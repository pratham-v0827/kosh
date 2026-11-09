import { defineConfig } from 'vitest/config';

// Rules tests need the Firestore emulator. Run them from the repo root with `pnpm test:rules`,
// which wraps vitest in `firebase emulators:exec`.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
