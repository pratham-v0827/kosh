/** One entry in the command palette. */
export interface Command {
  id: string;
  label: string;
  /** Extra text that matches but is shown smaller (a ticker, a shortcut). */
  hint?: string;
  group: string;
}

/**
 * Commands whose label or hint contains every word of the query (case-insensitive). Commands where
 * every word starts a word of the text come first; otherwise the original order is kept.
 */
export function matchCommands<T extends Command>(commands: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...commands];
  const scored: { c: T; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const text = `${c.label} ${c.hint ?? ''}`.toLowerCase();
    const starts = text.split(/[^a-z0-9&]+/).filter(Boolean);
    let score = 0;
    for (const w of words) {
      if (!text.includes(w)) return;
      if (starts.some((s) => s.startsWith(w))) score++;
    }
    scored.push({ c, score: score === words.length ? 0 : 1, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.c);
}

/** True when a key press is going into a text field, so single-key shortcuts must not fire. */
export function isTypingTarget(
  el: { tagName: string; isContentEditable: boolean } | null,
): boolean {
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
