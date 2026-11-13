import 'server-only';
import { adminDb, projectId, usingEmulators } from '@/lib/firebase/admin';
import { createHealthCheck, publicHealth } from './health-check';

const TIMEOUT_MS = 4000;

/**
 * Read-only round trip to `health/ping` (a server-only path: rules deny all clients). The document
 * does not need to exist; a successful read proves the server can reach Firestore.
 */
async function probeFirestore(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Firestore did not respond within ${TIMEOUT_MS} ms`)),
      TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([adminDb().doc('health/ping').get(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const check = createHealthCheck(probeFirestore);

export async function health() {
  const result = await check();
  if (!result.ok) console.error('[health] Firestore check failed:', result.error);
  return publicHealth(result, { emulator: usingEmulators, projectId: projectId ?? '' });
}
