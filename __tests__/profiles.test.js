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
      firmwareBaseDir: '/should/not/be/saved',
    });

    const loaded = loadProfile(profilesPath, 'Filtered');
    expect(loaded.settings.chip).toBe('esp32c3');
    expect(loaded.settings.firmwareBaseDir).toBeUndefined();
  });
});
