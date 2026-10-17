// br-vhtm: the paint key survives filtering (node --test tools/vehicles/test/).
// The renderer draws an atlas texel as linear(rgb) + (1 − alpha) × tint (web/shared/render/paint-key.js). The GPU
// filters an sRGB texture in linear light, and a premultiplied texel filters exactly, so this test filters the baked
// atlas the way the GPU does (bilinear between neighbours, then the 2×2 box mip chain) and walks a line across livery
// edges: no filtered sample may be lighter than both colours meeting at the edge, for dark and light seat colours.
// The same walk over the old rule (only pure-white texels tint) must find the light fringe, so the test can see the bug.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { paintKeyedAtlas, keyPaint } from '../paint-key.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lin = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const hexLin = (h) => [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// Seat colours: a dark one (where a grey fringe shows most), a mid one and a light one.
const SEATS = ['#1d3a8a', '#d8231c', '#f4c418'];

/** One column of the atlas as premultiplied linear texels [r, g, b, a], top to bottom. */
function column(px, W, H, x) {
  return Array.from({ length: H }, (_, y) => { const o = (y * W + x) * 4; return [lin(px[o]), lin(px[o + 1]), lin(px[o + 2]), px[o + 3] / 255]; });
}
/** The 2×2 box mip of a column (two columns averaged is the same column here: the livery is constant along x). */
const mip = (col) => Array.from({ length: col.length >> 1 }, (_, i) => col[2 * i].map((v, k) => (v + col[2 * i + 1][k]) / 2));
/** Every bilinear sample between neighbours (quarter steps), drawn with the paint key. */
function drawn(col, tint) {
  const out = [];
  for (let i = 0; i + 1 < col.length; i++) for (const t of [0, 0.25, 0.5, 0.75]) {
    const s = col[i].map((v, k) => v * (1 - t) + col[i + 1][k] * t);
    out.push([0, 1, 2].map((k) => s[k] + (1 - s[3]) * tint[k]));
  }
  return out;
}
/** The old rule on an opaque, unkeyed atlas column: tint only where the filtered sample is (nearly) pure white. */
function drawnOld(colSrgb, tint) {
  const out = [];
  for (let i = 0; i + 1 < colSrgb.length; i++) for (const t of [0, 0.25, 0.5, 0.75]) {
    const s = [0, 1, 2].map((k) => colSrgb[i][k] * (1 - t) + colSrgb[i + 1][k] * t);
    const white = Math.min(...s.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))) >= 0.985;
    out.push(white ? s.map((v, k) => v * tint[k]) : s);
  }
  return out;
}

/** The lightest sample's excess over the lighter of the two colours that meet (paint in this seat, the livery). */
function fringe(samples, tint, livery) {
  const ceiling = Math.max(lum(tint), lum(livery));
  return Math.max(...samples.map((s) => lum(s) - ceiling));
}

async function car(id) {
  const atlas = await import(pathToFileURL(path.join(REPO, `art/vehicles/${id}/atlas.js`)).href);
  return { atlas, keyed: paintKeyedAtlas(atlas.drawAtlas), plain: atlas.drawAtlas() };
}

test('Hawk Dash: across the black twin stripes, no filtered sample is lighter than the seat paint or the stripe, at any mip', async () => {
  const { atlas, keyed, plain } = await car('hawk-dash');
  const { W, H, REGION } = atlas;
  const x = Math.round(REGION.top[2] * W * 0.5); // halfway along the bonnet-to-boot top livery
  const stripe = hexLin(atlas.DEFAULT_COLOURS.stripe);
  let col = column(keyed.base, W, H, x).slice(Math.round((1 - REGION.top[3]) * H), Math.round((1 - REGION.top[1]) * H));
  let old = column(plain.base, W, H, x).slice(Math.round((1 - REGION.top[3]) * H), Math.round((1 - REGION.top[1]) * H));
  assert.ok(col.some((t) => t[3] === 0) && col.some((t) => t[3] === 1), 'the column crosses paint and stripe');
  for (let level = 0; col.length >= 8; level++, col = mip(col), old = mip(old)) {
    for (const seat of SEATS) {
      const tint = hexLin(seat);
      const f = fringe(drawn(col, tint), tint, stripe);
      assert.ok(f <= 1e-3, `mip ${level}, seat ${seat}: a filtered sample is ${f.toFixed(4)} lighter than the lighter of paint and stripe`);
      if (level === 0 && seat === SEATS[0]) {
        const fo = fringe(drawnOld(old.map((t) => t.slice(0, 3)), tint), tint, stripe);
        assert.ok(fo > 0.05, `the old rule shows its fringe here (${fo.toFixed(3)}), so this walk can see the bug`);
      }
    }
  }
});

test('every roster atlas: paint is (0,0,0,0), non-paint texels keep their colour, edges are premultiplied', async () => {
  for (const id of ['cruz-missile', 'hawk-dash', 'lion-president', 'tradie-ute', 'pig-catcher', 'postie-bike']) {
    const { keyed, plain } = await car(id);
    let paint = 0, edge = 0;
    for (let o = 0; o < keyed.base.length; o += 4) {
      const a = keyed.base[o + 3];
      if (a === 0) { paint++; assert.deepEqual([...keyed.base.subarray(o, o + 3)], [0, 0, 0], `${id}: paint texel rgb`); }
      else if (a === 255) assert.deepEqual([...keyed.base.subarray(o, o + 3)], [...plain.base.subarray(o, o + 3)], `${id}: opaque texel keeps its colour`);
      // premultiplied in linear light: no channel brighter than its coverage (one sRGB step of rounding)
      else { edge++; for (let k = 0; k < 3; k++) assert.ok(lin(Math.max(0, keyed.base[o + k] - 1)) <= a / 255, `${id}: edge texel rgb ${keyed.base[o + k]} over alpha ${a}`); }
    }
    assert.ok(paint > 0 && edge > 0, `${id}: has paint (${paint}) and filtered paint edges (${edge})`);
  }
});

test('keyPaint: a half-paint texel next to black keeps half the coverage and no colour', () => {
  const white = Uint8Array.from([128, 128, 128, 255]), black = Uint8Array.from([0, 0, 0, 255]);
  assert.deepEqual([...keyPaint(white, black)], [0, 0, 0, 127]);
});
