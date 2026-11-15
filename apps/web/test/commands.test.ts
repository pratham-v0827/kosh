// Command palette matching: every word must match; earlier, word-start matches rank first.
import { describe, expect, it } from 'vitest';
import { isTypingTarget, matchCommands } from '@/lib/commands';

const cmds = [
  { id: 'nav:holdings', label: 'Go to Holdings', group: 'Pages' },
  { id: 'nav:history', label: 'Go to History', group: 'Pages' },
  { id: 'h:tcs', label: 'Tata Consultancy Services', hint: 'TCS', group: 'Holdings' },
  { id: 'h:hdfc', label: 'HDFC Bank', hint: 'HDFCBANK', group: 'Holdings' },
  { id: 'view:hide', label: 'Hide amounts', group: 'View' },
];

describe('matchCommands', () => {
  it('an empty query lists everything in its original order', () => {
    expect(matchCommands(cmds, '  ').map((c) => c.id)).toEqual(cmds.map((c) => c.id));
  });

  it('matches case-insensitively, on every word, including the hint', () => {
    expect(matchCommands(cmds, 'tcs').map((c) => c.id)).toEqual(['h:tcs']);
    expect(matchCommands(cmds, 'go hist').map((c) => c.id)).toEqual(['nav:history']);
    expect(matchCommands(cmds, 'go bank')).toEqual([]);
  });

  it('ranks matches at the start of a word above matches inside one', () => {
    // "hi" starts "History" and "Hide"; "onsul" is only inside "Consultancy"
    expect(matchCommands(cmds, 'hi').map((c) => c.id)).toEqual(['nav:history', 'view:hide']);
    expect(matchCommands(cmds, 'ba').map((c) => c.id)).toEqual(['h:hdfc']); // "Bank"
    expect(matchCommands(cmds, 'onsul').map((c) => c.id)).toEqual(['h:tcs']);
  });
});

describe('isTypingTarget', () => {
  it('is true for text fields and editable content, false otherwise', () => {
    expect(isTypingTarget({ tagName: 'INPUT', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
