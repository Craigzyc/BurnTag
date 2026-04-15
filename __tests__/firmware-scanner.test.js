import { describe, it, expect } from 'vitest';
import { scanFirmwareDirs, findBinFiles, scanAll } from '../main/firmware-scanner.js';
import path from 'node:path';

const FIRMWARE_BASE = path.resolve(import.meta.dirname, '../../firmware');

describe('firmware-scanner', () => {
  it('discovers firmware directories under sensors/ and gateway/', () => {
    const dirs = scanFirmwareDirs(FIRMWARE_BASE);
    const names = dirs.map(d => d.name);
    expect(names).toContain('esp32s3-test');
    expect(dirs.find(d => d.name === 'esp32s3-test').category).toBe('sensors');
  });

  it('finds .bin files for esp32s3-test build', () => {
    const firmwareDir = path.join(FIRMWARE_BASE, 'sensors', 'esp32s3-test');
    const builds = findBinFiles(firmwareDir);
    const testBuild = builds.find(b => b.env === 'test');
    expect(testBuild).toBeDefined();
    expect(testBuild.files.firmware).toMatch(/firmware\.bin$/);
  });

  it('returns empty builds for firmware with no .pio/build', () => {
    const builds = findBinFiles(path.join(FIRMWARE_BASE, 'sensors', 'temp-rh'));
    expect(builds).toEqual([]);
  });
});
