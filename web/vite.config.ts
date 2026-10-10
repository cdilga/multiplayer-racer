import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// One multi-page build; each page bundles only what it imports, so the controller never pulls the
// host's renderer or sim (Playtest-1 plan §4.1). The base is relative, so ONE build serves under any deployment base
// (`/` in production, `/p/<id>/` in a preview, §5.1, §12): jj-server rewrites the pages' asset links to the base and
// tells the apps where it is with `<meta name="jj-base">` (web/shared/src/base.ts).
//
// The host's test surface (P1-F05b) is its own lazily loaded chunk, worker and WASM, all written under `test/`
// (their names carry "testing"): a production-realm server answers that whole directory with 404, and
// scripts/ci/bundle-check.mjs fails a build with test code anywhere else.
const testOrAssets = (name: string | undefined, rest: string) =>
  `${name?.includes('testing') ? 'test' : 'assets'}/${rest}`;
const output = {
  entryFileNames: (c: { name: string }) => testOrAssets(c.name, '[name]-[hash].js'),
  chunkFileNames: (c: { name: string }) => testOrAssets(c.name, '[name]-[hash].js'),
  assetFileNames: (a: { names?: string[]; name?: string }) => testOrAssets(a.names?.[0] ?? a.name, '[name]-[hash][extname]'),
};

function commit(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base: process.env.JJ_BASE ?? './',
  // __JJ_OWNER_TOOLS__: the owner's temporary tools (the tuning menu, br-2sdu); a production build (JJ_PRODUCTION=1)
  // drops them and their chunks entirely.
  define: { __JJ_COMMIT__: JSON.stringify(process.env.JJ_COMMIT ?? commit()), __JJ_OWNER_TOOLS__: JSON.stringify(process.env.JJ_PRODUCTION !== '1') },
  worker: { format: 'es', rollupOptions: { output } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'landing/index.html'),
        host: resolve(import.meta.dirname, 'host/index.html'),
        controller: resolve(import.meta.dirname, 'controller/index.html'),
        credits: resolve(import.meta.dirname, 'landing/credits/index.html'),
      },
      output,
    },
  },
});
