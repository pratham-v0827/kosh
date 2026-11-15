import { MAX_FILE_BYTES, MAX_IMPORT_ROWS, supportedFormats } from '@kosh/parsers';
import { connection } from 'next/server';
import { requireUser } from '@/server/auth';
import { ok, readUpload, route } from '@/server/http';
import { previewImport } from '@/server/imports';
import { IMPORT_PREVIEWS_PER_DAY, IMPORT_ROWS_PER_DAY } from '@/server/limits';

/** GET /api/v1/imports: the statement formats this instance can read, and the import limits. */
export const GET = route(async (req: Request) => {
  await connection();
  await requireUser(req);
  return ok({
    formats: supportedFormats(),
    limits: {
      maxFileBytes: MAX_FILE_BYTES,
      maxRowsPerFile: MAX_IMPORT_ROWS,
      uploadsPerDay: IMPORT_PREVIEWS_PER_DAY,
      rowsPerDay: IMPORT_ROWS_PER_DAY,
    },
  });
});

/**
 * POST /api/v1/imports (multipart: file, optional password): detect the format, parse the file in
 * memory and store a draft. Nothing reaches the ledger until the draft is confirmed. The file and
 * the password are never stored or logged.
 */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  const upload = await readUpload(req, MAX_FILE_BYTES);
  try {
    const preview = await previewImport(uid, upload);
    // The same statement uploaded again creates nothing: 200 rather than 201.
    return ok(preview, 'alreadyImported' in preview ? 200 : 201);
  } finally {
    upload.bytes.fill(0);
  }
});
