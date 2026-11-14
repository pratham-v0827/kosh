import type { AssetClass } from '@kosh/core';

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'holding';

/**
 * Kosh instrument id: "<ASSET_CLASS>:<symbol or name slug>". NSE (the default) keeps the short id;
 * BSE listings get their own id so both can coexist.
 */
export function instrumentIdFor(input: {
  assetClass: AssetClass;
  name: string;
  symbol?: string | undefined;
  exchange?: 'NSE' | 'BSE' | undefined;
}): string {
  const key = input.symbol ?? slug(input.name);
  return input.assetClass === 'IN_EQUITY' && input.exchange === 'BSE'
    ? `IN_EQUITY:BSE:${key}`
    : `${input.assetClass}:${key}`;
}
