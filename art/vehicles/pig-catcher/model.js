// model.js: the low-poly Pig Catcher built from code (R81, R123, br-bwju.5): a bubbly Australian outback enduro bike in the
// spirit of the DR-Z400E (generic: no Suzuki branding), with its rider standing on the pegs as part of the model.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs); pivots(P). P is params.json, measured off refs/lod-plus-1.png and fitted with tools/vehicles/fit.
//
// Frame: metres, +Z nose, +Y up, origin on the ground between the axles; +X is the bike's LEFT; the exhaust is tucked up on
// the right (−X). Parts (the bike part set of jj.vehicle.v1): core (frame, engine, tank, side plastics, seat, rear side
// panels, swingarm, exhaust, pegs, bars and hand guards), front (forks, the high beaked mudguard, the number-plate shroud
// and its headlamp, the black light bar with two spotlights), back (rear mudguard, tail lamp, the rack with a coiled rope
// and a hessian sack), rider, wheel_F, wheel_R.
import { swatchUV } from './atlas.js';
import { Soup, wheel, rider, exportsFor } from '../_kit/bike.js';

export const LODS = {
  0: { wheelSeg: 12, rim: 6, spokes: 3, rider: 2, guards: true, ropeSeg: 8, sackSeg: [6, 4], spotSeg: 8, header: true, detail: true },
  1: { wheelSeg: 8, rim: 6, spokes: 0, rider: 2, guards: true, ropeSeg: 6, sackSeg: [5, 3], spotSeg: 6, header: false, detail: true },
  2: { wheelSeg: 8, rim: 0, spokes: 0, rider: 1, guards: false, ropeSeg: 6, sackSeg: [4, 3], spotSeg: 4, header: false, detail: false },
};

function makeSoups(P, lod) {
  const T = LODS[lod], soups = {}, S = (id) => (soups[id] ??= new Soup(swatchUV));
  const C = S('core'), F = S('front'), B = S('back');
  const head = [0, P.fork.top[1] - 0.04, P.fork.top[0] - 0.04]; // the steering head

  // ── core ──
  // frame: down tube from the head to the engine's front, a top rail from the head back under the seat, and the swingarm
  const fw = P.frame.w, e = P.engine;
  C.limb(head, [0, e.y - e.s[1] / 2 + 0.06, e.z + e.s[2] / 2], fw, fw, 'frame');
  C.limb(head, [0, P.seat.y - 0.06, P.sidePanel.z1 + 0.1], fw, fw, 'frame');
  C.box([0, e.y, e.z], e.s, { all: 'engine', ny: 'under' });
  for (const s of T.detail ? [1, -1] : [0]) C.limb([s * 0.1, P.swingarm.y0, P.swingarm.z0], [s * 0.1, P.rR, P.zR], T.detail ? 0.05 : 0.2, 0.08, 'chrome');
  // tank, the raked side plastics (radiator shrouds), the long flat seat, the rear side panels
  { const t = P.tank; C.box([0, (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2], [t.w, t.y1 - t.y0, t.z0 - t.z1], 'paint', [-0.12, 0, 0]); }
  // the radiator shrouds: raked plates from the tank's front edge down and back to the engine, wide at the top
  { const h = P.shrouds; for (const s of [1, -1]) C.limb([s * h.x, h.y1, h.z0], [s * (h.x - 0.03), h.y0, h.z1], 0.07, (h.z0 - h.z1) * 0.9, 'paint'); }
  { const s = P.seat; C.box([0, s.y + s.h / 2, (s.z0 + s.z1) / 2], [s.w, s.h, s.z0 - s.z1], 'seat'); }
  // the rear side panels: one wedge rising from under the seat's front to the tail, under the seat
  { const p = P.sidePanel; C.limb([0, p.y0 + (p.y1 - p.y0) * 0.35, p.z0], [0, p.y1 - (p.y1 - p.y0) * 0.2, p.z1], p.x * 2, (p.y1 - p.y0) * 0.6, 'paint'); }
  // exhaust tucked up on the right, with a header pipe from the engine at LOD0
  { const x = P.exhaust; C.prism([x.x, x.y0, x.z0], [x.x, x.y1, x.z1], x.r, 6, 'chrome', 'under');
    if (T.header) C.limb([x.x * 0.6, e.y + 0.05, e.z + e.s[2] / 2], [x.x, x.y0, x.z0], 0.05, 0.05, 'chrome'); }
  // footpegs, handlebar on its stem, the hand guards
  if (T.detail) for (const s of [1, -1]) C.box([s * P.pegs.x, P.pegs.y, P.pegs.z], [0.14, 0.04, 0.06], 'frame');
  { const b = P.bars; C.limb([0, P.fork.top[1], P.fork.top[0]], [0, b.y, b.z], 0.06, 0.06, 'frame');
    C.limb([-b.hw, b.y, b.z], [b.hw, b.y, b.z], 0.04, 0.04, 'frame');
    for (const s of [1, -1]) if (T.guards) C.box([s * (b.hw - b.guard / 2 + 0.03), b.y + 0.01, b.z + 0.06], [b.guard, 0.1, 0.06], 'lightbar', [0, s * 0.25, 0]); }

  // ── front: fork legs, the high beaked mudguard, the number-plate shroud with its headlamp, the light bar and spots ──
  for (const s of [1, -1]) F.limb([s * P.fork.x, P.fork.top[1], P.fork.top[0]], [s * P.fork.x, P.rF, P.zF], P.fork.w, P.fork.w, 'chrome');
  { const k = P.beak; F.limb([0, k.y0, k.z0], [0, k.y1, k.z1], k.w * 2, k.t, 'paint'); }
  { const h = P.shroud; F.box([0, (h.y0 + h.y1) / 2, h.z], [h.w, h.y1 - h.y0, h.t], { all: 'paint', pz: 'paint' }, [-0.25, 0, 0]);
    if (T.detail) F.prism([0, P.spots.y - 0.02, h.z + 0.05], [0, P.spots.y - 0.02, h.z + 0.09], P.spots.r * 0.8, 6, 'lightbar', 'head', Math.PI / 6); }
  { const L = P.spots; F.limb([-(L.x + L.r), L.y - L.r - 0.02, L.z - 0.02], [L.x + L.r, L.y - L.r - 0.02, L.z - 0.02], 0.04, 0.04, 'lightbar');
    for (const s of [1, -1]) F.prism([s * L.x, L.y, L.z - 0.05], [s * L.x, L.y, L.z + 0.03], L.r, T.spotSeg, 'lightbar', 'head', Math.PI / T.spotSeg); }

  // ── back: the rear mudguard rising to its tail, tail lamp, the rack with the rope coil and the hessian sack ──
  { const f = P.fenderR; B.limb([0, f.y0, f.z0], [0, f.y1, f.z1], f.w, 0.04, 'paint');
    if (T.detail) B.box([0, f.y1 - 0.04, f.z1 + 0.03], [0.1, 0.06, 0.05], { all: 'frame', nz: 'tail' }); }
  { const r = P.rack; B.box([0, r.y, (r.z0 + r.z1) / 2], [r.w, 0.04, r.z0 - r.z1], 'lightbar');
    for (const s of [1, -1]) B.limb([s * r.w / 2, r.y, r.z0], [s * 0.12, P.fenderR.y0 - 0.1, r.z0 + 0.15], 0.03, 0.03, 'lightbar'); }
  { const o = P.rope; B.prism([o.x, P.rack.y + 0.02, o.z], [o.x, P.rack.y + 0.02 + o.h, o.z], o.r, T.ropeSeg, 'rope', 'rope'); }
  { const k = P.sack; B.blob([k.x, k.y, k.z], [k.r * 0.95, k.r * 1.1, k.r], T.sackSeg[0], T.sackSeg[1], 'sack');
    B.box([k.x, k.y + k.r * 1.15, k.z], [0.06, 0.08, 0.06], 'rope'); } // the tie is the back's top at every LOD (its hinge height)

  // ── rider, standing on the pegs, with an MX helmet's peak and chin bar ──
  const J = P.rider, R = S('rider');
  rider(R, J, { helmet: 'helmet', visor: 'goggles', skin: 'skin', shirt: 'shirt', pants: 'pants', boots: 'boots', gloves: 'gloves' }, J.headR, T);
  if (T.rider >= 2) R.limb([-0.27, J.shoulder[1] - 0.06, J.shoulder[2]], [0.27, J.shoulder[1] - 0.06, J.shoulder[2]], 0.16, 0.2, 'shirt'); // broad shoulders (the kit's torso is narrow)
  R.box([0, J.head[1] + J.headR * 0.55, J.head[2] + J.headR * 0.95], [J.headR * 1.4, 0.03, J.headR * 0.9], 'helmet', [-0.25, 0, 0]); // peak
  if (T.rider >= 2) R.box([0, J.head[1] - J.headR * 0.65, J.head[2] + J.headR * 0.8], [J.headR * 0.9, J.headR * 0.4, J.headR * 0.5], 'helmet'); // chin bar

  // ── wheels: a big 21-inch-style front and an 18-inch-style rear, knobblies on silver spoked rims ──
  const look = { tyre: 'tyre', rim: 'rim', hub: 'hub', spokes: 'spokes' };
  wheel(S('wheel_F'), P.zF, P.rF, P.tyreW, T, look);
  wheel(S('wheel_R'), P.zR, P.rR, P.tyreW * 1.15, T, look);
  return { soups };
}

export const { pivots, soups, build } = exportsFor('pig-catcher', makeSoups);
