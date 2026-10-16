// model.js: the low-poly Postie Bike built from code (R81, R123, br-bwju.5): a bubbly Australian step-through delivery bike
// in the spirit of the 110 cc postie (generic: no Australia Post branding or logo), with its rider as part of the model.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs); pivots(P). P is params.json, measured off refs/lod-plus-1.png and fitted with tools/vehicles/fit.
//
// Frame: metres, +Z nose, +Y up, origin on the ground between the axles; +X is the bike's LEFT; the exhaust is on the
// right (−X). Parts (the bike part set of jj.vehicle.v1): core (frame, leg shield, floor, body, seat, engine, exhaust,
// handlebars), front (fork, front basket with its mail, headlamp, front mudguard), back (rear rack, the two postal-red
// panniers and their parcels, tail lamp, rear mudguard), rider, wheel_F, wheel_R.
import { swatchUV } from './atlas.js';
import { Soup, wheel, rider, exportsFor } from '../_kit/bike.js';

export const LODS = {
  0: { wheelSeg: 12, rim: 6, spokes: 3, rider: 2, mirrors: true, parcels: 3, basketBars: true, shieldSeg: 3, exhaust: true, grips: true },
  1: { wheelSeg: 12, rim: 6, spokes: 0, rider: 2, mirrors: false, parcels: 2, basketBars: false, shieldSeg: 2, exhaust: true, grips: true },
  // LOD2 keeps one parcel a side: the back's top edge (its hinge line) is the parcels' top at every LOD
  2: { wheelSeg: 8, rim: 0, spokes: 0, rider: 1, mirrors: false, parcels: 1, basketBars: false, shieldSeg: 1, exhaust: false, grips: false },
};

function makeSoups(P, lod) {
  const T = LODS[lod], soups = {}, S = (id) => (soups[id] ??= new Soup(swatchUV));
  const C = S('core'), F = S('front'), B = S('back');

  // ── core: the step-through frame (headstock → down tube → floor → up under the seat), the leg shield, floor boards,
  // the body under the seat, the seat, the engine, the exhaust on the right, the handlebars and mirrors ──
  const fr = P.frame;
  const hs = [0, fr.head[1], P.shield.z + 0.05];
  C.limb(hs, [0, fr.floor[1] + 0.05, fr.floor[0]], fr.w, fr.w, 'frame');
  C.limb([0, fr.floor[1] + 0.05, fr.floor[0]], [0, fr.floor[1] + 0.05, fr.floorBack], fr.w, fr.w, 'frame');
  C.limb([0, fr.floor[1] + 0.05, fr.floorBack], [0, P.body.y0, P.body.z0 - 0.2], fr.w, fr.w, 'frame');
  // leg shield: a thick raked wedge from the headstock cowl down to the floor (front face paint, bowed in `shieldSeg` facets)
  { const L = P.shield, n = T.shieldSeg + 1, xs = Array.from({ length: n + 1 }, (_, i) => -L.w / 2 + (L.w * i) / n);
    const at = (x, top, back) => { const bow = 0.07 * (1 - (2 * x / L.w) ** 2); return [x * (top ? 0.8 : 1), top ? L.top : L.bottom, (top ? L.z : L.z - L.rake) + bow - (back ? L.t : 0)]; };
    for (let i = 0; i < n; i++) {
      const [x0, x1] = [xs[i], xs[i + 1]];
      C.quad(at(x0, false, false), at(x1, false, false), at(x1, true, false), at(x0, true, false), 'paint'); // front
      C.quad(at(x0, false, true), at(x0, true, true), at(x1, true, true), at(x1, false, true), 'paint'); // back (rider side)
      C.quad(at(x0, true, false), at(x1, true, false), at(x1, true, true), at(x0, true, true), 'paint'); // top
    }
    for (const [x, s] of [[-L.w / 2, -1], [L.w / 2, 1]]) { const q = [at(x, false, false), at(x, true, false), at(x, true, true), at(x, false, true)]; if (s > 0) C.quad(q[0], q[3], q[2], q[1], 'paint'); else C.quad(q[0], q[1], q[2], q[3], 'paint'); } }
  // floor boards
  C.box([0, fr.floor[1] + 0.03, (fr.floor[0] + fr.floorBack) / 2], [0.36, 0.04, fr.floor[0] - fr.floorBack], { all: 'frame', py: 'under' });
  // body under the seat (side covers, paint) and the seat
  { const b = P.body; C.box([0, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2], [b.w, b.y1 - b.y0, b.z0 - b.z1], { all: 'paint', ny: 'under' }); }
  { const s = P.seat; C.box([0, s.y + s.h / 2, (s.z0 + s.z1) / 2], [s.w, s.h, s.z0 - s.z1], 'seat'); }
  C.box([0, P.engine.y, P.engine.z], P.engine.s, 'engine');
  if (T.exhaust) { const e = P.exhaust; C.prism([e.x, e.y, e.z0], [e.x, e.y + 0.04, e.z1], e.r, 6, 'chrome', 'under'); }
  // handlebars (a bar across on a short stem) and round mirrors up on stalks
  { const b = P.bars; C.limb([0, b.y - 0.12, b.z - 0.02], [0, b.y, b.z], 0.06, 0.06, 'frame');
    C.limb([-b.hw, b.y, b.z - 0.04], [b.hw, b.y, b.z - 0.04], 0.045, 0.045, 'frame');
    for (const s of [1, -1]) {
      if (T.grips) C.box([s * b.hw, b.y, b.z - 0.04], [0.09, 0.07, 0.07], 'seat'); // grips
      if (T.mirrors) { C.limb([s * (b.hw - 0.06), b.y, b.z - 0.04], [s * (b.hw - 0.02), b.mirrorY, b.z - 0.08], 0.025, 0.025, 'frame');
        C.prism([s * (b.hw - 0.02), b.mirrorY + 0.05, b.z - 0.1], [s * (b.hw - 0.02), b.mirrorY + 0.05, b.z - 0.07], 0.055, 6, 'frame', 'chrome'); }
    } }

  // ── front: fork legs to the front hub, the headlamp, the front mudguard, the front carrier and its mail tub ──
  { const h = P.head; F.prism([0, h.y, h.z - 0.06], [0, h.y, h.z + 0.04], h.r, 8, 'frame', 'head', Math.PI / 8); }
  for (const s of [1, -1]) F.limb([s * 0.1, P.head.y - 0.08, P.head.z - 0.04], [s * 0.1, P.rF, P.zF], 0.05, 0.05, 'chrome');
  { const R = P.rF + P.fenderF.lift, n = 3; // front mudguard: a faceted arc over the front of the tyre, as wide as the tyre
    const p = (t, x) => [x, P.rF + Math.cos(t) * R, P.zF + Math.sin(t) * R];
    for (let i = 0; i < n; i++) { const t0 = -0.35 + (P.fenderF.arc * Math.PI * i) / n, t1 = -0.35 + (P.fenderF.arc * Math.PI * (i + 1)) / n;
      F.quad(p(t0, -0.1), p(t0, 0.1), p(t1, 0.1), p(t1, -0.1), 'paint'); F.quad(p(t0, -0.1), p(t1, -0.1), p(t1, 0.1), p(t0, 0.1), 'under'); } }
  { const k = P.basket, cz = (k.z0 + k.z1) / 2, cy = (k.y0 + k.y1) / 2;
    F.limb([0, k.y0 + 0.02, P.head.z], [0, k.y0 + 0.02, k.z1 - 0.05], 0.05, 0.04, 'chrome'); // carrier arm
    F.box([0, k.y0 + 0.1, cz], [k.hw * 2 - 0.06, 0.18, k.z1 - k.z0 - 0.06], { all: 'postred', py: 'parcel' }); // the mail tub
    if (T.basketBars) { for (const s of [1, -1]) F.limb([s * k.hw, k.y0, k.z0], [s * k.hw, k.y0, k.z1], 0.025, 0.025, 'chrome');
      F.limb([-k.hw, k.y1, k.z1], [k.hw, k.y1, k.z1], 0.025, 0.025, 'chrome'); F.limb([-k.hw, k.y1, k.z0], [k.hw, k.y1, k.z0], 0.025, 0.025, 'chrome');
      for (const s of [1, -1]) { F.limb([s * k.hw, k.y1, k.z0], [s * k.hw, k.y1, k.z1], 0.025, 0.025, 'chrome'); for (const z of [k.z0, k.z1]) F.limb([s * k.hw, k.y0, z], [s * k.hw, k.y1, z], 0.025, 0.025, 'chrome'); } }
    // LOD2: the mail tub alone reads as the basket at that size
    for (let i = 0; i < T.parcels - 1; i++) F.box([(i - 0.5) * 0.18, k.y0 + 0.24, cz + (i ? 0.06 : -0.08)], [0.16, 0.1, 0.2], { all: 'parcel', py: 'tape' }, [0, 0.3 * (i ? 1 : -1), 0]); }

  // ── back: rear rack, the two postal-red panniers with parcels on top, tail lamp, rear mudguard ──
  { const r = P.rack, p = P.pannier, cz = (p.z0 + p.z1) / 2;
    B.box([0, r.y, (r.z0 + r.z1) / 2], [0.3, 0.04, r.z0 - r.z1], 'chrome');
    for (const s of [1, -1]) {
      B.box([s * (p.xin + p.xout) / 2, (p.y0 + p.y1) / 2, cz], [p.xout - p.xin, p.y1 - p.y0, p.z0 - p.z1], { all: 'postred', py: 'frame' });
      B.limb([s * 0.12, r.y, cz], [s * p.xin, p.y1 - 0.05, cz], 0.03, 0.03, 'chrome');
      for (let i = 0; i < T.parcels; i++) B.box([s * (p.xin + 0.08 + (i % 2) * 0.18), p.y1 + 0.06, p.z0 - 0.14 - i * 0.2], [0.16, P.parcels.h, 0.18], { all: 'parcel', py: 'tape' }, [0, 0.25 * (i % 2 ? 1 : -1), 0]);
    }
    B.box([0, r.y - 0.12, r.z1 + 0.02], [0.14, 0.08, 0.05], { all: 'frame', nz: 'tail' }); // tail lamp
    B.limb([0, r.y - 0.06, r.z0 + 0.1], [0, P.rR + P.rR * 0.75, P.zR - 0.35], 0.18, 0.03, 'paint'); } // rear mudguard

  // ── rider ──
  const J = P.rider;
  rider(S('rider'), J, { helmet: 'helmet', visor: 'visor', skin: 'skin', shirt: 'shirt', vest: 'vest', pants: 'pants', boots: 'boots', gloves: 'skin' }, J.headR, T);
  if (T.rider >= 2) S('rider').limb([0, (J.hip[1] + J.shoulder[1]) / 2, (J.hip[2] + J.shoulder[2]) / 2 - 0.115], [0, (J.hip[1] + J.shoulder[1]) / 2 + 0.06, (J.hip[2] + J.shoulder[2]) / 2 - 0.12], 0.37, 0.02, 'band'); // vest's reflective band (back)

  // ── wheels: chunky little knobblies on silver rims ──
  const look = { tyre: 'tyre', rim: 'rim', hub: 'hub', spokes: 'spokes' };
  wheel(S('wheel_F'), P.zF, P.rF, P.tyreW, T, look);
  wheel(S('wheel_R'), P.zR, P.rR, P.tyreW, T, look);
  return { soups };
}

export const { pivots, soups, build } = exportsFor('postie-bike', makeSoups);
