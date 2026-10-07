import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The sim-worker test harness (P1-S02): built on its own into web/dist-test, never part of the shipped pages.
// Needs web/host/src/worker/pkg (scripts/build-host-wasm.sh).
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  worker: { format: 'es' },
  define: { __JJ_COMMIT__: JSON.stringify('harness') },
  build: {
    outDir: resolve(import.meta.dirname, '../../dist-test'),
    emptyOutDir: true,
    rollupOptions: {
      input: [resolve(import.meta.dirname, 'harness.html'), resolve(import.meta.dirname, 'prepare-harness.html')],
    },
  },
});
