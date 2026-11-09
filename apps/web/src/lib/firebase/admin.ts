import 'server-only';
import { type App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin SDK (server only). NOTE: the Admin SDK bypasses Firestore security rules,
 * so every server module must enforce its own access boundaries (see docs/PLAN.md §4.1).
 */

export const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-kosh';
export const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function createApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  // Emulators need no credentials; the Admin SDK reads FIRESTORE_EMULATOR_HOST and
  // FIREBASE_AUTH_EMULATOR_HOST from the environment.
  if (usingEmulators) return initializeApp({ projectId });

  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!encoded) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is not set. For local development, run the emulators ' +
        '(`pnpm dev:all`) so FIRESTORE_EMULATOR_HOST is used instead.',
    );
  }
  const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };
  return initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    }),
    projectId: serviceAccount.project_id,
  });
}

/** Lazily initialised so `next build` never needs credentials. */
export const adminDb = () => getFirestore(createApp());
export const adminAuth = () => getAuth(createApp());
