// P1-R03 browser tests: the map renderer on the real web build (web/dist) in headless Chromium, on the greybox.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node --test web/host/tests/map.test.mjs
// Writes its captures and numbers to docs/evidence/P1-R03/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R03');
const runs = {};
let browser;
let server;
let greybox;

before(async () => {
  browser = await chromium.launch();
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
  greybox = JSON.parse(await readFile(join(repo, 'maps/greybox-loop.json'), 'utf8'));
  await mkdir(evidenceDir, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  await writeFile(
    join(evidenceDir, 'browser-run.json'),
    `${JSON.stringify({ browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, ...runs }, null, 2)}\n`,
  );
});

async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/${path}`);
  await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 20, null, { timeout: 30_000 });
  return { page, errors };
}

/** CIE76 distance between two sRGB colours: enough to say "a person tells these apart". */
function deltaE([r1, g1, b1], [r2, g2, b2]) {
  const lab = (r, g, b) => {
    const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [f(r), f(g), f(b)];
    const [x, y, z] = [(R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.9505, R * 0.2126 + G * 0.7152 + B * 0.0722, (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.089];
    const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
  };
  const [a, b] = [lab(r1, g1, b1), lab(r2, g2, b2)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('the greybox renders with distinguishable surfaces', async () => {
  // Free drive keeps the greybox (a bare host page's Lobby prepares a procgen track since P1-M08a).
  const { page, errors } = await open('?drive');
  const stats = await page.evaluate(() => window.__jjRender.map());
  assert.equal(stats.routePoints, greybox.route.points.length);
  // A spot of each surface: on the route centreline (tarmac, packed dirt) and a terrain sample far from the road.
  const pts = greybox.route.points;
  const t = greybox.terrain;
  const offIdx = t.surfaces.findIndex((s, k) => s === 'off-track' && Math.floor(k / t.cols) === 1 && k % t.cols === Math.floor(t.cols / 2));
  const spots = {
    tarmac: pts.find((p) => p.surface === 'tarmac'),
    'packed-dirt': pts.find((p) => p.surface === 'packed-dirt'),
    'off-track': { x: t.originX + (offIdx % t.cols) * t.spacing, y: 0, z: t.originZ + Math.floor(offIdx / t.cols) * t.spacing },
  };
  const png = await page.screenshot();
  await page.screenshot({ path: join(evidenceDir, 'greybox-1280x720.jpg'), quality: 82 });
  const colours = {};
  for (const [name, p] of Object.entries(spots)) {
    assert.ok(p, `the greybox has ${name}`);
    const [sx, sy] = await page.evaluate(([x, y, z]) => window.__jjRender.project(x, y, z), [p.x / 1000, p.y / 1000 + 0.05, p.z / 1000]);
    colours[name] = await page.evaluate(
      async ([b64, x, y]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height).getContext('2d');
        c.drawImage(img, 0, 0);
        return [...c.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)];
      },
      [png.toString('base64'), sx, sy],
    );
  }
  const names = Object.keys(colours);
  const pairs = {};
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const d = deltaE(colours[names[i]], colours[names[j]]);
      pairs[`${names[i]}/${names[j]}`] = +d.toFixed(1);
      assert.ok(d > 20, `${names[i]} and ${names[j]} are distinguishable (ΔE ${d.toFixed(1)})`);
    }
  }
  // Props draw with their kit pieces (3 cones, 2 bins on the greybox).
  const props = await page.evaluate(() => window.__jjRender.props());
  assert.equal(props['generic/cone'], 3);
  assert.equal(props['generic/bin'], 2);
  assert.deepEqual(errors, []);
  runs.surfaces = { colours, deltaE: pairs, props, stats };
  await page.close();
});

test('draws scale with kit-piece types, not instances (1× and 10× the dressing)', async () => {
  const out = {};
  for (const k of [1, 10]) {
    const { page, errors } = await open(`?kitx=${k}`);
    const m = await page.evaluate(() => window.__jjRender.map());
    const s = await page.evaluate(() => window.__jjRender.stats());
    assert.deepEqual(errors, []);
    out[k] = { kitTypes: m.kitTypes, kitInstances: m.kitInstances, mapDraws: m.draws, frameDraws: s.drawCalls, kit: m.kit };
    if (k === 10) await page.screenshot({ path: join(evidenceDir, 'greybox-kitx10.jpg'), quality: 80 });
    await page.close();
  }
  assert.equal(out[10].kitInstances, out[1].kitInstances * 10);
  assert.equal(out[10].kitTypes, out[1].kitTypes);
  assert.equal(out[10].mapDraws, out[1].mapDraws);
  assert.equal(out[10].frameDraws, out[1].frameDraws, 'the frame costs the same draws');
  runs.drawScaling = out;
});

test("each registry entry's collider proxy and its rendered bounds agree within tolerance", async () => {
  const { page, errors } = await open('');
  const bounds = await page.evaluate(() => window.__jjRender.kitBounds());
  const await_fs = await import('node:fs');
  const families = (dir) => (await_fs.readdirSync(dir, { recursive: true }).filter((f) => /^[^/]+\/[^/]+\.json$/.test(f))); // every family (generic, signs, ...)
  // The wayfinding family's entries are procgen's stand-ins until P1-R10's assets/kit/wayfinding lands (same ids win).
  const ids = new Set([...families(join(repo, 'assets/kit')), ...families(join(repo, 'crates/jj-procgen/kit'))].map((f) => f.replace(/\.json$/, '')));
  assert.equal(bounds.length, ids.size, 'every registry entry has a module');
  for (const b of bounds) {
    assert.equal(b.rendered.length, 4, `${b.id} has a geometry module`);
    for (let k = 0; k < 3; k++) {
      const rel = Math.abs(b.rendered[k] - b.collider[k]) / b.collider[k];
      // 3 %: the round parts are polygons inscribed in or around the proxy's circle.
      assert.ok(rel <= 0.03, `${b.id} axis ${'xyz'[k]}: rendered ${b.rendered[k].toFixed(3)} m vs collider ${b.collider[k].toFixed(3)} m`);
    }
    assert.ok(Math.abs(b.rendered[3]) < 0.01, `${b.id} stands on its origin`);
  }
  assert.deepEqual(errors, []);
  runs.kitBounds = bounds;
  await page.close();
});
