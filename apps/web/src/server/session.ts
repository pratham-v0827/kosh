import 'server-only';
import { DEFAULT_SETTINGS } from '@kosh/contracts';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

/** Version of the terms/privacy notice the user accepts by signing in (DPDP consent record). */
export const TERMS_VERSION = '2026-11-09';

const istDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); // YYYY-MM-DD

/**
 * Called once per sign-in. Creates the user's private doc and admin-visible metadata on first
 * sign-in, and records activity counters. userMeta holds NO personal data (docs/PLAN.md §9.1).
 */
export async function recordSignIn(uid: string): Promise<{ created: boolean }> {
  const db = adminDb();
  const userRef = db.doc(`users/${uid}`);
  const metaRef = db.doc(`userMeta/${uid}`);
  const today = istDay();
  const metricsRef = db.doc(`metrics/daily_${today}`);

  return db.runTransaction(async (tx) => {
    const [user, meta] = await Promise.all([tx.get(userRef), tx.get(metaRef)]);
    const created = !user.exists;
    const now = FieldValue.serverTimestamp();

    if (created) {
      tx.set(userRef, {
        settings: DEFAULT_SETTINGS,
        consents: { terms: TERMS_VERSION, privacy: TERMS_VERSION, at: now },
        createdAt: now,
        updatedAt: now,
      });
    }

    const firstToday = meta.get('lastActiveDay') !== today;
    tx.set(
      metaRef,
      {
        ...(meta.exists
          ? {}
          : {
              createdAt: now,
              status: 'active',
              role: 'user',
              refreshCount: 0,
              sourcesConnected: 0,
            }),
        lastActiveAt: now,
        lastActiveDay: today,
        loginCount: FieldValue.increment(1),
      },
      { merge: true },
    );
    tx.set(
      metricsRef,
      {
        day: today,
        logins: FieldValue.increment(1),
        ...(firstToday ? { dau: FieldValue.increment(1) } : {}),
        ...(created ? { signups: FieldValue.increment(1) } : {}),
      },
      { merge: true },
    );
    return { created };
  });
}
