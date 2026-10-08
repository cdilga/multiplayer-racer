// P1-R10 and P1-R12 captures and checks on the real host page (test build): the in-world look at 1, 4 and 24 tiles with the
// wayfinding kit in view, the identity paint-vs-badge check in the engine, and every effect family at 1, 4 and 24 tiles.
// Run where the GPU is (eris: scripts/remote/eris.sh --run <id> 'JJ_CHROMIUM_GPU=1 node web/host/tests/look-capture.mjs'); not on
// the busy Mac. Native device pixels (R111): the viewport is the canvas, DPR 1 unless a shot says otherwise.
//   npm --prefix web run build && node web/host/tests/look-capture.mjs [look identity fx] [--headless]
// Writes JPGs and report.json (what each shot waited for, console errors, draw calls, tiers) into docs/evidence/P1-R10 and
// docs/evidence/P1-R12. Look at every frame: self-review.md is written from them, never from this report.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { chromiumArgs } from '../../tests/journeys/lib/chromium.mjs';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
// Evidence goes to $JJ_EVIDENCE_DIR (eris.sh --run sets it to the run dir: nobody writes into eris's clone), else docs/evidence.
const evidenceRoot = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence');
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const want = (k) => !only.length || only.includes(k);
const server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
// JJ_CHROMIUM_GPU=1: headless Chromium through ANGLE on Vulkan (eris's RTX 2080 Super; the journeys' own launch arguments).
// Never a silent fallback: a launch that fails fails the run, and every report names the WebGL renderer that drew it.
const gpu = process.env.JJ_CHROMIUM_GPU === '1';
const browser = await chromium.launch(
  gpu ? { headless: true, args: chromiumArgs } : args.includes('--headless') || process.env.JJ_HEADLESS ? {} : { headless: false, channel: 'chrome' },
);
const probe = await browser.newPage();
const renderer = await probe.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
await probe.close();
const mode = `${gpu ? 'Chromium (ANGLE/Vulkan, headless)' : 'Chrome'} ${browser.version()}, ${process.platform}/${process.arch}; WebGL renderer: ${renderer}`;
console.log('mode', mode);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE = '.jj-chip,.jj-render-chip,aside,.jj-arrows,button,[class*=banner],[class*=toast],.jj-hud{display:none!important}';

async function openPage(url, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || /shader|program|GLSL|WebGL: INVALID/i.test(m.text())) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/${url}`);
  return { page, errors };
}

// ---- look: the playtest track with the wayfinding kit, at 1, 4 and 24 tiles ----------------------------------------------
// [name, players, w, h, where]: where is a route feature found from the route's own geometry (the kit sits on it).
const LOOK = [
  ['corner-1tile-tv-1080p', 1, 1920, 1080, 'corner'],
  ['corner-4tiles-tv-1080p', 4, 1920, 1080, 'corner'],
  ['corner-24tiles-tv-1080p', 24, 1920, 1080, 'corner'],
  ['gantry-1tile-tv-1080p', 1, 1920, 1080, 'start'],
  ['gantry-4tiles-tv-1080p', 4, 1920, 1080, 'start'],
  ['gantry-24tiles-tv-1080p', 24, 1920, 1080, 'start'],
  ['corner-1tile-laptop-1366', 1, 1366, 768, 'corner'],
  ['straight-4tiles-laptop-1366', 4, 1366, 768, 'straight'],
  // A phone as the host (P1-R08), landscape and portrait.
  ['corner-1tile-phone-915x412', 1, 915, 412, 'corner'],
  ['straight-2tiles-phone-412x915', 2, 412, 915, 'straight'],
];

// A real room of 24 joined controllers once crashed headless GPU Chromium on eris (the page closed during the joins). The 24-tile
// shots try the real room first (headed under Xvfb on eris) and fall back to the synthetic oval on the greybox map (generic kit
// only) if the page dies; the report says which (`where`).
async function syntheticShot(spec, out, report) {
  const [name, players, w, h, where] = spec;
  const { page, errors } = await openPage(`?synthetic=${players}&map&look=on&tiles=${players}&res=1&autores=off`, w, h);
  await page.waitForFunction(() => window.__jjRender?.stats().frames > 60, null, { timeout: 60_000 });
  await sleep(1500);
  await page.addStyleTag({ content: HIDE });
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });
  const info = await page.evaluate(() => ({ stats: window.__jjRender.stats(), map: window.__jjRender.map() }));
  report.shots.push({ name, players, viewport: [w, h], where: `synthetic oval, greybox map (${where})`, errors, drawCalls: info.stats.drawCalls, tiles: info.stats.lods?.length, mapDraws: info.map?.draws, kit: info.map?.kit });
  console.log('look', name, JSON.stringify({ draws: info.stats.drawCalls, errors: errors.length }));
  await page.close();
}

async function raceShot(spec, out, report) {
  const [name, players, w, h, where] = spec;
  if (players >= 12 && !spec.real) {
    try {
      return await raceShot(Object.assign([...spec], { real: true }), out, report);
    } catch (e) {
      console.log('look', name, `real room failed (${String(e.message).slice(0, 120)}); synthetic oval instead`);
      return syntheticShot(spec, out, report);
    }
  }
  const { page, errors } = await openPage('?test=live&room&look=on&res=1&autores=off&laps=1', w, h);
  await page.waitForFunction(() => window.__jjPrepare !== undefined, null, { timeout: 60_000 });
  for (let k = 0; k < players; k++) await page.evaluate((n) => window.__jjTest.join(n, { lobby: true }), `Driver ${k + 1}`);
  await page.evaluate(() => window.__jjRoom.start());
  await page.waitForFunction(() => window.__jjPrepare.stats().committed === 1, null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__jjRoom.view()?.phase === 'Running', null, { timeout: 90_000 });
  await page.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  const reached = await page.evaluate(
    async (kind) => {
      const info = window.__jjPrepare.mapInfo();
      const pts = info.route;
      const n = pts.length;
      // The sharpest turn over a 12-point window: where the corner chevrons and the rail stand.
      const turn = (i) => {
        const a = pts[i % n];
        const b = pts[(i + 6) % n];
        const c = pts[(i + 12) % n];
        const v1 = [b[0] - a[0], b[1] - a[1]];
        const v2 = [c[0] - b[0], c[1] - b[1]];
        return Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]));
      };
      let target = 0;
      if (kind === 'corner') for (let i = 0, best = -1; i < n; i++) if (turn(i) > best) [best, target] = [turn(i), i];
      if (kind === 'straight') for (let i = 30, best = 9; i < n - 30; i++) if (turn(i) < best) [best, target] = [turn(i), i + 20];
      const behind = kind === 'start' ? 0 : 16; // the view ahead of the car
      const at = Math.max(0, target - behind);
      const nearest = (p) => {
        let best = 0;
        let d = Infinity;
        pts.forEach(([x, z], i) => {
          const dd = (x - p[0]) ** 2 + (z - p[2]) ** 2;
          if (dd < d) [d, best] = [dd, i];
        });
        return best;
      };
      if (kind === 'start') return { kind, target: 0, reached: true, tick: 0, point: 0 };
      const r = await window.__jjTest.untilFact((s) => Math.abs(nearest(s.cars[0].position) - at) <= 2, { maxTicks: 40_000, every: 20 });
      return { kind, target: at, reached: r.held, tick: r.tick, point: nearest(r.state.cars[0].position) };
    },
    where,
  );
  if (!reached.reached) throw new Error(`${name}: ${JSON.stringify(reached)}`);
  await sleep(1500);
  await page.addStyleTag({ content: HIDE });
  await sleep(300);
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });
  const info = await page.evaluate(() => ({ stats: window.__jjRender.stats(), map: window.__jjRender.map(), vehicles: window.__jjRender.vehicles()?.drawsPerTile }));
  report.shots.push({ name, players, viewport: [w, h], where: reached, errors, drawCalls: info.stats.drawCalls, tiles: info.stats.lods?.length, mapDraws: info.map?.draws, kit: info.map?.kit });
  console.log('look', name, JSON.stringify({ draws: info.stats.drawCalls, errors: errors.length }));
  await page.close();
}

// ---- identity: the engine's lit paint against the flat badge colours ----------------------------------------------------
async function identity(out, report) {
  const { page, errors } = await openPage('?synthetic=8&damage=strip&map&look=on&res=1&autores=off', 1920, 1080);
  await page.waitForFunction(() => window.__jjRender?.stats().frames > 5);
  await sleep(1200);
  await page.addStyleTag({ content: HIDE });
  const cars = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      // The strip: car i parked at x = -6.5 i facing +x; project its corners to a screen box (CSS px = canvas px at DPR 1).
      const pts = [];
      for (const dx of [-2.2, 2.2]) for (const dy of [0.2, 1.5]) for (const dz of [-1, 1]) pts.push(window.__jjRender.project(-6.5 * i + dx, dy, dz));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      out.push({ box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
    return out;
  });
  const palette = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389', '#ff7a2e', '#9b7bff', '#ff3b3b', '#3bd6c6']; // vehicles.ts PALETTE: the badge colours
  const shot = await page.screenshot({ type: 'png' });
  await writeFile(join(out, 'identity-strip-1080p.png'), shot);
  const png = PNG.sync.read(shot);
  const rows = cars.map((c, i) => {
    const want = [1, 3, 5].map((k) => parseInt(palette[i].slice(k, k + 2), 16));
    let near = 0;
    let total = 0;
    const [x0, y0, x1, y1] = c.box.map(Math.round);
    for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x++) {
        const o = (y * png.width + x) * 4;
        total++;
        // A lit face shows the badge colour within 10 % per channel; the ink and shade tones are other pixels.
        if ([0, 1, 2].every((k) => Math.abs(png.data[o + k] - want[k]) <= 38)) near++;
      }
    return { car: i + 1, badge: palette[i], litPixelShare: +(near / Math.max(1, total)).toFixed(3), box: c.box.map(Math.round) };
  });
  report.identity = { rows, errors, passes: rows.every((r) => r.litPixelShare >= 0.03) };
  console.log('identity', JSON.stringify(rows.map((r) => [r.car, r.litPixelShare])));
  await page.close();
}

// ---- fx: every family at 1, 4 and 24 tiles ----------------------------------------------------------------------------------
// The synthetic oval with ?fxdemo: car i cycles through the family its index names (see synthetic.ts fxDemoState).
const ALL = ['dust', 'tyre-smoke', 'boost', 'sparks', 'impact', 'landing', 'detach', 'damage-smoke', 'wreck-fire', 'lamp'];
const FX = [
  // [name, tiles, follow, families that must be alive, { see: a tile must have the husk in view, hit: shoot the moment a new impact lands }]
  ['dust-dirt-1tile', 1, [0], ['dust']],
  ['tyre-smoke-1tile', 1, [1], ['tyre-smoke']],
  ['boost-blue-1tile', 1, [2], ['boost']],
  ['gravel-spray-1tile', 1, [3], ['dust']],
  ['impact-sparks-1tile', 1, [4], ['impact', 'sparks'], { hit: true }],
  ['landing-1tile', 1, [11], ['landing']],
  ['detach-damage-1tile', 1, [5], ['detach', 'damage-smoke']],
  ['wreck-fire-1tile', 1, [0], ['wreck-fire'], { see: true }],
  ['wreck-fire-overview', 0, [], ['wreck-fire']],
  ['driving-4tiles', 4, [0, 1, 2, 3], ['dust', 'tyre-smoke', 'boost', 'lamp']],
  ['hits-4tiles', 4, [4, 5, 10, 11], ['impact', 'sparks', 'landing', 'detach', 'damage-smoke']],
  ['wreck-fire-4tiles', 4, [0, 6, 12, 18], ['wreck-fire'], { see: true }],
  ['all-24tiles', 24, null, ALL, { see: true }],
];
const HUSK = [-14, 0.8, 6]; // synthetic.ts HUSK_AT, lifted to the fire

async function fxShot([name, tiles, follow, families, opts = {}], out, report, reduced = false) {
  const q = `?synthetic=${tiles === 0 ? 12 : Math.max(24, tiles)}&map&look=on&fxdemo&res=1&autores=off${tiles ? `&tiles=${tiles}` : ''}${follow?.length ? `&follow=${follow.join(',')}` : ''}`;
  const { page, errors } = await openPage(q, 1920, 1080);
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: HIDE });
  let alive = {};
  let seen = !opts.see;
  const hits0 = opts.hit ? await page.evaluate(() => window.__jjRender.vehicles()?.fx.spawned.impact ?? 0) : 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    const st = await page.evaluate((h) => ({ alive: window.__jjRender.vehicles()?.fx.alive ?? {}, spawned: window.__jjRender.vehicles()?.fx.spawned ?? {}, sees: window.__jjRender.tilesSee([h]).some((t) => t.sees[0]) }), HUSK);
    alive = st.alive;
    if (opts.see) seen = tiles === 0 || st.sees;
    // A new hit (normal and reduced motion are shot at the same moment after it), or every family alive at once.
    if (opts.hit ? st.spawned.impact > hits0 : families.every((f) => alive[f] > 0) && seen && (!families.includes('sparks') || alive.sparks >= 12)) break;
    await sleep(15);
  }
  alive = await page.evaluate(() => window.__jjRender.vehicles()?.fx.alive ?? {});
  const have = families.filter((f) => alive[f] > 0);
  await page.screenshot({ path: join(out, `${name}${reduced ? '-reduced' : ''}.jpg`), type: 'jpeg', quality: 86 });
  const info = await page.evaluate(() => ({ fx: window.__jjRender.vehicles()?.fx, draws: window.__jjRender.stats().drawCalls }));
  report.shots.push({ name, tiles, reduced, families, aliveWhenShot: alive, allFamiliesShown: have.length === families.length, huskInView: seen, errors, drawCalls: info.draws, spawned: info.fx?.spawned, reducedMotion: info.fx?.reducedMotion });
  console.log('fx', name, reduced ? 'reduced' : '', have.length === families.length && seen ? 'ok' : `MISSING ${families.filter((f) => !alive[f])}${seen ? '' : ' husk not in view'}`);
  await page.close();
}

const done = [];
if (want('look')) {
  const out = join(evidenceRoot, 'P1-R10/captures');
  await mkdir(out, { recursive: true });
  const report = { mode, shots: [] };
  for (const s of LOOK.filter((x) => !process.env.JJ_SHOT || process.env.JJ_SHOT.split(',').includes(x[0]))) await raceShot(s, out, report);
  await writeFile(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  done.push('look');
}
if (want('identity')) {
  const out = join(evidenceRoot, 'P1-R10/captures');
  await mkdir(out, { recursive: true });
  const report = { mode };
  await identity(out, report);
  await writeFile(join(out, 'identity.json'), `${JSON.stringify(report, null, 2)}\n`);
  done.push('identity');
}
if (want('fx')) {
  const out = join(evidenceRoot, 'P1-R12/captures');
  await mkdir(out, { recursive: true });
  const report = { mode, shots: [] };
  for (const s of FX.filter((x) => !process.env.JJ_SHOT || process.env.JJ_SHOT.split(',').includes(x[0]))) await fxShot(s, out, report);
  await fxShot(FX[4], out, report, true); // the same moment after a hit, reduced motion on
  await writeFile(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  done.push('fx');
}
console.log('done', done.join(','), mode);
await browser.close();
server.close();
