import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for framework-free modules (no DOM, no Next runtime).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
