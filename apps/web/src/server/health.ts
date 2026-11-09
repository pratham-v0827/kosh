import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, projectId, usingEmulators } from '@/lib/firebase/admin';

export type FirestoreHealth =
  | { ok: true; emulator: boolean; projectId: string; roundTripMs: number; pings: number }
  | { ok: false; emulator: boolean; projectId: string; error: string };

const TIMEOUT_MS = 4000;

/**
 * Writes and reads back `health/ping` (a server-only collection: rules deny all clients).
 * Proves the server can reach Firestore (the emulator in local development).
 */
export async function checkFirestore(): Promise<FirestoreHealth> {
  const started = performance.now();
  try {
    const ref = adminDb().doc('health/ping');
    const work = (async () => {
      await ref.set(
        { at: FieldValue.serverTimestamp(), pings: FieldValue.increment(1) },
        { merge: true },
      );
      return (await ref.get()).get('pings') as number;
    })();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Firestore did not respond within ${TIMEOUT_MS} ms`)),
        TIMEOUT_MS,
      ),
    );
    const pings = await Promise.race([work, timeout]);
    return {
      ok: true,
      emulator: usingEmulators,
      projectId,
      roundTripMs: Math.round(performance.now() - started),
      pings,
    };
  } catch (error) {
    return {
      ok: false,
      emulator: usingEmulators,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
