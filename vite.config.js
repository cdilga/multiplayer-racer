import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';

/**
 * Resolve a stable build identity for this bundle.
 *
 * Precedence: explicit env (CI/deploy) -> git short sha -> a time-based id.
 * buildId is the short, human-scannable identity used for skew detection;
 * buildSha is the full commit (or env) for traceability; buildTime is the
 * wall-clock build moment. All three are baked into the client bundle (define)
 * AND written to dist/version.json so the server can advertise the same id.
 */
function resolveBuildIdentity() {
  const env = process.env;
  let sha = env.BUILD_SHA || env.GIT_COMMIT || env.CF_PAGES_COMMIT_SHA || '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    } catch (e) {
      sha = '';
    }
  }
  const buildTime = env.BUILD_TIME || new Date().toISOString();
  const shortFromSha = sha ? sha.slice(0, 12) : '';
  const buildId = env.BUILD_ID || shortFromSha ||
    `t${buildTime.replace(/[^0-9]/g, '').slice(0, 14)}`;
  return {
    buildId,
    buildSha: sha || 'unknown',
    buildTime
  };
}

const BUILD = resolveBuildIdentity();
const SOURCE_MAPS_ENABLED = process.env.POSTHOG_SOURCEMAP_UPLOAD === '1' ||
  process.env.JJ_BUILD_SOURCEMAPS === '1';

/**
 * Emit dist/version.json after the bundle is written so the server (and any
 * curl/healthcheck) can read the exact build identity it is serving. Kept
 * no-cache at the HTTP layer so a redeployed server always answers with the
 * fresh id and stale clients can detect the skew.
 */
function versionManifestPlugin() {
  return {
    name: 'jj-version-manifest',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      try {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          path.join(outDir, 'version.json'),
          JSON.stringify({ manifest: 'jj-build-version', ...BUILD }, null, 2)
        );
      } catch (e) {
        this.warn(`could not write dist/version.json: ${e.message}`);
      }
    }
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD.buildId),
    __BUILD_SHA__: JSON.stringify(BUILD.buildSha),
    __BUILD_TIME__: JSON.stringify(BUILD.buildTime),
  },
  plugins: [wasm(), topLevelAwait(), versionManifestPlugin()],
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
    sourcemap: SOURCE_MAPS_ENABLED,
    rollupOptions: {
      input: {
        landing: path.resolve(__dirname, 'frontend/landing/index.html'),
        host: path.resolve(__dirname, 'frontend/host/index.html'),
        player: path.resolve(__dirname, 'frontend/player/index.html'),
        'weapon-lab': path.resolve(__dirname, 'frontend/weapon-lab/index.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['three', '@dimforge/rapier3d-compat', 'socket.io-client'],
  },
});
