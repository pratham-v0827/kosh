import { randomBytes } from 'node:crypto';
import { type App, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * The end-to-end user lives ONLY in the local Auth emulator (offline project demo-kosh). Every
 * helper here refuses to run against anything else, so these tests can never create or delete a
 * real account.
 */
export const PROJECT_ID = 'demo-kosh';
export const AUTH_HOST = '127.0.0.1:9099';
export const FIRESTORE_HOST = '127.0.0.1:8080';
export const E2E_USER = { name: 'pratham_test', email: 'pratham_test@kosh.test' } as const;

function assertEmulatorOnly() {
  if (!PROJECT_ID.startsWith('demo-')) throw new Error('E2E runs only on a demo- project');
  for (const host of [AUTH_HOST, FIRESTORE_HOST]) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      throw new Error(`E2E refuses a non-local emulator host: ${host}`);
    }
  }
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
}

async function withAdmin<T>(fn: (app: App) => Promise<T>): Promise<T> {
  assertEmulatorOnly();
  const app = initializeApp({ projectId: PROJECT_ID }, `e2e-${randomBytes(4).toString('hex')}`);
  try {
    return await fn(app);
  } finally {
    await deleteApp(app);
  }
}

/**
 * Start each run from nothing: delete pratham_test and everything stored under it, then create it
 * again. Kosh signs in with email links (no passwords), but the account gets a password anyway, as
 * asked: E2E_PASSWORD from the local environment, else a random one made now. It is never printed,
 * stored or used to sign in.
 */
export async function resetE2EUser(): Promise<string> {
  return withAdmin(async (app) => {
    const auth = getAuth(app);
    const db = getFirestore(app);
    const existing = await auth.getUserByEmail(E2E_USER.email).catch(() => null);
    if (existing) {
      await db.recursiveDelete(db.doc(`users/${existing.uid}`));
      await db.doc(`userMeta/${existing.uid}`).delete();
      await auth.deleteUser(existing.uid);
    }
    const user = await auth.createUser({
      email: E2E_USER.email,
      emailVerified: true,
      displayName: E2E_USER.name,
      password: process.env.E2E_PASSWORD || randomBytes(24).toString('base64url'),
    });
    return user.uid;
  });
}

/**
 * Shared market data (no user data) that a run must not inherit: the emulator is shared with
 * `pnpm dev`, whose real prices, exchange rate and histories would otherwise mix with the mock
 * ones. Cleared before a mock run and again after it, so the dev server never shows mock prices.
 */
const MARKET_COLLECTIONS = [
  'prices',
  'fx',
  'fxHistory',
  'indices',
  'priceHistory',
  'isinMap',
  'trackedInstruments',
  'providerBudgets',
];

export async function clearMarketData(): Promise<void> {
  await withAdmin(async (app) => {
    const db = getFirestore(app);
    for (const name of MARKET_COLLECTIONS) await db.recursiveDelete(db.collection(name));
  });
}

interface OobCode {
  email: string;
  requestType: string;
  oobLink: string;
}

/** The newest email sign-in link the Auth emulator "sent" to an address. */
export async function latestSignInLink(email: string): Promise<string | null> {
  assertEmulatorOnly();
  const r = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  if (!r.ok) throw new Error(`Auth emulator: HTTP ${r.status}`);
  const { oobCodes = [] } = (await r.json()) as { oobCodes?: OobCode[] };
  const mine = oobCodes.filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN');
  return mine.at(-1)?.oobLink ?? null;
}

/** How many email sign-in links exist for an address (to wait for a new one). */
export async function signInLinkCount(email: string): Promise<number> {
  const r = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const { oobCodes = [] } = (await r.json()) as { oobCodes?: OobCode[] };
  return oobCodes.filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN').length;
}
