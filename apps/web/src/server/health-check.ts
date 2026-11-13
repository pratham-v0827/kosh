export type ProbeResult = { ok: true } | { ok: false; error: string };

/**
 * Cached health probe (SEC-007). /api/health is public, so however often it is called the
 * database is asked at most once per `ttlMs` per server instance; concurrent calls share one
 * probe. A failure is cached only for `failureTtlMs`, so recovery shows up quickly.
 */
export function createHealthCheck(
  probe: () => Promise<void>,
  ttlMs = 60_000,
  now: () => number = Date.now,
  failureTtlMs = 5_000,
) {
  let last: { at: number; ok: boolean | null; result: Promise<ProbeResult> } | null = null;
  return (): Promise<ProbeResult> => {
    const t = now();
    const ttl = last?.ok === false ? failureTtlMs : ttlMs;
    if (!last || t - last.at >= ttl) {
      const entry: NonNullable<typeof last> = {
        at: t,
        ok: null, // in flight: callers share it
        result: probe().then(
          (): ProbeResult => ({ ok: true }),
          (e: unknown): ProbeResult => ({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      };
      void entry.result.then((r) => {
        entry.ok = r.ok;
      });
      last = entry;
    }
    return last.result;
  };
}

/** Public response body. Project id and error text are shown only with the local emulators. */
export function publicHealth(r: ProbeResult, info: { emulator: boolean; projectId: string }) {
  return {
    status: r.ok ? ('ok' as const) : ('degraded' as const),
    firestore: {
      ok: r.ok,
      ...(info.emulator
        ? { emulator: true, projectId: info.projectId, ...(r.ok ? {} : { error: r.error }) }
        : {}),
    },
  };
}
