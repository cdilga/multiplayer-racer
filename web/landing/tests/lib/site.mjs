// Test helpers for the landing page (P1-C01): build the web app under a base path, and serve it the way the game
// server will (plan §5.1): B/ is the landing page, B/host the host app, B/c and B/j/<CODE> the controller, B/assets
// real files with real 404s.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' };

/** Builds the whole web app with Vite under `base` (`/` or `/p/<id>/`) into web/dist-test/<name> (git-ignored). */
export function build(base, name) {
  const outDir = join('dist-test', name);
  execFileSync(process.execPath, [join(web, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--logLevel', 'error'], {
    cwd: web,
    env: { ...process.env, JJ_BASE: base },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return join(web, outDir);
}

/** Serves a build at `base`. Anything outside the base is a 404, like a real preview path. */
export async function serve(dist, base) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname);
    if (!url.pathname.startsWith(base)) return res.writeHead(404).end();
    const rel = normalize(decodeURIComponent(url.pathname.slice(base.length))).replace(/^(\.\.[/\\])+/, '');
    let file = rel;
    if (rel === '.' || rel === '' || rel === '/') file = 'landing/index.html';
    else if (rel === 'host') file = 'host/index.html';
    else if (rel === 'c' || rel.startsWith('j/')) file = 'controller/index.html';
    try {
      const body = await readFile(join(dist, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}
