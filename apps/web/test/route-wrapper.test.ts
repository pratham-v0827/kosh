// BUG-010: route() caught Next.js control-flow errors (notFound, redirect, prerender bail-out)
// and turned them into 500 responses.
import { notFound, redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { HttpError, route } from '@/server/http';

describe('route() error wrapper', () => {
  it('maps HttpError to its JSON status', async () => {
    const res = await route(async () => {
      throw new HttpError(404, 'NOT_FOUND', 'No such holding');
    })();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such holding' } });
  });

  it('hides unexpected errors behind a request id', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await route(async () => {
      throw new Error('db password is hunter2');
    })();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('hunter2');
    log.mockRestore();
  });

  it('lets Next.js control-flow errors through', async () => {
    await expect(route(async () => notFound())()).rejects.toThrow();
    await expect(route(async () => redirect('/login'))()).rejects.toThrow();
  });
});
