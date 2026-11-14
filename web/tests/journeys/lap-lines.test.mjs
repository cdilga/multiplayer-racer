// br-8h3u.18 AC4 and AC3's visual part ("Laps don't count: shortcuts aren't treated as road, and wide or cut lines lose gates").
// A real room (Lobby, Ready, countdown, Running) on a generated track with a fork (`outback-dirt`, track seed 2: one fork, an infield cut, no loop or crossing). Two
// synthetic controllers join the way a phone's frames do, and each car is driven kinematically (the test surface's `place`
// command, one placement and one tick at a time on the held clock) along a line the lap audit
// (crates/jj-procgen/tests/lap_audit.rs) drives through the rules natively:
//   - the fork's branch every lap (the branch's centreline is the generator's own Hermite curve, ported from jj_map::fork);
//   - a wide line out to the corridor's edge on the left (half way to the nearest other part of the course).
// Both cars finish 3 laps (the room's own seat view: `finished`, three lap times) and neither is pointed back to a gate.
// Then a single car cuts across the infield from the road to a part of the lap hundreds of metres further round (the
// audit's own choice of cut): it is told it missed a gate, and the TV shows a beacon on that gate, an arrow over the car and
// "MISSED GATE! GO BACK" (self-review captures with JJ_CAPTURE_DIR). Nothing counts for the cut.
//   JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/lap-lines.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/lap-lines/';
const RECIPE = 'outback-dirt';
const TRACK_SEED = 2;
/** The room's track seed is the session seed plus the preparation id (test pages: `?seed=` is the session seed). */
const SESSION_SEED = Number(process.env.JJ_LAP_LINES_SESSION ?? TRACK_SEED - 1);
const LAPS = 3;
/** How far a line moves per tick, m: one tick of the sim (120 Hz) at SPEED. */
const STEP_M = 36 / 120;
const RIDE_M = 0.5;
const SPEED = 36;
const GATE_OTHER_ROAD_M = 80;
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;
let scratch;
let map;

before(async () => {
  server = await serve(build('./', 'lap-lines'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  // The track the room will draw, built natively (the same generator as the page's WASM) so the journey knows the fork.
  scratch = mkdtempSync(join(tmpdir(), 'jj-lap-lines-'));
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  execFileSync(bin, [...args, 'procgen', '--seed', String(TRACK_SEED), '--recipe', RECIPE, '--out', join(scratch, 'm'), '--json']);
  map = JSON.parse(readFileSync(join(scratch, 'm', 'map.json'), 'utf8'));
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([e, fr]) => window.__jjTest.input({ type: 'controller', endpoint: e, frame: fr }), [endpoint, f]);
const shot = async (page, name) => {
  if (!CAPTURE) return;
  // Draw what the held clock last stepped (the renderer draws on a new snapshot), then capture.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(CAPTURE, `${name}.jpg`), type: 'jpeg', quality: 85 });
};

// ---- the track as the lap audit reads it -------------------------------------------------------------------------------

function track(m) {
  const pts = m.route.points;
  const n = pts.length;
  const p = pts.map((q) => [q.x / 1000, q.y / 1000, q.z / 1000]);
  const half = pts.map((q) => q.width / 2000);
  const s = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    s.push(total);
    const [a, b] = [p[i], p[(i + 1) % n]];
    total += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const tangent = (i, j) => {
    const [a, b] = [p[i % n], p[j % n]];
    const l = Math.max(Math.hypot(b[0] - a[0], b[2] - a[2]), 1e-6);
    return [(b[0] - a[0]) / l, (b[2] - a[2]) / l];
  };
  const nrm = p.map((_, i) => {
    const t = tangent(i + n - 1, i + 1);
    return [-t[1], t[0]];
  });
  const turn = [];
  const radius = [];
  const d = (x, y) => Math.hypot(p[y % n][0] - p[x % n][0], p[y % n][2] - p[x % n][2]);
  for (let i = 0; i < n; i++) {
    const [a, b] = [tangent(i + n - 2, i), tangent(i, i + 2)];
    turn.push(a[0] * b[1] - a[1] * b[0]);
    const angle = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1])));
    radius.push(angle > 1e-4 ? (d(i + n - 2, i) / 2 + d(i, i + 2) / 2) / angle : Infinity);
  }
  const corridor = p.map((_, i) => {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      const dd = Math.abs(s[j] - s[i]);
      if (Math.min(dd, total - dd) > GATE_OTHER_ROAD_M) best = Math.min(best, Math.hypot(p[j][0] - p[i][0], p[j][2] - p[i][2]) - half[j]);
    }
    return best / 2;
  });
  const finish = m.route.gates.find((g) => g.finish)?.at ?? 0;
  const forks = m.features.filter((f) => f.kind === 'fork' && !f.params.cut).map((f) => ({ from: f.params.fromAt, to: f.params.toAt, width: f.params.widthMm / 1000, line: forkPath(p, f.params) }));
  // Near a set piece's pit the road is the line (its ribbon isn't drawn in the gap).
  const onRoad = Array(n).fill(false);
  for (const f of m.features.filter((f) => f.kind === 'set-piece')) {
    for (let k = f.params.fromAt - 8; k <= f.params.toAt + 8; k++) onRoad[(k + n * 2) % n] = true;
  }
  const b = m.header.bounds;
  return { n, p, half, s, total, nrm, turn, radius, corridor, finishS: s[finish], forks, onRoad, bounds: [b.minX / 1000, b.minZ / 1000, b.maxX / 1000, b.maxZ / 1000] };
}

/** jj_map::fork::path_of: the branch's centreline (x, z) as a cubic Hermite curve from route point `fromAt` to `toAt`, winding if asked. */
function forkPath(p, q) {
  const n = p.length;
  const frame = (i) => {
    const [a, b] = [p[(i + n - 1) % n], p[(i + 1) % n]];
    const l = Math.max(Math.hypot(b[0] - a[0], b[2] - a[2]), 1e-9);
    return [[(b[0] - a[0]) / l, (b[2] - a[2]) / l], [p[i % n][0], p[i % n][2]]];
  };
  const turned = (v, deg) => {
    const [sn, cs] = [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
    return [v[0] * cs - v[1] * sn, v[0] * sn + v[1] * cs];
  };
  const [ta, pa] = frame(q.fromAt);
  const [tb, pb] = frame(q.toAt);
  const da = turned(ta, q.side * (q.splitCdeg / 100));
  const db = turned(tb, -q.side * (q.mergeCdeg / 100));
  const [inM, outM] = [q.inMm / 1000, q.outMm / 1000];
  const m0 = [da[0] * inM, da[1] * inM];
  const m1 = [db[0] * outM, db[1] * outM];
  const at = (t) => {
    const [t2, t3] = [t * t, t * t * t];
    const [h00, h10, h01, h11] = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
    return [h00 * pa[0] + h10 * m0[0] + h01 * pb[0] + h11 * m1[0], h00 * pa[1] + h10 * m0[1] + h01 * pb[1] + h11 * m1[1]];
  };
  const len = (c) => c.slice(1).reduce((a, v, i) => a + Math.hypot(v[0] - c[i][0], v[1] - c[i][1]), 0);
  const coarse = Array.from({ length: 65 }, (_, k) => at(k / 64));
  const count = Math.max(Math.ceil(len(coarse) / 2.5), 2);
  const curve = Array.from({ length: count + 1 }, (_, k) => at(k / count));
  const [wiggle, wave] = [(q.wiggleMm ?? 0) / 1000, (q.waveMm ?? 0) / 1000];
  if (wiggle <= 0 || wave <= 0) return curve;
  const total = len(curve);
  const fade = wave / 2;
  const smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  let u = 0;
  return curve.map((c, k) => {
    if (k > 0) u += Math.hypot(c[0] - curve[k - 1][0], c[1] - curve[k - 1][1]);
    const [a, b] = [curve[Math.max(k - 1, 0)], curve[Math.min(k + 1, curve.length - 1)]];
    const l = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-9);
    const left = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    const env = smooth((u - 40) / fade) * smooth((total - u - 40) / fade);
    const off = wiggle * env * Math.sin((2 * Math.PI * (u - 40)) / wave);
    return [c[0] + left[0] * off, c[1] + left[1] * off];
  });
}

/** The point at arc `arc` (any lap), `lateral` m left of the centreline. */
function at(t, arc, lateral = 0) {
  const sArc = ((arc % t.total) + t.total) % t.total;
  let i = t.s.findIndex((v, k) => v <= sArc && (k + 1 === t.n || t.s[k + 1] > sArc));
  if (i < 0) i = 0;
  const j = (i + 1) % t.n;
  const end = j === 0 ? t.total : t.s[j];
  const f = end > t.s[i] ? (sArc - t.s[i]) / (end - t.s[i]) : 0;
  const [a, b] = [t.p[i], t.p[j]];
  const nx = t.nrm[i][0] * (1 - f) + t.nrm[j][0] * f;
  const nz = t.nrm[i][1] * (1 - f) + t.nrm[j][1] * f;
  const l = Math.max(Math.hypot(nx, nz), 1e-6);
  return [a[0] + f * (b[0] - a[0]) + (nx / l) * lateral, a[1] + f * (b[1] - a[1]) + RIDE_M, a[2] + f * (b[2] - a[2]) + (nz / l) * lateral];
}

/** The wide line's lateral offset at each route point (lap_audit.rs `Track::wide`): out to the corridor's edge on `side` (+1 left). */
function wide(t, side) {
  const { n } = t;
  const [x0, z0, x1, z1] = t.bounds;
  const branch = t.forks.flatMap((f) => f.line.map((q) => [q, f.width / 2]));
  const raw = t.p.map((q, i) => {
    let d = t.corridor[i] - 1;
    if (t.turn[i] * side > 0) d = Math.min(d, 0.6 * t.radius[i]);
    const nv = t.nrm[i];
    let lim = Infinity;
    for (const [o, v, lo, hi] of [[q[0], nv[0] * side, x0, x1], [q[2], nv[1] * side, z0, z1]]) {
      if (v > 1e-4) lim = Math.min(lim, (hi - 5 - o) / v);
      else if (v < -1e-4) lim = Math.min(lim, (lo + 5 - o) / v);
    }
    d = Math.min(d, lim);
    for (const [b, bh] of branch) {
      const [dx, dz] = [b[0] - q[0], b[1] - q[2]];
      const along = dx * nv[0] * side + dz * nv[1] * side;
      const across = Math.abs(dx * nv[1] - dz * nv[0]);
      if (along > 0 && across < bh + 3) d = Math.min(d, along - bh - 2);
    }
    if (t.onRoad[i]) d = Math.min(d, t.half[i] - 0.5);
    return Math.max(d, 0);
  });
  const w = 6;
  const low = raw.map((_, i) => Math.min(...Array.from({ length: 2 * w + 1 }, (_, k) => raw[(i + n + k - w) % n])));
  return low.map((_, i) => (side * Array.from({ length: 2 * w + 1 }, (_, k) => low[(i + n + k - w) % n]).reduce((a, v) => a + v, 0)) / (2 * w + 1));
}

// ---- lines: positions one tick apart ------------------------------------------------------------------------------------

class Line {
  pos = [];
  road(t, a, b, lateral = () => 0) {
    for (let arc = a; arc < b; arc += STEP_M) this.pos.push(at(t, arc, lateral(arc)));
  }
  straight(to) {
    const from = this.pos.at(-1);
    const k = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / STEP_M));
    for (let i = 1; i <= k; i++) {
      const f = i / k;
      this.pos.push([from[0] + f * (to[0] - from[0]), from[1] + f * (to[1] - from[1]), from[2] + f * (to[2] - from[2])]);
    }
  }
  branch(line, ya, yb) {
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const len = cum.at(-1);
    let k = 0;
    for (let u = 0; u <= len; u += STEP_M) {
      while (k + 2 < cum.length && cum[k + 1] < u) k++;
      const f = Math.min(1, Math.max(0, (u - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-6)));
      this.pos.push([line[k][0] + f * (line[k + 1][0] - line[k][0]), ya + (u / len) * (yb - ya) + RIDE_M, line[k][1] + f * (line[k + 1][1] - line[k][1])]);
    }
  }
}

/** Arc span of a fork on the route (the rejoin is ahead of the split). */
function forkSpan(t, f) {
  const a = t.s[f.from];
  let b = t.s[f.to];
  if (b <= a) b += t.total;
  return [a, b];
}

/** From arc `a` to `b` along the road at `lateral`, taking every fork in between by its branch when `branch`. */
function lapLine(t, a, b, { branch = false, lateral = () => 0 } = {}) {
  const line = new Line();
  const spans = [];
  if (branch) {
    for (const f of t.forks) {
      const [fa, fb] = forkSpan(t, f);
      for (let lap = -1; lap <= LAPS + 1; lap++) {
        if (fa + lap * t.total > a && fb + lap * t.total < b) spans.push([fa + lap * t.total, fb + lap * t.total, f]);
      }
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  let arc = a;
  for (const [fa, fb, f] of spans) {
    if (fa < arc) continue;
    line.road(t, arc, fa, lateral);
    line.branch(f.line, t.p[f.from][1], t.p[f.to][1]);
    arc = fb;
  }
  line.road(t, arc, b, lateral);
  return line;
}

/** The audit's infield cut: from the road straight across to the part of the lap that gains the most road for the least ground. */
function infieldCut(t) {
  const u = (i) => (((t.s[i] - t.finishS) % t.total) + t.total) % t.total;
  let best = null;
  for (let i = 0; i < t.n; i += 4) {
    const ui = u(i);
    if (ui < 60 || t.onRoad[i]) continue;
    for (let j = 0; j < t.n; j += 2) {
      const gain = u(j) - ui;
      if (!(gain >= 300 && gain <= Math.min(t.total / 2, t.total - ui - 40)) || t.onRoad[j]) continue;
      const dist = Math.hypot(t.p[j][0] - t.p[i][0], t.p[j][2] - t.p[i][2]);
      if (dist > 0.35 * gain || dist > 200) continue;
      const score = gain - 3 * dist;
      if (!best || score > best.score) best = { score, i, j, gain, dist };
    }
  }
  return best;
}

// ---- driving ------------------------------------------------------------------------------------------------------------

/**
 * Walks the lines (`{car: [[x, y, z], ...]}`, one point per tick at SPEED) from index `from` up to (not including) `to`.
 * A placement is a teleport the race rules never count a gate crossing across (`Race::placed` forgets the last position),
 * so a car is placed, then left to fly `FLY` ticks along its heading at line speed, and placed again `ADVANCE` points on:
 * every placement lands `FLY - ADVANCE` ticks behind where the flight ended, so no stretch of the line goes unwatched.
 */
const FLY = 8;
const ADVANCE = 6;
const drive = (page, lines, from, to) =>
  page.evaluate(
    async ({ lines, from, to, speed, fly, advance }) => {
      const s = window.__jjTest;
      for (let i = 0; i < to - from; i += advance) {
        for (const [c, l] of Object.entries(lines)) {
          if (i >= l.length) continue;
          const a = l[i];
          const b = l[Math.min(i + 4, l.length - 1)];
          const d = b === a ? [a[0] - l[i - 1][0], a[2] - l[i - 1][2]] : [b[0] - a[0], b[2] - a[2]];
          const h = Math.atan2(d[0], d[1]);
          await s.command({ cmd: 'place', car: Number(c), pose: { x: a[0], y: a[1], z: a[2], headingDeg: (h * 180) / Math.PI }, linvel: [speed * Math.sin(h), 0, speed * Math.cos(h)] });
        }
        await s.command({ cmd: 'step', ticks: fly });
      }
    },
    { lines: Object.fromEntries(Object.entries(lines).map(([c, l]) => [c, l.slice(from, to + 6)])), from, to, speed: SPEED, fly: FLY, advance: ADVANCE },
  );

/** A room on the track: `n` synthetic controllers joined and Ready, the race Running, the clock held. Returns the host page and each car. */
async function startRace(n, query = '') {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=${LAPS}&seed=${SESSION_SEED}&recipe=${RECIPE}${query}`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const names = ['Ava', 'Bree', 'Cal'].slice(0, n);
  for (const [k, name] of names.entries()) {
    await frame(host, `syn${k + 1}`, { hello: true });
    await frame(host, `syn${k + 1}`, { claim: name });
  }
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, n);
  for (let k = 0; k < n; k++) await frame(host, `syn${k + 1}`, { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
  const prep = await host.evaluate(() => window.__jjPrepare.current());
  assert.equal(prep.seed, TRACK_SEED, `the room's track is the one the journey planned lines on: ${JSON.stringify(prep)}`);
  const seats = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ name: s.name, car: s.car })));
  await host.evaluate(() => window.__jjTest.hold(true));
  return { host, seats, errors };
}

const seatView = (host) => host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ name: s.name, car: s.car, finished: s.finished, laps: (s.lapMs ?? []).length, position: s.position })));

test('a car on the fork branch and a car running wide both finish three laps and are never told they missed a gate', { timeout: 900_000 }, async () => {
  const t = track(map);
  assert.ok(t.forks.length > 0, 'the track has a fork');
  assert.ok(!map.features.some((f) => ['loop', 'bridge'].includes(f.kind)), 'no loop or crossing to account for');
  const start = t.finishS - 20;
  const end = t.finishS + LAPS * t.total + 40;
  const off = wide(t, 1);
  const lateral = (arc) => {
    const sa = ((arc % t.total) + t.total) % t.total;
    const i = Math.max(0, t.s.findIndex((v, k) => v <= sa && (k + 1 === t.n || t.s[k + 1] > sa)));
    const f = (sa - t.s[i]) / Math.max(1e-6, (i + 1 === t.n ? t.total : t.s[i + 1]) - t.s[i]);
    return off[i] * (1 - f) + off[(i + 1) % t.n] * f;
  };
  const widest = Math.max(...off.map(Math.abs));
  assert.ok(widest > 15, `the wide line goes well off the road's edge (${widest.toFixed(0)} m)`);
  const { host, seats, errors } = await startRace(2, '&res=0.5');
  const [branchCar, wideCar] = seats.map((s) => s.car);
  // The branch car leaves first; the wide car follows 70 m back (placed cars collide as they are placed on one road).
  const lines = {
    [branchCar]: lapLine(t, start, end, { branch: true }).pos,
    [wideCar]: lapLine(t, start - 70, end, { lateral }).pos,
  };
  const len = Math.max(...Object.values(lines).map((l) => l.length));
  let i = 0;
  let sawBranch = false;
  let sawWide = false;
  while (i < len) {
    const next = Math.min(len, i + 600);
    await drive(host, lines, i, next);
    i = next;
    const v = await seatView(host);
    if (process.env.JJ_LAP_DEBUG) console.log(i, JSON.stringify(await host.evaluate(async () => (await window.__jjTest.observe()).cars.map((c) => ({ p: c.position.map((x) => Math.round(x)), gates: c.race.gatesPassed, laps: c.race.laps, w: c.race.wrecks, lat: Math.round(c.progress.lateralM) })))));
    const pa = lines[branchCar][Math.min(i, lines[branchCar].length - 1)];
    const pb = lines[wideCar][Math.min(i, lines[wideCar].length - 1)];
    // A shot of each line where it is most itself: the branch car in the fork, the wide car furthest from the road.
    if (CAPTURE && !sawBranch && t.forks.some((f) => f.line.some((q) => Math.hypot(q[0] - pa[0], q[1] - pa[2]) < 4))) {
      sawBranch = true;
      await shot(host, 'branch-car-in-the-fork');
    }
    if (CAPTURE && !sawWide && i > len / 6 && Math.abs(lateral(i * STEP_M + start - 70 - 0)) > 0.8 * widest) {
      sawWide = true;
      await shot(host, 'wide-car-off-the-road');
    }
    if (v.every((s) => s.finished)) break;
  }
  // Settle the held clock for a few more ticks so the last finish registers, then read the room.
  await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 30, every: 6 }));
  const v = await seatView(host);
  const shown = await host.evaluate(() => window.__jjRender.missedGatesShown());
  const laps = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ name: s.name, lapMs: s.lapMs, finishMs: s.finishMs })));
  await shot(host, 'both-finished');
  assert.deepEqual(shown, [], `neither car was pointed back to a gate: ${JSON.stringify(shown)}`);
  for (const s of v) {
    assert.equal(s.finished, true, `${s.name} finished: ${JSON.stringify(v)} ${JSON.stringify(laps)}`);
    assert.equal(s.laps, LAPS, `${s.name} counted ${LAPS} laps: ${JSON.stringify(laps)}`);
  }
  assert.deepEqual(errors, []);
});

test('an infield cut earns nothing and the TV points the car back to the gate it missed', { timeout: 600_000 }, async () => {
  const t = track(map);
  const cut = infieldCut(t);
  assert.ok(cut, 'a lap of this track has an infield cut');
  const { host, seats, errors } = await startRace(2);
  const car = seats[0].car;
  // Lap 1 on the road to the cut, straight across to the far part of the lap, then on along the road past it.
  const u = (i) => (((t.s[i] - t.finishS) % t.total) + t.total) % t.total;
  const sa = t.finishS + u(cut.i);
  const sb = t.finishS + u(cut.j);
  const line = lapLine(t, t.finishS - 20, sa);
  const toJ = t.p[cut.j];
  const crossAt = line.pos.length;
  line.straight([toJ[0], toJ[1] + RIDE_M, toJ[2]]);
  const rejoin = line.pos.length;
  line.pos.push(...lapLine(t, sb, sb + 260).pos);
  const lines = { [car]: line.pos };
  // Up to the cut: nothing is wrong.
  await drive(host, lines, 0, crossAt);
  assert.deepEqual(await host.evaluate(() => window.__jjRender.missedGates()), [], 'on the road nothing is flagged');
  await shot(host, `cut-1-on-the-road`);
  // Across the infield: nothing earned; the road past the cut then crosses a gate further round than the catch-up.
  await drive(host, lines, crossAt, rejoin);
  let i = rejoin;
  let marks = [];
  while (i < line.pos.length && !marks.length) {
    const next = Math.min(line.pos.length, i + 24);
    await drive(host, lines, i, next);
    i = next;
    marks = await host.evaluate(() => window.__jjRender.missedGates());
  }
  assert.equal(marks.length, 1, `the car was told it missed a gate (after ${i - rejoin} ticks past the cut)`);
  assert.equal(marks[0].car, car);
  const seat = (await seatView(host))[0];
  assert.equal(seat.laps, 0, 'the cut counted no lap');
  // The gate it is pointed to is behind the cut: nearer the start of the cut than its end along the lap.
  const [gx, , gz] = marks[0].gate;
  const nearest = t.p.reduce((b, q, k) => (Math.hypot(q[0] - gx, q[2] - gz) < Math.hypot(t.p[b][0] - gx, t.p[b][2] - gz) ? k : b), 0);
  assert.ok(u(nearest) < u(cut.j) && u(nearest) >= u(cut.i) - 130, `the beacon stands on a gate the cut skipped (gate at ${u(nearest).toFixed(0)} m, cut ${u(cut.i).toFixed(0)}-${u(cut.j).toFixed(0)} m)`);
  // The phone's HUD flag is on the same state; the TV's marks are in the scene: look at them.
  await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 12, every: 6 }));
  await shot(host, `cut-2-missed-gate-on-the-tv`);
  const beyond = Math.min(line.pos.length, i + 240);
  await drive(host, lines, i, beyond);
  await shot(host, `cut-3-driving-on`);
  const after = await host.evaluate(() => window.__jjRender.missedGates());
  assert.equal(after.length, 1, 'still pointed back: it hasn’t taken the gate');
  // The second player's tile: Bree parked on the road 35 m before the gate, looking along it: her tile shows the beacon.
  const [gArc] = [t.s[nearest]];
  const [px, py, pz] = at(t, gArc - 35);
  const [qx, , qz] = at(t, gArc - 30);
  await host.evaluate(
    async ({ car, pose }) => {
      await window.__jjTest.command({ cmd: 'place', car, pose, linvel: [0, 0, 0] });
      await window.__jjTest.untilFact(() => false, { maxTicks: 30, every: 6 });
    },
    { car: seats[1].car, pose: { x: px, y: py + 0.3, z: pz, headingDeg: (Math.atan2(qx - px, qz - pz) * 180) / Math.PI } },
  );
  await shot(host, 'cut-4-beacon-in-a-second-tile');
  assert.deepEqual(errors, []);
});
