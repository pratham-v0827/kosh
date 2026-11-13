#!/usr/bin/env node
// Make a user an admin (or remove it) via the Firebase Admin SDK custom claim `role: "admin"`.
// Run locally by the instance owner. There is no hard-coded admin email anywhere in Kosh.
//
//   pnpm admin:grant --email you@example.com            (your project: needs credentials, below)
//   pnpm admin:grant --uid <uid> --revoke
//   pnpm admin:grant --email demo@example.test --emulator   (local emulators)
//
// Credentials for a real project (any one):
//   FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64 of the service-account JSON>
//   GOOGLE_APPLICATION_CREDENTIALS=<path to the service-account JSON>
// The user must sign out and in again (or wait up to an hour) to pick up the new claim.
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const opt = (name) =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
const email = opt('email');
const uidArg = opt('uid');
const revoke = args.includes('--revoke');
const emulator = args.includes('--emulator');

if (!email && !uidArg) {
  console.error(
    'Usage: pnpm admin:grant --email <email> | --uid <uid> [--revoke] [--emulator] [--project <id>]',
  );
  process.exit(2);
}

let app;
if (emulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: opt('project') ?? 'demo-kosh' });
} else {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      'Emulator variables are set; pass --emulator explicitly, or unset them for a real project.',
    );
    process.exit(2);
  }
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = initializeApp({
      credential: applicationDefault(),
      ...(opt('project') ? { projectId: opt('project') } : {}),
    });
  } else {
    console.error(
      'No credentials: set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_APPLICATION_CREDENTIALS.',
    );
    process.exit(2);
  }
}

const auth = getAuth(app);
const db = getFirestore(app);
const user = email ? await auth.getUserByEmail(email) : await auth.getUser(uidArg);
const claims = { ...(user.customClaims ?? {}) };
if (revoke) delete claims.role;
else claims.role = 'admin';
await auth.setCustomUserClaims(user.uid, claims);
await db.doc(`userMeta/${user.uid}`).set({ role: revoke ? 'user' : 'admin' }, { merge: true });
await db.collection('adminAudit').add({
  action: revoke ? 'revoke-admin' : 'grant-admin',
  targetUid: user.uid,
  actor: 'cli',
  at: FieldValue.serverTimestamp(),
});
console.log(
  `${revoke ? 'Removed admin from' : 'Granted admin to'} uid ${user.uid}. They must sign in again to pick it up.`,
);
