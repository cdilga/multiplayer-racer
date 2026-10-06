import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The UI kit page (P1-U06): every component in every state, built on its own for the kit tests into web/dist-test/kit. It is
// not an input of the shipped build (web/vite.config.ts), so it never reaches web/dist.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, '../dist-test/kit'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'index.html') },
  },
});
