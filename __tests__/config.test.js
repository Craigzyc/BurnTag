import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDefaults, loadConfig, saveConfig } from '../main/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('config', () => {
  let tmpDir, configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-config-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns complete defaults when no config file exists', () => {
    const config = loadConfig(configPath);
    expect(config.serialPrefix).toBe('FC');
    expect(config.nextSerialNumber).toBe(1);
    expect(config.fccIds).toEqual([]);
    expect(config.activeProfile).toBeNull();
    expect(config.flashAddresses).toEqual({
      bootloader: '0x0',
      partitions: '0x8000',
      firmware: '0x10000',
    });
    expect(config.autoMode).toBe(false);
    expect(config.labelTemplate).toBeDefined();
    expect(config.labelTemplate.printer).toBe('niimbot-b21-pro');
    expect(config.labelTemplate.header.text).toBe('');
  });

  it('saves and reloads config with fccIds array', () => {
    const config = loadConfig(configPath);
    config.fccIds = [{ chip: 'ESP32-S3', id: '2AC7Z-ESPS3' }];
    config.nextSerialNumber = 42;
    saveConfig(config, configPath);

    const reloaded = loadConfig(configPath);
    expect(reloaded.fccIds).toEqual([{ chip: 'ESP32-S3', id: '2AC7Z-ESPS3' }]);
    expect(reloaded.nextSerialNumber).toBe(42);
  });

  it('merges defaults for missing keys in partial config', () => {
    fs.writeFileSync(configPath, JSON.stringify({ serialPrefix: 'PARTIAL' }));
    const config = loadConfig(configPath);
    expect(config.serialPrefix).toBe('PARTIAL');
    expect(config.fccIds).toEqual([]);
    expect(config.labelTemplate).toBeDefined();
    expect(config.labelTemplate.printer).toBe('niimbot-b21-pro');
  });

  it('saves and restores labelTemplate', () => {
    const config = loadConfig(configPath);
    config.labelTemplate.header.text = 'MyBrand';
    config.labelTemplate.printer = 'niimbot-b21';
    saveConfig(config, configPath);

    const reloaded = loadConfig(configPath);
    expect(reloaded.labelTemplate.header.text).toBe('MyBrand');
    expect(reloaded.labelTemplate.printer).toBe('niimbot-b21');
  });

  it('saves and restores activeProfile', () => {
    const config = loadConfig(configPath);
    config.activeProfile = 'Sensor Node';
    saveConfig(config, configPath);
    expect(loadConfig(configPath).activeProfile).toBe('Sensor Node');
  });
});
