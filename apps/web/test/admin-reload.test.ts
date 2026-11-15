// BUG-026: after a hot reload in `next dev`, every request failed with "Firestore has already been
// initialized. You can only call settings() once" until the server was restarted.
import { afterAll, describe, expect, it, vi } from 'vitest';

const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

describe('adminDb across a module reload', () => {
  it('configures Firestore once per process, not once per module load', async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-kosh';
    const first = await import('@/lib/firebase/admin');
    const db = first.adminDb();
    vi.resetModules(); // what a hot reload does to our module; firebase-admin keeps its state
    const second = await import('@/lib/firebase/admin');
    expect(() => second.adminDb()).not.toThrow();
    expect(second.adminDb()).toBe(db);
  });
});
