import 'server-only';
import { BENCHMARK_IDS, BENCHMARKS, type BenchmarkId } from '@kosh/core';
import { fetchIndexHistory } from '@kosh/prices';
import { adminDb } from '@/lib/firebase/admin';
import { closesByYear, INDEX_RETRY_MS, type IndexDocState, planIndexFetch } from './index-plan';
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
      const state = (await ref.get()).data() as IndexDocState | undefined;
      const range = planIndexFetch(state, today, now.getTime());
      if (range === 'skip') {
        out[id] = 'skipped';
        continue;
      }
      const r = await fetchIndexHistory(id, range, providerContext(now));
      if (r.status !== 'ok' || r.closes.length === 0) {
        await ref.set({ retryAfter: now.getTime() + INDEX_RETRY_MS }, { merge: true });
        out[id] = r.status === 'unavailable' ? `unavailable: ${r.reason}` : 'no data';
        continue;
      }
      const batch = db.batch();
      for (const [year, days] of closesByYear(r.closes)) {
        batch.set(ref.collection('years').doc(year), { d: days }, { merge: true });
      }
      const latest = r.closes.at(-1)!.date;
      batch.set(
        ref,
        {
          symbol: BENCHMARKS[id].symbol,
          currency: BENCHMARKS[id].currency,
          source: 'yahoo-unofficial',
          checkedDay: today,
          to: state?.to && state.to > latest ? state.to : latest,
          retryAfter: 0,
          updatedAt: now.toISOString(),
        },
        { merge: true },
      );
      await batch.commit();
      out[id] = `${range}: ${r.closes.length} closes`;
    } catch (e) {
      out[id] = `failed: ${(e as Error).message}`;
    }
  }
  return out;
}
