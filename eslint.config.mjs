// ESLint for the shared packages, the Firebase rules tests and the root scripts.
// apps/web has its own config (eslint-config-next), which takes precedence inside that folder.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = Object.fromEntries(
  [
    'process',
    'console',
    'fetch',
    'Buffer',
    'URL',
    'URLSearchParams',
    'setTimeout',
    'clearTimeout',
    'AbortController',
    'Intl',
    'Response',
    'Request',
    'FormData',
    'Blob',
    'TextEncoder',
    'TextDecoder',
  ].map((name) => [name, 'readonly']),
);

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', 'apps/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Money is handled as decimal strings; a stray float conversion is a bug worth a second look.
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use Decimal for money.' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
);
