import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendRecord, readHistory } from '../main/history.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('history', () => {
  let tmpDir, historyPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-hist-'));
    historyPath = path.join(tmpDir, 'history.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends a record with auto-generated timestamp', () => {
    appendRecord({ serial: 'FC-000001', mac: 'AA:BB:CC:DD:EE:FF' }, historyPath);
    const records = readHistory(historyPath);
    expect(records).toHaveLength(1);
    expect(records[0].serial).toBe('FC-000001');
    expect(records[0].timestamp).toBeDefined();
  });

  it('reads multiple records in reverse chronological order', () => {
    appendRecord({ serial: 'FC-000001' }, historyPath);
    appendRecord({ serial: 'FC-000002' }, historyPath);
    appendRecord({ serial: 'FC-000003' }, historyPath);
    const records = readHistory(historyPath);
    expect(records[0].serial).toBe('FC-000003');
    expect(records[2].serial).toBe('FC-000001');
  });

  it('returns empty array when file does not exist', () => {
    expect(readHistory(path.join(tmpDir, 'nope.jsonl'))).toEqual([]);
  });
});
