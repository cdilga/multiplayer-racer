// Node-side helpers for driving the host's test surface (P1-F05b) from Playwright: a static server for a web build
// with a realm switch, and the guardrail that refuses production URLs (plan §13a: guardrails live in the tool).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { serve as serveGameServer } from '../../../landing/tests/lib/site.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css' };
/** Hosts the test surface may be driven on: local runs and previews. `JJ_TEST_HOSTS` adds more (comma-separated). */
const TESTABLE = [/^localhost$/, /^127\.\d+\.\d+\.\d+$/, /^\[::1\]$/, /\.local$/, /^jammers-preview\.dilger\.dev$/];

/** Throws unless `url` is a local or preview host: test-only helpers never touch production. */
export function assertTestable(url) {
  const host = new URL(url).hostname;
  const extra = (process.env.JJ_TEST_HOSTS ?? '').split(',').filter(Boolean);
  if (TESTABLE.some((re) => re.test(host)) || extra.includes(host)) return url;
  throw new Error(`refusing to drive the test surface on ${host}: not a local or preview host (set JJ_TEST_HOSTS to add one)`);
}

/** Serves a web build (`web/dist`). Realm `production` answers everything under `test/` with 404, like the game
 *  server will (the real server's check is P1-F05b's child bead on P1-N02); any other realm serves it. */
export async function serve(dist, realm = 'preview') {
  const requests = [];
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    requests.push(path);
    if (realm === 'production' && path.startsWith('/test/')) return res.writeHead(404).end();
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(dist, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

/** Serves a web build with the REAL game server (`jj-server`, JJ_SERVER_BIN or the workspace's debug build) in `realm`
 *  (`production` answers everything under `/test/` with 404; any other realm serves it, P1-F05b.1). Same shape as `serve`:
 *  `url`, `requests` (the paths the pages asked for: record them with `track(server, page)`), `close`. */
export async function serveReal(dist, realm = 'preview') {
  const game = await serveGameServer(dist, '/', { JJ_REALM: realm, JJ_STUN_URLS: '' });
  return { url: game.origin, requests: [], realm, close: () => game.close() };
}

/** Records the path of every request `page` makes into `server.requests`. */
export function track(server, page) {
  page.on('request', (r) => server.requests.push(new URL(r.url()).pathname));
}

/** Opens the host page and waits until it has booted (`data-jj-host` is `test` or `ready`). */
export async function openHost(page, url) {
  await page.goto(assertTestable(url));
  await page.waitForFunction(() => document.documentElement.dataset.jjHost !== undefined, null, { timeout: 30_000 });
  return page.evaluate(() => document.documentElement.dataset.jjHost);
}
