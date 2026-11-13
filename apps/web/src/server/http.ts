import 'server-only';
import { type ApiError, fieldErrors } from '@kosh/contracts';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const MAX_JSON_BYTES = 32 * 1024;

/**
 * Read at most `max` bytes of the body, then stop (SEC-005). Content-Length can be missing or
 * wrong (chunked uploads), so the cap is enforced while streaming rather than after buffering.
 */
async function readCapped(req: Request, max: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Parse and validate a JSON body. Throws HttpError(400/413/422). */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_JSON_BYTES)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  const text = await readCapped(req, MAX_JSON_BYTES);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(422, 'VALIDATION_FAILED', 'Some fields are invalid', {
      fields: fieldErrors(parsed.error),
    });
  }
  return parsed.data;
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Wrap a route handler: maps HttpError to JSON, hides unexpected errors behind a request id. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      // BUG-010: let Next.js control flow (notFound, redirect, prerender bail-out) through.
      unstable_rethrow(e);
      if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message, e.details);
      const requestId = crypto.randomUUID();
      console.error(`[${requestId}]`, e);
      return errorResponse(500, 'INTERNAL', `Something went wrong (ref ${requestId.slice(0, 8)})`);
    }
  };
}

export const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
