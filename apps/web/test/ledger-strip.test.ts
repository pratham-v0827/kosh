// BUG-014: the purchase-date quality of statement lots was dropped when a stored transaction was
// read back, so the first recompute after an import (for example the refresh that follows it)
// showed XIRR for holdings with no purchase dates, and lost the "approximate" label.
import { describe, expect, it } from 'vitest';
import { stripMeta } from '@/server/ledger';

const stored = {
  accountId: 'import:groww',
  instrumentId: 'IN_EQUITY:ITC',
  type: 'OPENING_BALANCE' as const,
  tradeDate: '2026-10-31',
  qty: '10',
  price: '400',
  currency: 'INR' as const,
  seq: 1,
  // stored metadata the ledger maths must not see
  status: 'active' as const,
  source: 'import' as const,
  fingerprint: 'f'.repeat(64),
  importId: 'imp1',
  parser: 'groww.holdings@1.0.0',
  createdAt: {} as never,
};

describe('stripMeta', () => {
  it('keeps the date quality of a statement lot', () => {
    expect(stripMeta({ ...stored, dateQuality: 'unknown' }).dateQuality).toBe('unknown');
    expect(stripMeta({ ...stored, dateQuality: 'approximate' }).dateQuality).toBe('approximate');
  });

  it('leaves an exact (manual) transaction without the field', () => {
    expect(stripMeta(stored)).not.toHaveProperty('dateQuality');
  });

  it('drops storage metadata', () => {
    const out = stripMeta({ ...stored, dateQuality: 'unknown' }) as Record<string, unknown>;
    for (const k of ['status', 'source', 'fingerprint', 'importId', 'parser', 'createdAt']) {
      expect(out).not.toHaveProperty(k);
    }
  });
});
