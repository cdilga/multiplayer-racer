import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// P1-F03's qualification bundle: every pinned runtime library, minified as the real build is, for the origin scan
// (scripts/ci/origin-scan.mjs). Output: web/dist-qualify (not shipped, not served).
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, '..', 'dist-qualify'),
    emptyOutDir: true,
    lib: { entry: resolve(import.meta.dirname, 'entry.ts'), formats: ['es'], fileName: 'qualify' },
    minify: true,
  },
});
