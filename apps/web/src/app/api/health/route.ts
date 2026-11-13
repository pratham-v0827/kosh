import { connection } from 'next/server';
import { health } from '@/server/health';

/**
 * GET /api/health: liveness plus a cached, read-only Firestore check (at most one read a minute
 * per instance, however often this public endpoint is called).
 */
export async function GET() {
  await connection(); // run at request time, never during prerendering
  const body = await health();
  return Response.json(body, {
    status: body.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
