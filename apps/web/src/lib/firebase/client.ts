import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore, getFirestore } from 'firebase/firestore';

/** Firebase web config. These values are public by design; restrict the API key by HTTP referrer. */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-kosh.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-kosh',
};

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
let auth: Auth | undefined;
let db: Firestore | undefined;

function app(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(config);
}

/** Page hostname: "localhost" and "127.0.0.1" are different sites; storage partitioning would
 * otherwise break redirect sign-in against the Auth emulator. */
const emulatorHost = () => (typeof window === 'undefined' ? '127.0.0.1' : window.location.hostname);

/** Browser-side Auth instance, wired to the Auth emulator in local development. */
export function clientAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(app());
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
