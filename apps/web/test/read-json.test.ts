// SEC-009: request bodies must be capped while streaming, not after buffering everything.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpError, readJson } from '@/server/http';

// A long chunked body with no Content-Length. Bounded (1 MiB) so a regression cannot hang the run.
const CHUNK = 16 * 1024;
const MAX_CHUNKS = 64;
const longBody = () => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= MAX_CHUNKS) return c.close();
      pulled++;
      c.enqueue(new Uint8Array(CHUNK).fill(32)); // spaces: valid JSON whitespace
    },
  });
  return { stream, pulled: () => pulled };
};

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
};

describe('readJson', () => {
  it('parses and validates a normal body', async () => {
    await expect(readJson(post('{"a":1}'), z.object({ a: z.number() }))).resolves.toEqual({ a: 1 });
    expect(await statusOf(readJson(post('{"a":"x"}'), z.object({ a: z.number() })))).toBe(422);
    expect(await statusOf(readJson(post('{oops'), z.object({})))).toBe(400);
  });

  it('rejects a declared oversized body with 413', async () => {
    expect(await statusOf(readJson(post('{}', { 'content-length': '999999' }), z.object({})))).toBe(
      413,
    );
  });

  it('stops reading an oversized chunked body early and answers 413', async () => {
    const { stream, pulled } = longBody();
    const status = await Promise.race([
      statusOf(readJson(post(stream), z.object({}))),
      new Promise((r) => setTimeout(() => r('hung'), 2000)),
    ]);
    expect(status).toBe(413);
    expect(pulled()).toBeLessThan(10);
  });
});
