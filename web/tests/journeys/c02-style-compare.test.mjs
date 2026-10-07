// P1-C02/C03/C04 .style: the real controller beside the accepted phone mock (art/ui/accepted/2026-10-07/poc/phone), the same
// state at the same size, saved as `ref-<state>-<size>.png` and `real-<state>-<size>.png` in $JJ_CAPTURE_DIR for the
// fresh-eyes review. The test only checks that both draw (no errors, no overflow in the real one); the judging is by eye.
//   JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/c02-style-compare.test.mjs
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// art/ui/poc/phone is the mock as accepted on 2026-10-07 (art/ui/accepted/2026-10-07/poc/phone is its frozen copy); it
// imports ../../sheets, so the whole of art/ui is served.
const ACCEPTED = join(here, '..', '..', '..', 'art', 'ui');
const BASE = '/p/c02style/';
const OUT = process.env.JJ_CAPTURE_DIR;
let browser;
let server;
let refServer;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

before(async () => {
  server = await serve(build('./', 'c02style'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  // The accepted mock is static files; it fetches its tokens and fonts relative to itself.
  refServer = createServer((req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let f = join(ACCEPTED, p);
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  await new Promise((r) => refServer.listen(0, '127.0.0.1', r));
});
after(async () => {
  await browser?.close();
  await server?.close();
  refServer?.close();
});

const SIZES = { 'landscape-844x390': [844, 390], 'portrait-390x844': [390, 844], 'small-375x667': [375, 667] };
/** [name, the mock's fragment, the controller's fragment, which sizes] */
const PAIRS = [
  ['race', 'race', 'playing&round=racing&boost=140', null],
  ['lobby-play', 'tutorial', 'playing&round=lobby', ['landscape-844x390']],
  ['ready-to-join', 'ready-to-join', 'ready-to-join&name=Dusty', null],
  ['finding', 'finding', 'finding', null],
  ['no-such-room', 'no-such-game', 'no-such-room', null],
  ['room-ended', 'game-ended', 'room-ended', null],
  ['preview-expired', 'preview-expired', 'preview-expired', null],
  ['connecting', 'connecting', 'connecting', null],
  ['finding-relay', 'finding-relay', 'finding-relay', null],
  ['no-route', 'no-route', 'no-route', null],
  ['joining', 'joining', 'joining', null],
  ['reconnecting', 'reconnecting', 'reconnecting&seat=12', null],
  ['host-gone', 'host-gone', 'host-gone', null],
  ['host-paused', 'host-paused', 'host-paused&seat=12', null],
  ['another-tab', 'another-tab', 'another-tab', null],
  ['update-needed', 'update-needed', 'update-needed', null],
];

async function shotPair([name, ref, real, only]) {
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    if (only && !only.includes(label)) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const a = await ctx.newPage();
    const errs = [];
    a.on('pageerror', (e) => errs.push(e.message));
    await a.goto(`http://127.0.0.1:${refServer.address().port}/poc/phone/index.html#${ref}&chrome=0&seat=12`);
    await a.waitForTimeout(1200);
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errs.push(e.message));
    await b.goto(`${server.origin}${BASE}j/ABCD#state=${real}`);
    await b.waitForFunction(() => document.documentElement.dataset.jjController === 'ready', undefined, { timeout: 30_000 });
    await b.waitForTimeout(600);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      await a.screenshot({ path: `${OUT}/ref-${name}-${label}.png` });
      await b.screenshot({ path: `${OUT}/real-${name}-${label}.png` });
    }
    const over = await b.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 1, `${name} ${label}: the real controller scrolls sideways by ${over}px`);
    assert.deepEqual(errs, [], `${name} ${label}: page errors`);
    await ctx.close();
  }
}

for (const pair of PAIRS) test(`style compare: ${pair[0]}`, { timeout: 60_000 }, () => shotPair(pair));
