import fs from 'node:fs';
import path from 'node:path';

/**
 * Label template storage — separate from device profiles.
 * Stored as { "Template Name": { ...templateData }, ... }
 */

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

export function listLabelTemplates(filePath) {
  const store = readStore(filePath);
  return Object.keys(store).map(name => ({
    name,
    printer: store[name].printer,
    labelSize: store[name].labelSize,
    headerText: store[name].header?.text || '',
  }));
}

export function saveLabelTemplate(filePath, name, template) {
  const store = readStore(filePath);
  store[name] = template;
  writeStore(store, filePath);
}

export function loadLabelTemplate(filePath, name) {
  const store = readStore(filePath);
  return store[name] || null;
}

export function deleteLabelTemplate(filePath, name) {
  const store = readStore(filePath);
  delete store[name];
  writeStore(store, filePath);
}
