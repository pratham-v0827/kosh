// SEC-007: /api/health is public. It must not write to Firestore or probe it on every call
// (free-tier quota), and must not reveal project details or internal errors.
import { describe, expect, it, vi } from 'vitest';
import { createHealthCheck, publicHealth } from '@/server/health-check';

describe('createHealthCheck', () => {
  it('probes at most once per TTL, however many calls arrive', async () => {
    let t = 0;
    const probe = vi.fn(async () => {});
    const check = createHealthCheck(probe, 60_000, () => t);
    await Promise.all(Array.from({ length: 50 }, () => check()));
    t = 59_000;
    expect((await check()).ok).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    t = 61_000;
    await check();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('reports failure without throwing, and caches it too', async () => {
    const probe = vi.fn(async () => {
      throw new Error('PERMISSION_DENIED: project kosh-prod-1234');
    });
    const check = createHealthCheck(probe, 60_000, () => 0);
    expect((await check()).ok).toBe(false);
    await check();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('caches a failure only briefly, so recovery is noticed within seconds', async () => {
    let t = 0;
    let up = false;
    const probe = vi.fn(async () => {
      if (!up) throw new Error('starting');
    });
    const check = createHealthCheck(probe, 60_000, () => t, 5_000);
    expect((await check()).ok).toBe(false);
    await Promise.resolve(); // let the result settle
    up = true;
    t = 4_000;
    expect((await check()).ok).toBe(false); // still inside the short failure window
    t = 6_000;
    expect((await check()).ok).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('publicHealth', () => {
  it('shows only ok/degraded on a real project', () => {
    const body = publicHealth(
      { ok: false, error: 'PERMISSION_DENIED: project kosh-prod-1234' },
      { emulator: false, projectId: 'kosh-prod-1234' },
    );
    expect(body).toEqual({ status: 'degraded', firestore: { ok: false } });
    expect(JSON.stringify(body)).not.toContain('kosh-prod-1234');
  });

  it('keeps helpful detail for local emulator development', () => {
    const body = publicHealth({ ok: true }, { emulator: true, projectId: 'demo-kosh' });
    expect(body).toEqual({
      status: 'ok',
      firestore: { ok: true, emulator: true, projectId: 'demo-kosh' },
    });
  });
});
