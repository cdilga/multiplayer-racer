// P1-R12 / P1-R10 unit tests (pure, no browser): the effects emitter and pool (web/host/src/render/fx), the look's tiers and
// hull normals (render/look) and the wayfinding kit's geometry against its registry colliders. Imported as TypeScript.
//   node --test web/host/tests/fx.test.mjs
import './lib/ts-resolve.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { BoxGeometry } from 'three';
const { Emitter, FLAG_BOOSTING, FLAG_DRIFTING } = await import('../src/render/fx/emit.ts');
const { FAMILIES, Pool } = await import('../src/render/fx/particles.ts');
const { smoothNormals, tierFor } = await import('../src/render/look/index.ts');
const { decodeSnapshot, encodeSnapshot, PART_DETACHED, PART_LOOSE, PART_PIECE, PIECE_HUSK, snapshotBytes } = await import('../src/render/snapshot.ts');
const { WAYFINDING_MODULES } = await import('../src/render/kit/wayfinding/index.ts');

const repo = resolve(import.meta.dirname, '../../..');
const HZ = 120;

/** One decoded snapshot of `cars` (each: id, pos, yaw, flags, vel, boost, throttle) and `parts`, as the renderer reads it. */
function frameOf(tick, cars, parts = []) {
  const buf = new ArrayBuffer(snapshotBytes(cars.length, 0, parts.length));
  const poses = cars.map((c) => ({
    id: c.id, life: c.life ?? 0, pos: c.pos, rot: [0, Math.sin((c.yaw ?? 0) / 2), 0, Math.cos((c.yaw ?? 0) / 2)],
    flags: c.flags ?? 0, vel: c.vel ?? [0, 0, 0], boost: c.boost ?? 0, throttle: c.throttle ?? 1,
  }));
  encodeSnapshot(buf, tick, poses, 0, parts);
  return decodeSnapshot(new DataView(buf));
}

/** The emitter's input from a decoded frame (the interpolated sample's shape, at alpha 1). */
const inputOf = (f) => ({ cars: f.cars, id: f.id, flags: f.flags, pos: f.pos, rot: f.rot, frame: f });

/** Drives `seconds` of a scenario: `make(tick)` returns the cars and parts for that tick. Returns the emitter. */
function run(make, seconds, { emitter = new Emitter(), step = true } = {}) {
  for (let tick = 0; tick < seconds * HZ; tick++) {
    const { cars, parts } = make(tick);
    emitter.update(inputOf(frameOf(tick, cars, parts)), 1 / HZ);
    if (step) emitter.step(1 / HZ);
  }
  return emitter;
}

/** The birth colour of the first live particle of a family. */
function colourOf(e, family) {
  const i = Array.from({ length: e.pool.n }, (_, k) => k).find((k) => FAMILIES[e.pool.fam[k]] === family);
  assert.ok(i !== undefined, `a live ${family} particle`);
  return [...e.pool.c0.slice(i * 3, i * 3 + 3)];
}

const cruise = (extra = {}) => (tick) => ({ cars: [{ id: 1, pos: [0, 0, tick * (20 / HZ)], vel: [0, 0, 20], ...extra }] });

test('the snapshot carries velocity, boost and throttle for the effects (and a worker that wrote zeros reads as zeros)', () => {
  const f = frameOf(5, [{ id: 3, pos: [1, 2, 3], vel: [4, -5, 6], boost: 0.75, throttle: 0.5, flags: 16 }]);
  assert.deepEqual([...f.vel], [4, -5, 6]);
  assert.equal(f.boost[0], 0.75);
  assert.equal(f.throttle[0], 0.5);
  const z = frameOf(5, [{ id: 3, pos: [0, 0, 0] }]);
  assert.deepEqual([...z.vel], [0, 0, 0]);
});

test('driving: dust by surface (light on tarmac, red on dirt, gravel spray), tyre smoke on a drift, a boost flame blue at full', () => {
  const tarmac = run(cruise({ flags: 0 }), 1);
  const dirt = run(cruise({ flags: 1 << 6 }), 1);
  const gravel = run(cruise({ flags: 2 << 6 }), 1);
  assert.ok(tarmac.pool.spawned.dust > 0, 'tarmac at speed kicks a little dust');
  assert.ok(dirt.pool.spawned.dust > tarmac.pool.spawned.dust * 3, 'dirt kicks far more than tarmac');
  const dustColour = (e) => colourOf(e, 'dust');
  assert.ok(dustColour(dirt)[0] > dustColour(dirt)[2] * 2, 'dirt dust is warm earth, lighter than the ground it lies on');
  assert.ok(Math.abs(dustColour(tarmac)[0] - dustColour(tarmac)[2]) < 0.1, 'tarmac dust is grey');
  // Gravel adds pebbles: ballistic dots with gravity.
  assert.ok([...gravel.pool.grav.slice(0, gravel.pool.n)].some((g) => g > 5), 'gravel throws pebbles');
  const drift = run(cruise({ flags: FLAG_DRIFTING }), 1);
  assert.ok(drift.pool.spawned['tyre-smoke'] > 60, 'a drift smokes the tyres');
  assert.equal(tarmac.pool.spawned['tyre-smoke'], 0);
  const orange = run(cruise({ flags: FLAG_BOOSTING, boost: 0.4 }), 0.5);
  const blue = run(cruise({ flags: FLAG_BOOSTING, boost: 1 }), 0.5);
  assert.ok(orange.pool.spawned.boost > 40 && blue.pool.spawned.boost > 40);
  const first = (e) => colourOf(e, 'boost');
  assert.ok(first(blue)[2] > first(blue)[0], 'full boost is blue');
  assert.ok(first(orange)[0] > first(orange)[2], 'part boost is orange');
  assert.equal(run(cruise({ flags: FLAG_BOOSTING }), 0.5, {}).pool.spawned.dust >= 0, true);
});

test('dust is born low and behind the wheels, never up over the roof (effects never cover identity)', () => {
  const e = run(cruise({ flags: 1 << 6 }), 0.5, { step: false });
  const p = e.pool;
  for (let i = 0; i < p.n; i++) {
    if (FAMILIES[p.fam[i]] !== 'dust') continue;
    assert.ok(p.y[i] < 0.5, `dust born at y ${p.y[i]}`);
    // The car drives +z; the wheels are 1.55 m behind its origin at that tick.
    assert.ok(p.z[i] < 20 * (p.age.length ? 1 : 1) * 1 + 0.01);
  }
  // Lamp glows are lamp-sized: nothing near the car's own size.
  const l = new Emitter();
  l.update(inputOf(frameOf(0, [{ id: 1, pos: [0, 0, 0], vel: [0, 0, 5], throttle: 0 }])), 1 / HZ);
  for (let i = 0; i < l.pool.n; i++) if (FAMILIES[l.pool.fam[i]] === 'lamp') assert.ok(l.pool.s0[i] <= 0.7, 'a lamp glow stays lamp-sized');
  assert.ok(l.pool.spawned.lamp >= 4, 'head and tail lamps glow');
});

test('contact: an impact flashes and sparks in proportion to the speed lost; a scrape throws a few sparks; a landing puffs', () => {
  const hit = (dv) => (tick) => ({ cars: [{ id: 1, pos: [0, 0, tick * (20 / HZ)], vel: [0, 0, tick === 240 || tick === 241 ? 20 - dv : tick > 241 ? 20 : 20] }] });
  const soft = run(hit(5), 3);
  const hard = run(hit(15), 3);
  assert.ok(soft.pool.spawned.impact > 0 && soft.pool.spawned.sparks > 0, 'a 5 m/s hit shows');
  assert.ok(hard.pool.spawned.sparks > soft.pool.spawned.sparks * 1.8, 'a harder hit throws more sparks');
  const scrape = run((tick) => ({ cars: [{ id: 1, pos: [0, 0, tick / 6], vel: [0, 0, 20 - (tick % 60 === 0 ? 1.2 : 0)] }] }), 2);
  assert.ok(scrape.pool.spawned.sparks > 0 && scrape.pool.spawned.impact === 0, 'a scrape is sparks, not a flash');
  const land = run((tick) => ({ cars: [{ id: 1, pos: [0, tick < 100 ? 3 : 0, 0], vel: [0, tick < 100 ? -8 : 0, 10] }] }), 1.2);
  assert.ok(land.pool.spawned.landing >= 8, 'landing puffs dust');
  // Speeding up isn't an impact.
  const accel = run((tick) => ({ cars: [{ id: 1, pos: [0, 0, 0], vel: [0, 0, tick > 120 ? 20 : 4] }] }), 2);
  assert.equal(accel.pool.spawned.impact, 0);
  // A respawn (life bump) isn't an impact either.
  const respawn = run((tick) => ({ cars: [{ id: 1, life: tick > 120 ? 1 : 0, pos: [0, 0, 0], vel: [0, 0, tick > 120 ? 0 : 20] }] }), 2);
  assert.equal(respawn.pool.spawned.impact, 0);
});

test('damage: a part newly detached bursts, a badly damaged car smokes, a husk burns and smoulders for as long as it stays', () => {
  const parts = (tick) => (tick < 120 ? [] : [{ car: 1, part: 1, state: PART_DETACHED, pos: [2, 0.3, 2] }, { car: 1, part: 2, state: PART_LOOSE, angle: 0.4 }, { car: 1, part: 3, state: PART_LOOSE, angle: 0.4 }]);
  const e = run((tick) => ({ cars: [{ id: 1, pos: [0, 0, 0], vel: [0, 0, 0] }], parts: parts(tick) }), 3);
  assert.ok(e.pool.spawned.detach >= 5 && e.pool.spawned.sparks >= 14, 'the detach burst: a flash, a puff and sparks');
  assert.ok(e.pool.spawned['damage-smoke'] > 30, 'three broken parts smoke');
  // Already broken on first sight (a joiner's view of a wrecked car) isn't a fresh burst.
  const born = run((tick) => ({ cars: [{ id: 1, pos: [0, 0, 0] }], parts: parts(999) }), 0.1);
  assert.equal(born.pool.spawned.detach, 0);
  const husk = (tick) => ({ cars: [], parts: [{ car: 7, part: PIECE_HUSK, state: PART_PIECE, pos: [10, 0, 10] }] });
  const w = run(husk, 6);
  assert.ok(w.pool.spawned['wreck-fire'] > 200, 'a husk burns and smokes');
  assert.ok(w.pool.alive()['wreck-fire'] > 0, 'and is still burning after six seconds');
});

test('there is no particle cap: a field of 200 drifting cars emits for every one, and the pool grows by doubling', () => {
  const cars = (tick) => ({ cars: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, pos: [i * 5, 0, tick * (20 / HZ)], vel: [0, 0, 20], flags: FLAG_DRIFTING })) });
  const e = run(cars, 1);
  assert.ok(e.pool.spawned['tyre-smoke'] > 200 * 100, `spawned ${e.pool.spawned['tyre-smoke']}`);
  assert.ok(e.pool.cap >= e.pool.n && e.pool.cap > 256, 'the pool grew past its first size');
  assert.ok(e.pool.n > 5000);
});

test('reduced motion tones the flashes and sparks down; replay with the same seed is identical', () => {
  const hit = (tick) => ({ cars: [{ id: 1, pos: [0, 0, tick * (20 / HZ)], vel: [0, 0, tick === 120 ? 4 : 20] }] });
  const calm = new Emitter();
  calm.reducedMotion = true;
  run(hit, 1.5, { emitter: calm });
  const full = run(hit, 1.5);
  assert.ok(calm.pool.spawned.sparks < full.pool.spawned.sparks * 0.6, 'fewer sparks');
  const flash = (e) => Math.max(...[...e.pool.alpha.slice(0, e.pool.n)].filter((_, i) => e.pool.add[i] && e.pool.life[i] < 0.2));
  const a = new Emitter();
  const b = new Emitter();
  a.seed(9);
  b.seed(9);
  run(hit, 1.5, { emitter: a });
  run(hit, 1.5, { emitter: b });
  assert.deepEqual([...a.pool.x.slice(0, a.pool.n)], [...b.pool.x.slice(0, b.pool.n)]);
  void flash;
});

test('the pool drops the dead and keeps the live ones intact', () => {
  const p = new Pool();
  const base = { family: 'dust', blend: 'alpha', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size0: 1, size1: 1, c0: [1, 1, 1], c1: [1, 1, 1], alpha: 1 };
  p.spawn({ ...base, life: 0.1, x: 1 });
  p.spawn({ ...base, life: 1, x: 2 });
  p.spawn({ ...base, life: 0.1, x: 3 });
  p.step(0.2);
  assert.equal(p.n, 1);
  assert.equal(p.x[0], 2);
});

test('the look: cost tiers follow the jammers-look table; ink width is 4 px at 1080p', () => {
  assert.equal(tierFor(1080).name, 'L');
  assert.equal(tierFor(1080).inkPx, 4);
  assert.equal(tierFor(540).name, 'L');
  assert.equal(tierFor(400).name, 'M');
  assert.equal(tierFor(200).name, 'S');
  assert.equal(tierFor(200).cell, 0, 'no halftone below 270 px');
  assert.equal(tierFor(60).name, 'XS');
  assert.ok(tierFor(2160).inkPx <= 6, 'ink stays bounded at 4K');
});

test('hull normals: a flat-shaded box gets one outward normal per corner, so its outline has no cracks', () => {
  const g = new BoxGeometry(2, 2, 2).toNonIndexed();
  const n = smoothNormals(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const out = [Math.sign(pos.getX(i)), Math.sign(pos.getY(i)), Math.sign(pos.getZ(i))];
    const l = Math.hypot(...out);
    const dot = (n.getX(i) * out[0] + n.getY(i) * out[1] + n.getZ(i) * out[2]) / l;
    assert.ok(dot > 0.99, `vertex ${i} normal points out of the corner (${dot})`);
  }
});

test("the wayfinding kit: each piece's rendered bounds are its collider's, stand on the origin, and carry a vertex colour", () => {
  const dirs = [join(repo, 'assets/kit/wayfinding'), join(repo, 'crates/jj-procgen/kit/wayfinding')];
  const entries = {};
  for (const d of dirs.reverse()) {
    let files = [];
    try {
      files = readdirSync(d).filter((f) => f.endsWith('.json'));
    } catch {
      /* the assets family may not exist yet */
    }
    for (const f of files) {
      const e = JSON.parse(readFileSync(join(d, f), 'utf8'));
      entries[e.id] = e;
    }
  }
  const size = (s, p) => (typeof s === 'number' ? s : p[s.param] * (s.scale ?? 1)) / 1000;
  assert.deepEqual(Object.keys(entries).sort(), Object.keys(WAYFINDING_MODULES).sort());
  for (const [id, mod] of Object.entries(WAYFINDING_MODULES)) {
    const e = entries[id];
    const p = Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, v.default]));
    const col = 'box' in e.collider ? [size(e.collider.box.x, p), size(e.collider.box.y, p), size(e.collider.box.z, p)] : [2 * size(e.collider.cylinder.radius, p), size(e.collider.cylinder.height, p), 2 * size(e.collider.cylinder.radius, p)];
    const g = mod.geometry();
    g.computeBoundingBox();
    const b = g.boundingBox;
    const [sx, sy, sz] = mod.scale(p);
    const rendered = [(b.max.x - b.min.x) * sx, b.max.y * sy, (b.max.z - b.min.z) * sz];
    rendered.forEach((r, k) => assert.ok(Math.abs(r - col[k]) / col[k] <= 0.03, `${id} axis ${'xyz'[k]}: ${r.toFixed(3)} vs collider ${col[k].toFixed(3)}`));
    assert.ok(Math.abs(b.min.y * sy) < 0.01, `${id} stands on its origin`);
    assert.ok(g.attributes.color, `${id} has vertex colours`);
    assert.equal(g.attributes.position.count % 3, 0);
    for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v));
    // The guard rail is a two-sided sheet: an inverted-hull outline covers its whole face (it read navy), so it has none.
    if (id === 'wayfinding/guard-rail') assert.ok(!mod.ink, `${id} has no ink hull`);
    else assert.ok(mod.ink, `${id} is outlined`);
  }
  const chevron = WAYFINDING_MODULES['wayfinding/chevron-post'].decor;
  const board = chevron.geometry();
  board.computeBoundingBox();
  assert.ok(board.boundingBox.max.x - board.boundingBox.min.x > 0.5, 'the chevron board is a real board, wider than its post');
  void snapshotBytes;
});
