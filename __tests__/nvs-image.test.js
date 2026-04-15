import { describe, it, expect } from 'vitest';
import { buildNvsImage } from '../main/nvs-image.js';

const PAGE = 4096;
const HEADER = 32;
const BITMAP = 32;
const ENTRIES_OFFSET = HEADER + BITMAP;
const ENTRY = 32;

// Replicate the CRC used inside the module (seed 0xFFFFFFFF, no final XOR).
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32Le(seed, buf) {
  let c = seed >>> 0;
  for (let i = 0; i < buf.length; i++) c = ((c >>> 8) ^ TABLE[(c ^ buf[i]) & 0xFF]) >>> 0;
  return c >>> 0;
}

describe('buildNvsImage', () => {
  it('produces a partitionSize-sized buffer padded with 0xFF', () => {
    const img = buildNvsImage({
      namespace: 'config',
      items: [{ key: 'id', value: 1 }],
      partitionSize: 0x6000,
    });
    expect(img.length).toBe(0x6000);
    // Second page onward untouched.
    for (let i = PAGE; i < img.length; i++) expect(img[i]).toBe(0xFF);
  });

  it('writes a valid page header (state=ACTIVE, version=0xFE, CRC matches)', () => {
    const img = buildNvsImage({ namespace: 'config', items: [{ key: 'k', value: 1 }] });
    expect(img.readUInt32LE(0)).toBe(0xFFFFFFFE);
    expect(img.readUInt32LE(4)).toBe(0);           // seq_num
    expect(img[8]).toBe(0xFE);                     // version v2
    const expected = crc32Le(0xFFFFFFFF, img.subarray(4, 28));
    expect(img.readUInt32LE(28)).toBe(expected);
  });

  it('registers the namespace as entry 0 (ns=0, type=U8, data[0]=1)', () => {
    const img = buildNvsImage({ namespace: 'config', items: [] });
    const e0 = img.subarray(ENTRIES_OFFSET, ENTRIES_OFFSET + ENTRY);
    expect(e0[0]).toBe(0);          // ns_index = 0 (system)
    expect(e0[1]).toBe(0x01);       // type U8
    expect(e0[2]).toBe(1);          // span
    expect(e0[3]).toBe(0xFF);       // chunkIndex
    expect(e0.subarray(8, 8 + 'config'.length).toString('utf8')).toBe('config');
    expect(e0[24]).toBe(1);         // assigned ns index = 1
  });

  it('marks each written entry in the bitmap with bits = 10', () => {
    const img = buildNvsImage({
      namespace: 'config',
      items: [{ key: 'a', value: 1 }, { key: 'b', value: 2 }],
    });
    // 3 entries written (namespace + 2 items). For each, low bit of the
    // 2-bit pair is cleared, high bit stays 1 → pair = 0b10.
    for (let i = 0; i < 3; i++) {
      const byte = img[HEADER + (i >> 2)];
      const pair = (byte >> ((i & 3) * 2)) & 0b11;
      expect(pair).toBe(0b10);
    }
    // Entry 3 still empty (pair = 0b11).
    const byte = img[HEADER + 0];
    expect((byte >> 6) & 0b11).toBe(0b11);
  });

  it('packs a u32 value little-endian into the data field', () => {
    const img = buildNvsImage({
      namespace: 'ns',
      items: [{ key: 'id', value: 0x12345678, nvsType: 'u32' }],
    });
    const entry = img.subarray(ENTRIES_OFFSET + ENTRY, ENTRIES_OFFSET + 2 * ENTRY);
    expect(entry[1]).toBe(0x04); // U32 type
    expect(entry.readUInt32LE(24)).toBe(0x12345678);
  });

  it('stores strings as descriptor + data entries with correct size and CRC', () => {
    const str = 'hello';
    const img = buildNvsImage({
      namespace: 'ns',
      items: [{ key: 'name', value: str, nvsType: 'string' }],
    });
    const descriptor = img.subarray(ENTRIES_OFFSET + ENTRY, ENTRIES_OFFSET + 2 * ENTRY);
    expect(descriptor[1]).toBe(0x21); // STR type
    expect(descriptor[2]).toBe(2);    // span: descriptor + 1 data entry
    const size = descriptor.readUInt16LE(24);
    expect(size).toBe(str.length + 1); // +1 for null
    const dataEntry = img.subarray(ENTRIES_OFFSET + 2 * ENTRY, ENTRIES_OFFSET + 3 * ENTRY);
    const payload = Buffer.from(str + '\0', 'utf8');
    const expectedCrc = crc32Le(0xFFFFFFFF, payload);
    expect(descriptor.readUInt32LE(28)).toBe(expectedCrc);
    expect(dataEntry.subarray(0, size).toString('utf8')).toBe(str + '\0');
    // Tail of data entry is 0xFF-padded.
    for (let i = size; i < ENTRY; i++) expect(dataEntry[i]).toBe(0xFF);
  });

  it('each entry CRC covers bytes 0-3 + 8-31, skipping the CRC field', () => {
    const img = buildNvsImage({
      namespace: 'ns',
      items: [{ key: 'id', value: 42, nvsType: 'u8' }],
    });
    // Validate the namespace entry's CRC.
    const e0 = img.subarray(ENTRIES_OFFSET, ENTRIES_OFFSET + ENTRY);
    let crc = crc32Le(0xFFFFFFFF, e0.subarray(0, 4));
    crc = crc32Le(crc, e0.subarray(8, 32));
    expect(e0.readUInt32LE(4)).toBe(crc);
    // And the item entry.
    const e1 = img.subarray(ENTRIES_OFFSET + ENTRY, ENTRIES_OFFSET + 2 * ENTRY);
    let crc2 = crc32Le(0xFFFFFFFF, e1.subarray(0, 4));
    crc2 = crc32Le(crc2, e1.subarray(8, 32));
    expect(e1.readUInt32LE(4)).toBe(crc2);
  });

  it('rejects out-of-range values', () => {
    expect(() => buildNvsImage({
      namespace: 'ns', items: [{ key: 'k', value: 300, nvsType: 'u8' }],
    })).toThrow(/u8/);
  });

  it('rejects keys longer than 15 chars', () => {
    expect(() => buildNvsImage({
      namespace: 'ns', items: [{ key: 'a'.repeat(16), value: 1 }],
    })).toThrow(/too long/);
  });
});
