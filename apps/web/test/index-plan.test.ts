// When and how much benchmark history to fetch, and how closes are stored by year.
import { describe, expect, it } from 'vitest';
import { closesByYear, planIndexFetch } from '@/server/index-plan';

const NOW = Date.parse('2026-11-15T06:00:00Z');
const TODAY = '2026-11-15';

describe('planIndexFetch', () => {
  it('fetches ten years the first time', () => {
    expect(planIndexFetch(undefined, TODAY, NOW)).toBe('10y');
    expect(planIndexFetch({}, TODAY, NOW)).toBe('10y');
  });

  it('does nothing more once checked today', () => {
    expect(planIndexFetch({ checkedDay: TODAY, to: '2026-11-14' }, TODAY, NOW)).toBe('skip');
  });

  it('fetches only enough to cover the gap since the last stored close', () => {
    expect(planIndexFetch({ checkedDay: '2026-11-14', to: '2026-11-14' }, TODAY, NOW)).toBe('1mo');
    expect(planIndexFetch({ checkedDay: '2026-09-01', to: '2026-09-01' }, TODAY, NOW)).toBe('1y');
    expect(planIndexFetch({ checkedDay: '2025-01-01', to: '2025-01-01' }, TODAY, NOW)).toBe('10y');
  });

  it('waits before retrying after a failure', () => {
    const doc = { to: '2026-11-13', retryAfter: NOW + 60_000 };
    expect(planIndexFetch(doc, TODAY, NOW)).toBe('skip');
    expect(planIndexFetch(doc, TODAY, NOW + 61_000)).toBe('1mo');
  });
});

describe('closesByYear', () => {
  it('splits closes into one map per year', () => {
    expect(
      closesByYear([
        { date: '2025-12-31', close: 100 },
        { date: '2026-01-01', close: 101 },
        { date: '2026-01-02', close: 102.5 },
      ]),
    ).toEqual(
      new Map([
        ['2025', { '2025-12-31': 100 }],
        ['2026', { '2026-01-01': 101, '2026-01-02': 102.5 }],
      ]),
    );
  });
});
