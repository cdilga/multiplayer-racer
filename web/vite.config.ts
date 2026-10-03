import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// One multi-page build; each page bundles only what it imports, so the controller never pulls the
// host's renderer or sim (Playtest-1 plan §4.1). The base path comes from the deployment:
// `/` in production, `/p/<id>/` in a preview (§5.1, §12).
export default defineConfig({
  base: process.env.JJ_BASE ?? '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'landing/index.html'),
        host: resolve(import.meta.dirname, 'host/index.html'),
        controller: resolve(import.meta.dirname, 'controller/index.html'),
      },
    },
  },
});
