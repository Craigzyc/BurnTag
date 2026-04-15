import { describe, it, expect } from 'vitest';
import { formatSerial, getNextSerial } from '../main/serial-number.js';

describe('serial-number', () => {
  it('formats with zero-padded 6-digit suffix', () => {
    expect(formatSerial('FC', 1)).toBe('FC-000001');
    expect(formatSerial('FC', 999999)).toBe('FC-999999');
    expect(formatSerial('TEST', 42)).toBe('TEST-000042');
  });

  it('getNextSerial returns formatted serial and increments counter', () => {
    const config = { serialPrefix: 'FC', nextSerialNumber: 5 };
    expect(getNextSerial(config)).toBe('FC-000005');
    expect(config.nextSerialNumber).toBe(6);
  });
});
