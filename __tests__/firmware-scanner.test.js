import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { scanFirmwareDir } from '../main/firmware-scanner.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'burntag-fwscan-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

describe('scanFirmwareDir', () => {
  it('returns kind:empty when the directory is empty', () => {
    expect(scanFirmwareDir(tmp)).toEqual({ kind: 'empty' });
  });

  it('returns kind:empty when the directory does not exist', () => {
    expect(scanFirmwareDir(path.join(tmp, 'nope'))).toEqual({ kind: 'empty' });
  });

  it('returns kind:single when firmware.bin lives directly in the dir', () => {
    touch(path.join(tmp, 'firmware.bin'));
    touch(path.join(tmp, 'bootloader.bin'));
    touch(path.join(tmp, 'partitions.bin'));

    const result = scanFirmwareDir(tmp);
    expect(result.kind).toBe('single');
    expect(result.files.firmware).toMatch(/firmware\.bin$/);
    expect(result.files.bootloader).toMatch(/bootloader\.bin$/);
    expect(result.files.partitions).toMatch(/partitions\.bin$/);
  });

  it('returns kind:single with null siblings when only firmware.bin exists', () => {
    touch(path.join(tmp, 'firmware.bin'));
    const result = scanFirmwareDir(tmp);
    expect(result.kind).toBe('single');
    expect(result.files.bootloader).toBeNull();
    expect(result.files.partitions).toBeNull();
  });

  it('returns kind:multi for a PlatformIO multi-env tree', () => {
    touch(path.join(tmp, '.pio', 'build', 'esp32-release', 'firmware.bin'));
    touch(path.join(tmp, '.pio', 'build', 'esp32-release', 'bootloader.bin'));
    touch(path.join(tmp, '.pio', 'build', 'esp32-debug', 'firmware.bin'));

    const result = scanFirmwareDir(tmp);
    expect(result.kind).toBe('multi');
    expect(result.builds).toHaveLength(2);
    const labels = result.builds.map(b => b.label).sort();
    expect(labels).toEqual(['[esp32-debug]', '[esp32-release]']);
  });

  it('returns kind:multi for the legacy sensors/gateway tree', () => {
    touch(path.join(tmp, 'sensors', 'temp', '.pio', 'build', 'release', 'firmware.bin'));
    touch(path.join(tmp, 'gateway', 'main', '.pio', 'build', 'c3', 'firmware.bin'));

    const result = scanFirmwareDir(tmp);
    expect(result.kind).toBe('multi');
    expect(result.builds.map(b => b.label).sort()).toEqual([
      'gateway/main [c3]',
      'sensors/temp [release]',
    ]);
  });

  it('prefers single-folder layout over .pio when both apply', () => {
    touch(path.join(tmp, 'firmware.bin'));
    touch(path.join(tmp, '.pio', 'build', 'env', 'firmware.bin'));

    const result = scanFirmwareDir(tmp);
    expect(result.kind).toBe('single');
  });
});
