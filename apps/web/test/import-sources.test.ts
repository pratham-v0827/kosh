import { describe, expect, it } from 'vitest';
import { lastImportOf } from '@/lib/import-sources';

const imp = (parser: string, status: 'draft' | 'confirmed' | 'undone' = 'confirmed') => ({
  parser,
  status,
});

describe('lastImportOf: the newest confirmed import of a source', () => {
  it('finds the newest confirmed import of that parser, whatever its version', () => {
    const list = [
      imp('groww.holdings@1.1.0', 'draft'),
      imp('kosh.csv@1.0.0'),
      imp('groww.holdings@1.0.0'),
      imp('groww.holdings@0.9.0'),
    ];
    expect(lastImportOf(list, 'groww.holdings', true)).toEqual({
      kind: 'found',
      import: list[2],
    });
  });

  it('ignores undone imports and a parser whose id only starts the same way', () => {
    const list = [imp('groww.holdings@1.0.0', 'undone'), imp('groww.holdings-v2@1.0.0')];
    expect(lastImportOf(list, 'groww.holdings', true)).toEqual({ kind: 'none' });
  });

  it('says "not in the recent list" rather than "never" when the list is cut short (BUG-022)', () => {
    const recent = Array.from({ length: 25 }, () => imp('kosh.csv@1.0.0'));
    expect(lastImportOf(recent, 'groww.holdings', false)).toEqual({ kind: 'not-recent' });
  });
});
