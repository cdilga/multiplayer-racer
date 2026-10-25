// P1-FL15b / br-bbki.15.2 (R132, R129): generated set pieces through the real worker and renderer. For each kind (canyon
// leap, mesa drop, creek washout) the first seed that places it: the autopilot's car leaves the kicker, is visibly in the
// air over the pit, lands upright on the far rim, and the WASM replay matches native; every drawn kicker triangle matches
// the native collision mesh. With JJ_CAPTURE_DIR set it also captures the TV views the self-review looks at: the chase
// camera 200 m before the commitment point (seen from afar), mid-air, a side angle, and the course overview.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/set-piece/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-FL15b');
const TICK_HZ = 120;
const KINDS = [['canyon-leap', 'rocks'], ['mesa-drop', 'outback-bitumen'], ['creek-washout', 'outback-dirt']];
const cases = [];
let server, scratch;

/** Route index nearest a pose. */
const nearest = (pts, pose) => pts.reduce((best, p, i) => ((p.x - pose.x) ** 2 + (p.z - pose.z) ** 2 < (pts[best].x - pose.x) ** 2 + (pts[best].z - pose.z) ** 2 ? i : best), 0);
const heading = (pts, i) => { const [a, b] = [pts[i], pts[(i + 1) % pts.length]]; return Math.atan2(b.x - a.x, b.z - a.z); };
const car = (pts, i, speed) => { const h = heading(pts, i); return { routePoint: i, lift: .5, linvel: [speed * Math.sin(h), 0, speed * Math.cos(h)] }; };

before(async () => {
  mkdirSync(out, { recursive: true });
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  scratch = mkdtempSync(join(tmpdir(), 'jj-set-piece-'));
  symlinkSync(resolve('assets'), join(scratch, 'assets'), 'dir');
  for (const [kind, recipe] of KINDS) {
    let found;
    for (let seed = 0; seed < 20 && !found; seed++) {
      const dir = join(scratch, `${recipe}-${seed}`);
      execFileSync(bin, [...args, 'procgen', '--seed', String(seed), '--recipe', recipe, '--out', dir, '--json']);
      const mapJson = readFileSync(join(dir, 'map.json'), 'utf8');
      const map = JSON.parse(mapJson);
      const piece = map.features.find(f => f.kind === 'set-piece' && f.params.piece === KINDS.findIndex(k => k[0] === kind) + 1);
      if (piece) found = { kind, recipe, seed, dir, mapJson, map, piece, jumpShapes: JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).jumpShapes };
    }
    assert.ok(found, `some seed of ${recipe} places a ${kind}`);
    const { map, piece, dir, seed } = found;
    const pts = map.route.points;
    const n = pts.length;
    const base = nearest(pts, piece.pose);
    const start = (base + n - 12) % n;
    const ticks = 6 * TICK_HZ;
    found.fixture = {
      scenario: `set-piece-${kind}`, what: `The autopilot takes a generated ${kind}: airborne over the pit, lands upright on the far rim; native/WASM full state matches.`,
      map: join(dir, 'map.json'), seed, ticks,
      cars: [car(pts, start, 24)],
      seats: [{ name: 'Set piece driver', car: 0 }],
      autopilot: [{ tick: 0, car: 0, on: true }],
      observe: [ticks],
      expect: [
        { car: 0, metric: 'airtimeS', min: .8, max: 4 },
        { car: 0, metric: 'upY', min: .9, max: 1.01 },
      ],
    };
    // Seen from afar: the chase camera 200 m (80 route points) before the commitment point, at the approach's speed.
    found.afar = {
      scenario: `set-piece-${kind}-afar`, what: 'The chase view before the commitment point.', map: 'generated.json', seed, ticks: 1,
      cars: [car(pts, (piece.params.fromAt + n - 80) % n, 20)], seats: [{ name: 'Set piece driver', car: 0 }], inputs: [],
    };
    found.overview = { scenario: `set-piece-${kind}-overview`, what: 'The whole course.', map: 'generated.json', seed, ticks: 1, cars: [], seats: [], inputs: [] };
    const fixturePath = join(scratch, `${kind}.json`);
    writeFileSync(fixturePath, JSON.stringify(found.fixture, null, 2) + '\n');
    [found.native] = JSON.parse(execFileSync(bin, [...args, 'sim', '--json', '--out', join(scratch, `native-${kind}`), fixturePath], { encoding: 'utf8' }));
    assert.equal(found.native.ok, true, JSON.stringify(found.native));
    assert.equal(found.native.replayMatches, true);
    cases.push(found);
  }
  server = deployed ? { origin: deployed.origin } : await serve(build('./', 'set-piece'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: every set-piece kind is flown, drawn as the sim collides with it, and matches native replay`, { timeout: 1_500_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [], rows = [];
    try {
      for (const c of cases) {
        const open = async (extra = '') => {
          const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
          page.on('pageerror', e => errors.push(`${c.kind}: ${e.message}`));
          await page.route('**/set-piece.json', r => r.fulfill({ contentType: 'application/json', body: c.mapJson }));
          await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off${extra}&mapUrl=${encodeURIComponent(server.origin + '/set-piece.json')}`);
          await page.waitForFunction(() => window.__jjTest && window.__jjRender);
          // The replay advances explicit ticks below. Draw its checkpoints explicitly too: continuously repainting
          // 1080p software GL between every six-tick RPC took 748 s for Chromium alone in CI 9116.
          await page.evaluate(() => window.__jjRender.hold());
          return page;
        };
        const paint = async (page, frames = 2) => {
          const tick = await page.evaluate(async () => (await window.__jjTest.observe()).tick);
          await page.waitForFunction(t => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= t; }, tick);
          await page.evaluate(async frames => {
            for (let i = 0; i < frames; i++) { window.__jjRender.frame(); await new Promise(r => setTimeout(r, 16)); }
            window.__jjRender.hold();
          }, frames);
        };
        const shot = async (page, state) => {
          if (!process.env.JJ_CAPTURE_DIR) return;
          await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
          await paint(page, 20);
          const file = `${name}-${c.kind}-${state}-1920x1080.jpg`;
          await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
          rows.push({ file, kind: c.kind, seed: c.seed, recipe: c.recipe, state });
        };
        // The flight: step until the car has been in the air a while (past the lip), check it, capture it.
        const page = await open();
        await page.evaluate(async ({ fixture, mapJson }) => { await window.__jjTest.load(fixture, mapJson); }, { fixture: c.fixture, mapJson: c.mapJson });
        let air = null, takeoff = 0;
        for (let t = 0; t < 5 * TICK_HZ && !air; t += 6) {
          const s = await page.evaluate(async () => { await window.__jjTest.step(6); return window.__jjTest.observe(); });
          if (s.cars[0].wheelsInContact === 0 && s.tick > TICK_HZ) {
            // Half a second still in the air: the leap itself, not a crest on the approach.
            const later = await page.evaluate(async () => { await window.__jjTest.step(60); return window.__jjTest.observe(); });
            if (later.cars[0].wheelsInContact === 0) [air, takeoff] = [later, s.tick];
          }
        }
        assert.ok(air, `${c.kind}: the car is airborne for at least half a second`);
        assert.ok(air.cars[0].upY > .8, `${c.kind}: upright in the air`);
        await paint(page);
        assert.deepEqual(await page.evaluate(() => window.__jjRender.jumpShapes()), c.jumpShapes, `${c.kind}: drawn kicker triangles match the native collision mesh`);
        await page.evaluate(async t => window.__jjTest.step(t), c.fixture.ticks - air.tick);
        const final = await page.evaluate(async () => ({ hash: await window.__jjTest.hash(), state: await window.__jjTest.observe() }));
        assert.equal(final.hash.stateHash, c.native.stateHash, `${c.kind}: WASM matches native`);
        assert.ok(final.state.cars[0].upY > .9, `${c.kind}: lands upright`);
        await paint(page);
        await page.close();
        if (process.env.JJ_CAPTURE_DIR) {
          // Just off the lip (over the pit, the far rim ahead), from the chase camera and a side angle; then the
          // approach from afar and the whole course.
          const chase = await open();
          await chase.evaluate(async ({ fixture, mapJson, t }) => { await window.__jjTest.load(fixture, mapJson); await window.__jjTest.step(t); }, { fixture: c.fixture, mapJson: c.mapJson, t: takeoff + 12 });
          await shot(chase, 'air');
          await chase.close();
          const side = await open('&orbit=75');
          await side.evaluate(async ({ fixture, mapJson, t }) => { await window.__jjTest.load(fixture, mapJson); await window.__jjTest.step(t); }, { fixture: c.fixture, mapJson: c.mapJson, t: takeoff + 24 });
          await shot(side, 'side-air');
          await side.close();
          for (const [state, fixture] of [['afar', c.afar], ['overview', c.overview]]) {
            const p = await open();
            // The overview has no car to follow: the camera frames the whole map.
            await p.evaluate(async ({ fixture, mapJson, overview }) => { if (overview) window.__jjRender.setFollow(null); window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); await window.__jjTest.step(1); }, { fixture, mapJson: c.mapJson, overview: state === 'overview' });
            await shot(p, state);
            await p.close();
          }
        }
      }
      assert.deepEqual(errors, []);
      writeFileSync(join(out, `${name}-set-pieces.json`), JSON.stringify({ browser: name, source: `${deployed ? deployed.href : 'local real jj-server'}, generated seeds, frame-stepped WASM fixtures; no connected phone`, cases: cases.map(c => ({ kind: c.kind, recipe: c.recipe, seed: c.seed, native: c.native.stateHash })), rows, errors }, null, 2) + '\n');
    } finally { await browser.close(); }
  });
}
