// SEC-002 / SEC-004: per-user write limits and bounded document growth.
import { describe, expect, it } from 'vitest';
import {
  appendHistory,
  assertLedgerSize,
  MAX_ACTIVE_TRANSACTIONS,
  MAX_INSTRUMENTS,
  nextWriteCounters,
  WRITE_LIMIT_PER_DAY,
  WRITE_LIMIT_PER_MINUTE,
} from '@/server/limits';

const now = new Date('2026-11-09T10:00:30Z');
const minute = Math.floor(now.getTime() / 60_000);
const today = '2026-11-09';

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as { status?: number; code?: string }).status;
  }
};

describe('nextWriteCounters', () => {
  it('starts fresh and counts up', () => {
    expect(nextWriteCounters(undefined, now, today)).toEqual({
      writeMinute: minute,
      writesThisMinute: 1,
      writeDay: today,
      writesToday: 1,
    });
    expect(
      nextWriteCounters(
        { writeMinute: minute, writesThisMinute: 4, writeDay: today, writesToday: 9 },
        now,
        today,
      ),
    ).toMatchObject({ writesThisMinute: 5, writesToday: 10 });
  });

  it('rejects the write over the per-minute limit with 429', () => {
    const meta = {
      writeMinute: minute,
      writesThisMinute: WRITE_LIMIT_PER_MINUTE,
      writeDay: today,
      writesToday: WRITE_LIMIT_PER_MINUTE,
    };
    expect(status(() => nextWriteCounters(meta, now, today))).toBe(429);
    // a new minute resets the window
    expect(status(() => nextWriteCounters(meta, new Date(now.getTime() + 60_000), today))).toBe(
      200,
    );
  });

  it('rejects the write over the daily limit; a new day resets it', () => {
    const meta = {
      writeMinute: minute - 5,
      writesThisMinute: 1,
      writeDay: today,
      writesToday: WRITE_LIMIT_PER_DAY,
    };
    expect(status(() => nextWriteCounters(meta, now, today))).toBe(429);
    expect(status(() => nextWriteCounters(meta, now, '2026-11-10'))).toBe(200);
  });
});

describe('assertLedgerSize', () => {
  it('allows up to the ceilings and rejects beyond them', () => {
    expect(status(() => assertLedgerSize(MAX_ACTIVE_TRANSACTIONS, MAX_INSTRUMENTS))).toBe(200);
    expect(status(() => assertLedgerSize(MAX_ACTIVE_TRANSACTIONS + 1, 1))).toBe(422);
    expect(status(() => assertLedgerSize(1, MAX_INSTRUMENTS + 1))).toBe(422);
  });
});

describe('appendHistory', () => {
  it('keeps only the newest entries', () => {
    const h = Array.from({ length: 60 }, (_, i) => i).reduce<number[]>(
      (acc, i) => appendHistory(acc, i, 50),
      [],
    );
    expect(h).toHaveLength(50);
    expect(h[0]).toBe(10);
    expect(h.at(-1)).toBe(59);
  });
});
