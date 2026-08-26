import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundary enforcement (ARCHITECTURE.md §3).
 *
 *   core/    -> may import only from core/
 *   schema/  -> may import core *types*; never core logic
 *   storage/ -> may import schema/
 *   manual/  -> may import schema/ and core game types
 *   app/     -> may import anything
 *
 * A violation is an error, so it fails `npm run verify` and therefore the build.
 */

/** Import path groups, written to match both relative and aliased specifiers. */
const group = (dir) => [`**/${dir}/**`, `${dir}/**`, `**/src/${dir}/**`];

/** `core/` is deterministic and host-free: no DOM, no clock, no ambient entropy. */
const NON_DETERMINISTIC_GLOBALS = [
  { name: 'window', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'document', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'navigator', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'localStorage', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'sessionStorage', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'indexedDB', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'requestAnimationFrame', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  { name: 'fetch', message: 'core/ must be DOM-free (ARCHITECTURE.md §3.1).' },
  {
    name: 'performance',
    message: 'core/ is clocked by the integer tick counter only (ARCHITECTURE.md §9.1).',
  },
  {
    name: 'crypto',
    message: 'core/ entropy comes from the seeded PCG32 generator only (ARCHITECTURE.md §9.1).',
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // ---------------------------------------------------------------- core/ ---
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...group('app'), ...group('manual'), ...group('storage'), ...group('schema')],
              message:
                'core/ may import only from core/. Dependencies point inward (ARCHITECTURE.md §3.1).',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'core/ must be React-free (ARCHITECTURE.md §3.1).',
            },
            {
              group: ['zod'],
              message:
                'core/ holds plain TypeScript types. Runtime validation belongs in schema/ (ARCHITECTURE.md §3.1).',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NON_DETERMINISTIC_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded PCG32 generator owned by SimWorld (ARCHITECTURE.md §9.1).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'core/ is clocked by the integer tick counter only (ARCHITECTURE.md §9.1).',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'core/ is clocked by the integer tick counter only (ARCHITECTURE.md §9.1).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'core/ is clocked by the integer tick counter only (ARCHITECTURE.md §9.1).',
        },
      ],
    },
  },

  // -------------------------------------------------------------- schema/ ---
  {
    files: ['src/schema/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...group('app'), ...group('manual'), ...group('storage')],
              message: 'schema/ may import core types only (ARCHITECTURE.md §3.1).',
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------------------- storage/ ---
  {
    files: ['src/storage/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...group('app'), ...group('manual')],
              message: 'storage/ may import schema/ only (ARCHITECTURE.md §3.1).',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------- manual/ ---
  {
    files: ['src/manual/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...group('app'), ...group('storage')],
              message:
                'manual/ may import schema/ and core game types only (ARCHITECTURE.md §3.1).',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------- tests ---
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-properties': 'off',
      'no-console': 'off',
    },
  },

  // ---------------------------------------------------------------- tools ---
  //
  // Maintainer scripts, run by hand against files outside the repo. They are not
  // part of the app or the sim, so the layering rules do not apply — but they do
  // run on Node, which the browser-oriented default globals do not include.
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
