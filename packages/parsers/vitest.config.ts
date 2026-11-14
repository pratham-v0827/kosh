import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // re-exports and type-only files have nothing to execute
      exclude: ['src/index.ts', 'src/types.ts', 'src/sheets/types.ts'],
      reporter: ['text-summary', 'text'],
      // The M3 bar for this package: a parser that misreads a statement misstates someone's money.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
