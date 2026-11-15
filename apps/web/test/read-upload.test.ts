// M3: the upload reader caps the body while streaming and never needs the disk.
import { describe, expect, it } from 'vitest';
import { HttpError, readUpload } from '@/server/http';
import {
  IMPORT_PREVIEWS_PER_DAY,
  IMPORT_ROWS_PER_DAY,
  IMPORT_WRITE_BUDGET,
  importWrites,
  nextImportPreviewCounters,
  nextImportRowCounters,
} from '@/server/limits';

const MAX = 64 * 1024;
const form = (parts: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(parts)) f.set(k, v);
  return new Request('http://localhost/api/v1/imports', { method: 'POST', body: f });
};
const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
};

describe('readUpload', () => {
  it('returns the file bytes, name and optional password', async () => {
    const file = new File(['date,type\n2024-01-01,buy\n'], 'my trades.csv', { type: 'text/csv' });
    const up = await readUpload(form({ file, password: 'p@ss' }), MAX);
    expect(new TextDecoder().decode(up.bytes)).toBe('date,type\n2024-01-01,buy\n');
    expect(up).toMatchObject({ fileName: 'my trades.csv', mime: 'text/csv', password: 'p@ss' });
    const noPassword = await readUpload(form({ file }), MAX);
    expect(noPassword).not.toHaveProperty('password');
  });

  it('refuses the wrong content type, a missing file and an oversized file', async () => {
    const json = new Request('http://localhost/x', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(await statusOf(readUpload(json, MAX))).toBe(415);
    expect(await statusOf(readUpload(form({ file: 'not a file' }), MAX))).toBe(400);
    const big = new File([new Uint8Array(MAX + 1)], 'big.csv');
    expect(await statusOf(readUpload(form({ file: big }), MAX))).toBe(413);
  });

  it('stops reading a long chunked body early (no Content-Length)', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled >= 64) return c.close(); // bounded so a regression cannot hang the run
        pulled++;
        c.enqueue(new Uint8Array(16 * 1024));
      },
    });
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      duplex: 'half',
    } as RequestInit);
    expect(await statusOf(readUpload(req, MAX))).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});

describe('import limits', () => {
  const status = (fn: () => unknown) => {
    try {
      fn();
      return 200;
    } catch (e) {
      return (e as { status?: number }).status;
    }
  };

  it('caps file uploads per user per day', () => {
    expect(nextImportPreviewCounters(undefined, '2026-11-14')).toEqual({
      importPreviewDay: '2026-11-14',
      importPreviewsToday: 1,
    });
    const full = { importPreviewDay: '2026-11-14', importPreviewsToday: IMPORT_PREVIEWS_PER_DAY };
    expect(status(() => nextImportPreviewCounters(full, '2026-11-14'))).toBe(429);
    expect(status(() => nextImportPreviewCounters(full, '2026-11-15'))).toBe(200);
  });

  it('caps imported rows per user per day', () => {
    const used = { importRowDay: '2026-11-14', importRowsToday: IMPORT_ROWS_PER_DAY - 10 };
    expect(nextImportRowCounters(used, '2026-11-14', 10).importRowsToday).toBe(IMPORT_ROWS_PER_DAY);
    expect(status(() => nextImportRowCounters(used, '2026-11-14', 11))).toBe(429);
    expect(nextImportRowCounters(used, '2026-11-15', 400).importRowsToday).toBe(400);
  });

  it('a full file of new holdings stays inside the write budget check', () => {
    expect(importWrites(100, 20)).toBeLessThanOrEqual(IMPORT_WRITE_BUDGET);
    expect(importWrites(450, 30)).toBeGreaterThan(IMPORT_WRITE_BUDGET);
  });
});
