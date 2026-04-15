/**
 * Minimal NVS (Non-Volatile Storage) partition image builder.
 *
 * Produces a byte-for-byte compatible ESP-IDF NVS v2 partition blob containing
 * a single namespace with string / uint8 / uint16 / uint32 / int32 values.
 * The blob is flashed alongside firmware at the `nvs` partition offset so the
 * device reads provisioning values on boot via the normal Preferences /
 * nvs_get_* APIs — no runtime serial RPC required.
 *
 * Scope: one page (4096 bytes) maximum, i.e. up to ~125 entries. For
 * factory-provision data (device id, customer key, region, model) this is
 * more than enough. If you outgrow it, pre-generate the image with Espressif's
 * `nvs_partition_gen.py` and skip this module.
 *
 * Reference layout: ESP-IDF `components/nvs_flash/src/nvs_page.cpp` and
 * docs/api-reference/storage/nvs_flash.html (v2 format, version byte 0xFE).
 */

const PAGE_SIZE = 4096;
const HEADER_SIZE = 32;
const BITMAP_SIZE = 32;
const ENTRIES_OFFSET = HEADER_SIZE + BITMAP_SIZE; // 64
const ENTRY_SIZE = 32;
const MAX_ENTRIES_PER_PAGE = (PAGE_SIZE - ENTRIES_OFFSET) / ENTRY_SIZE; // 126
const KEY_MAX_LEN = 15; // 16 bytes including null

// NVS item types (ESP-IDF nvs_types.h)
const TYPE = {
  U8:  0x01,
  I8:  0x11,
  U16: 0x02,
  I16: 0x12,
  U32: 0x04,
  I32: 0x14,
  STR: 0x21,
};

// Page header state values
const STATE_ACTIVE = 0xFFFFFFFE;
const PAGE_VERSION_V2 = 0xFE;

// CRC-32/ISO-HDLC table (reflected poly 0xEDB88320). Matches ESP-IDF crc32_le.
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

/** ESP-IDF-compatible CRC32 (seed 0xFFFFFFFF, no final XOR). */
function crc32Le(crc, buf) {
  let c = crc >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c = ((c >>> 8) ^ CRC32_TABLE[(c ^ buf[i]) & 0xFF]) >>> 0;
  }
  return c >>> 0;
}

/**
 * Build an NVS partition image from a list of {key, value, nvsType} items.
 *
 * @param {object} opts
 * @param {string} opts.namespace - namespace name (≤15 chars)
 * @param {Array<{key: string, value: string|number, nvsType?: string}>} opts.items
 * @param {number} [opts.partitionSize=0x6000] - total image size in bytes (must be ≥ 4096 and a multiple of 4096)
 * @returns {Buffer} partition image, `partitionSize` bytes, 0xFF-padded.
 */
export function buildNvsImage({ namespace, items, partitionSize = 0x6000 }) {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('NVS: namespace is required');
  }
  if (namespace.length > KEY_MAX_LEN) {
    throw new Error(`NVS: namespace "${namespace}" too long (max ${KEY_MAX_LEN} chars)`);
  }
  if (partitionSize < PAGE_SIZE || partitionSize % PAGE_SIZE !== 0) {
    throw new Error(`NVS: partitionSize must be ≥${PAGE_SIZE} and a multiple of ${PAGE_SIZE}`);
  }

  const page = Buffer.alloc(PAGE_SIZE, 0xFF);
  const entries = [];

  // Entry 0: namespace registration (ns=0, type=U8, key=namespace, data=1).
  // Namespace index 1 is then used for all user entries.
  const USER_NS_INDEX = 1;
  entries.push(buildPrimitiveEntry({
    nsIndex: 0,
    type: TYPE.U8,
    span: 1,
    chunkIndex: 0xFF,
    key: namespace,
    dataBytes: [USER_NS_INDEX, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
  }));

  // User entries
  for (const item of items) {
    if (!item.key) throw new Error('NVS: each item needs a key');
    if (item.key.length > KEY_MAX_LEN) {
      throw new Error(`NVS: key "${item.key}" too long (max ${KEY_MAX_LEN} chars)`);
    }
    const nvsType = (item.nvsType || inferType(item.value)).toLowerCase();
    entries.push(...buildItemEntries(USER_NS_INDEX, item.key, item.value, nvsType));
  }

  if (entries.length > MAX_ENTRIES_PER_PAGE) {
    throw new Error(
      `NVS: image needs ${entries.length} entries but one page holds ${MAX_ENTRIES_PER_PAGE}. ` +
      `Reduce item count or pre-generate with nvs_partition_gen.py for multi-page support.`
    );
  }

  // Write page header
  const header = Buffer.alloc(HEADER_SIZE, 0xFF);
  header.writeUInt32LE(STATE_ACTIVE, 0);
  header.writeUInt32LE(0, 4); // seq_num
  header.writeUInt8(PAGE_VERSION_V2, 8);
  // bytes 9..27 stay 0xFF
  const headerCrc = crc32Le(0xFFFFFFFF, header.subarray(4, 28));
  header.writeUInt32LE(headerCrc, 28);
  header.copy(page, 0);

  // Write entries
  for (let i = 0; i < entries.length; i++) {
    entries[i].copy(page, ENTRIES_OFFSET + i * ENTRY_SIZE);
  }

  // Write bitmap: 2 bits per entry, 0b11 = empty (initial 0xFF), 0b10 = written.
  // To mark entry i as written, clear its low bit in the pair.
  for (let i = 0; i < entries.length; i++) {
    const byteIdx = HEADER_SIZE + (i >> 2);
    const bitPos = (i & 3) * 2;
    page[byteIdx] &= ~(1 << bitPos) & 0xFF;
  }

  // Pad to full partition size (all additional pages remain erased = 0xFF).
  const image = Buffer.alloc(partitionSize, 0xFF);
  page.copy(image, 0);
  return image;
}

function inferType(value) {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value < 0) return 'i32';
    if (value <= 0xFF) return 'u8';
    if (value <= 0xFFFF) return 'u16';
    return 'u32';
  }
  throw new Error(`NVS: cannot infer type for value ${JSON.stringify(value)}`);
}

function buildItemEntries(nsIndex, key, value, nvsType) {
  switch (nvsType) {
    case 'u8':  return [primitive(nsIndex, TYPE.U8,  key, u8(value))];
    case 'i8':  return [primitive(nsIndex, TYPE.I8,  key, i8(value))];
    case 'u16': return [primitive(nsIndex, TYPE.U16, key, u16(value))];
    case 'i16': return [primitive(nsIndex, TYPE.I16, key, i16(value))];
    case 'u32': return [primitive(nsIndex, TYPE.U32, key, u32(value))];
    case 'i32': return [primitive(nsIndex, TYPE.I32, key, i32(value))];
    case 'string':
    case 'str': return stringEntries(nsIndex, key, String(value));
    default: throw new Error(`NVS: unsupported type "${nvsType}" for key "${key}"`);
  }
}

function primitive(nsIndex, type, key, dataBytes) {
  return buildPrimitiveEntry({ nsIndex, type, span: 1, chunkIndex: 0xFF, key, dataBytes });
}

function stringEntries(nsIndex, key, str) {
  // Include null terminator in stored bytes and in declared size.
  const payload = Buffer.from(str + '\0', 'utf8');
  const size = payload.length;
  const dataEntries = Math.ceil(size / ENTRY_SIZE);
  const span = 1 + dataEntries;
  if (span > 255) throw new Error(`NVS: string "${key}" too large (${size} bytes)`);

  const payloadCrc = crc32Le(0xFFFFFFFF, payload);

  // Descriptor entry's 8-byte data:
  //   [0..1] size u16 LE (bytes including null)
  //   [2..3] reserved = 0xFFFF
  //   [4..7] crc32 of payload LE
  const descData = Buffer.alloc(8, 0xFF);
  descData.writeUInt16LE(size, 0);
  descData.writeUInt32LE(payloadCrc, 4);

  const descriptor = buildPrimitiveEntry({
    nsIndex, type: TYPE.STR, span, chunkIndex: 0xFF,
    key, dataBytes: Array.from(descData),
  });

  const entries = [descriptor];
  // Data entries: 32-byte chunks, 0xFF-padded on the tail.
  for (let i = 0; i < dataEntries; i++) {
    const chunk = Buffer.alloc(ENTRY_SIZE, 0xFF);
    payload.copy(chunk, 0, i * ENTRY_SIZE, Math.min((i + 1) * ENTRY_SIZE, size));
    entries.push(chunk);
  }
  return entries;
}

function buildPrimitiveEntry({ nsIndex, type, span, chunkIndex, key, dataBytes }) {
  const entry = Buffer.alloc(ENTRY_SIZE, 0);
  entry.writeUInt8(nsIndex, 0);
  entry.writeUInt8(type, 1);
  entry.writeUInt8(span, 2);
  entry.writeUInt8(chunkIndex, 3);
  // CRC at offset 4..8 — filled in after.

  // Key: UTF-8, null-terminated, zero-padded to 16 bytes.
  const keyBuf = Buffer.from(key, 'utf8');
  keyBuf.copy(entry, 8, 0, Math.min(keyBuf.length, KEY_MAX_LEN));
  // bytes [8 + keyLen .. 24] remain zero from alloc(0)

  // Data: 8 bytes at offset 24
  Buffer.from(dataBytes).copy(entry, 24, 0, 8);

  // CRC over bytes 0..3 (header) + 8..31 (key + data), skipping CRC field.
  let crc = crc32Le(0xFFFFFFFF, entry.subarray(0, 4));
  crc = crc32Le(crc, entry.subarray(8, 32));
  entry.writeUInt32LE(crc, 4);

  return entry;
}

// ─── Primitive packers ───────────────────────────────────────────
function u8(v)  { return [checkRange(v, 0, 0xFF, 'u8'),  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]; }
function i8(v)  { const b = Buffer.alloc(8, 0xFF); b.writeInt8(checkRange(v, -0x80, 0x7F, 'i8'), 0); return Array.from(b); }
function u16(v) { const b = Buffer.alloc(8, 0xFF); b.writeUInt16LE(checkRange(v, 0, 0xFFFF, 'u16'), 0); return Array.from(b); }
function i16(v) { const b = Buffer.alloc(8, 0xFF); b.writeInt16LE(checkRange(v, -0x8000, 0x7FFF, 'i16'), 0); return Array.from(b); }
function u32(v) { const b = Buffer.alloc(8, 0xFF); b.writeUInt32LE(checkRange(v, 0, 0xFFFFFFFF, 'u32'), 0); return Array.from(b); }
function i32(v) { const b = Buffer.alloc(8, 0xFF); b.writeInt32LE(checkRange(v, -0x80000000, 0x7FFFFFFF, 'i32'), 0); return Array.from(b); }

function checkRange(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`NVS: value ${v} out of range for ${label} (${min}..${max})`);
  }
  return n;
}
