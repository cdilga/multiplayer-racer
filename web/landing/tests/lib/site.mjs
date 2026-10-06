// Test helpers for the web pages: build the web app once (a relative base, so one build serves under any base path),
// and serve it with the real game server, `jj-server` (crates/jj-server), at a base path: B/ is the landing page,
// B/host the host app, B/c and B/j/<CODE> the controller, B/assets real files with real 404s, B/api/v1 the room API.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const repo = join(web, '..');

/** Builds the whole web app with Vite into web/dist-test/<name> (git-ignored). The base doesn't matter: the build is
 * relative and the server places it (`_base` stays for callers that name the base they'll serve). */
export function build(_base, name) {
  const outDir = join('dist-test', name);
  const env = { ...process.env };
  delete env.JJ_BASE;
  execFileSync(process.execPath, [join(web, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--logLevel', 'error'], {
    cwd: web,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return join(web, outDir);
}

/** The jj-server binary: `JJ_SERVER_BIN`, else the workspace's debug build (built here if missing). */
export function serverBin() {
  if (process.env.JJ_SERVER_BIN) return process.env.JJ_SERVER_BIN;
  const target = process.env.CARGO_TARGET_DIR ?? join(repo, 'target');
  const bin = join(target, 'debug', 'jj-server');
  if (!existsSync(bin)) execFileSync('cargo', ['build', '-q', '-p', 'jj-server'], { cwd: repo, stdio: 'inherit' });
  return bin;
}

/** Runs jj-server on a free port with `dist` at `base`; resolves once it listens. */
export async function serve(dist, base, extraEnv = {}) {
  const child = spawn(serverBin(), [], {
    env: { ...process.env, JJ_BIND: '127.0.0.1:0', JJ_DIST: dist, JJ_BASE_PATH: base, JJ_REALM: 'test', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  const origin = await new Promise((resolve, reject) => {
    child.stderr.on('data', (d) => {
      log += d;
      const m = /listening on (\S+)/.exec(log);
      if (m) resolve(`http://${m[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`jj-server exited ${code}: ${log}`)));
  });
  return {
    origin,
    log: () => log,
    close: () => new Promise((r) => (child.exitCode !== null ? r() : (child.once('exit', r), child.kill()))),
  };
}
