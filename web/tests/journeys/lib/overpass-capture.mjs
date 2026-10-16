// br-xlvx.5 self-review capture (run by hand until the generator places overpass leaps itself): a car mid-flight over the
// lower road of a generated figure-eight's overpass leap, with a car on the lower road beneath it, in the real host.
//   cargo test -p jj-procgen --test overpass --release overpass_leaps_lay   (with JJ_EVIDENCE_DIR=<dir>: writes the map)
//   node web/tests/journeys/lib/overpass-capture.mjs <dir>/overpass-town-1.json docs/evidence/br-xlvx.5
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build, serve } from '../../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './chromium.mjs';

const [mapPath, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const mapJson = readFileSync(mapPath, 'utf8');
const map = JSON.parse(mapJson);
const f = map.features.find((x) => x.kind === 'set-piece' && x.params.piece === 4);
const P = map.route.points;
const n = P.length;
const at = (i) => P[((i % n) + n) % n];
// The flight's direction: the route through the kicker's base.
const base = P.reduce((b, p, i) => (Math.hypot(p.x - f.pose.x, p.z - f.pose.z) < Math.hypot(P[b].x - f.pose.x, P[b].z - f.pose.z) ? i : b), 0);
const [a, b] = [at(base - 4), at(base + 4)];
const len = Math.hypot(b.x - a.x, b.z - a.z);
const t = [(b.x - a.x) / len, (b.z - a.z) / len];
const heading = (Math.atan2(t[0], t[1]) * 180) / Math.PI;
const back = 12;
const start = { x: f.pose.x / 1000 - t[0] * back, z: f.pose.z / 1000 - t[1] * back };
// Faster than the band's middle at the lip: the kicker costs some.
const v = (f.params.minSpeedCmps + f.params.maxSpeedCmps) / 200 + 4;
// The lower road: a car on it, timed to pass under the middle of the gap as the leaper flies over.
const [lf, lt] = [f.params.lowerFrom, f.params.lowerTo];
const lmid = (lf + Math.floor(((lt - lf + n) % n) / 2)) % n;
const under = lmid - 14;
const [la, lb] = [at(under), at(under + 1)];
const lh = (Math.atan2(lb.x - la.x, lb.z - la.z) * 180) / Math.PI;
const fixture = {
  scenario: 'overpass-leap-capture',
  what: 'A Cruz leaps a generated figure-eight overpass while another drives the lower road beneath it.',
  map: mapPath, seed: 1, ticks: 600,
  cars: [
    { pose: { x: start.x, y: f.pose.y / 1000 + 0.4, z: start.z, headingDeg: heading }, linvel: [v * t[0], 0, v * t[1]] },
    { pose: { x: la.x / 1000, y: la.y / 1000 + 0.4, z: la.z / 1000, headingDeg: lh }, linvel: [16 * Math.sin((lh * Math.PI) / 180), 0, 16 * Math.cos((lh * Math.PI) / 180)] },
  ],
  race: { laps: 1, atTick: 0 },
  seats: [{ name: 'Leaper', car: 0 }, { name: 'Under', car: 1 }],
  inputs: [{ car: 0, fromTick: 0, toTick: 600, throttle: 1 }, { car: 1, fromTick: 0, toTick: 600, throttle: 0.6 }],
  expect: [],
};
const BASE = '/p/overpass/';
const server = await serve(build('./', 'overpass-capture'), BASE, { JJ_STUN_URLS: '' });
const browser = await chromium.launch({ args: chromiumArgs });
const rows = [];
try {
  for (const [view, query] of [['side', 'tiles=1&follow=0&orbit=90&orbitDistance=36&orbitHeight=2&orbitTargetHeight=-3'], ['chase', 'tiles=1&follow=0'], ['grid', 'tiles=2&follow=0,1']]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/overpass.json', (r) => r.fulfill({ contentType: 'application/json', body: mapJson }));
    await page.goto(`${server.origin}${BASE}host?test&${query}&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/overpass.json')}`);
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 120_000 }).catch((e) => {
      throw new Error(`${view}: the host never came up: ${JSON.stringify({ errors, logs: logs.slice(-8) })}`);
    });
    await page.evaluate(async ({ fixture, mapJson }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); }, { fixture, mapJson });
    const lip = { x: f.pose.x / 1000 + t[0] * f.params.rampLengthMm / 1000, z: f.pose.z / 1000 + t[1] * f.params.rampLengthMm / 1000 };
    const gap = f.params.gapLengthMm / 1000;
    let shot = null;
    for (let tick = 0; tick < 600 && !shot; tick += 2) {
      await page.evaluate(() => window.__jjTest.step(2));
      const s = await page.evaluate(() => window.__jjTest.observe());
      const c = s.cars[0];
      const u = (c.position[0] - lip.x) * t[0] + (c.position[2] - lip.z) * t[1];
      if (u > gap * 0.4 && c.wheelsInContact === 0) shot = { tick, leaper: c.position, under: s.cars[1].position, u };
    }
    assert.ok(shot, `${view}: the leaper got over the gap`);
    await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      const tick = await page.evaluate(async () => (await window.__jjTest.observe()).tick);
      await page.waitForFunction((tick) => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= tick; }, tick, { polling: 100 });
      const file = `chromium-${view}-${w}x${h}.jpg`;
      await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
      rows.push({ view, file, ...shot, above_lower_m: shot.leaper[1] - shot.under[1] });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(join(out, 'capture.json'), JSON.stringify({ map: 'jj-procgen tests/overpass.rs Town seed 1', piece: f.params, startSpeed: v, rows }, null, 2) + '\n');
  console.log(JSON.stringify(rows.map((r) => [r.file, r.tick, Math.round(r.above_lower_m * 10) / 10])));
} finally {
  await browser.close();
  await server.close?.();
}
