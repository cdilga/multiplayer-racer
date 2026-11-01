// br-xlvx.10.4 self-review capture: crossings on courses the generator laid itself (jj procgen, no test-only placement),
// in the real host on the TV. For a map with a bridge crossing and one with an overpass leap:
// - the empty course's whole-map overview (what an empty room's TV shows);
// - the bridge: a car on the lower road passing under a car on the deck, from each car's chase camera and side-on;
// - the leap: a car mid-flight over the lower road with a car beneath it, chase and side-on;
// - sight: a car approaching each crossing at racing speed, its chase camera's frustum checked for the crossing 10, 7 and
//   4 s out (frustum only: an occluding hill isn't detected; the captures are looked at for that).
//   node web/tests/journeys/lib/crossing-capture.mjs <out-dir>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, serve } from '../../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './chromium.mjs';

const out = process.argv[2];
assert.ok(out, 'usage: crossing-capture.mjs <out-dir>');
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'jj-crossing-capture-'));
symlinkSync(resolve('assets'), join(scratch, 'assets'), 'dir');
const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '--release', '-p', 'jj-tools', '--bin', 'jj', '--'];
const generate = (seed, preset) => {
  const dir = join(scratch, `${preset}-${seed}`);
  execFileSync(bin, [...args, 'procgen', '--seed', String(seed), '--preset', preset, '--out', dir, '--json']);
  return { name: `${preset} seed ${seed}`, json: readFileSync(join(dir, 'map.json'), 'utf8') };
};
// The first of each kind on the speedway family (crossings per family: docs/evidence/P1-M-crossover-b).
const find = (want) => {
  for (let seed = 0; seed < 40; seed++) {
    const m = generate(seed, 'speedway');
    const map = JSON.parse(m.json);
    const leap = map.features.find((f) => f.kind === 'set-piece' && f.params.piece === 4);
    const bridge = map.features.find((f) => f.kind === 'bridge');
    if (want === 'leap' && leap) return { ...m, map, f: leap };
    if (want === 'bridge' && bridge) return { ...m, map, f: bridge };
  }
  throw new Error(`no speedway seed in 0..40 has a ${want}`);
};
const maps = { bridge: find('bridge'), leap: find('leap') };

const P = (m) => m.map.route.points;
const at = (m, i) => P(m)[((i % P(m).length) + P(m).length) % P(m).length];
const headingAt = (m, i) => { const [a, b] = [at(m, i), at(m, i + 1)]; return Math.atan2(b.x - a.x, b.z - a.z); };
const mid = (m, from, to) => (from + Math.floor(((to - from + P(m).length) % P(m).length) / 2)) % P(m).length;
// A car `back` route points before point i, heading along the road at v m/s.
const carAt = (m, i, v) => { const h = headingAt(m, i); return { routePoint: ((i % P(m).length) + P(m).length) % P(m).length, lift: 0.3, linvel: [v * Math.sin(h), 0, v * Math.cos(h)] }; };
const STEP = 2.5; // m between route points (jj-procgen course::STEP_M)

// Where each crossing is: the bridge's pair of upper and lower route points nearest in plan (its two levels' crossing),
// the leap's lip and gap, and its racing speed.
const B = maps.bridge, L = maps.leap;
const span = (m, from, to) => Array.from({ length: ((to - from + P(m).length) % P(m).length) + 1 }, (_, k) => (from + k) % P(m).length);
const [bUpper, bLower] = span(B, B.f.params.upperFrom, B.f.params.upperTo)
  .flatMap((i) => span(B, B.f.params.lowerFrom, B.f.params.lowerTo).map((j) => [i, j]))
  .reduce((best, [i, j]) => { const d = Math.hypot(at(B, i).x - at(B, j).x, at(B, i).z - at(B, j).z); return d < best[2] ? [i, j, d] : best; }, [0, 0, Infinity]);
const lip = { x: L.f.pose.x / 1000, z: L.f.pose.z / 1000 };
const leapV = (L.f.params.minSpeedCmps + L.f.params.maxSpeedCmps) / 200 + 4;
const lBase = P(L).reduce((b, p, i) => (Math.hypot(p.x - L.f.pose.x, p.z - L.f.pose.z) < Math.hypot(at(L, b).x - L.f.pose.x, at(L, b).z - L.f.pose.z) ? i : b), 0);
const lLower = mid(L, L.f.params.lowerFrom, L.f.params.lowerTo);
// The middle of the leap's gap, over the lower road.
const tL = [Math.sin(headingAt(L, lBase)), Math.cos(headingAt(L, lBase))];
const gapMid = (L.f.params.rampLengthMm + L.f.params.gapLengthMm / 2) / 1000;
const leapMid = { x: (lip.x + tL[0] * gapMid) * 1000, y: L.f.pose.y, z: (lip.z + tL[1] * gapMid) * 1000 };

const BASE = '/p/crossing-capture/';
const server = await serve(build('./', 'crossing-capture'), BASE, { JJ_STUN_URLS: '' });
const browser = await chromium.launch({ args: chromiumArgs });
const rows = [];
const open = async (m, query) => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // The test surface's keys-and-pads drawer is a dev panel, not what a room's TV shows.
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '[data-jj-input-drawer]{display:none!important}';
    document.head.append(style);
  }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/crossing.json', (r) => r.fulfill({ contentType: 'application/json', body: m.json }));
  await page.goto(`${server.origin}${BASE}host?test&${query}&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/crossing.json')}`);
  await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 120_000 });
  return { page, errors };
};
const load = (page, m, fixture) => page.evaluate(async ({ fixture, json }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, json); }, { fixture, json: m.json });
const paint = async (page) => {
  const t = await page.evaluate(async () => (await window.__jjTest.observe()).tick);
  await page.waitForFunction((t) => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= t; }, t, { polling: 100 });
};
const shoot = async (page, file, extra = {}) => {
  await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await paint(page);
    const name = `${file}-${w}x${h}.jpg`;
    await page.screenshot({ path: join(out, name), type: 'jpeg', quality: 85 });
    rows.push({ file: name, ...extra });
  }
};
const fixture = (m, scenario, cars, seats, ticks = 600) => ({
  scenario, what: `br-xlvx.10.4 capture on ${m.name}`, map: 'crossing.json', seed: 1, ticks, cars,
  race: { laps: 1, atTick: 0 }, seats,
  inputs: cars.map((_, car) => ({ car, fromTick: 0, toTick: ticks, throttle: car === 0 ? 1 : 0.6 })), expect: [],
});

try {
  // The whole course, no cars: an empty room's TV.
  for (const [kind, m] of [['bridge', B], ['leap', L]]) {
    const { page, errors } = await open(m, 'x=1');
    await load(page, m, { ...fixture(m, `overview-${kind}`, [], []), race: undefined, inputs: [] });
    await page.evaluate(() => window.__jjTest.step(1));
    await shoot(page, `overview-${kind}`, { map: m.name });
    assert.deepEqual(errors, []);
    await page.close();
  }

  // The bridge: car 0 on the lower road, car 1 on the deck, both 16 points (40 m) short of where the levels cross, at the
  // same speed and throttle, so they meet there.
  for (const [view, query] of [['bridge-lower-chase', 'tiles=1&follow=0'], ['bridge-deck-chase', 'tiles=1&follow=1'], ['bridge-side', 'tiles=1&follow=0&orbit=140&orbitDistance=26&orbitHeight=10&orbitTargetHeight=6']]) {
    const { page, errors } = await open(B, query);
    const meet = fixture(B, view, [carAt(B, bLower - 16, 14), carAt(B, bUpper - 16, 14)], [{ name: 'Underpass', car: 0 }, { name: 'Deck', car: 1 }], 400);
    meet.inputs = [0, 1].map((car) => ({ car, fromTick: 0, toTick: 400, throttle: 0.3 }));
    await load(page, B, meet);
    let best = null;
    for (let tick = 0; tick < 400; tick += 3) {
      await page.evaluate(() => window.__jjTest.step(3));
      const [a, b] = (await page.evaluate(() => window.__jjTest.observe())).cars;
      const d = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
      if (!best || d < best.d) best = { tick, d, lower: a.position, upper: b.position };
      if (d > best.d + 2) break;
    }
    assert.ok(best.upper[1] - best.lower[1] > 5, `${view}: the cars pass on two levels ${JSON.stringify(best)}`);
    await shoot(page, view, { map: B.name, ...best });
    assert.deepEqual(errors, []);
    await page.close();
  }

  // The leap: car 0 flat out from 12 m before the kicker at the band's middle + 4 m/s, car 1 on the lower road beneath.
  for (const [view, query] of [['leap-chase', 'tiles=1&follow=0'], ['leap-side', 'tiles=1&follow=0&orbit=90&orbitDistance=36&orbitHeight=2&orbitTargetHeight=-3'], ['leap-grid', 'tiles=2&follow=0,1']]) {
    const { page, errors } = await open(L, query);
    const t = [Math.sin(headingAt(L, lBase)), Math.cos(headingAt(L, lBase))];
    const leaper = { pose: { x: lip.x - t[0] * 12, y: L.f.pose.y / 1000 + 0.4, z: lip.z - t[1] * 12, headingDeg: (headingAt(L, lBase) * 180) / Math.PI }, linvel: [leapV * t[0], 0, leapV * t[1]] };
    await load(page, L, fixture(L, view, [leaper, carAt(L, lLower - 14, 16)], [{ name: 'Leaper', car: 0 }, { name: 'Under', car: 1 }]));
    const lipAt = { x: lip.x + t[0] * L.f.params.rampLengthMm / 1000, z: lip.z + t[1] * L.f.params.rampLengthMm / 1000 };
    const gap = L.f.params.gapLengthMm / 1000;
    let shot = null;
    for (let tick = 0; tick < 600 && !shot; tick += 2) {
      await page.evaluate(() => window.__jjTest.step(2));
      const s = await page.evaluate(() => window.__jjTest.observe());
      const c = s.cars[0];
      const u = (c.position[0] - lipAt.x) * t[0] + (c.position[2] - lipAt.z) * t[1];
      if (u > gap * 0.4 && c.wheelsInContact === 0) shot = { tick, leaper: c.position, under: s.cars[1].position, u, aboveLowerM: c.position[1] - s.cars[1].position[1] };
    }
    assert.ok(shot, `${view}: the leaper got over the gap`);
    await shoot(page, view, { map: L.name, ...shot });
    assert.deepEqual(errors, []);
    await page.close();
  }

  // Sight: a car on each crossing's approach at racing speed (25 m/s), 10, 7 and 4 s out; is the crossing in its chase frame?
  const sight = [];
  for (const [kind, m, point, target] of [
    ['bridge deck', B, bUpper, at(B, bUpper)], ['bridge lower road', B, bLower, at(B, bUpper)], ['leap', L, lBase, leapMid],
  ]) {
    const { page, errors } = await open(m, 'tiles=1&follow=0');
    for (const s of [10, 7, 4]) {
      const back = Math.round((25 * s) / STEP);
      await load(page, m, fixture(m, `sight-${kind}-${s}`, [carAt(m, point - back, 25)], [{ name: 'Approach', car: 0 }], 10));
      await page.evaluate(() => window.__jjTest.step(2));
      await paint(page);
      const sees = await page.evaluate((p) => window.__jjRender.tilesSee([p]), [target.x / 1000, target.y / 1000 + 2, target.z / 1000]);
      sight.push({ kind, map: m.name, seconds: s, metres: back * STEP, inFrame: !!sees[0]?.sees[0] });
      if (s === 10) {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
        await paint(page);
        const name = `sight-${kind.replace(/ /g, '-')}-10s-1920x1080.jpg`;
        await page.screenshot({ path: join(out, name), type: 'jpeg', quality: 85 });
        rows.push({ file: name, map: m.name, kind, seconds: 10 });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(join(out, 'capture.json'), JSON.stringify({ maps: { bridge: B.name, leap: L.name }, bridge: B.f.params, leap: L.f.params, rows, sight }, null, 2) + '\n');
  console.log(JSON.stringify(sight));
} finally {
  await browser.close();
  await server.close?.();
}
