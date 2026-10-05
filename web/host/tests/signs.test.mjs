// P1-M09 unit tests: the road-sign kit (web/host/src/render/signs/sign-kit.ts, imported as TypeScript; Node strips the
// types). Pure geometry, so plain node --test, no browser:
//   node --test web/host/tests/signs.test.mjs
// The captures live in web/host/tests/signs-capture.mjs (docs/evidence/P1-M09/).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { FAMILY_COLOURS, FONT, SIZES, fitHeight, legendHeights, panelHeight, rowHeight, signModule } from '../src/render/signs/sign-kit.ts';

const repo = resolve(import.meta.dirname, '../../..');
const kit = join(repo, 'assets/kit/signs');
const names = readdirSync(join(kit, 'data')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const data = Object.fromEntries(names.map((n) => [n, JSON.parse(readFileSync(join(kit, 'data', `${n}.json`), 'utf8'))]));
const entry = (n) => JSON.parse(readFileSync(join(kit, `${n}.json`), 'utf8'));
/** Smallest legend cap height (m) the kit may draw, per family: below this a sign stops being legible at the smallest
 *  tile (set from the captures in docs/evidence/P1-M09/). */
const MIN_LEGEND = { warning: 0.12, direction: 0.13, tourist: 0.14 };

const geo = (n) => signModule(data[n]).geometry();

test('there is a sign data file and registry entry for each sign, and all three families are covered', () => {
  assert.ok(names.length >= 10, 'a sample of signs, not a limit');
  assert.deepEqual(new Set(Object.values(data).map((d) => d.family)), new Set(['warning', 'direction', 'tourist']));
  for (const n of names) {
    assert.equal(data[n].id, `signs/${n}`);
    assert.equal(entry(n).id, `signs/${n}`);
    assert.equal(data[n].sidecar.family, data[n].family);
    assert.ok(data[n].sidecar.source === 'original' || data[n].sidecar.source.startsWith('https://commons.wikimedia.org/wiki/File:'), n);
  }
  assert.equal(data['bloody-big-jumps'].family, 'warning');
  assert.deepEqual(data['bloody-big-jumps'].lines, ['BLOODY BIG', 'JUMPS', 'AHEAD']);
});

test('family colours and shapes are the fixed grammar (no new shapes, no new colour families)', () => {
  for (const n of names) {
    const d = data[n];
    const f = FAMILY_COLOURS[d.family];
    assert.deepEqual({ shape: d.shape, background: d.background, legend: d.legend }, f, n);
  }
});

test('every lettering character the data uses has a glyph', () => {
  for (const n of names) {
    const d = data[n];
    const text = [...(d.lines ?? []), d.heading ?? '', d.shield ?? '', ...(d.rows ?? []).flatMap((r) => [r.text, String(r.km)])].join('');
    for (const ch of text) assert.ok(FONT[ch], `${n}: glyph for ${JSON.stringify(ch)}`);
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-/') assert.ok(FONT[ch], ch);
});

test("each sign's rendered bounds equal its registry collider, standing on the ground", () => {
  for (const n of names) {
    const g = geo(n);
    g.computeBoundingBox();
    const b = g.boundingBox;
    const box = entry(n).collider.box;
    const got = [(b.max.x - b.min.x) * 1000, b.max.y * 1000, (b.max.z - b.min.z) * 1000];
    [box.x, box.y, box.z].forEach((want, k) => assert.ok(Math.abs(got[k] - want) / want <= 0.03, `${n} axis ${'xyz'[k]}: ${got[k].toFixed(0)} vs ${want} mm`));
    assert.ok(Math.abs(b.min.y) < 1e-6, `${n} stands on its origin`);
  }
});

test('every sign is one geometry with flat vertex colours, within a triangle budget per sign', () => {
  for (const n of names) {
    const g = geo(n);
    assert.ok(g.attributes.position && g.attributes.color && g.attributes.normal, n);
    assert.equal(g.attributes.uv, undefined, `${n}: no textures`);
    const tris = g.attributes.position.count / 3;
    assert.ok(tris > 20 && tris < 12_000, `${n}: ${tris} triangles`);
  }
});

test('the legend and pictogram stay inside the border at their legible heights (nothing clipped, nothing too small)', () => {
  for (const n of names) {
    const d = data[n];
    const g = geo(n);
    const pos = g.attributes.position;
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (z < 0.058) continue; // panel, face and border layers
      checked++;
      if (d.family === 'warning') {
        const R = SIZES.warning.side / Math.SQRT2;
        const cy = SIZES.warning.bottom + R;
        assert.ok(Math.abs(x) + Math.abs(y - cy) <= R - 0.12 + 1e-3, `${n}: vertex (${x.toFixed(2)}, ${y.toFixed(2)}) outside the border`);
      } else {
        const { w, bottom } = SIZES[d.family];
        const h = panelHeight(d);
        assert.ok(Math.abs(x) <= w / 2 - 0.07 + 1e-3 && Math.abs(y - (bottom + h / 2)) <= h / 2 - 0.07 + 1e-3, `${n}: vertex (${x.toFixed(2)}, ${y.toFixed(2)}) outside the border`);
      }
    }
    assert.ok(checked > 0, `${n} draws a legend`);
  }
  // Legend cap heights: the data names a fit, the kit draws it; measure the same rule the kit uses.
  for (const [n, d] of Object.entries(data)) {
    if (d.family === 'tourist') for (const l of d.lines) assert.ok(Math.min(0.3, fitHeight(l, SIZES.tourist.w - 0.28)) >= MIN_LEGEND.tourist, `${n}: ${l}`);
    if (d.family === 'direction') {
      const h = rowHeight(d.rows, SIZES.direction.w - 2 * 0.13 - 0.2 - 0.24);
      assert.ok(h >= MIN_LEGEND.direction, `${n}: rows at ${h.toFixed(3)} m`);
    }
  }
});

// "Legible at the smallest tile", concretely: the smallest tile the grid makes is 192x108 (100 players at 1920x1080).
// A sign is "about to be passed" when its panel is 85% of the tile height (92 px); with the near chase camera's 60 deg
// vertical FOV that is a distance of panelHeight / (0.85 * 2 * tan 30) = 1.02 x the panel height (warning 1.7 m,
// direction 1.4-1.6 m, tourist 1.2 m from the camera). The legend's cap height there must be at least 6 px.
const TILE_H = 108;
const PASS_FILL = 0.85;
const MIN_CAP_PX = 6;

test('at the smallest tile (192x108, panel 85% of the tile height) every legend has a cap height of at least 6 px', () => {
  const table = {};
  for (const [n, d] of Object.entries(data)) {
    const hs = legendHeights(d);
    if (hs.length === 0) continue; // pictogram only
    const pxPerM = (TILE_H * PASS_FILL) / panelHeight(d);
    const caps = hs.map((h) => h * pxPerM);
    table[n] = caps.map((c) => +c.toFixed(1));
    for (const c of caps) assert.ok(c >= MIN_CAP_PX, `${n}: legend cap ${c.toFixed(1)} px < ${MIN_CAP_PX}`);
  }
  console.log('legend cap heights (px) at 192x108:', JSON.stringify(table));
});

test('the kit is one set of code: adding a sign adds no module, only data (same geometry code path)', () => {
  const a = signModule(data['bloody-big-jumps']);
  const b = signModule({ ...data['bloody-big-jumps'], id: 'signs/test-clone', lines: ['BLOODY BIG', 'JUMPS', 'AHEAD'] });
  assert.equal(a.geometry().attributes.position.count, b.geometry().attributes.position.count);
});
