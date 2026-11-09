import { getJson, isDecimal, ProviderError } from '../http';
import type { FxProvider, FxRate, ProviderContext } from '../types';

/**
 * Frankfurter: ECB reference rates, no key. Daily, published on ECB business days.
 * A weekend/holiday date returns the closest earlier business day (verified 2026-11-09).
 */
const BASE = 'https://api.frankfurter.dev/v1';

interface Resp {
  base: string;
  date: string;
  rates: { INR?: number };
}

function toRate(r: Resp): FxRate {
  const v = r.rates?.INR;
  if (r.base !== 'USD' || typeof v !== 'number' || !isDecimal(String(v))) {
    throw new ProviderError('frankfurter', 'unexpected response');
  }
  return { pair: 'USDINR', rate: String(v), asOf: r.date, source: 'frankfurter-ecb' };
}

export const frankfurterFx: FxProvider = {
  id: 'frankfurter-ecb',
  async latest(ctx: ProviderContext) {
    return toRate(await getJson<Resp>('frankfurter', `${BASE}/latest?base=USD&symbols=INR`, ctx));
  },
  async onDate(date: string, ctx: ProviderContext) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ProviderError('frankfurter', 'bad date');
    return toRate(await getJson<Resp>('frankfurter', `${BASE}/${date}?base=USD&symbols=INR`, ctx));
  },
};
