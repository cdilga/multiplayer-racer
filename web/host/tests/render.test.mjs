// P1-R01 browser tests: the host renderer on the real web build (web/dist) in headless Chromium.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node --test web/host/tests/render.test.mjs
// Writes its captures and numbers to docs/evidence/P1-R01/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R01');
const runs = {};
let browser;
let server;

before(async () => {
  browser = await chromium.launch();
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
});

after(async () => {
  await browser?.close();
  server?.close();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, 'browser-run.json'),
    `${JSON.stringify({ browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, ...runs }, null, 2)}\n`,
  );
});

const stats = (page) => page.evaluate(() => window.__jjRender.stats());

async function open(path, { viewport = { width: 1280, height: 720 }, deviceScaleFactor = 1 } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const mode = await openHost(page, `${server.url}/host/${path}`);
  return { page, mode, errors };
}

async function untilFrames(page, n, timeoutMs = 20_000) {
  await page.waitForFunction((k) => (window.__jjRender?.stats().frames ?? 0) >= k, n, { timeout: timeoutMs });
  return stats(page);
}

test('a browser without WebGL2 or WebGPU gets the explanation and a Join link, and no room is created', async () => {
  const bare = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-features=WebGPU'] });
  try {
    const page = await bare.newPage();
    const from = server.requests.length;
    const mode = await openHost(page, `${server.url}/host/`);
    assert.equal(mode, 'unsupported');
    const text = await page.locator('.jj-unsupported').innerText();
    assert.match(text, /can’t host a game/);
    assert.match(text, /WebGL2 or WebGPU/);
    const joinLink = page.getByRole('link', { name: 'Join a game' });
    assert.equal(await joinLink.getAttribute('href'), `${server.url}/controller/`);
    await page.waitForTimeout(500);
    const fetched = server.requests.slice(from);
    // No room: the sim worker and its WASM are never fetched, and no canvas exists.
    assert.ok(!fetched.some((p) => /sim\.worker|\.wasm$/.test(p)), `fetched ${fetched.join(', ')}`);
    assert.equal(await page.locator('canvas').count(), 0);
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, 'unsupported.png') });
    runs.unsupported = { mode, joinHref: await joinLink.getAttribute('href'), fetched };
  } finally {
    await bare.close();
  }
});

/** The synthetic source's respawn stagger (render/synthetic.ts): car i respawns when (tick + phase_i) % 1200 == 0. */
const phase = (i) => (i * 997) % 1200;
const crossing = (cars, tick) => Array.from({ length: cars }, (_, i) => i).filter((i) => (tick + phase(i)) % 1200 === 0).length;

test('the renderer interpolates from the synthetic snapshot source (§4.4 ABI), never across a respawn', async () => {
  const { page, mode, errors } = await open('?synthetic=24');
  assert.equal(mode, 'synthetic');
  const a = await untilFrames(page, 30);
  const b = await untilFrames(page, a.frames + 30);
  assert.equal(b.cars, 24);
  assert.ok(b.tick > a.tick, `render tick advances (${a.tick} → ${b.tick})`);
  assert.ok(!Number.isInteger(b.tick) || !Number.isInteger(a.tick) || b.tick !== a.tick);
  assert.deepEqual(errors, []);
  await page.close();

  // A frozen pair that crosses car 1's respawn (tick 203) draws car 1 at its new pose; one that crosses none snaps none.
  const at = {};
  for (const tick of [203, 600]) {
    const { page: p } = await open(`?synthetic=24&freeze=${tick}`);
    const s = await untilFrames(p, 3);
    at[tick] = { snapped: s.snapped, expected: crossing(24, tick), drawnTick: s.tick };
    assert.equal(s.snapped, crossing(24, tick), `tick ${tick}`);
    assert.equal(s.tick, tick - 0.5);
    await p.close();
  }
  assert.ok(at[203].snapped >= 1);
  runs.interpolation = { live: { from: a, to: b }, frozen: at };
});

async function capture(renderer) {
  const { page, errors } = await open(`?synthetic=24&freeze=600&renderer=${renderer}`);
  const s = await untilFrames(page, 30);
  const png = await page.screenshot(); // the canvas fills the viewport (an element screenshot dropped grid lines here)
  await page.close();
  assert.deepEqual(errors, []);
  return { png, backend: s.backend };
}

test('the forced fallback path renders the same frame (capture comparison)', async () => {
  const main = await capture('webgl');
  const fallback = await capture('webgl2');
  assert.equal(main.backend, 'WebGL2 (WebGLRenderer)');
  assert.equal(fallback.backend, 'WebGL2 (WebGPURenderer)');
  const page = await browser.newPage();
  const diff = await page.evaluate(
    async ([a, b]) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height);
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return { sameSize: false };
      let sum = 0;
      let big = 0;
      let flat = new Set();
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
        sum += d;
        if (d > 48) big++;
        if (flat.size < 64) flat.add((x.data[i] << 16) | (x.data[i + 1] << 8) | x.data[i + 2]);
      }
      const px = x.data.length / 4;
      return { sameSize: true, width: x.width, height: x.height, meanDiff: sum / px, bigDiffShare: big / px, colours: flat.size };
    },
    [`data:image/png;base64,${main.png.toString('base64')}`, `data:image/png;base64,${fallback.png.toString('base64')}`],
  );
  await page.close();
  await writeFile(join(evidenceDir, 'frame-webgl.png'), main.png);
  await writeFile(join(evidenceDir, 'frame-webgl2-fallback.png'), fallback.png);
  runs.fallback = { main: main.backend, fallback: fallback.backend, ...diff };
  assert.ok(diff.sameSize);
  assert.ok(diff.colours > 8, 'the frame is not blank or flat');
  // Same scene, same tick, same camera: only shading/AA differences between the two renderers are allowed.
  assert.ok(diff.meanDiff < 6, `mean channel difference ${diff.meanDiff.toFixed(2)}`);
  assert.ok(diff.bigDiffShare < 0.02, `pixels that differ a lot: ${(diff.bigDiffShare * 100).toFixed(2)} %`);
});

test('the host draws the sim worker’s snapshots at native resolution (R111)', async () => {
  const { page, mode, errors } = await open('', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625 });
  assert.equal(mode, 'ready');
  const s = await untilFrames(page, 20);
  // The backing store is the canvas's on-screen size in device pixels, and the chip names it.
  assert.equal(s.resolution, 'native', JSON.stringify(s));
  assert.equal(s.width, Math.round(915 * 2.625));
  assert.equal(s.height, Math.round(412 * 2.625));
  assert.equal(s.backend, 'WebGL2 (WebGLRenderer)');
  // The chip names the backing store it shows. Read it with the stats in one step: on a slow runner the auto resolution
  // can lower the scale between two separate reads, which is correct and only the reads would disagree.
  const now = await page.evaluate(() => ({ chip: document.querySelector('[data-testid="render-chip"]').innerText, s: window.__jjRender.stats() }));
  const chip = now.chip;
  assert.ok(chip.includes(`${now.s.width}×${now.s.height}`), `${chip} vs ${JSON.stringify(now.s)}`);
  if (now.s.resolution === 'native') assert.match(chip, new RegExp(`${now.s.width}×${now.s.height} native`));
  assert.ok(s.tick > 0, 'snapshots from the sim worker arrive');
  assert.deepEqual(errors, []);
  runs.nativeResolution = { viewport: '915x412 @2.625', stats: s, chip };
  await page.close();
});
