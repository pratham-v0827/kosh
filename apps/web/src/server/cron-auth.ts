import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './http';

/** Published in .env.development for the emulators. Never valid against a real project. */
export const LOCAL_CRON_SECRET = 'local-dev-cron-secret';
const MIN_SECRET_LENGTH = 32;

/**
 * Authorise the daily job (`Authorization: Bearer CRON_SECRET`, sent by Vercel Cron).
 * SEC-008: on a real Firebase project the secret must be long and must not be the published
 * local placeholder; otherwise the endpoint stays disabled (503) instead of being guessable.
 */
export function assertCronAuthorised(
  authorization: string | null,
  env: Record<string, string | undefined> = process.env,
) {
  const secret = env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'CRON_DISABLED', 'CRON_SECRET is not configured');
  const local = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (!local && (secret === LOCAL_CRON_SECRET || secret.length < MIN_SECRET_LENGTH)) {
    throw new HttpError(
      503,
      'CRON_DISABLED',
      `CRON_SECRET must be a random value of at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  const given = Buffer.from(authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid cron secret');
  }
}

/** Whole-run time budget: stays well inside Vercel Hobby's 60 s function limit (ADR-0018). */
export const RUN_BUDGET_MS = 40_000;
const MIN_SNAPSHOT_BUDGET_MS = 5_000;

/** Time left for snapshots after the price step, so the two together respect the run budget. */
export function snapshotBudgetMs(startedMs: number, nowMs: number): number {
  return Math.max(MIN_SNAPSHOT_BUDGET_MS, RUN_BUDGET_MS - (nowMs - startedMs));
}
