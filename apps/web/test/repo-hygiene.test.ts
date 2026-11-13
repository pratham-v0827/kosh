// BUG-011: a broad `coverage/` rule in .gitignore silently excluded the API route
// src/app/api/v1/prices/coverage, so fresh clones had no such endpoint.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));

describe('repository hygiene', () => {
  it('no source file is git-ignored', () => {
    const ignored = execFileSync(
      'git',
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        ':(glob)apps/*/src/**',
        ':(glob)apps/*/scripts/**',
        ':(glob)packages/*/src/**',
        ':(glob)packages/*/test/**',
        'scripts',
        'docs',
      ],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
    expect(ignored).toEqual([]);
  }, 60_000); // git can be slow on a cold index (CI, Windows)
});
