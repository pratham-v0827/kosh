import 'server-only';
import { BENCHMARK_IDS, BENCHMARKS, type BenchmarkId } from '@kosh/core';
import { fetchIndexHistory } from '@kosh/prices';
import { adminDb } from '@/lib/firebase/admin';
import { claimDailyFetch, markRetry, storeDailyCloses } from './daily-closes';
import { istToday } from './ledger';
import { providerContext } from './market';

export type IndexRefresh = Partial<Record<BenchmarkId, string>>;

/**
 * Keep the benchmark indices' daily closes current: at most one Yahoo request per index per day,
 * ten years the first time and only the recent gap after that. Shared by everyone (no user data).
 * Never throws: a failure is recorded and retried after an hour; the dashboard says the
 * comparison is unavailable meanwhile.
 */
export async function refreshIndices(now = new Date()): Promise<IndexRefresh> {
  const db = adminDb();
  const today = istToday(now);
  const out: IndexRefresh = {};
  for (const id of BENCHMARK_IDS) {
    const ref = db.doc(`indices/${id}`);
    try {
      const { range, state } = await claimDailyFetch(ref, today, now);
      if (range === 'skip') {
        out[id] = 'skipped';
        continue;
      }
      const r = await fetchIndexHistory(id, range, providerContext(now));
      if (r.status !== 'ok' || r.closes.length === 0) {
        await markRetry(ref, now);
        out[id] = r.status === 'unavailable' ? `unavailable: ${r.reason}` : 'no data';
        continue;
      }
      const { symbol, currency } = BENCHMARKS[id];
      await storeDailyCloses(
        ref,
        r.closes,
        { symbol, currency, source: 'yahoo-unofficial' },
        state,
        today,
        now,
      );
      out[id] = `${range}: ${r.closes.length} closes`;
    } catch (e) {
      out[id] = `failed: ${(e as Error).message}`;
    }
  }
  return out;
}
