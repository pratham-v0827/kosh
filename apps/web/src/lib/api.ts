import type { ApiError } from '@kosh/contracts';
import { clientAuth } from '@/lib/firebase/client';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Field → message, for VALIDATION_FAILED. */
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Call a Kosh API route as the signed-in user (Firebase ID token as Bearer). */
export async function api<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const user = clientAuth().currentUser;
  if (!user) throw new ApiRequestError(401, 'UNAUTHENTICATED', 'Please sign in');
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    const err = data?.error;
    const fields = (err?.details as { fields?: Record<string, string> } | undefined)?.fields ?? {};
    throw new ApiRequestError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? res.statusText,
      fields,
    );
  }
  return data as T;
}

/** Upload one file to a Kosh API route as multipart form data (field "file"). */
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const user = clientAuth().currentUser;
  if (!user) throw new ApiRequestError(401, 'UNAUTHENTICATED', 'Please sign in');
  const token = await user.getIdToken();
  const form = new FormData();
  form.set('file', file);
  // No Content-Type header: the browser adds the multipart boundary itself.
  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? res.statusText,
    );
  }
  return data as T;
}
