import 'server-only';
import type { IndexPoint } from '@kosh/core';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { closesByYear, INDEX_RETRY_MS, type IndexDocState, planIndexFetch } from './index-plan';

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

/** How long a claimed fetch keeps others from starting the same one. */
export const CLAIM_MS = 2 * 60 * 1000;

/**
 * BUG-021: decide whether to fetch today and, if so, claim the fetch in one transaction, so
 * requests arriving at the same moment (two users opening the same share, or a double click) send
 * one request to the source between them instead of one each. The claim is released by
 * `storeDailyCloses` or `markRetry`, or expires after two minutes if the fetch dies.
 */
export function claimDailyFetch(
  ref: DocumentReference,
  today: string,
  now: Date,
): Promise<{ range: ReturnType<typeof planIndexFetch>; state: IndexDocState | undefined }> {
  return adminDb().runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data() as IndexDocState | undefined;
    const range = planIndexFetch(state, today, now.getTime());
    if (range !== 'skip') tx.set(ref, { retryAfter: now.getTime() + CLAIM_MS }, { merge: true });
    return { range, state };
  });
}

/** A failed fetch: wait an hour before asking the source again. */
export const markRetry = (ref: DocumentReference, now: Date) =>
  ref.set({ retryAfter: now.getTime() + INDEX_RETRY_MS }, { merge: true });
