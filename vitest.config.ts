import { defineConfig } from 'vitest/config';

/**
 * Test configuration. See the note in `vite.config.ts` for why this is separate.
 *
 * The environment is `node`, not a DOM: everything under `src/core/` is
 * required to be DOM-free (ARCHITECTURE.md §3.1), so running the suite without
 * a DOM is itself a check on that boundary — a stray `document` reference fails
 * the tests rather than silently working.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
