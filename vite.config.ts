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
/**
 * Public path of the site.
 *
 * GitHub Pages serves a project site from `https://<user>.github.io/<repo>/`,
 * so every emitted asset URL has to carry that prefix or the page loads its
 * HTML and then 404s on the script.
 *
 * Applied unconditionally rather than only to `build`. `vite preview` reports
 * itself as a *serve* command, so a build-only base makes preview host the app
 * at `/` while the HTML it is serving asks for `/Ftcsim/…` — the site goes
 * blank locally and there is nothing left that reproduces production. One base
 * everywhere means preview is a real rehearsal; the dev server redirects `/`
 * here, so `npm run dev` is unaffected.
 *
 * This is a deployment path, not application behaviour — nothing in `src/`
 * reads it, because no code constructs an absolute URL.
 */
const BASE_PATH = '/Ftcsim/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
