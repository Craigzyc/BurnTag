import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listProfiles, saveProfile, loadProfile, deleteProfile } from '../main/profiles.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('profiles', () => {
  let tmpDir, profilesPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-profiles-'));
    profilesPath = path.join(tmpDir, 'profiles.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no profiles file exists', () => {
    expect(listProfiles(profilesPath)).toEqual([]);
  });

  it('saves and reloads a profile with chip and flash settings', () => {
    const data = {
      chip: 'esp32s3',
      serialPrefix: 'FC',
      baudRate: 921600,
      flashAddresses: { bootloader: '0x0', partitions: '0x8000', firmware: '0x10000' },
    };

    saveProfile(profilesPath, 'Test Device', data);
    const loaded = loadProfile(profilesPath, 'Test Device');

    expect(loaded).not.toBeNull();
    expect(loaded.settings.chip).toBe('esp32s3');
    expect(loaded.settings.serialPrefix).toBe('FC');
    expect(loaded.updatedAt).toBeTruthy();
  });

  it('returns null for non-existent profile', () => {
    expect(loadProfile(profilesPath, 'Does Not Exist')).toBeNull();
  });

  it('deletes a profile', () => {
    saveProfile(profilesPath, 'ToDelete', { chip: 'esp32' });
    expect(listProfiles(profilesPath)).toHaveLength(1);
    deleteProfile(profilesPath, 'ToDelete');
    expect(listProfiles(profilesPath)).toHaveLength(0);
  });

  it('lists multiple saved profiles', () => {
    saveProfile(profilesPath, 'Sensor Node', { chip: 'esp32s3', serialPrefix: 'SN' });
    saveProfile(profilesPath, 'Gateway', { chip: 'esp32', serialPrefix: 'GW' });

    const profiles = listProfiles(profilesPath);
    expect(profiles).toHaveLength(2);
    expect(profiles.map(p => p.name)).toContain('Sensor Node');
    expect(profiles.map(p => p.name)).toContain('Gateway');
  });

  it('only saves profile-allowed keys', () => {
    saveProfile(profilesPath, 'Filtered', {
      chip: 'esp32c3',
      nextSerialNumber: 42,        // counter — not a per-profile setting
      activeProfile: 'somethingElse', // shouldn't round-trip into the profile
      randomKey: 'nope',
    });

    const loaded = loadProfile(profilesPath, 'Filtered');
    expect(loaded.settings.chip).toBe('esp32c3');
    expect(loaded.settings.nextSerialNumber).toBeUndefined();
    expect(loaded.settings.activeProfile).toBeUndefined();
    expect(loaded.settings.randomKey).toBeUndefined();
  });

  it('saves the full settings bundle a renderer would send', () => {
    const data = {
      serialEnabled: true,
      serialPrefix: 'FC',
      chip: 'esp32s3',
      baudRate: 921600,
      flashAddresses: { bootloader: '0x0', partitions: '0x8000', firmware: '0x10000' },
      flashEnabled: { bootloader: true, partitions: false, firmware: true },
      firmwareBaseDir: '/path/to/firmware',
      labelTemplate: { header: { text: 'Hello' }, lines: [] },
      postFlashConfig: { enabled: true, items: [{ key: 'id', value: 5, autoIncrement: true }] },
    };
    saveProfile(profilesPath, 'Full', data);
    const loaded = loadProfile(profilesPath, 'Full');

    expect(loaded.settings.serialEnabled).toBe(true);
    expect(loaded.settings.flashEnabled).toEqual({ bootloader: true, partitions: false, firmware: true });
    expect(loaded.settings.firmwareBaseDir).toBe('/path/to/firmware');
    expect(loaded.settings.labelTemplate.header.text).toBe('Hello');
    expect(loaded.settings.postFlashConfig.items[0].autoIncrement).toBe(true);
  });

  it('migrates legacy chip="auto" on load', () => {
    saveProfile(profilesPath, 'Legacy', { chip: 'auto', serialPrefix: 'L' });
    // Hand-edit the profile to bypass any future save-side migration we add.
    const raw = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
    raw.Legacy.settings.chip = 'auto';
    fs.writeFileSync(profilesPath, JSON.stringify(raw));

    const loaded = loadProfile(profilesPath, 'Legacy');
    expect(loaded.settings.chip).toBe('esp32s3');
  });
});
