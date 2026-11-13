// SEC-008: the daily job must not accept a weak or well-known secret on a real project, and its
// price step must not eat the whole function time limit.
import { describe, expect, it } from 'vitest';
import { assertCronAuthorised, LOCAL_CRON_SECRET, snapshotBudgetMs } from '@/server/cron-auth';

const STRONG = 'k'.repeat(48);
const status = (authorization: string | null, env: Record<string, string | undefined>) => {
  try {
    assertCronAuthorised(authorization, env);
    return 200;
  } catch (e) {
    return (e as { status?: number }).status;
  }
};

describe('assertCronAuthorised', () => {
  it('is disabled without a secret', () => {
    expect(status('Bearer x', {})).toBe(503);
  });

  it('accepts only the exact bearer secret', () => {
    const env = { CRON_SECRET: STRONG };
    expect(status(`Bearer ${STRONG}`, env)).toBe(200);
    expect(status(`Bearer ${STRONG}x`, env)).toBe(401);
    expect(status(`bearer ${STRONG}`, env)).toBe(401);
    expect(status(STRONG, env)).toBe(401);
    expect(status(null, env)).toBe(401);
  });

  it('allows the local placeholder only with the emulators', () => {
    const local = { CRON_SECRET: LOCAL_CRON_SECRET, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
    expect(status(`Bearer ${LOCAL_CRON_SECRET}`, local)).toBe(200);
    // real project: the published placeholder and short secrets are refused even if they match
    expect(status(`Bearer ${LOCAL_CRON_SECRET}`, { CRON_SECRET: LOCAL_CRON_SECRET })).toBe(503);
    expect(status('Bearer short', { CRON_SECRET: 'short' })).toBe(503);
  });
});

describe('snapshotBudgetMs', () => {
  it('gives the snapshot step what is left of the run, with a floor', () => {
    expect(snapshotBudgetMs(0, 0)).toBe(40_000);
    expect(snapshotBudgetMs(0, 16_000)).toBe(24_000);
    expect(snapshotBudgetMs(0, 55_000)).toBe(5_000);
  });
});
