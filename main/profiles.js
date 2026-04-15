import fs from 'node:fs';
import path from 'node:path';

/**
 * Profile-saveable fields — everything an operator would want to switch
 * between device types without re-entering.
 */
const PROFILE_KEYS = [
  'serialPrefix', 'serialWriteToDevice', 'serialDeviceKey', 'serialDeviceType',
  'chip', 'baudRate',
  'flashAddresses', 'labelTemplate',
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
  return Object.keys(store).map(name => ({
    name,
    chip: store[name].settings?.chip,
    fccCount: store[name].settings?.fccIds?.length || 0,
    updatedAt: store[name].updatedAt,
  }));
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
  return store[name] || null;
}

export function deleteProfile(filePath, name) {
  const store = readStore(filePath);
  delete store[name];
  writeStore(store, filePath);
}
