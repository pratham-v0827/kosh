import 'server-only';
import { type ApiError, fieldErrors } from '@kosh/contracts';
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

/** Parse and validate a JSON body. Throws HttpError(400/413/422). */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_JSON_BYTES)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw new Error('too large');
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
      if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message, e.details);
      const requestId = crypto.randomUUID();
      console.error(`[${requestId}]`, e);
      return errorResponse(500, 'INTERNAL', `Something went wrong (ref ${requestId.slice(0, 8)})`);
    }
  };
}

export const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
