import fs from 'node:fs';
import path from 'node:path';

/**
 * Profile-saveable fields — the full picture an operator switches between
 * device types. Anything missing here silently fails to round-trip, so when
 * adding a new top-level config field also add it here.
 *
 * `nextSerialNumber` is intentionally NOT included: it's a counter that
 * advances per-burn, not a per-profile setting.
 */
const PROFILE_KEYS = [
  'serialEnabled', 'serialPrefix', 'serialWriteToDevice',
  'serialDeviceKey', 'serialDeviceType',
  'chip', 'baudRate',
  'flashAddresses', 'flashEnabled',
  'firmwareBaseDir', 'selectedFirmware',
  'labelTemplate', 'labelTemplateName',
  'postFlashConfig',
  'fccIds',
];

function readStore(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeStore(store, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, filePath);
}

export function listProfiles(filePath) {
  const store = readStore(filePath);
  return Object.keys(store).map(name => {
    const s = store[name].settings || {};
    return {
      name,
      chip: s.chip === 'auto' ? 'esp32s3' : s.chip,
      fccCount: s.fccIds?.length || 0,
      configItemCount: s.postFlashConfig?.items?.length || 0,
      serialEnabled: !!s.serialEnabled,
      updatedAt: store[name].updatedAt,
    };
  });
}

export function saveProfile(filePath, name, data) {
  const store = readStore(filePath);
  const settings = {};
  for (const key of PROFILE_KEYS) {
    if (data[key] !== undefined) settings[key] = data[key];
  }
  store[name] = { settings, updatedAt: new Date().toISOString() };
  writeStore(store, filePath);
}

export function loadProfile(filePath, name) {
  const store = readStore(filePath);
  const profile = store[name];
  if (!profile) return null;
  // Profiles saved before chip="auto" was removed need to land on a real value
  // or the renderer's chip <select> silently rejects the assignment.
  if (profile.settings?.chip === 'auto') {
    profile.settings.chip = 'esp32s3';
  }
  return profile;
}

export function deleteProfile(filePath, name) {
  const store = readStore(filePath);
  delete store[name];
  writeStore(store, filePath);
}
