// bin.js — Australian wheelie bin from kit primitives (green body, coloured lid, two rear wheels, loose junk).
// Same method as the car: analytic spline/superellipse surfaces + vertex-colour paint + merged per material.
// Ribs and the grab-recess are part of the surface function (his lathe `pleats` / `bend` hooks), not textures.
import { THREE, KitBuilder, P, lathe, tube, col, clamp, lerp, sstep, hash, TAU, tintedMaterial, texturedMaterial, canvasTexture, countTris, surfaceGrid } from './kit/kit.js';

export const B = { y0: 0.07, H: 0.99, w0: 0.235, w1: 0.30, d0: 0.285, d1: 0.345, p: 3.7, wall: 0.026, wheelX: 0.345, wheelY: 0.185, wheelZ: -0.2, wheelR: 0.185, wheelW: 0.095 };
const sgnpow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));

/** body surface: v 0→1 = floor centre → bottom edge → rim ; u = around (0.25 = front / +Z) */
export function bodySurface(inset = 0, feats = true) {
  const vb = 0.07;
  return (u, v, out) => {
    let t, s, y;
    if (v < vb) { const a = v / vb; s = Math.sin(a * Math.PI / 2); t = 0; y = B.y0 - 0.05 * Math.cos(a * Math.PI / 2); }
    else { t = (v - vb) / (1 - vb); s = 1; y = B.y0 + B.H * t; }
    const W = (lerp(B.w0, B.w1, t) - inset) * s, D = (lerp(B.d0, B.d1, t) - inset) * s, ph = u * TAU;
    let x = W * sgnpow(Math.cos(ph), 2 / B.p), z = D * sgnpow(Math.sin(ph), 2 / B.p);
    if (feats && z > 0 && v > vb) {
      const front = sstep(0.05, 0.35, z / D);                            // only on the front face
      z += front * 0.014 * (gauss(x + 0.1, 0.028) + gauss(x, 0.028) + gauss(x - 0.1, 0.028)) * sstep(0.2, 0.32, t) * (1 - sstep(0.8, 0.9, t)); // 3 moulded ribs
      z -= front * 0.024 * gauss(x / 0.12, 1) * gauss((t - 0.86) / 0.05, 1);                                                                         // grab recess
      z -= front * 0.012 * gauss(x / 0.16, 1) * gauss((t - 0.12) / 0.04, 1);                                                                           // kick-plate dish
    }
    if (feats && v > vb && t > 0.94) { const k = (t - 0.94) / 0.06; x *= 1 + 0.03 * Math.sin(k * Math.PI); z *= 1 + 0.03 * Math.sin(k * Math.PI); } // rim bulge
    out[0] = x; out[1] = y; out[2] = z;
  };
}
/** lid slab (closed): underside → edge → dome, in lid-local space; plan is a squircle */
export function lidSurface(W = 0.335, D = 0.385, h1 = 0.05, h2 = 0.075) {
  const prof = new THREE.SplineCurve([[0, 0], [0.86, 0], [0.985, 0.01], [1, 0.035], [0.995, h1 - 0.01], [0.95, h1 + 0.02], [0.72, h1 + h2 * 0.72], [0.35, h1 + h2 * 0.96], [0, h1 + h2]].map(([a, b]) => new THREE.Vector2(a, b)));
  return (u, v, out) => {
    const pt = prof.getPoint(clamp(v)), ph = u * TAU, p = 4.6;
    out[0] = pt.x * W * sgnpow(Math.cos(ph), 2 / p); out[1] = pt.y; out[2] = pt.x * D * sgnpow(Math.sin(ph), 2 / p);
  };
}

function tyre(lod) {
  const R = B.wheelR, W = B.wheelW / 2;
  return lathe([[0.05, -W], [R * 0.62, -W], [R * 0.92, -W * 0.7], [R, -W * 0.3], [R, W * 0.3], [R * 0.92, W * 0.7], [R * 0.62, W], [0.05, W], [0.05, -W]], [24, 14, 8][lod], [30, 14, 8][lod], 'bintyre' + lod);
}
const stickerTex = () => canvasTexture(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.fillStyle = '#fbf5e4'; g.beginPath(); g.roundRect(6, 6, 116, 116, 22); g.fill(); g.lineWidth = 6; g.strokeStyle = '#25302a'; g.stroke();
  g.fillStyle = '#25302a'; g.font = 'bold 74px "Arial Black", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('42', 64, 68);
});

export async function build({ lod = 0, paint = '#2e9d57', accent = '#d8362f' } = {}) {
  const k = [1, 0.42, 0.2][lod], N = (n) => Math.max(3, Math.round(n * k)), rad = [8, 5, 4][lod];
  const bin = new THREE.Group(); bin.name = 'bin'; const parts = {}; bin.userData.parts = parts;
  const mats = { paint: tintedMaterial('paint', paint), accent: tintedMaterial('accent', accent) };
  const addPart = (id, grp, meta) => { grp.name = id; grp.userData.jj = { id, ...meta }; bin.add(grp); parts[id] = grp; return grp; };
  const at = (fn, u, v) => { const o = [0, 0, 0]; fn(u, v, o); return o; };

  // ── body: outer skin + inner wall + rim bead + hinge bar + feet + sticker
  {
    const b = new KitBuilder(), outer = bodySurface(0, true), inner = bodySurface(B.wall, false);
    const ref = (u, v, o) => { o[0] = 0; o[1] = B.y0 + 0.5; o[2] = 0; };
    b.add(surfaceGrid(N(56), N(44), outer, { inside: ref }), 'paint', {
      c: '#fff', space: 'world', g: (x, y, z, nx, ny, nz, c) => {
        const t = (y - B.y0) / B.H;
        c.multiplyScalar(0.72 + 0.28 * sstep(0.0, 0.45, t));                                     // AO bottom
        const streak = (1 - sstep(0.05, 0.5, t)) * (0.5 + 0.5 * Math.sin(x * 47 + z * 13));      // vertical dirt streaks
        c.lerp(col('#6f5233'), clamp(streak) * 0.42 * (1 - sstep(0.0, 0.5, t)) + 0.0);
        if (t > 0.965) c.multiplyScalar(1.12);                                                   // lighter rolled rim
        if (nz > 0.5 && t > 0.79 && t < 0.93 && Math.abs(x) < 0.15) c.multiplyScalar(0.8);      // grab recess shadow
      },
    });
    b.add(surfaceGrid(N(48), N(30), (u, v, o) => inner(u, 0.2 + 0.8 * v, o), { inside: ref, reverse: true }), 'matte', { c: '#123d22', space: 'world', g: (x, y, z, nx, ny, nz, c) => c.multiplyScalar(0.55 + 0.45 * sstep(B.y0 + 0.1, B.y0 + B.H, y)) });
    { // rim bead hugging the top edge
      const pts = []; for (let i = 0; i <= 40; i++) { const o = [0, 0, 0]; outer(i / 40, 1, o); pts.push([o[0] * 0.995, o[1] + 0.004, o[2] * 0.995]); }
      b.add(tube('binrim' + lod, pts, 0.03, Math.max(16, Math.round(80 * k)), rad, false, false), 'paint', { c: '#fff', space: 'world', g: (x, y, z, nx, ny, nz, c) => c.multiplyScalar(1.08) });
    }
    b.add(P.cyl(0.028, 0.028, 0.5, [12, 8, 6][lod]), 'metal', { p: [0, B.y0 + B.H + 0.02, -0.33], r: [0, 0, Math.PI / 2], c: '#8a8f98' });      // hinge bar
    for (const s of [-1, 1]) b.add(P.box(0.11, 0.05, 0.11, 0.03, 1), 'rubber', { p: [s * 0.13, 0.045, 0.24], c: '#1f2926' });         // front feet
    for (const s of [-1, 1]) b.add(P.cyl(0.02, 0.02, 0.2, 10), 'metal', { p: [s * 0.25, B.wheelY, B.wheelZ], r: [0, 0, Math.PI / 2], c: '#6d727b' }); // axle stubs
    // sticker: conforms to the front face by bisecting the surface fn for the u that gives the wanted x
    const frontAt = (x, t) => { const o = [0, 0, 0], v = 0.07 + 0.93 * t; let lo = x >= 0 ? 0.0 : 0.25, hi = x >= 0 ? 0.25 : 0.5; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; outer(m, v, o); if ((x >= 0) === (o[0] > x)) lo = m; else hi = m; } outer((lo + hi) / 2, v, o); return o; };
    b.add(surfaceGrid(8, 8, (u, v, o) => { const p = frontAt(lerp(-0.11, 0.11, u), lerp(0.30, 0.45, v)); o[0] = p[0]; o[1] = p[1]; o[2] = p[2] + 0.004; }, { inside: (u, v, o) => { o[0] = 0; o[1] = 0.45; o[2] = 0; } }),
      texturedMaterial('binSticker', 'satin', stickerTex, { transparent: true, alphaTest: 0.4 }), { c: '#fff' });
    const g = b.build('chassis', { materials: mats });
    g.name = 'chassis'; bin.add(g); parts.chassis = g; g.userData.jj = { id: 'chassis', kind: 'core', hp: 999, mass: 6 };
  }
  // ── lid (hinged at the back edge), two grips, and a pull tab
  {
    const b = new KitBuilder(), ly = B.y0 + B.H + 0.012, lz = 0.0, pivot = [0, ly + 0.03, -0.335];
    const lid = lidSurface();
    b.add(surfaceGrid(N(48), N(30), (u, v, o) => { lid(u, v, o); o[1] += ly; o[2] += lz; }, { inside: (u, v, o) => { o[0] = 0; o[1] = ly + 0.03; o[2] = 0; } }), 'accent', {
      c: '#fff', space: 'world', g: (x, y, z, nx, ny, nz, c) => { const t = (y - ly) / 0.13; c.multiplyScalar(0.8 + 0.2 * sstep(0, 0.4, t)); if (ny < -0.6) c.set('#5b1a17'); c.lerp(col('#7a5a36'), (1 - sstep(0.0, 0.05, y - ly)) * 0.25 * (0.5 + 0.5 * Math.sin(x * 33 + z * 21))); },
    });
    for (const s of [-1, 1]) {   // moulded grips (accent, chunky)
      b.add(tube('bingrip' + s + lod, [[s * 0.15, ly + 0.11, 0.2], [s * 0.15, ly + 0.165, 0.2], [s * 0.15, ly + 0.165, 0.27], [s * 0.15, ly + 0.11, 0.3]], 0.024, Math.max(8, Math.round(24 * k)), rad, true), 'accent', { c: '#fff', space: 'world' });
    }
    b.add(P.box(0.5, 0.035, 0.075, 0.016, 1), 'accent', { p: [0, ly + 0.13, -0.3], c: '#fff' });
    addPart('lid', b.build('lid', { pivot, materials: mats }), { kind: 'lid', hinge: { point: pivot, axis: [1, 0, 0], sign: -1, max: 2.1 }, hp: 90, mass: 2.2 });
  }
  // ── wheels
  for (const sgn of [1, -1]) {
    const spin = new KitBuilder(), R = B.wheelR;
    spin.push({ r: [0, 0, Math.PI / 2] });
    spin.add(tyre(lod), 'rubber', { g: (x, y, z, nx, ny, nz, c) => { const r = Math.hypot(x, z); c.set(r > R * 0.9 ? '#161a19' : '#262c2a'); } });
    spin.pop();
    spin.add(P.cyl(0.085, 0.09, 0.03, 18), 'gloss', { p: [sgn * (B.wheelW / 2 + 0.005), 0, 0], r: [0, 0, Math.PI / 2], c: accent });
    for (let i = 0; lod < 2 && i < 6; i++) { spin.push({ r: [(i / 6) * TAU, 0, 0] }); spin.add(P.box(0.02, 0.05, 0.03, 0.008, 1), 'rubber', { p: [sgn * 0.05, 0.12, 0], c: '#3a423f' }); spin.pop(); }
    const g = new THREE.Group(); const gs = spin.build('spin'); g.add(gs); g.userData.spin = gs;
    g.position.set(sgn * B.wheelX, B.wheelY, B.wheelZ);
    addPart(sgn > 0 ? 'wheel_R' : 'wheel_L', g, { kind: 'wheel', axle: [1, 0, 0], hp: 70, mass: 0.9, radius: R, width: B.wheelW });
  }
  // ── junk in the bin (spills out when the lid goes)
  const junk = [
    ['can', [0.1, B.y0 + B.H - 0.03, 0.08], (b) => { b.add(P.cyl(0.05, 0.05, 0.13, 14), 'chrome', { r: [0, 0, 1.2], c: '#5aa0ff' }); b.add(P.cyl(0.046, 0.046, 0.012, 14), 'chrome', { p: [0.06, 0.01, 0], r: [0, 0, 1.2], c: '#dfe4ec' }); }],
    ['paper', [-0.1, B.y0 + B.H - 0.02, 0.0], (b) => b.add(P.ico(0.085, 1), 'matte', { s: [1, 0.75, 1], c: '#e9d7b1', g: (x, y, z, nx, ny, nz, c) => c.multiplyScalar(0.8 + 0.4 * hash(x * 99 + y * 33 + z * 71)) })],
    ['box', [0.0, B.y0 + B.H - 0.01, 0.22], (b) => { b.add(P.box(0.3, 0.035, 0.26, 0.015, 1), 'matte', { r: [-0.35, 0.3, 0.1], c: '#f4e9d0' }); b.add(P.box(0.14, 0.038, 0.12, 0.01, 1), 'matte', { p: [0.04, 0.005, 0.03], r: [-0.35, 0.3, 0.1], c: '#e2483a' }); }],
    ['bottle', [-0.12, B.y0 + B.H - 0.03, -0.1], (b) => { b.add(P.cyl(0.04, 0.04, 0.17, 12), 'gloss', { r: [1.3, 0, 0.6], c: '#3fbf6e' }); b.add(P.cyl(0.016, 0.02, 0.06, 10), 'gloss', { p: [0.0, 0.0, -0.11], r: [1.3, 0, 0.6], c: '#3fbf6e' }); }],
    ['sock', [0.14, B.y0 + B.H - 0.02, -0.14], (b) => b.add(P.capsule(0.04, 0.12, 4), 'matte', { r: [0.5, 1.0, 1.4], c: '#ffc233' })],
  ];
  for (const [name, pos, make] of junk) { const b = new KitBuilder(); make(b); const g = b.build('junk_' + name, { materials: mats, dentable: [] }); g.position.set(...pos); addPart('junk_' + name, g, { kind: 'junk', hp: 1e9, mass: 0.25, releasedBy: 'lid' }); }
  bin.userData.proxy = [{ half: [0.3, 0.5, 0.34], offset: [0, 0.55, 0] }];
  bin.userData.isBin = true;
  return bin;
}
export const report = (bin) => countTris(bin);

/** Squish: crush the body permanently (drive-over). k 0..1. Pops the lid when it gets bad. */
export function crushBody(bin, k) {
  const sy = 1 - 0.8 * k;
  bin.userData.parts.chassis.traverse((m) => {
    if (!m.isMesh) return; const g = m.geometry;
    if (!g.userData.rest) g.userData.rest = { pos: g.attributes.position.array.slice(), col: g.attributes.color.array.slice() };
    const rest = g.userData.rest.pos, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2], t = clamp((y - B.y0) / B.H);
      const bulge = 1 + 0.32 * k * Math.sin(Math.PI * clamp(t * 0.9 + 0.05));
      pos.setXYZ(i, x * bulge, B.y0 + (y - B.y0) * sy, z * (bulge + 0.04 * k * Math.sin(x * 40)));
    }
    pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
  });
  const lift = (B.y0 + B.H) * (1 - sy) * 0.98;
  const lid = bin.userData.parts.lid; if (lid && lid.parent === bin) lid.position.y = lid.userData.home[1] - lift;
  for (const [id, p] of Object.entries(bin.userData.parts)) if (id.startsWith('junk_') && p.parent === bin) p.position.y = p.userData.home[1] - lift;
}
