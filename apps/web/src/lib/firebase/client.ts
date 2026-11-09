import { getApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';

/** Firebase web config. These values are public by design; restrict the API key by HTTP referrer. */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-kosh.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-kosh',
};

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
let auth: Auth | undefined;

/** Browser-side Auth instance, wired to the Auth emulator in local development. */
export function clientAuth(): Auth {
  if (auth) return auth;
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  if (useEmulators) {
    // Use the page's own hostname: "localhost" and "127.0.0.1" are different sites, and the
    // browser's storage partitioning would otherwise break redirect sign-in.
    const host = typeof window === 'undefined' ? '127.0.0.1' : window.location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  }
  return auth;
}
