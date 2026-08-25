import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Application build/dev config only.
 *
 * Test configuration lives in `vitest.config.ts` rather than here. Vitest 2.x
 * depends on Vite 5 while the app builds on Vite 6, so a single file that
 * imported `defineConfig` from `vitest/config` would mix two incompatible sets
 * of Vite plugin types. Splitting them keeps both at their locked major versions
 * with no casts and no dependency overrides.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
