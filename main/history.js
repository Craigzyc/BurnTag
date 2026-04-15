import fs from 'node:fs';
import path from 'node:path';

export function appendRecord(data, filePath) {
  const record = { ...data, timestamp: new Date().toISOString() };
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

export function readHistory(filePath, limit = 100) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l))
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}
