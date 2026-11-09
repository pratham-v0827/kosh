import { connection } from 'next/server';
import { checkFirestore } from '@/server/health';

/** GET /api/health: liveness plus a Firestore round trip. Never cached. */
export async function GET() {
  await connection(); // run at request time, never during prerendering
  const firestore = await checkFirestore();
  return Response.json(
    { status: firestore.ok ? 'ok' : 'degraded', firestore },
    { status: firestore.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
