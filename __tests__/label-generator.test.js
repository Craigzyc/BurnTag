import { describe, it, expect } from 'vitest';
import { resolveTemplate, generateLabel } from '../main/label-generator.js';
import { getDefaultTemplate } from '../main/printer-registry.js';
import sharp from 'sharp';

describe('resolveTemplate', () => {
  it('replaces {serial} and {mac} variables', () => {
    const result = resolveTemplate('S/N: {serial} MAC: {mac}', {
      serial: 'FC-000001',
      mac: 'AA:BB:CC:DD:EE:FF',
    });
    expect(result).toBe('S/N: FC-000001 MAC: AA:BB:CC:DD:EE:FF');
  });

  it('replaces {fcc_line_N} variables', () => {
    const result = resolveTemplate('FCC ID: {fcc_line_1} IC: {fcc_line_2}', {
      fccIds: [
        { chip: 'ESP32-S3', id: '2AC7Z-ESPS3' },
        { chip: 'nRF52840', id: '2ABCB-NRF52' },
      ],
    });
    expect(result).toBe('FCC ID: ESP32-S3 : 2AC7Z-ESPS3 IC: nRF52840 : 2ABCB-NRF52');
  });

  it('replaces {fcc_ids} with comma-joined list', () => {
    const result = resolveTemplate('IDs: {fcc_ids}', {
      fccIds: [
        { chip: 'ESP32', id: 'ABC' },
        { chip: 'BLE', id: 'DEF' },
      ],
    });
    expect(result).toBe('IDs: ESP32: ABC, BLE: DEF');
  });

  it('returns defaults for missing variables', () => {
    const result = resolveTemplate('S/N: {serial} MAC: {mac}', {});
    expect(result).toBe('S/N: FC-000000 MAC: 00:00:00:00:00:00');
  });

  it('leaves unrecognized variables as-is', () => {
    const result = resolveTemplate('Hello {unknown}', {});
    expect(result).toBe('Hello {unknown}');
  });
});

describe('generateLabel', () => {
  it('generates a PNG buffer with default template', async () => {
    const template = getDefaultTemplate();
    const buffer = await generateLabel(template, {
      serial: 'FC-000001',
      mac: 'AA:BB:CC:DD:EE:FF',
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
    // Default: niimbot-b21-pro, 50x30mm, 300 DPI → 592x360 (aligned to 8)
    expect(meta.width).toBe(592);
    expect(meta.height).toBe(360);
  });

  it('generates correct size for different printer/label', async () => {
    const template = {
      ...getDefaultTemplate(),
      printer: 'niimbot-b21',
      labelSize: '40x30',
    };
    const buffer = await generateLabel(template, { serial: 'TEST' });
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
    // niimbot-b21 = 203 DPI, 40x30mm landscape → ~320x240
    expect(meta.width).toBeGreaterThan(300);
    expect(meta.width).toBeLessThan(340);
  });

  it('generates valid label with no header', async () => {
    const template = { ...getDefaultTemplate(), header: { text: '' } };
    const buffer = await generateLabel(template, { serial: 'FC-000042' });
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
  });

  it('generates valid label with QR disabled', async () => {
    const template = { ...getDefaultTemplate(), qr: { enabled: false } };
    const buffer = await generateLabel(template, { serial: 'FC-000099' });
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
  });

  it('generates valid label with empty lines', async () => {
    const template = { ...getDefaultTemplate(), lines: [] };
    const buffer = await generateLabel(template, {});
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
  });
});
