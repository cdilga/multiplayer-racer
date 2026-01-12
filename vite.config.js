import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  root: '.',
  publicDir: 'static',
  resolve: {
    alias: {
      '/static': path.resolve(__dirname, 'static'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:8000',
        ws: true,
      },
      '/qrcode': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        host: path.resolve(__dirname, 'frontend/host/index.html'),
        player: path.resolve(__dirname, 'frontend/player/index.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['three', '@dimforge/rapier3d-compat', 'socket.io-client'],
  },
}); 