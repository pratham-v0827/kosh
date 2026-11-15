import 'server-only';
import type { IndexPoint } from '@kosh/core';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { closesByYear, INDEX_RETRY_MS, type IndexDocState } from './index-plan';

/**
 * Store daily closes under `<ref>/years/{yyyy}` = { d: { date: close } } and record the check on
 * `ref` itself. Shared market data: no user ids are ever written here.
 */
export async function storeDailyCloses(
  ref: DocumentReference,
  closes: readonly IndexPoint[],
  meta: Record<string, string>,
  state: IndexDocState | undefined,
  today: string,
  now: Date,
) {
  const batch = adminDb().batch();
  for (const [year, days] of closesByYear(closes)) {
    batch.set(ref.collection('years').doc(year), { d: days }, { merge: true });
  }
  const latest = closes.at(-1)!.date;
  batch.set(
    ref,
    {
      ...meta,
      checkedDay: today,
      to: state?.to && state.to > latest ? state.to : latest,
      retryAfter: 0,
      updatedAt: now.toISOString(),
    },
    { merge: true },
  );
  await batch.commit();
}

/** A failed fetch: wait an hour before asking the source again. */
export const markRetry = (ref: DocumentReference, now: Date) =>
  ref.set({ retryAfter: now.getTime() + INDEX_RETRY_MS }, { merge: true });
