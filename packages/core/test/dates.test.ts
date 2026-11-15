import { describe, expect, it } from 'vitest';
import { daysBetween, indiaDate, toEpochDay } from '../src';

describe('toEpochDay', () => {
  it('counts whole days since 1970-01-01', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('2024-02-29')).toBe(19782); // leap day
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  // BUG-013: only the day was verified, so month 13+ rolled into the next year and was accepted.
  it('rejects dates that are not on the calendar', () => {
    for (const bad of [
      '2025-14-03',
      '2025-13-01',
      '2025-00-10',
      '2025-02-30',
      '2025-04-31',
      '2023-02-29',
      '2025-01-00',
      '2025-1-5',
      '14-03-2025',
      '',
    ]) {
      expect(() => toEpochDay(bad), bad).toThrow(RangeError);
    }
  });

  it('uses the UTC calendar day of a Date', () => {
    expect(toEpochDay(new Date('2024-02-29T23:59:59Z'))).toBe(19782);
    expect(() => toEpochDay(new Date('nope'))).toThrow(RangeError);
  });
});

describe('indiaDate', () => {
  it('is the calendar date in Asia/Kolkata', () => {
    expect(indiaDate(new Date('2026-11-09T05:00:00Z'))).toBe('2026-11-09');
    expect(indiaDate(new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10'); // 01:30 IST next day
  });
});
