import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore, getFirestore } from 'firebase/firestore';

/**
 * Firebase web config for YOUR project (bring-your-own-Firebase). These values are public by
 * design; restrict the API key by HTTP referrer in Google Cloud. No defaults: local development
 * gets demo values from apps/web/.env.development, production from your own env vars.
 * (Each variable is referenced literally so Next.js can inline it at build time.)
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
let auth: Auth | undefined;
let db: Firestore | undefined;

function app(): FirebaseApp {
  if (getApps().length) return getApp();
  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Firebase web config missing (${missing.join(', ')}). Set NEXT_PUBLIC_FIREBASE_* — see docs/self-hosting.md.`,
    );
  }
  return initializeApp(config);
}

/** Page hostname: "localhost" and "127.0.0.1" are different sites; storage partitioning would
 * otherwise break redirect sign-in against the Auth emulator. */
const emulatorHost = () => (typeof window === 'undefined' ? '127.0.0.1' : window.location.hostname);

/** Set while a Google redirect sign-in is under way (see auth-provider). */
export const REDIRECT_PENDING_KEY = 'kosh.redirectPending';

/**
 * Browser-side Auth instance, wired to the Auth emulator in local development.
 *
 * BUG-025: `getAuth()` comes with the popup/redirect resolver, which loads Google's sign-in helper
 * script from apis.google.com on EVERY page in advance; that script pings Google, the CSP blocks
 * the ping, and pages logged console errors. Auth is set up without the resolver (same
 * persistence as getAuth), and the sign-in page passes it only when Google sign-in is chosen.
 */
export function clientAuth(): Auth {
  if (auth) return auth;
  try {
    auth = initializeAuth(app(), {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  } catch {
    auth = getAuth(app()); // already initialised (hot reload)
  }
  if (useEmulators) {
    connectAuthEmulator(auth, `http://${emulatorHost()}:9099`, { disableWarnings: true });
  }
  return auth;
}

/** Browser-side Firestore (read-only use: all writes go through the API, except settings). */
export function clientDb(): Firestore {
  if (db) return db;
  db = getFirestore(app());
  if (useEmulators) connectFirestoreEmulator(db, emulatorHost(), 8080);
  return db;
}
