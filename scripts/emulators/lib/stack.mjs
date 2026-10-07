// P1-F08: the drive scenarios' stack. jj-server (the real server) + the lane proxy (injects the probe) + a real
// host page in Chromium on this machine (Playwright). The emulator's controller joins that host over WebRTC.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLaneServer } from './lane-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = process.env.JJ_REPO || path.resolve(here, '../../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(what, fn, timeoutMs, stepMs = 200) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(stepMs);
  }
}
const freePort = () => new Promise((res) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/** jj-server on `dist` (base `/`) behind the lane proxy. `env` adds to the server's (JJ_STUN_URLS etc.). */
export async function startStack({ dist, env = {}, port = 0, bind = '127.0.0.1' }) {
  const bin = process.env.JJ_SERVER_BIN || path.join(repo, 'target/debug/jj-server');
  if (!existsSync(bin)) throw new Error(`no jj-server at ${bin}; cargo build -p jj-server`);
  if (!existsSync(path.join(dist, 'landing/index.html'))) throw new Error(`no web build at ${dist}`);
  const upstream = await freePort();
  const srv = spawn(bin, [], { env: { ...process.env, JJ_BIND: `127.0.0.1:${upstream}`, JJ_DIST: dist, JJ_BASE_PATH: '/', JJ_REALM: 'test', ...env }, stdio: 'ignore' });
  await until('jj-server listening', () => new Promise((res) => {
    const c = net.connect(upstream, '127.0.0.1'); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false));
  }), 20000);
  const lane = await startLaneServer({ upstreamPort: upstream, port, host: bind, dist });
  const events = lane.events;
  const of = (kind) => events.filter((e) => e.kind === kind);
  return {
    port: lane.port, events, of, hostApi: lane.hostApi,
    has: (k) => events.some((e) => e.kind === k),
    last: (k) => of(k).at(-1)?.data,
    ctl: () => of('ctl').at(-1)?.data,
    reset: () => { events.length = 0; },
    stop: async () => { await lane.close(); srv.kill(); },
  };
}

/** A real host page (`/host?drive&test=live`) in Chromium on this machine. */
export async function startHost(port, { gpu = 'native' } = {}) {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(path.join(repo, 'web/package.json'))('playwright');
  const args = ['--disable-features=WebRtcHideLocalIpsWithMdns', ...(gpu === 'native' ? ['--ignore-gpu-blocklist'] : gpu === 'vulkan' ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])];
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.setExtraHTTPHeaders({ 'x-jj-nolane': '1' }); // the host page is not the page under test: no probe
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/host?drive&test=live`);
  await page.waitForFunction(() => window.__jjNet?.code() && window.__jjTest, undefined, { timeout: 60000, polling: 100 });
  const code = await page.evaluate(() => window.__jjNet.code());
  return {
    page, code, errors, browser,
    observe: () => page.evaluate(() => window.__jjTest.observe()),
    command: (c) => page.evaluate((c) => window.__jjTest.command(c), c),
    close: () => browser.close(),
  };
}
