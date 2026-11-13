import { ASSET_CLASSES } from '@kosh/core';
import { HttpError } from './http';

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Not found');

// "<ASSET_CLASS>:<key>", where key is a ticker/code ("BSE:RELIANCE", "M&M", "BRK.B") or a name slug.
const INSTRUMENT_KEY = /^[A-Za-z0-9&][A-Za-z0-9:._&-]{0,79}$/;
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;

/**
 * Instrument id from a URL segment (SEC-009). Malformed escapes, slashes and anything that is not
 * a Kosh instrument id are answered with 404 instead of reaching a Firestore path or a 500.
 */
export function instrumentIdParam(raw: string): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw notFound();
  }
  const sep = id.indexOf(':');
  const assetClass = id.slice(0, sep);
  const key = id.slice(sep + 1);
  if (
    sep < 1 ||
    !(ASSET_CLASSES as readonly string[]).includes(assetClass) ||
    !INSTRUMENT_KEY.test(key)
  ) {
    throw notFound();
  }
  return id;
}

/** Firestore auto-generated document id from a URL segment. */
export function docIdParam(raw: string): string {
  if (!DOC_ID.test(raw)) throw notFound();
  return raw;
}
