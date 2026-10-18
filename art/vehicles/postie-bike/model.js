// model.js: the low-poly Postie Bike built from code (R81, R123, br-bwju.5, rebuilt br-bwju.11): a bubbly Australian step-through
// delivery bike in the spirit of the 110 cc postie (generic: no Australia Post branding or logo), with its rider as part of the model.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs); pivots(P). P is params.json, measured off refs/lod-plus-1.png (see its `what`).
//
// Frame: metres, +Z nose, +Y up, origin on the ground between the axles; +X is the bike's LEFT. Parts (the bike part set of
// jj.vehicle.v1): core (leg shield, floor and pads, body, seat, engine, twin mufflers, shocks, head tube, handlebars, mirrors),
// front (fork, headlamp, front mudguard, front carrier with its mail tub and parcels), back (rear grab rail, the two postal-red
// panniers with parcels, tail block and lamp, rear mudguard), rider, wheel_F, wheel_R.
import { swatchUV } from './atlas.js';
import { Soup, exportsFor } from '../_kit/bike.js';

export const LODS = {
  // n: tyre sides (24 = lugged, hollow, spoked); pann/bask: parcels per pannier / in the basket (the highest one stays at every
  // LOD: the back's and front's top edge is their hinge line); the rest drop out down the ladder
  0: { n: 24, hollow: true, spokes: 4, hub: 8, rail: 2, cavity: true, pann: 4, bask: 3, mirrors: 2, bow: true, rider: 2, visor: true, basketBars: 2, flick: true, forkSleeve: true, header: true, shocks: 2, rimRing: true, lampRim: true, lampN: 8, fenderSeg: 6, strap: true, bands: true, pads: true, grips: true, tailLens: true, bars: 2, mufN: 8, crown: true, stem: true, mirN: 8 },
  1: { n: 12, hollow: false, spokes: 0, hub: 6, rail: 1, cavity: false, pann: 2, bask: 1, mirrors: 1, bow: false, rider: 1, visor: false, basketBars: 1, flick: false, forkSleeve: false, header: false, shocks: 0, rimRing: false, lampRim: false, lampN: 6, fenderSeg: 2, strap: false, bands: true, pads: false, grips: true, tailLens: false, bars: 1, mufN: 6, crown: false, stem: false, mirN: 6 },
  2: { n: 12, hollow: false, spokes: 0, hub: 0, rail: 0, cavity: false, pann: 1, bask: 1, mirrors: 0, bow: false, rider: 0, visor: false, basketBars: 0, flick: false, forkSleeve: false, header: false, shocks: 0, rimRing: false, lampRim: false, lampN: 6, lampOne: true, fenderSeg: 1, strap: false, bands: false, pads: false, grips: false, tailLens: false, bars: 1, mufN: 6, crown: false, stem: false, mirN: 6 },
};

const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (ps) => ps[0].map((_, k) => ps.reduce((t, p) => t + p[k], 0) / ps.length);
const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

/** A quad whose normal faces `hint` (a direction), whatever order the corners came in. */
function qd(S, hint, a, b, c, d, sw) { if (dot(cross(sub(b, a), sub(c, a)), hint) < 0) S.quad(a, d, c, b, sw); else S.quad(a, b, c, d, sw); }
/** A convex hexahedron from 8 corners indexed ix + 2 iz + 4 iy (iy 0 = bottom): every face points away from the centre. */
function hexa(S, p, sw) {
  const f = (k) => (typeof sw === 'string' ? sw : sw[k] ?? sw.all), c = mean(p);
  const q = (i, j, k, l, key) => { const a = p[i], b = p[j], cc = p[k], d = p[l]; qd(S, sub(mean([a, b, cc, d]), c), a, b, cc, d, f(key)); };
  q(0, 1, 3, 2, 'ny'); q(4, 5, 7, 6, 'py'); q(0, 2, 6, 4, 'nx'); q(1, 3, 7, 5, 'px'); q(0, 1, 5, 4, 'nz'); q(2, 3, 7, 6, 'pz');
}
const mk = (f) => Array.from({ length: 8 }, (_, i) => f(i & 1, (i >> 2) & 1, (i >> 1) & 1)); // f(ix, iy, iz) → [x, y, z]
/** A box from rectangles at the bottom (x0..x1, z0..z1 at y0) and the top (tx0..tx1, tz0..tz1 at y1). */
function tbox(S, r, sw) {
  const { x0, x1, z0, z1, y0, y1, tx0 = x0, tx1 = x1, tz0 = z0, tz1 = z1 } = r;
  hexa(S, mk((ix, iy, iz) => (iy ? [ix ? tx1 : tx0, y1, iz ? tz1 : tz0] : [ix ? x1 : x0, y0, iz ? z1 : z0])), sw);
}
/** Plan-tapered block: rear (z0) and front (z1) half-widths at the bottom (b) and top (t). */
function frustum(S, { z0, z1, y0, y1, hw0b, hw1b, hw0t = hw0b, hw1t = hw1b }, sw) {
  hexa(S, mk((ix, iy, iz) => { const hw = iz ? (iy ? hw1t : hw1b) : (iy ? hw0t : hw0b); return [ix ? hw : -hw, iy ? y1 : y0, iz ? z1 : z0]; }), sw);
}
/** A parcel: a cream box with a tape strip over the top and a small label mark; `rot` turns it about y. */
function parcel(S, c, s, ry, lvl) {
  S.box(c, s, { all: 'parcel', py: 'tape' }, [0, ry, 0]);
  if (lvl < 1) return;
  const ca = Math.cos(ry), sa = Math.sin(ry), top = c[1] + s[1] / 2 + 0.004, R = (x, z) => [c[0] + x * ca + z * sa, top, c[2] - x * sa + z * ca];
  const w = s[0] * 0.14, hx = s[0] / 2, hz = s[2] / 2;
  S.quad(R(-w, -hz), R(-w, hz), R(w, hz), R(w, -hz), 'tape');
  S.quad(R(-hx * 0.55, -hz * 0.1), R(-hx * 0.55, hz * 0.4), R(-hx * 0.1, hz * 0.4), R(-hx * 0.1, -hz * 0.1), 'ink');
}
/** A shell over a wheel: an arc about the hub (z, y), angles in degrees from straight up, positive toward +z, `hw` half width. */
function arcShell(S, hub, R, th, a0, a1, n, hw, sw, under) {
  const pt = (t, r, x) => [x, hub[1] + Math.cos(t * D2R) * r, hub[0] + Math.sin(t * D2R) * r];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n, tm = (t0 + t1) / 2, rad = [0, Math.cos(tm * D2R), Math.sin(tm * D2R)];
    qd(S, rad, pt(t0, R, -hw), pt(t0, R, hw), pt(t1, R, hw), pt(t1, R, -hw), sw);
    qd(S, rad.map((v) => -v), pt(t0, R - th, -hw), pt(t0, R - th, hw), pt(t1, R - th, hw), pt(t1, R - th, -hw), under);
    for (const s of [-1, 1]) qd(S, [s, 0, 0], pt(t0, R, s * hw), pt(t1, R, s * hw), pt(t1, R - th, s * hw), pt(t0, R - th, s * hw), sw);
  }
  for (const [t, k] of [[a0, 1], [a1, -1]]) { const tg = [0, -Math.sin(t * D2R) * k, Math.cos(t * D2R) * k]; qd(S, tg, pt(t, R, -hw), pt(t, R, hw), pt(t, R - th, hw), pt(t, R - th, -hw), sw); }
}
/** An octagon-ish disc about the z axis (mirror heads, lamps, tail lens): centre c, radius r, from z0 to z1. */
const discZ = (S, c, r, z0, z1, n, side, cap) => S.prism([c[0], c[1], z0], [c[0], c[1], z1], r, n, side, cap, Math.PI / n);

/** One wheel about the x axis: lugged tyre (alternating radius), open spoked wheel at LOD0, flat-sided tyre below. */
function wheel(S, z, R, W, T) {
  const hw = W / 2, n = T.n;
  if (T.hollow) {
    // vertex k at angle 2πk/n from +z; even k on the full radius (the bottom, k = 3n/4, stays on the ground), odd k are the grooves
    const ring = (x, r, k, g = 0) => { const a = (2 * Math.PI * k) / n, rr = r * (g && k % 2 ? 0.95 : 1); return [x, R + Math.sin(a) * rr, z + Math.cos(a) * rr]; };
    const ri = R * 0.64, rs = R * 0.86;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n, am = (2 * Math.PI * (k + 0.5)) / n, rad = [0, Math.sin(am), Math.cos(am)];
      qd(S, rad, ring(-hw, R, k, 1), ring(hw, R, k, 1), ring(hw, R, j, 1), ring(-hw, R, j, 1), 'tyre'); // tread
      for (const s of [-1, 1]) {
        qd(S, [s, 0, 0], ring(s * hw, R, k, 1), ring(s * hw, R, j, 1), ring(s * hw * 0.8, rs, j), ring(s * hw * 0.8, rs, k), 'tyre'); // shoulder
        qd(S, [s, 0, 0], ring(s * hw * 0.8, rs, k), ring(s * hw * 0.8, rs, j), ring(s * hw * 0.55, ri, j), ring(s * hw * 0.55, ri, k), 'tyre'); // sidewall
      }
    }
    if (T.rimRing) for (let k = 0; k < n; k += 1) { const j = (k + 1) % n; for (const s of [-1, 1]) qd(S, [s, 0, 0], ring(s * hw * 0.55, ri, k), ring(s * hw * 0.55, ri, j), ring(s * hw * 0.5, ri * 0.93, j), ring(s * hw * 0.5, ri * 0.93, k), 'rim'); }
    for (let i = 0; i < T.spokes; i++) {
      const a = (i / T.spokes) * Math.PI, d = [Math.cos(a), Math.sin(a)];
      S.limb([0, R + d[1] * ri * 0.97, z + d[0] * ri * 0.97], [0, R - d[1] * ri * 0.97, z - d[0] * ri * 0.97], W * 0.5, 0.035, 'spokes');
    }
  } else {
    const Rc = R / Math.cos(Math.PI / n);
    S.prism([-hw, R, z], [hw, R, z], Rc, n, 'tyre', 'tyre', Math.PI / n);
  }
  if (T.hub) S.prism([-hw - 0.025, R, z], [hw + 0.025, R, z], R * 0.2, T.hub, 'hub', 'hub');
}

/** The helmet: a faceted ellipsoid, white with its lowest ring grey. */
function helmetBlob(S, c, r, seg, rings) {
  const pt = (i, k) => { const ph = (Math.PI * k) / rings, th = (2 * Math.PI * i) / seg; return [c[0] + r[0] * Math.sin(ph) * Math.cos(th), c[1] + r[1] * Math.cos(ph), c[2] + r[2] * Math.sin(ph) * Math.sin(th)]; };
  for (let k = 0; k < rings; k++) for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg, sw = k >= rings - 2 ? 'helmet2' : 'helmet';
    if (k === 0) S.tri(pt(i, 0), pt(j, 1), pt(i, 1), sw); else if (k === rings - 1) S.tri(pt(i, k), pt(j, k), pt(i, k + 1), sw); else S.quad(pt(i, k), pt(j, k), pt(j, k + 1), pt(i, k + 1), sw);
  }
}

function makeSoups(P, lod) {
  const T = LODS[lod], soups = {}, S = (id) => (soups[id] ??= new Soup(swatchUV));
  const C = S('core'), F = S('front'), B = S('back'), RD = S('rider');
  const { floor: fl, shield: sh, body: bd, seat: st, bars: br, head: hd, pannier: pn, basket: bk, rail: rl, tail: tl } = P;

  // ───────────────────────── core ─────────────────────────
  // floor: a chunky wedge in body paint, dark underneath, with rubber foot pads (LOD0) the boots stand on
  tbox(C, { x0: -fl.hw, x1: fl.hw, z0: fl.z1, z1: fl.z0, y0: fl.y0, y1: fl.y1, tz1: fl.z0 - 0.03 }, { all: 'paint', ny: 'under' });
  if (T.pads) for (const s of [1, -1]) C.box([s * 0.31, fl.y1 + 0.03, 0.0], [0.2, 0.06, 0.3], 'frame');
  // leg shield: a bent slab (headstock, down, kink, floor), the front bowed in three facets at LOD0
  { const L = [{ f: sh.A, b: sh.A2, hw: sh.hwA }, { f: sh.B, b: sh.B2, hw: sh.hwB }, { f: sh.C, b: sh.C2, hw: sh.hwC }];
    const X = (p, x, bow = 0) => [x, p[1], p[0] + bow];
    const xs = (hw) => (T.bow ? [-hw, -hw / 3, hw / 3, hw] : [-hw, hw]);
    const bowAt = (x, hw) => (T.bow ? 0.045 * (1 - (x / hw) ** 2) : 0);
    for (let i = 0; i < 2; i++) {
      const a = L[i], b = L[i + 1], d = [b.f[0] - a.f[0], b.f[1] - a.f[1]];
      let n = [d[1], -d[0]]; if (n[0] * (a.f[0] - a.b[0]) + n[1] * (a.f[1] - a.b[1]) < 0) n = [-n[0], -n[1]];
      const hint = [0, n[1], n[0]], xa = xs(a.hw), xb = xs(b.hw);
      for (let k = 0; k + 1 < xa.length; k++) {
        const pa = (x) => X(a.f, x, bowAt(x, a.hw)), pb = (x) => X(b.f, x, bowAt(x, b.hw));
        qd(C, hint, pa(xa[k]), pa(xa[k + 1]), pb(xb[k + 1]), pb(xb[k]), 'paint');
      }
      qd(C, [-hint[0], -hint[1], -hint[2]], X(a.b, -a.hw), X(a.b, a.hw), X(b.b, b.hw), X(b.b, -b.hw), 'paint');
      for (const s of [-1, 1]) qd(C, [s, 0, 0], X(a.f, s * a.hw), X(b.f, s * b.hw), X(b.b, s * b.hw), X(a.b, s * a.hw), 'paint');
    }
    qd(C, [0, 1, 0], X(L[0].f, -L[0].hw), X(L[0].f, L[0].hw), X(L[0].b, L[0].hw), X(L[0].b, -L[0].hw), 'paint'); }
  // body under the seat: side covers in three stations (a notch where the lower cover leans forward), dark underneath
  { const st3 = [{ y: bd.yTop, zf: bd.zTop, zr: bd.zRearTop, hw: bd.hwTop }, { y: bd.yMid, zf: bd.zMid, zr: (bd.zRearTop + bd.zRearBot) / 2, hw: (bd.hwTop + bd.hwBot) / 2 + 0.02 }, { y: bd.yBot, zf: bd.zBot, zr: bd.zRearBot, hw: bd.hwBot }];
    for (let i = 0; i < 2; i++) { const a = st3[i], b = st3[i + 1];
      tbox(C, { x0: -b.hw, x1: b.hw, z0: b.zr, z1: b.zf, y0: b.y, tx0: -a.hw, tx1: a.hw, tz0: a.zr, tz1: a.zf, y1: a.y }, { all: 'paint', ny: i ? 'under' : 'paint' }); } }
  // seat
  frustum(C, { z0: st.z1, z1: st.z0, y0: st.y0, y1: st.y1, hw0b: st.hw1 - 0.02, hw1b: st.hw0 - 0.02, hw0t: st.hw1, hw1t: st.hw0 }, 'seat');
  // engine block and crankcase, between the wheels under the body
  { const e = P.engine; tbox(C, { x0: -e.hw, x1: e.hw, z0: e.z - 0.16, z1: e.z + 0.16, y0: e.y - 0.07, y1: e.y + 0.07 }, 'engine');
    if (T.header) C.prism([-e.hw - 0.02, e.y, e.z + 0.02], [e.hw + 0.02, e.y, e.z + 0.02], 0.085, 8, 'engine', 'engine', Math.PI / 8); }
  // twin mufflers (one each side, as the sheet's top and rear views show), header pipes and hangers
  for (const s of [1, -1]) { const e = P.exhaust;
    C.prism([s * e.x, e.y, e.z0], [s * e.x, e.y, e.z1], e.r, T.mufN, 'chrome', 'chrome', Math.PI / T.mufN);
    if (T.header) discZ(C, [s * e.x, e.y], e.r * 0.55, e.z1 - 0.012, e.z1 - 0.004, 8, 'under', 'under');
    if (T.header) { C.limb([s * 0.2, e.y - 0.02, 0.16], [s * e.x, e.y, e.z0 + 0.04], 0.05, 0.05, 'chrome'); C.limb([s * e.x, e.y + 0.06, -0.78], [s * 0.2, 0.52, -0.78], 0.035, 0.035, 'frame'); }
    // rear shocks: a dark strut in a silver sleeve
    if (T.shocks) { const top = [s * 0.22, 0.86, -0.9], bot = [s * 0.25, 0.4, -1.03];
      C.limb(top, bot, 0.045, 0.045, 'frame'); if (T.shocks > 1) C.limb(top, lerp(top, bot, 0.55), 0.065, 0.065, 'chrome'); } }
  // head tube (the black cowl up the shield's front) and the stem
  { const c = P.column; C.limb([0, c.by, c.bz], [0, c.ty, c.tz], 0.11, 0.1, 'frame');
    if (T.stem) C.box([0, br.y - 0.03, br.z], [0.15, 0.09, 0.1], 'frame'); }
  // handlebars: a swept silver bar, black grips; round mirrors on stalks
  for (const s of [1, -1]) {
    const mid = [s * 0.28, br.y + 0.06, br.z - 0.05], end = [s * (br.hw - 0.13), br.y + 0.01, br.gripZ + 0.04];
    if (T.bars > 1) { C.limb([0, br.y, br.z], mid, 0.04, 0.04, 'chrome'); C.limb(mid, end, 0.04, 0.04, 'chrome'); } else C.limb([0, br.y, br.z], end, 0.045, 0.045, 'chrome');
    if (T.grips) C.limb(end, [s * br.hw, br.y, br.gripZ], 0.055, 0.055, 'frame');
    if (T.mirrors) {
      C.limb([s * 0.3, br.y + 0.03, br.z + 0.02], [s * (br.mirrorX - 0.04), br.mirrorY - 0.07, br.mirrorZ], 0.026, 0.026, 'frame');
      discZ(C, [s * br.mirrorX, br.mirrorY], 0.095, br.mirrorZ - 0.035, br.mirrorZ + 0.035, T.mirN, 'frame', 'frame');
      if (T.mirrors > 1) discZ(C, [s * br.mirrorX, br.mirrorY], 0.072, br.mirrorZ - 0.04, br.mirrorZ - 0.034, T.mirN, 'glass', 'glass');
    }
  }

  // ───────────────────────── front ─────────────────────────
  // headlamp: a black bucket, a silver rim and the lens, on the head tube
  { const r = hd.r, n = T.lampN;
    if (T.lampOne) { F.prism([0, hd.y, hd.z - hd.depth], [0, hd.y, hd.z], r, n, 'frame', 'head', Math.PI / n); } else {
    discZ(F, [0, hd.y], r, hd.z - hd.depth, hd.z - 0.03, n, 'frame', 'frame');
    if (T.lampRim) discZ(F, [0, hd.y], r * 1.07, hd.z - 0.045, hd.z - 0.016, n, 'chrome', 'chrome');
    discZ(F, [0, hd.y], r * 0.92, hd.z - 0.025, hd.z, n, 'head', 'head'); } }
  // fork: legs from the crown to the hub, silver upper sleeves
  { const fk = P.fork;
    if (T.crown) F.box([0, fk.cy - 0.02, fk.cz], [fk.x * 2 + 0.08, 0.06, 0.1], 'frame');
    for (const s of [1, -1]) { const top = [s * fk.x, fk.cy, fk.cz], hub = [s * 0.13, P.rF, P.zF], mid = lerp(top, hub, 0.45);
      if (T.forkSleeve) { F.limb(top, mid, 0.07, 0.07, 'chrome'); F.limb(mid, hub, 0.06, 0.06, 'frame'); } else F.limb(top, hub, 0.065, 0.065, 'frame'); } }
  // front mudguard: a faceted arc, wider behind the fork
  { const g = P.fenderF; arcShell(F, [P.zF, P.rF], P.rF + g.lift, 0.12, g.a0, g.a1, T.fenderSeg, g.hw, 'paint', 'under'); }
  // carrier: the postal-red mail tub in a silver wire frame, parcels on top
  { const cz = (bk.z0 + bk.z1) / 2, hw = bk.hw;
    if (T.basketBars > 1) for (const s of [1, -1]) F.limb([s * P.fork.x, P.fork.cy, P.fork.cz - 0.02], [s * (hw - 0.07), bk.yB, bk.z0 + 0.03], 0.03, 0.03, 'chrome'); // stays to the fork crown
    else F.limb([0, P.fork.cy, P.fork.cz - 0.02], [0, bk.yB, bk.z0 + 0.03], 0.05, 0.05, 'frame'); // one stay
    tbox(F, { x0: -hw + 0.07, x1: hw - 0.07, z0: bk.z0 + 0.07, z1: bk.z1 - 0.07, y0: bk.yB + 0.03, tx0: -hw + 0.03, tx1: hw - 0.03, tz0: bk.z0 + 0.03, tz1: bk.z1 - 0.03, y1: bk.yT + 0.02 }, { all: 'postred', py: T.cavity ? 'cavity' : 'postred2' });
    if (T.cavity) { // the rim: a lighter lip round the open top
      const y0 = bk.yT, y1 = bk.yT + 0.035, w = 0.04, x0 = -hw + 0.03, x1 = hw - 0.03, z0 = bk.z0 + 0.03, z1 = bk.z1 - 0.03;
      F.box([0, (y0 + y1) / 2, z0 + w / 2], [x1 - x0, y1 - y0, w], 'postred2'); F.box([0, (y0 + y1) / 2, z1 - w / 2], [x1 - x0, y1 - y0, w], 'postred2');
      for (const s of [1, -1]) F.box([s * (x1 - w / 2), (y0 + y1) / 2, cz], [w, y1 - y0, z1 - z0 - 2 * w], 'postred2'); }
    if (T.basketBars === 2) {
      const r = 0.024, yb = bk.yB, yt = bk.yT + 0.01;
      for (const s of [1, -1]) { F.limb([s * hw, yb, bk.z0], [s * hw, yb, bk.z1], r * 2, r * 2, 'chrome'); F.limb([s * hw, yt, bk.z0], [s * hw, yt, bk.z1], r * 2, r * 2, 'chrome'); }
      F.limb([-hw, yb, bk.z1], [hw, yb, bk.z1], r * 2, r * 2, 'chrome'); F.limb([-hw, yt, bk.z1], [hw, yt, bk.z1], r * 2, r * 2, 'chrome');
      F.limb([-hw, yt, bk.z0], [hw, yt, bk.z0], r * 2, r * 2, 'chrome'); F.limb([-hw, yb, bk.z0], [hw, yb, bk.z0], r * 2, r * 2, 'chrome');
      for (const s of [1, -1]) for (const z of [bk.z0, bk.z1]) F.limb([s * hw, yb, z], [s * hw, yt, z], r * 2, r * 2, 'chrome');
    } else if (T.basketBars === 1) {
      const r = 0.026, yt = bk.yT + 0.01;
      for (const s of [1, -1]) F.limb([s * hw, yt, bk.z0], [s * hw, yt, bk.z1], r * 2, r * 2, 'chrome');
      F.limb([-hw, yt, bk.z1], [hw, yt, bk.z1], r * 2, r * 2, 'chrome'); F.limb([-hw, yt, bk.z0], [hw, yt, bk.z0], r * 2, r * 2, 'chrome');
    }
    const top = bk.yT + 0.19, ph = 0.2; // the highest parcel edge is the front's hinge line at every LOD
    const set = [[-0.1, cz + 0.02, 0.2, 0.2, 0.12], [0.1, cz - 0.07, 0.18, 0.18, -0.2], [0.06, cz + 0.13, 0.18, 0.16, 0.25]];
    for (let i = 0; i < T.bask; i++) { const [x, z, sx, sz, ry] = set[i]; parcel(F, [x, top - ph / 2, z], [sx, ph, sz], ry, T.rider > 1 ? 1 : 0); } }

  // ───────────────────────── back ─────────────────────────
  // rear grab rail: a rounded loop round the tail, silver; a bar at LOD1
  { const y = rl.y, hw = rl.hw, z0 = rl.z0, z1 = rl.z1, k = 0.12, r = 0.032;
    if (T.rail >= 2) {
      const path = [[hw, z0], [hw, z1 + k], [hw - 0.05, z1 + 0.04], [hw - k, z1], [0, z1], [-(hw - k), z1], [-(hw - 0.05), z1 + 0.04], [-hw, z1 + k], [-hw, z0]];
      for (let i = 0; i + 1 < path.length; i++) B.limb([path[i][0], y, path[i][1]], [path[i + 1][0], y, path[i + 1][1]], r, r, 'chrome');
    } else if (T.rail === 1) {
      for (const s of [1, -1]) B.limb([s * hw, y, z0], [s * hw, y, z1], 0.04, 0.04, 'chrome');
    } else for (const s of [1, -1]) B.limb([s * hw, y, z0], [s * hw, y, z0 - 0.5], 0.05, 0.05, 'chrome'); }
  // panniers: postal-red boxes with a lighter lid ring (open top at LOD0), parcels standing out of them
  for (const s of [1, -1]) {
    const xa = Math.min(s * pn.xin, s * pn.xout), xb = Math.max(s * pn.xin, s * pn.xout), cx = (xa + xb) / 2, w = xb - xa, L = pn.z0 - pn.z1, cz = (pn.z0 + pn.z1) / 2;
    const yl = pn.y1 - 0.12, wall = 0.065, ph = P.parcels.h, top = pn.y1 + ph; // parcels' top edge is the back's hinge line at every LOD
    tbox(B, { x0: xa + 0.015, x1: xb - 0.015, z0: pn.z1 + 0.015, z1: pn.z0 - 0.015, y0: pn.y0, tx0: xa, tx1: xb, tz0: pn.z1, tz1: pn.z0, y1: yl }, { all: 'postred', ny: 'under' });
    if (T.cavity) {
      const yc = (yl + pn.y1) / 2, hg = pn.y1 - yl;
      B.box([cx, yc, pn.z0 - wall / 2], [w, hg, wall], 'postred2'); B.box([cx, yc, pn.z1 + wall / 2], [w, hg, wall], 'postred2');
      B.box([xa + wall / 2, yc, cz], [wall, hg, L - 2 * wall], 'postred2'); B.box([xb - wall / 2, yc, cz], [wall, hg, L - 2 * wall], 'postred2');
      qd(B, [0, 1, 0], [xa + wall, yl + 0.004, pn.z1 + wall], [xa + wall, yl + 0.004, pn.z0 - wall], [xb - wall, yl + 0.004, pn.z0 - wall], [xb - wall, yl + 0.004, pn.z1 + wall], 'cavity');
    } else tbox(B, { x0: xa, x1: xb, z0: pn.z1, z1: pn.z0, y0: yl, y1: pn.y1 }, { all: 'postred2', ny: 'postred' });
    const spots = [[0.2, 0.21, 0.2, 0.2, 0.2], [0.6, 0.19, 0.17, 0.18, -0.3], [0.38, 0.48, 0.17, 0.17, 0.5], [0.8, 0.39, 0.16, 0.16, -0.1]]; // z along the box (0..1 from the front), x across (0..1 from the inner wall)
    const order = T.pann >= 4 ? [0, 1, 2, 3] : T.pann === 2 ? [0, 1] : [0];
    for (const i of order) {
      const [fz, fx, sx, sz, ry] = spots[i], h = T.cavity ? ph + 0.11 : ph, x = s * (pn.xin + (pn.xout - pn.xin) * (0.15 + 0.7 * fx)), z = pn.z0 - 0.1 - fz * (L - 0.2);
      parcel(B, [x, top - h / 2, z], [sx, h, sz], ry * s, T.rider > 1 ? 1 : 0);
    }
    if (T.rail > 1) B.limb([s * 0.2, rl.y, cz], [s * pn.xin, pn.y1 - 0.2, cz], 0.03, 0.03, 'chrome'); // arm from the rail
  }
  // tail block: body paint, a brake-lamp cap, the hex tail lens and the dark number-plate bracket
  tbox(B, { x0: -tl.hw, x1: tl.hw, z0: tl.z1, z1: tl.z0, y0: tl.y0, y1: tl.y1, tx0: -tl.hw + 0.03, tx1: tl.hw - 0.03, tz0: tl.z1 + 0.02, tz1: tl.z0 }, 'paint');
  tbox(B, { x0: -tl.hw + 0.04, x1: tl.hw - 0.04, z0: tl.z1 + 0.04, z1: tl.z0 - 0.02, y0: tl.y1 - 0.02, y1: tl.y1 + 0.09, tz0: tl.z1 + 0.06, tz1: tl.z0 - 0.06 }, { all: 'tail', ny: 'tail' });
  if (T.tailLens) { discZ(B, [0, tl.y0 + 0.18], 0.085, tl.z1 - 0.012, tl.z1 + 0.012, 6, 'tail', 'tail'); }
  if (T.tailLens) tbox(B, { x0: -0.1, x1: 0.1, z0: tl.z1 - 0.2, z1: tl.z1 - 0.1, y0: 0.36, y1: 0.54, tz0: tl.z1 - 0.01, tz1: tl.z1 + 0.06 }, 'frame');
  // rear mudguard: an arc over the rear tyre (hidden by the pannier at the top) with the flicked tail
  { const g = P.fenderR; arcShell(B, [P.zR, P.rR], P.rR + g.lift, 0.12, g.a0, g.a1, T.fenderSeg, g.hw, 'paint', 'under');
    if (T.flick) { const q = (z, y, x) => [x, y, z]; qd(B, [0, 1, -0.5], q(-1.4, 0.64, -0.13), q(-1.4, 0.64, 0.13), q(-1.66, 0.44, 0.13), q(-1.66, 0.44, -0.13), 'paint');
      qd(B, [0, -1, 0.5], q(-1.4, 0.6, -0.13), q(-1.4, 0.6, 0.13), q(-1.66, 0.4, 0.13), q(-1.66, 0.4, -0.13), 'under');
      for (const s of [-1, 1]) qd(B, [s, 0, 0], q(-1.4, 0.64, s * 0.13), q(-1.66, 0.44, s * 0.13), q(-1.66, 0.4, s * 0.13), q(-1.4, 0.6, s * 0.13), 'paint'); } }

  // ───────────────────────── rider ─────────────────────────
  { const J = P.rider, to = J.torso, hr = J.headR, hc = J.head, lvl = T.rider;
    // torso: the hi-vis vest, narrower at the waist, with its reflective bands
    tbox(RD, { x0: -to.hw + 0.02, x1: to.hw - 0.02, z0: to.z1 + 0.01, z1: to.z0 - 0.01, y0: to.y0, tx0: -to.hw, tx1: to.hw, tz0: to.z1, tz1: to.z0, y1: to.y1 }, 'vest');
    if (T.bands) { const y0 = to.y0 + 0.07, y1 = y0 + 0.05, w = to.hw + 0.006, zf = to.z0 + 0.006, zb = to.z1 - 0.006;
      tbox(RD, { x0: -w, x1: w, z0: zb, z1: zf, y0, y1 }, 'band');
      if (lvl >= 2) for (const s of [-1, 1]) for (const x of [s * 0.12, s * 0.22]) { // vertical stripes front and back
        const a = Math.abs(x) < 0.15 ? 0.045 : 0.035;
        qd(RD, [0, 0, 1], [x - a / 2, y1, zf + 0.004], [x + a / 2, y1, zf + 0.004], [x + a / 2, to.y1 - 0.02, zf + 0.004], [x - a / 2, to.y1 - 0.02, zf + 0.004], 'band');
        qd(RD, [0, 0, -1], [x - a / 2, y1, zb - 0.004], [x + a / 2, y1, zb - 0.004], [x + a / 2, to.y1 - 0.02, zb - 0.004], [x - a / 2, to.y1 - 0.02, zb - 0.004], 'band'); } }
    if (lvl >= 2) RD.box([0, to.y1 + 0.02, (to.z0 + to.z1) / 2], [0.3, 0.08, 0.2], 'shirt'); // collar
    for (const s of [1, -1]) {
      const sh0 = [s * to.hw, J.shoulder[1] - 0.02, J.shoulder[2]], el = [s * J.elbow[0], J.elbow[1], J.elbow[2]], ha = [s * J.hand[0], J.hand[1], J.hand[2]];
      const hip = [s * 0.13, J.hip[1], J.hip[2]], kn = [s * J.knee[0], J.knee[1], J.knee[2]], ft = [s * J.foot[0], J.foot[1], J.foot[2]];
      if (lvl >= 2) {
        RD.limb(sh0, el, 0.15, 0.15, 'shirt'); // a puffy sleeve
        RD.limb(lerp(el, ha, 0.15), ha, 0.085, 0.085, 'skin');
      }
      if (lvl >= 1) {
        RD.limb(hip, kn, 0.19, 0.19, 'pants'); // navy shorts to the knee, a bare shin
        RD.limb(kn, [ft[0], ft[1] + 0.2, ft[2] + 0.02], 0.1, 0.1, 'skin');
      } else RD.limb(hip, [ft[0], ft[1] + 0.2, ft[2]], 0.14, 0.14, 'pants');
      if (lvl < 2) RD.limb(sh0, ha, 0.11, 0.11, 'shirt');
      if (lvl >= 2) {
        RD.box([ha[0] + s * 0.02, ha[1] - 0.005, ha[2] + 0.01], [0.1, 0.085, 0.11], 'frame'); // glove on the grip
        RD.box([ft[0], ft[1] + 0.15, ft[2] - 0.03], [0.13, 0.2, 0.17], 'boots'); // tall boot on the pad
        RD.box([ft[0], ft[1] + 0.045, ft[2]], [0.13, 0.09, 0.27], 'boots');
      } else RD.box([ft[0], ft[1] + 0.1, ft[2]], [0.13, 0.2, 0.26], 'boots');
    }
    if (lvl >= 2) RD.box([0, to.y1 + 0.07, hc[2] + 0.02], [0.11, 0.1, 0.11], 'skin'); // neck
    // helmet: a faceted dome, grey in its lowest ring; a face behind a clear visor
    helmetBlob(RD, hc, [hr * 0.98, hr * 0.93, hr * 1.03], lvl >= 2 ? 10 : lvl === 1 ? 8 : 6, lvl >= 2 ? 6 : 4);
    if (T.strap) RD.prism([0, hc[1] - hr * 0.95, hc[2]], [0, hc[1] - hr * 0.8, hc[2]], hr * 0.86, 8, 'frame', 'frame', Math.PI / 8); // the helmet's dark lower rim
    const fz = hc[2] + hr * 1.03 + 0.005, fy = hc[1] - hr * 0.1;
    if (lvl >= 1) RD.box([0, fy, fz - 0.03], [hr * 0.62, hr * 0.62, 0.06], 'skin'); // blank face
    if (T.visor) { const vz = fz + 0.035, w = hr * 0.74, h = hr * 0.78, t = 0.02;
      RD.box([0, fy + h / 2 - t / 2, vz], [w * 2, t, 0.026], 'visor'); RD.box([0, fy - h / 2 + t / 2, vz], [w * 2, t, 0.026], 'visor');
      for (const s of [1, -1]) RD.box([s * (w - t / 2), fy, vz], [t, h, 0.026], 'visor'); }
    else if (lvl >= 1) RD.box([0, fy, fz + 0.01], [hr * 1.3, hr * 0.74, 0.03], 'visor');
  }

  // ───────────────────────── wheels ─────────────────────────
  wheel(S('wheel_F'), P.zF, P.rF, P.tyreW, T);
  wheel(S('wheel_R'), P.zR, P.rR, P.tyreW + 0.01, T);
  return { soups };
}

export const { pivots, soups, build } = exportsFor('postie-bike', makeSoups);
