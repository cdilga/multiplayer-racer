// model.js: the low-poly Pig Catcher built from code (R81, R123, br-bwju.5, rebuilt br-bwju.11): a bubbly Australian outback enduro
// bike in the spirit of the DR-Z400E (generic: no Suzuki branding), with its rider standing on the pegs as part of the model.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs); pivots(P). P is params.json, measured off refs/lod-plus-1.png and fitted with tools/vehicles/fit.
//
// Frame: metres, +Z nose, +Y up, origin on the ground between the axles; +X is the bike's LEFT; the exhaust is tucked up on
// the right (−X). Parts (the bike part set of jj.vehicle.v1): core (frame, engine, tank, radiator shrouds, seat, rear side
// panels, swingarm, chain, silencer, pegs, bars and hand guards), front (forks, the high beaked mudguard, the number-plate
// shroud and its headlamp, the crash bar with two spotlights), back (rear mudguard, tail lamp, the rack with a coiled rope
// and a hessian sack), rider, wheel_F, wheel_R (knobbly tyres on spoked rims; discs and sprocket).
// Decoration the colliders skip (Soup.decor): hand guards, levers, spokes, lugs, lamps' lenses.
import * as THREE from 'three';
import { swatchUV } from './atlas.js';
import { Soup, exportsFor } from '../_kit/bike.js';

// n: tyre facets (a multiple of 4), lug: tread blocks, rim: rim-ring facets, spokes: wire diameters; detail 0..2 gates the small parts.
export const LODS = {
  0: { n: 16, lug: 16, rim: 12, spokes: 6, rider: 2, detail: 2, sackSeg: [8, 5], ropeSeg: 12, spotSeg: 8 },
  1: { n: 8, lug: 0, rim: 8, spokes: 4, rider: 1, detail: 1, sackSeg: [6, 3], ropeSeg: 8, spotSeg: 6 },
  2: { n: 8, lug: 0, rim: 6, spokes: 3, rider: 0, detail: 0, sackSeg: [5, 3], ropeSeg: 3, spotSeg: 4 },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const avg = (pts) => [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k], 0) / pts.length);
/** A convex polygon wound so its normal points along `out`. */
function face(S, pts, sw, out) {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  const P = dot(n, out) >= 0 ? pts : pts.slice().reverse();
  for (let i = 1; i < P.length - 1; i++) S.tri(P[0], P[i], P[i + 1], sw);
}
/** A hexagonal cross-section [x, y]: top width wt at yt, middle wm at ym, bottom wb at yb (half-widths). */
const hex = (wt, yt, wm, ym, wb, yb) => [[-wt, yt], [wt, yt], [wm, ym], [wb, yb], [-wb, yb], [-wm, ym]];
/** A closed loft through cross-sections: st = [{ z, ring }], sw a swatch or one per ring edge; capped at both ends. */
function loft(S, st, sw, caps = true) {
  const p3 = (r, z) => r.map(([x, y]) => [x, y, z]);
  for (let i = 0; i + 1 < st.length; i++) {
    const A = p3(st[i].ring, st[i].z), B = p3(st[i + 1].ring, st[i + 1].z), c = avg([...A, ...B]), n = A.length;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n, q = [A[j], A[k], B[k], B[j]];
      face(S, q, typeof sw === 'string' ? sw : sw[j], sub(avg(q), c));
    }
  }
  if (caps) {
    const f = st[0], l = st.at(-1), s0 = typeof sw === 'string' ? sw : sw[0];
    if(caps!=='front')face(S, p3(f.ring, f.z), s0, [0, 0, f.z - st[1].z]);
    if(caps!=='back')face(S, p3(l.ring, l.z), s0, [0, 0, l.z - st.at(-2).z]);
  }
}
/** A thin plate: the convex polygon `pts` ([x, y, z]) and a copy offset by `off`, with edge quads. */
function plate(S, pts, off, sw, swEdge = sw) {
  const q = pts.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]), c = avg([...pts, ...q]);
  face(S, pts, sw, [-off[0], -off[1], -off[2]]);
  face(S, q, sw, off);
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length, e = [pts[i], pts[j], q[j], q[i]]; face(S, e, swEdge, sub(avg(e), c)); }
}

function wheel(S, z, R, W, T, look, extra) {
  const n = T.n, lh = T.lug ? 0.035 : 0, Rt = R - lh, Rc = Rt / Math.cos(Math.PI / n), hw = W / 2;
  // The reference has daylight between real spokes. A capped cylinder hid the entire wheel opening.
  const inner = Rt * 0.62, rings = [-hw, hw].map(x => Array.from({length:n}, (_, i) => {
    const a = Math.PI / n + i * Math.PI * 2 / n;
    return [[x, R + Math.cos(a) * Rc, z + Math.sin(a) * Rc], [x, R + Math.cos(a) * inner, z + Math.sin(a) * inner]];
  }));
  for (let i=0;i<n;i++) { const j=(i+1)%n, a=rings[0],b=rings[1];
    face(S,[a[i][0],a[j][0],b[j][0],b[i][0]],look.tyre,sub(avg([a[i][0],a[j][0],b[j][0],b[i][0]]),[0,R,z]));
    if (T.detail >= 2) face(S,[a[i][1],b[i][1],b[j][1],a[j][1]],look.tyre,sub([0,R,z],avg([a[i][1],b[i][1],b[j][1],a[j][1]])));
    for (const [ring,s] of [[a,-1],[b,1]]) face(S,[ring[i][0],ring[i][1],ring[j][1],ring[j][0]],look.tyre,[s,0,0]);
  }
  if (T.lug) for (let k = 0; k < T.lug; k++) {
    const th = (k / T.lug) * Math.PI * 2, r = Rt + lh / 2 - 0.004;
    S.box([0, R + Math.cos(th) * r, z + Math.sin(th) * r], [hw * 1.7, lh, 0.06], look.tyre, [th, 0, 0]);
  }
  if (T.rim && T.detail >= 2) {
    const a = Rt * 0.62, b = Rt * 0.74;
    for (const s of [1, -1]) {
      const x = s * (hw + 0.003), ra = [], rb = [];
      for (let i = 0; i < T.rim; i++) { const t = (i / T.rim) * Math.PI * 2; ra.push([x, R + Math.cos(t) * a, z + Math.sin(t) * a]); rb.push([x, R + Math.cos(t) * b, z + Math.sin(t) * b]); }
      for (let i = 0; i < T.rim; i++) { const j = (i + 1) % T.rim; face(S, [ra[i], ra[j], rb[j], rb[i]], look.rim, [s, 0, 0]); }
    }
    S.decor(() => {
      for (let i = 0; i < T.spokes; i++) {
        const t = (i / T.spokes) * Math.PI, o = (i % 2 ? 1 : -1) * (hw + 0.008);
        S.limb([o, R + Math.cos(t) * a, z + Math.sin(t) * a], [o, R - Math.cos(t) * a, z - Math.sin(t) * a], 0.01, 0.02, look.spokes);
      }
    });
  }
  if (T.detail < 2) for(let i=0;i<T.spokes;i++) { const a=i*Math.PI/T.spokes, r=inner, d=.009;
    const p=[R+Math.cos(a)*r,z+Math.sin(a)*r],q=[R-Math.cos(a)*r,z-Math.sin(a)*r],dy=-Math.sin(a)*d,dz=Math.cos(a)*d;
    for(const side of [-1,1]) { const x=side*(hw+.002);face(S,[[x,p[0]+dy,p[1]+dz],[x,q[0]+dy,q[1]+dz],[x,q[0]-dy,q[1]-dz],[x,p[0]-dy,p[1]-dz]],look.spokes,[side,0,0]); }
  }
  if (T.detail) S.prism([-hw - 0.025, R, z], [hw + 0.025, R, z], R * 0.17, T.detail >= 2 ? 6 : 4, look.hub, look.hub);
  if (extra) extra(S);
}

function makeSoups(P, lod) {
  const T = LODS[lod], D = T.detail, soups = {}, S = (id) => (soups[id] ??= new Soup(swatchUV));
  const C = S('core'), F = S('front'), B = S('back');
  if(lod>0) for(const target of [C,F,B,S('rider')]) {
    const limb=target.limb.bind(target);
    target.limb=(...args)=>{const start=target.p.length;limb(...args);target.p.splice(start+72);target.uv.splice((start/3)*2+48);};
  }
  const e = P.engine, fw = P.frame.w, head = [0, P.fork.top[1] - 0.04, P.fork.top[0] - 0.04];

  // ── core ──
  // frame: down tube, top rail, a cradle under the engine and a subframe to the tail
  C.limb(head, [0, e.y - e.s[1] / 2 + 0.06, e.z + e.s[2] / 2], fw, fw, 'frame');
  C.limb(head, [0, P.seat.y - 0.06, P.sidePanel.z1 + 0.1], fw, fw, 'frame');
  if (D >= 2) C.limb([0, e.y - e.s[1] / 2 + 0.02, e.z + e.s[2] / 2], [0, P.swingarm.y0, P.swingarm.z0], fw, fw, 'frame');
  if (D >= 2) for (const s of [1, -1]) C.limb([s * 0.1, P.seat.y - 0.12, P.sidePanel.z0], [s * 0.1, P.swingarm.y0 + 0.06, P.swingarm.z0], 0.04, 0.04, 'frame');
  // engine: crank cases, clutch cover, cylinder head, skid plate, header pipe
  // The crankcase is a round casting below a narrow tilted cylinder, leaving daylight
  // around the down tube and the rider's shins. The previous full-height box erased it.
  C.prism([-e.s[0]/2,e.y-.01,e.z-.04],[e.s[0]/2,e.y-.01,e.z-.04],.17,D>=2?10:D?6:4,'engine','engine',Math.PI/10);
  C.limb([0,e.y+.01,e.z+.04],[0,e.y+.24,e.z+.14],.19,.19,'engine');
  if (D >= 2) {
    C.box([0,e.y+.235,e.z+.14],[.23,.09,.21],'hub',[.22,0,0]);
    C.box([0, e.y - e.s[1] / 2 - 0.02, e.z - 0.04], [0.16, 0.04, 0.62], 'under');
  }
  if (D >= 2) for (const s of [1, -1]) C.prism([s * (e.s[0] / 2), e.y -.01, e.z - 0.04], [s * (e.s[0] / 2 + 0.025), e.y -.01, e.z - 0.04], 0.105, 8, 'hub', 'hub');
  { const x = P.exhaust; // header from the cylinder head round to the silencer, silencer with a silver wrap and tip
    if(D>=2) {
      const path=[[-.17,e.y+.24,e.z+.14],[-.19,e.y+.12,e.z+.32],[-.19,e.y-.17,e.z+.28],[-.17,e.y-.24,e.z+.05],[-.15,e.y-.16,e.z-.27],[x.x,x.y0-.03,x.z0+.04]];
      for(let i=0;i<path.length-1;i++)C.prism(path[i],path[i+1],.027,6,'chrome');
    } else if(D)C.limb([x.x*.9,e.y+.1,e.z+e.s[2]/2+.03],[x.x,x.y0-.03,x.z0+.04],.045,.045,'chrome');
    const at = (t) => [x.x, x.y0 + (x.y1 - x.y0) * t, x.z0 + (x.z1 - x.z0) * t];
    C.prism(at(0), at(0.86), x.r, D >= 2 ? 8 : D ? 6 : 4, 'pipe', 'under');
    if (D >= 2) { C.prism(at(0.28), at(0.4), x.r * 1.08, 8, 'chrome'); C.prism(at(0.55), at(0.67), x.r * 1.08, 8, 'chrome'); }
    C.prism(at(0.86), at(1), x.r, D >= 2 ? 6 : D ? 4 : 3, 'chrome', 'under', 0, x.r * 0.55);
    if (D >= 2) C.limb([x.x, x.y0 - 0.02, x.z0 - 0.12], [x.x * 0.3, x.y0 - 0.2, x.z0 - 0.16], 0.03, 0.03, 'frame'); }
  // swingarm both sides, chain and rear shock
  for (const s of D >= 2 ? [1, -1] : [0]) C.limb([s * 0.1, P.swingarm.y0, P.swingarm.z0], [s * 0.1, P.rR, P.zR], D >= 2 ? 0.05 : 0.2, 0.09, 'hub');
  if (D >= 2) C.limb([0.1, e.y - 0.12, e.z - 0.2], [0.1, P.rR + 0.07, P.zR], 0.03, 0.03, 'frame');
  if (D >= 2) { C.limb([0.1, e.y - 0.17, e.z - 0.2], [0.1, P.rR - 0.07, P.zR], 0.03, 0.03, 'frame');
    C.limb([0, P.rR + 0.1, P.zR + 0.42], [0, P.seat.y - 0.06, P.seat.z0 - 0.28], 0.05, 0.05, 'chrome'); }
  // tank, radiator shrouds, seat, rear side panels
  { const t = P.tank, h = P.shrouds, w = t.w, L = t.z0 - t.z1, yt = t.y1 + 0.05, yb = h.y0 + 0.2;
    const r = (top, bot) => hex(w * 0.4, top, w * 0.7, (top + bot) / 2 + 0.03, w * 0.5, bot);
    const st = [{ z: t.z0, ring: r(yt - 0.14, yb + 0.06) }, { z: t.z0 - L * 0.28, ring: r(yt, yb) }, { z: t.z0 - L * 0.62, ring: r(yt, yb + 0.02) }, { z: t.z1, ring: r(yt - 0.14, yb + 0.06) }];
    loft(S('core'), D >= 2 ? st : D >= 1 ? [st[0], st[1], st[3]] : [st[0], st[3]], 'paint');
    if (D >= 2) C.box([0, yt + 0.012, t.z0 - L * 0.4], [0.07, 0.025, 0.07], 'frame'); }
  { const h = P.shrouds;
    for (const s of [1, -1]) plate(C, [[s * h.x, h.y1, h.z0], [s * (h.x + 0.01), h.y1 + 0.03, h.z1], [s * (h.x - 0.03), h.y0 + 0.22, h.z1 - 0.04], [s * (h.x - 0.05), h.y0, h.z0 - 0.06]], [-s * 0.07, 0, 0], 'paint'); }
  { const s = P.seat, L = s.z0 - s.z1, yt = s.y + s.h, yb = s.y - 0.03;
    const st = [{ z: s.z0, ring: hex(s.w * 0.4, yt, s.w * 0.5, yt - 0.03, s.w * 0.35, yb) },
      { z: s.z0 - L * 0.15, ring: hex(s.w * 0.7, yt, s.w * 0.8, yt - 0.03, s.w * 0.6, yb) },
      { z: s.z0 - L * 0.6, ring: hex(s.w * 0.9, yt + 0.01, s.w, yt - 0.02, s.w * 0.75, yb) },
      { z: s.z1, ring: hex(s.w * 0.8, yt + 0.02, s.w * 0.9, yt - 0.01, s.w * 0.7, yb) }];
    loft(C, D >= 2 ? st : D >= 1 ? [st[0], st[2], st[3]] : [st[0], st[3]], 'seat'); }
  { const p = P.sidePanel, w = p.x;
    const st = [{ z: p.z0, ring: hex(0.1, p.y1 - 0.03, w, p.y1 - 0.1, w * 0.9, p.y0 + 0.16) },
      { z: (p.z0 + p.z1) / 2, ring: hex(0.1, p.y1 - 0.02, w * 0.92, p.y1 - 0.12, w * 0.65, p.y0 + 0.17) },
      { z: p.z1, ring: hex(0.07, p.y1, w * 0.45, p.y1 - 0.1, w * 0.3, p.y0 + 0.38) }];
    loft(C, D >= 2 ? st : [st[0], st[2]], 'paint'); }
  // footpegs, bars on a stem, grips, levers and the big black hand guards
  if (D >= 2) for (const s of [1, -1]) C.box([s * P.pegs.x, P.pegs.y, P.pegs.z], [0.14, 0.04, 0.06], 'frame');
  { const b = P.bars; C.limb([0, P.fork.top[1], P.fork.top[0]], [0, b.y, b.z], 0.06, 0.06, 'frame');
    C.limb([-b.hw, b.y, b.z], [b.hw, b.y, b.z], 0.035, 0.035, 'frame');
    for (const s of [1,-1]) C.decor(()=> {
      const cx=s*(b.hw+b.gx),z=b.z+.11,w=b.guard/2;
      const pts=[[cx-s*w,b.y-.045,z],[cx+s*w*.65,b.y-.055,z],[cx+s*w,b.y-.01,z-.025],[cx+s*w*.62,b.y+.065,z-.03],[cx-s*w*.9,b.y+.06,z-.015]];
      if(D>=2)plate(C,pts,[0,0,-.055],'guard');
      else {face(C,pts,'guard',[0,0,1]);face(C,pts,'guard',[0,0,-1]);}
      if(D>=2) { C.limb([s*(b.hw-.14),b.y,b.z],[s*(b.hw-.02),b.y,b.z],.05,.05,'frame'); C.limb([s*(b.hw-.14),b.y-.02,b.z+.03],[cx-s*w*.8,b.y-.025,z],.02,.012,'chrome'); }
    });
  }

  // ── front: forks, the high beaked mudguard, the number-plate shroud with its headlamp, the crash bar and spotlights ──
  { const fx = P.fork.x, tz = P.fork.top[0], ty = P.fork.top[1], L = (t) => [ty + (P.rF - ty) * t, tz + (P.zF - tz) * t];
    for (const s of [1, -1]) {
      const at = (t) => [s * fx, L(t)[0], L(t)[1]];
      F.limb(at(0), at(D >= 1 ? 0.46 : 1), P.fork.w * 0.7, P.fork.w * 0.7, 'chrome');
      if (D >= 2) F.limb(at(0.4), at(0.56), P.fork.w * 0.9, P.fork.w * 0.9, 'under');
      if (D >= 1) F.limb(at(D >= 2 ? 0.54 : 0.4), at(1), P.fork.w * 0.82, P.fork.w * 0.82, 'hub');
    }
    F.box([0, ty - 0.03, tz - 0.02], [fx * 2 + 0.1, 0.05, 0.08], 'frame');
    if (D >= 2) F.box([0, L(0.22)[0], L(0.22)[1]], [fx * 2 + 0.06, 0.03, 0.06], 'frame'); }
  { const k = P.beak, w = k.w, t = 0.04, yc = (f) => k.y0 + (k.y1 - k.y0) * f, zc = (f) => k.z0 + (k.z1 - k.z0) * f;
    const r = (hw, y,th=t) => hex(hw * 0.8, y + th, hw, y, hw * 0.7, y - th);
    const st = [{ z: zc(0), ring: r(w * 1.05, yc(0)) }, { z: zc(k.bend), ring: r(w * 1.1, yc(0.10)) }, { z: zc(1), ring: r(w * 0.95, yc(1),.018) }];
    loft(F, st, 'paint');
    if (D >= 2) for (const s of [1, -1]) F.limb([s * P.fork.x, P.rF + 0.3, P.zF - 0.12], [s * w * 0.8, yc(0.46) - 0.02, zc(0.46)], 0.025, 0.025, 'frame'); }
  { const h = P.shroud, hw = h.w / 2;
    const shell=[[-hw, h.y1, h.z + 0.055], [hw, h.y1, h.z + 0.055], [hw * 0.8, h.y0 + 0.17, h.z - 0.015], [0, h.y0, h.z - 0.055], [-hw * 0.8, h.y0 + 0.17, h.z - 0.015]];
    if (D) plate(F, shell, [0,0,.1], 'paint'); else { face(F,shell,'paint',[0,0,-1]);face(F,shell.map(([x,y,z])=>[x,y,z+.1]),'paint',[0,0,1]); }
    const yl = (h.y0 + h.y1) / 2 - 0.1, zl = h.z + 0.12;
    if (D) F.box([0, yl, zl], [0.25, 0.14, 0.06], 'lightbar'); else { const q=[[-.125,yl-.07,zl+.03],[.125,yl-.07,zl+.03],[.125,yl+.07,zl+.03],[-.125,yl+.07,zl+.03]];face(F,q,'lightbar',[0,0,1]);face(F,q,'lightbar',[0,0,-1]); }
    if (D >= 2) F.decor(() => F.prism([0, yl, zl + 0.03], [0, yl, zl + 0.045], 0.052, 8, 'head', 'head', Math.PI / 8)); }
  { const L = P.spots, rr = L.r;
    F.limb([-(L.x + rr + 0.03), L.y - rr - 0.03, L.z - 0.03], [L.x + rr + 0.03, L.y - rr - 0.03, L.z - 0.03], 0.035, 0.035, 'frame');
    for (const s of [1, -1]) {
      if (D) F.prism([s * L.x, L.y, L.z - 0.07], [s * L.x, L.y, L.z + 0.01], rr * 1.12, T.spotSeg, 'lightbar', D >= 2 ? 'lightbar' : 'head', Math.PI / T.spotSeg); else { const q=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[s*L.x+x*rr*.8,L.y+y*rr*.8,L.z+.01]);face(F,q,'head',[0,0,1]);face(F,q,'lightbar',[0,0,-1]); }
      if (D >= 2) F.decor(() => F.prism([s * L.x, L.y, L.z + 0.01], [s * L.x, L.y, L.z + 0.028], rr * 0.84, T.spotSeg, 'head', 'head', Math.PI / T.spotSeg));
      if (D >= 2) F.limb([s * (L.x + rr + 0.03), L.y - rr - 0.03, L.z - 0.03], [s * (L.x + rr + 0.03), L.y - rr - 0.03 - 0.17, L.z - 0.2], 0.03, 0.03, 'frame');
    } }

  // ── back: the rear mudguard rising to its tail, tail lamp, the rack with the rope coil and the hessian sack ──
  { const f = P.fenderR, w = f.w, t = 0.03, yc = (k) => f.y0 + (f.y1 - f.y0) * k, zc = (k) => f.z0 + (f.z1 - f.z0) * k;
    const r = (hw, y, th = t) => hex(hw * 0.7, y + th, hw, y, hw * 0.55, y - th);
    const st = [{ z: zc(0), ring: r(w * 0.95, yc(0), 0.045) }, { z: zc(0.55), ring: r(w * 0.8, yc(0.5)) }, { z: zc(1), ring: r(w * 0.5, yc(1)) }];
    loft(B, D >= 2 ? st : [st[0], st[2]], 'paint');
    B.box([0, f.y1 - 0.01, f.z1 - 0.025], [0.12, 0.07, 0.05], { all: 'frame', nz: 'tail' }); }
  { const r = P.rack, hw = r.w / 2, y = r.y, zm = (r.z0 + r.z1) / 2;
    if (D >= 1) {
      for (const s of [1, -1]) B.limb([s * hw, y, r.z0], [s * hw, y, r.z1], 0.03, 0.03, 'lightbar');
      B.limb([-hw, y, r.z1], [hw, y, r.z1], 0.03, 0.03, 'lightbar'); if (D >= 2) B.limb([-hw, y, r.z0], [hw, y, r.z0], 0.03, 0.03, 'lightbar');
    } else B.quad([-hw,y,r.z0],[hw,y,r.z0],[hw,y,r.z1],[-hw,y,r.z1],'lightbar');
    if (D >= 2) { B.limb([-hw, y, zm], [hw, y, zm], 0.025, 0.025, 'lightbar'); B.limb([0, y, r.z0], [0, y, r.z1], 0.025, 0.025, 'lightbar'); }
    if (D >= 2) for (const s of [1, -1]) B.limb([s * hw, y, r.z0], [s * 0.12, P.fenderR.y0 - 0.08, r.z0 - 0.03], 0.03, 0.03, 'lightbar'); }
  { const o = P.rope, y = P.rack.y + 0.02, n = D>=2?12:D?8:3;
    // Annular coil: actual central opening and layered rope edge, rather than a solid puck.
    const ring=(i,r,yy)=>[o.x+Math.cos(i*2*Math.PI/n)*r,yy,o.z+Math.sin(i*2*Math.PI/n)*r];
    for(let i=0;i<n;i++) {const j=(i+1)%n;
      face(B,[ring(i,o.r,y),ring(j,o.r,y),ring(j,o.r,y+o.h),ring(i,o.r,y+o.h)],'rope',sub(ring(i,o.r,y),[o.x,y,o.z]));
      if(D)face(B,[ring(i,o.r*.38,y),ring(i,o.r*.38,y+o.h),ring(j,o.r*.38,y+o.h),ring(j,o.r*.38,y)],'rope2',sub([o.x,y,o.z],ring(i,o.r,y)));
      face(B,[ring(i,o.r,y+o.h),ring(j,o.r,y+o.h),ring(j,o.r*.38,y+o.h),ring(i,o.r*.38,y+o.h)],'rope',[0,1,0]);
      if(D>=2) for(const h of [.035,.085]) face(B,[ring(i,o.r+.001,y+h),ring(j,o.r+.001,y+h),ring(j,o.r+.001,y+h+.012),ring(i,o.r+.001,y+h+.012)],'rope2',sub(ring(i,o.r,y),[o.x,y,o.z]));
    }
    if(D)B.box([o.x,y+o.h+.008,o.z],[o.r*1.9,.018,.025],'rope2'); }
  { const k = P.sack;
    B.blob([k.x, k.y, k.z], [k.r * 0.95, k.r * 1.1, k.r], T.sackSeg[0], T.sackSeg[1], 'sack', 'sack2');
    if (D >= 2) B.prism([k.x, k.y + k.r * 0.95, k.z], [k.x, k.y + k.r * 1.2, k.z], k.r * 0.28, 6, 'sack', 'sack', 0, k.r * 0.16);
    if (D) B.box([k.x, k.y + k.r * 1.22, k.z], [0.06, 0.08, 0.06], 'rope'); else B.limb([k.x,k.y+k.r,k.z],[k.x,k.y+k.r*1.48,k.z],.04,.04,'rope'); } // the tie is the back's top at every LOD (its hinge height)

  // ── rider, standing on the pegs: an MX helmet with a peak, goggles and chin bar; khaki shirt; jeans; black boots ──
  const J = P.rider, R = S('rider'), rl = T.rider, r2 = rl >= 2, hr = J.headR;
  // Shirt hem, waist and shoulders are separate sections: the reference is a tapered human torso, not a plank.
  const torso = [[J.waistY,J.waistZ,0.15,0.105],[J.shoulder[1]-0.19,J.shoulder[2]-0.02,0.17,0.115],[J.shoulder[1]-.05,J.shoulder[2],0.23,0.1],[J.shoulder[1]-.015,J.shoulder[2],.12,.08]];
  const tr = torso.map(([y,z,w,d]) => [[-w*.76,y,z-d],[w*.76,y,z-d],[w,y,z-d*.55],[w,y,z+d*.55],[w*.76,y,z+d],[-w*.76,y,z+d],[-w,y,z+d*.55],[-w,y,z-d*.55]]);
  { const sections=r2?tr:[tr[0],tr[2],tr[3]].map(r=>r.filter((_,i)=>![2,6].includes(i))),n=sections[0].length;for(let i=0;i<sections.length-1;i++) for(let k=0;k<n;k++) { const j=(k+1)%n; face(R,[sections[i][k],sections[i][j],sections[i+1][j],sections[i+1][k]],'shirt',sub(avg([sections[i][k],sections[i][j],sections[i+1][j],sections[i+1][k]]),[0,torso[0][0],torso[0][1]])); }
  if(rl)face(R,sections[0],'shirt',[0,-1,0]);face(R,sections.at(-1),'shirt',[0,1,0]); }
  if (r2) R.box([0, J.waistY, J.waistZ], [0.30, 0.16, 0.22], 'pants');
  for (const s of [1, -1]) {
    const m = (p) => [s * p[0], p[1], p[2]], hip = [s * 0.11, J.waistY, J.waistZ], knee = m(J.knee), foot = m(J.foot), el = m(J.elbow), ha = m(J.hand);
    const sh = [s * 0.22, J.shoulder[1] - 0.07, J.shoulder[2]];
    if (rl >= 1) {
      R.limb(hip, knee, 0.14, 0.14, 'pants');
      R.limb(knee, [foot[0], foot[1] + 0.12, foot[2]], 0.12, 0.12, 'pants');
      if(r2)R.prism(sh,el,.071,5,'shirt',null,0,.056);else R.limb(sh,el,.13,.13,'shirt');
      if(r2)R.prism(el,ha,.052,5,'skin',null,0,.037);else R.limb(el,ha,.085,.085,'skin');
    } else {
      R.limb(hip, [foot[0], foot[1] + 0.12, foot[2]], 0.15, 0.15, 'pants');
      R.limb(sh, ha, 0.12, 0.12, 'shirt');
    }
    R.box([foot[0], foot[1] + 0.09, foot[2] + 0.02], [0.14, r2 ? 0.2 : 0.22, 0.17], 'boots');
    if (r2) { R.box([foot[0], foot[1] + 0.03, foot[2] + 0.07], [0.145, 0.07, 0.3], 'boots'); R.box([foot[0], foot[1] - 0.005, foot[2] + 0.07], [0.15, 0.025, 0.31], 'sole');
      R.box(ha, [0.09, 0.08, 0.1], 'gloves'); }
  }
  if (rl >= 1) R.limb([0, J.shoulder[1], J.shoulder[2]], [J.head[0], J.head[1] - hr * 0.8, J.head[2]], 0.09, 0.09, 'skin');
  // MX shell has a brow, tapering back and protruding chin. Goggles wrap its
  // three front facets; their dark surround is behind the lens, never in front.
  { const [hx,hy,hz]=J.head, r=hr;
    const n=rl>=2?8:6,levels=rl>=2?[[.94,.15,.28,-.18],[.72,.69,.70,-.16],[.25,.96,.93,-.05],[-.25,.84,.78,-.18],[-.70,.58,.62,-.16]]:[[.93,.24,.35,-.18],[.40,.90,.90,-.08],[-.25,.82,.76,-.18],[-.70,.56,.60,-.16]];
    const rings=levels.map(([y,w,d,z])=>Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n;return[hx+Math.cos(a)*w*r,hy+y*r,hz+(z+Math.sin(a)*d)*r];}));
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++) {const k=(i+1)%n;if(j>=rings.length-3&&Math.sin((i+.5)*2*Math.PI/n)>.55)continue;const pts=[rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i]];face(R,pts,'helmet',sub(avg(pts),J.head));}
    face(R,rings[0],'helmet',[0,1,0]);
    if(rl)face(R,rings.at(-1),'helmet',[0,-1,0]);
    const q=(x,y,z)=>[hx+x*r,hy+y*r,hz+z*r];
    const band=[q(-.85,.28,.54),q(-.65,.34,1.0),q(.65,.34,1.0),q(.85,.28,.54),q(.84,-.3,.58),q(.60,-.34,1.04),q(-.60,-.34,1.04),q(-.84,-.3,.58)];
    face(R,[band[1],band[2],band[5],band[6]],'lightbar',[0,0,1]);
    face(R,[band[0],band[1],band[6],band[7]],'lightbar',[-1,0,1]);
    face(R,[band[2],band[3],band[4],band[5]],'lightbar',[1,0,1]);
    const lens=[q(-.53,.22,1.015),q(.53,.22,1.015),q(.50,-.20,1.055),q(-.50,-.20,1.055)];
    face(R,lens,'goggles',[0,0,1]);
    // Triangular chin points forward, with a black vent inset on its front facet.
    loft(R,[{z:hz+r*.4,ring:hex(r*.65,hy-r*.18,r*.58,hy-r*.45,r*.38,hy-r*.86)},
      {z:hz+r*1.22,ring:hex(r*.32,hy-r*.24,r*.28,hy-r*.45,r*.10,hy-r*.83)}],'helmet','front');
    if(rl)face(R,[q(-.23,-.47,1.225),q(.23,-.47,1.225),q(.13,-.64,1.225),q(-.13,-.64,1.225)],'lightbar',[0,0,1]);
    const peak=[q(-.66,.54,.24),q(.66,.54,.24),q(.63,.48,1.43),q(0,.62,1.55),q(-.63,.48,1.43)];if(rl)plate(R,peak,[0,.025,0],'helmet');else {face(R,peak,'helmet',[0,1,0]);face(R,peak,'helmet',[0,-1,0]);}
  }

  // ── wheels: a big 21-inch-style front and an 18-inch-style rear, knobblies on silver spoked rims ──
  const look = { tyre: 'tyre', rim: 'rim', hub: 'hub', spokes: 'spokes', cap: 'pipe' };
  wheel(S('wheel_F'), P.zF, P.rF, P.tyreW, T, look, D >= 2 ? (W) => {
    W.decor(() => { W.prism([P.tyreW / 2 + 0.03, P.rF, P.zF], [P.tyreW / 2 + 0.04, P.rF, P.zF], P.rF * 0.36, 12, 'chrome', 'chrome'); });
    W.box([P.tyreW / 2 + 0.06, P.rF + 0.14, P.zF + 0.03], [0.05, 0.1, 0.1], 'frame'); } : null);
  wheel(S('wheel_R'), P.zR, P.rR, P.tyreW * 1.15, T, look, D >= 2 ? (W) => {
    W.prism([P.tyreW * 0.575 + 0.03, P.rR, P.zR], [P.tyreW * 0.575 + 0.045, P.rR, P.zR], P.rR * 0.26, 10, 'hub', 'hub'); } : null);
  return { soups };
}

const generated = exportsFor('pig-catcher', makeSoups);
export const pivots = P => P.physicsPivots ?? generated.pivots(P);
export function soups(P,lod=0) {
  const out=generated.soups(P,lod),fixed=pivots(P);
  for(const [id,part]of Object.entries(out.parts)){const old=part.pivot;part.positions=part.positions.map((v,i)=>v+old[i%3]-fixed[id][i%3]);part.pivot=fixed[id].slice();}
  return out;
}
export function build(P,lod=0) {
  const out=generated.build(P,lod),fixed=pivots(P);
  for(const [id,mesh]of Object.entries(out.parts)){const old=mesh.position.toArray(),pv=fixed[id];mesh.geometry.translate(...old.map((v,i)=>v-pv[i]));mesh.position.fromArray(pv);mesh.userData.rest=pv.slice();}
  return out;
}
