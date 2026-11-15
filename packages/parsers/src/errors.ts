export type ImportErrorCode =
  | 'UNKNOWN_FORMAT'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_TEXT'
  | 'MISSING_COLUMNS'
  | 'TOO_MANY_ROWS'
  | 'PARSER_FAILED';

/**
 * A problem with the uploaded file as a whole. The message is written for the user and is safe to
 * show and log: it never contains file contents, the file name or a password.
 */
export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}
