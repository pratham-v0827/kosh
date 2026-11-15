/** What the source cards need from an import record. */
export interface ImportLike {
  parser: string;
  status: 'draft' | 'confirmed' | 'undone';
}

export type LastImport<T> =
  { kind: 'found'; import: T } | { kind: 'none' } | { kind: 'not-recent' };

/**
 * The newest confirmed import of one source (parser id without its version) in a newest-first
 * list. `complete` says whether the list holds every import; when it was cut short, a source
 * missing from it may still have been imported earlier (BUG-022), so that is what it says.
 */
export function lastImportOf<T extends ImportLike>(
  imports: readonly T[],
  parser: string,
  complete: boolean,
): LastImport<T> {
  const found = imports.find((i) => i.status === 'confirmed' && i.parser.startsWith(`${parser}@`));
  if (found) return { kind: 'found', import: found };
  return complete ? { kind: 'none' } : { kind: 'not-recent' };
}
