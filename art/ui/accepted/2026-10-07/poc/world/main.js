// main.js — the in-world look page (P1-U05). States by URL fragment:
//   #grid&n=24        24 live tiles under U02's HUD (the cost case)       #tv          one full-screen tile
//   #overview&n=16    the derby bowl from the fixed 60° Overview camera   #paint       each identity colour as paint next to its badge
//   #graphics         the start-finish banner, W-beam guard rail, chevron posts (P1-U05.3)
// &dist=near|mid|far|round0 picks the race-tile camera distance (../shared/framing.json, P1-U05.2).
// ?mode=full|ids|plain picks the post tier (full look / outlines on objects only / no post) for the cost table.
// Shader and lighting POC (P1-U05.5, R108): #shimmer (a slow chase-height crawl down the start straight, no cars: the line-shimmer
// before/after; &n=24 runs it in every tile of a 24-tile grid, where it shows most) and #closeup (one car, its cast shadow, brake lamps and boost flame, front and rear). The bar at the bottom switches
// the Mad Max looks live; ?look= ink= ao= smaa= shadow= shadowSize= tm= roadtex= af= emissive= haze= shimmer= grain= debug=
// pick the options (world.js createWorld fx), &bar=0 hides the bar for captures.
import * as THREE from 'three/webgpu';
import { loadTokens, seatColor } from '../shared/tokens.js';
import { layoutGrid } from '../tv/grid.js';
import { createWorld, BOWL, FRAMING, LOOKS } from './world.js';
import { createOverviewRig, createRound0Rig } from '../shared/overview-camera.js';

// #compare=gtao|smaa|shadows: the A/B compare page (compare.js): the same frozen frame with a setting on and off, a 4x crop and a
// difference map. It drives this page twice (once per setting value) with &freeze=N below; nothing else of this file runs.
if (location.hash.startsWith('#compare')) { await import('./compare.js'); await new Promise(() => {}); }
const tokens = await loadTokens();
// The look panel docks (P1-U05, br-dim.12): with &panel=1 the world is laid out in the area the panel leaves (a right column in
// landscape, a bottom sheet in portrait), so the panel never covers a tile; closing it reloads at full size.
const panelOpen = new URLSearchParams(location.search).get('panel') === '1' && new URLSearchParams(location.search).get('bar') !== '0';
const landscape = window.innerWidth >= window.innerHeight;
const VW = panelOpen && landscape ? window.innerWidth - Math.min(260, Math.round(window.innerWidth * 0.3)) : window.innerWidth;
const VH = panelOpen && !landscape ? window.innerHeight - Math.round(window.innerHeight * 0.34) : window.innerHeight;
document.getElementById('world').style.cssText = `width:${VW}px;height:${VH}px`;
document.getElementById('ui').style.cssText = `width:${VW}px;height:${VH}px;right:auto;bottom:auto`;
const k = () => VH / 1080;
document.documentElement.style.setProperty('--k', String(k()));
const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'full';
const [state, ...rest] = location.hash.replace(/^#/, '').split('&');
const P = new URLSearchParams(rest.join('&'));
const name = state || 'grid';
const N = +(P.get('n') ?? (name === 'grid' ? 24 : name === 'overview' ? 16 : 12));
const bool = (k) => (q.has(k) ? q.get(k) !== '0' : undefined);
const fx = { look: q.get('look') ?? undefined, ink: q.get('ink') ?? undefined, ao: bool('ao'), smaa: bool('smaa'), shadow: q.get('shadow') ?? undefined, shadowSize: q.has('shadowSize') ? +q.get('shadowSize') : undefined, tm: q.get('tm') ?? undefined, roadtex: bool('roadtex'), af: q.has('af') ? +q.get('af') : undefined, emissive: bool('emissive'), haze: bool('haze'), shimmer: bool('shimmer'), grain: bool('grain'), htcar: bool('htcar'), tierH: q.has('tierH') ? +q.get('tierH') : undefined, debug: q.get('debug') ?? undefined, inkscale: bool('inkscale'), mipbias: q.has('mipbias') ? +q.get('mipbias') : undefined, ink_: q.has('inkp') ? Object.fromEntries(q.get('inkp').split(',').map((kv) => kv.split(':')).map(([a, b]) => [a, +b])) : undefined };
const colors = tokens.identity.colors.map((c) => c.hex);
const NAMES = ['Dusty', 'Pip', 'Ash', 'Kai', 'Big Kev', 'Mia', 'Snag', 'Shaz', 'Roo Boy', 'Tiggy', 'Mack', 'Maximilian', 'Jojo', 'Nina', 'Bazza', 'Wren', 'Sakura', 'Zara', 'Tama', 'Lulu', 'Ned', 'Hamish', 'Priya', 'Wei', 'Sione', 'Ana', 'Jack', 'Ruby', 'Archie', 'Isla', 'Leo', 'Matilda'];

// ?freeze=N (R90, settable and steppable): the sim runs N fixed 1/60 s steps (every frame, no wall clock), then the page stops on
// that exact frame and keeps a pixel copy for window.__world.snapshot(). Same N and same options give the same frame
// when &grain=0&shimmer=0 (the grain and the heat shimmer read the renderer's clock); compare.js checks it with a control pair.
const FREEZE = q.has('freeze') ? Math.max(1, +q.get('freeze')) : 0;
let snap = null;
const canvas = document.getElementById('world');
const W = VW, H = VH;
const rects = (() => {
  if (name === 'grid' || (name === 'shimmer' && P.has('n'))) return layoutGrid(N, { x: 0, y: 0, w: W, h: H }, { gutter: 6 * k() }).tiles.map((t) => ({ x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h) }));
  if (name === 'graphics') { const w = Math.floor(W / 2), h = Math.floor(H / 2); return [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({ x, y, w, h })); }
  if (name === 'closeup') { const w = Math.floor(W / 2); return [{ x: 0, y: 0, w, h: H }, { x: w, y: 0, w: W - w, h: H }]; }
  return [{ x: 0, y: 0, w: W, h: H }];
})();
// The Derby Overview camera (P1-U05.4, R107): the shared rig, anchored to the bowl; &cam=round0 is round 0's refit.
const ovRig = (P.get('cam') === 'round0' ? createRound0Rig : createOverviewRig)(FRAMING.overview, { x: BOWL.x, z: BOWL.z });
const world = await createWorld(canvas, { colors, tileHeight: Math.min(...rects.map((r) => r.h)), mode, trackTimestamp: q.get('ts') === '1', overrides: Object.fromEntries(['bloom', 'halftone', 'fxaa'].filter((k) => q.has(k)).map((k) => [k, q.get(k) === '1'])), fx });
world.resize(W, H);

const ui = document.getElementById('ui');
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let cars = [];
if (name === 'paint') {
  // On the bowl's clean floor, nose-on in a shallow arc, so each paint reads lit and in shade next to its flat badge.
  cars = colors.map((paint, i) => ({ paint, fixed: true, x: BOWL.x + (i - (colors.length - 1) / 2) * 3.3, z: BOWL.z - Math.abs(i - (colors.length - 1) / 2) * 0.35, yaw0: 0.32 }));
} else if (name === 'overview') {
  cars = Array.from({ length: N }, (_, i) => ({ paint: colors[i % colors.length] }));
} else if (name === 'shimmer') {
  cars = [];
} else if (name === 'closeup') {
  const f = world.frames[20];
  cars = [{ paint: colors[0], fixed: true, x: f.p.x, z: f.p.z, yaw0: Math.atan2(f.t.x, f.t.z), brake0: 1, boost0: 1 }];
} else {
  cars = Array.from({ length: Math.max(N, 8) }, (_, i) => ({ paint: colors[i % colors.length], s: world.trackLen * 3 + 60 - Math.floor(i / 4) * 9, lane: ((i % 4) - 1.5) * 3.1, skill: 0.92 + ((i * 37) % 17) / 100 }));
}
world.setCars(cars);
world.setTiles(rects);

// U02's per-tile HUD (same classes, same tokens) over the grid tiles, so the look is judged under the real chrome.
const hud = [];
if (name === 'grid' || name === 'tv') {
  rects.forEach((r, i) => {
    const seat = i + 1, c = seatColor(tokens, seat);
    const t = el('div', 'tile');
    Object.assign(t.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    t.style.setProperty('--seat', c.hex); t.style.setProperty('--seat-on', c.on);
    t.style.setProperty('--t', String(Math.max(0.35, Math.min(1.3, r.h / (540 * k())))));
    if (r.w < 300 * k() || r.h < 170 * k()) t.classList.add('compact');
    t.innerHTML = `<div class="hud-top"><div class="hud-t hud-tl"><span class="badge hud-badge">#${seat}</span><span class="hud-name">${NAMES[i % NAMES.length]}</span></div><div class="hud-t hud-tr"><span class="display hud-pos tnum">${i + 1}<sup>${['th', 'st', 'nd', 'rd'][((i + 1) % 10 > 3 || [11, 12, 13].includes((i + 1) % 100)) ? 0 : (i + 1) % 10]}</sup></span><span class="hud-lap tnum">Lap 1/3</span></div></div><div class="hud-boost"><i style="width:${30 + ((i * 23) % 60)}%"></i></div>`;
    ui.append(t);
    hud.push(t);
  });
}
const paintBadges = [];
if (name === 'paint') {
  ui.append(el('div', 'paint-title display italic', 'Paint next to its badge'));
  colors.forEach((_, i) => { const c = seatColor(tokens, i + 1); const b = el('span', 'badge paint-badge', `#${i + 1}`); b.style.setProperty('--seat', c.hex); b.style.setProperty('--seat-on', c.on); b.style.fontSize = `calc(var(--k) * 34px)`; ui.append(b); paintBadges.push(b); });
}
const plates = [];
if (name === 'overview') {
  world.cars.forEach((_, i) => {
    const c = seatColor(tokens, i + 1);
    const p = el('div', 'nameplate', `<span class="badge">#${i + 1}</span><span class="plate-name">${NAMES[i % NAMES.length]}</span>`);
    p.firstChild.style.setProperty('--seat', c.hex); p.firstChild.style.setProperty('--seat-on', c.on);
    ui.append(p); plates.push(p);
  });
}
if (name === 'graphics') {
  for (const [i, label] of ['Start-finish banner', 'W-beam guard rail and terminal', 'Corner chevron posts', 'Guard rail along the track'].entries()) {
    const r = rects[i];
    const tag = el('div', 'graphics-label display', label);
    Object.assign(tag.style, { left: `${r.x + 16}px`, top: `${r.y + 14}px` });
    ui.append(tag);
  }
}

// ---- cameras per state ----
const V = new THREE.Vector3();
// #shimmer: a camera at the chase framing's height and pitch, crawling down the start straight at walking pace with no car, so
// only the road, its lines and the kerbs move on screen. shimmerAt(m) puts it m metres along, for the frame-by-frame metric.
let crawl = 0, crawlRun = true;
function shimmerCam(m, i = 0) {
  const R = FRAMING.chase[FRAMING.distance.default], f = world.frames, step = world.trackLen / (f.length - 1);
  const s = 8 + m, j = Math.floor(s / step), a = f[j], b = f[j + 1], t = s / step - j;
  const p = a.p.clone().lerp(b.p, t), dir = a.t.clone().lerp(b.t, t).normalize();
  world.aimFixed(i, V.copy(p).addScaledVector(dir, -R.backM).setY(R.upM), p.clone().addScaledVector(dir, R.lookAheadM).setY(R.lookUpM), R.fovDeg);
  if (i === 0) world.placeSun(p);
}
function aim(dt) {
  // &n=24: the same crawl in every tile of a 24-tile grid, staggered, where the lines are a few pixels wide; &speed= m/s
  if (name === 'shimmer') { if (crawlRun) crawl = (crawl + dt * +(P.get('speed') ?? (rects.length > 1 ? 6 : 1.2))) % 60; rects.forEach((_, i) => shimmerCam((crawl + i * 2.5) % 60, i)); return; }
  if (name === 'closeup') {
    const c = world.cars[0], side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), c.fwd).normalize();
    world.aimFixed(0, V.copy(c.pos).addScaledVector(c.fwd, 5.2).addScaledVector(side, -4.4).setY(2.1), c.pos.clone().setY(0.55), 44); // front three-quarter, its shaded flank and cast shadow
    world.aimFixed(1, V.copy(c.pos).addScaledVector(c.fwd, -5.6).addScaledVector(side, 2.6).setY(1.7), c.pos.clone().addScaledVector(c.fwd, -0.6).setY(0.6), 44); // rear: brake lamps and the boost flame
    world.placeSun(c.pos);
    return;
  }
  if (name === 'grid' || name === 'tv') {
    rects.forEach((r, i) => world.aimTile(i, world.cars[i % world.cars.length], (name === 'grid' && [4, 11, 18].includes(i)) ? 'fp' : 'tp', P.get('dist') ?? undefined));
  } else if (name === 'paint') {
    world.aimFixed(0, V.set(BOWL.x + 3, 6.6, BOWL.z + 34), new THREE.Vector3(BOWL.x, 0.2, BOWL.z - 1), 42);
    world.placeSun(new THREE.Vector3(BOWL.x, 0, BOWL.z));
  } else if (name === 'overview') {
    const p = ovRig.update(world.cars.map((c) => ({ x: c.pos.x, z: c.pos.z })), dt, W / H);
    const ctr = new THREE.Vector3(...p.target);
    world.aimFixed(0, V.set(...p.position), ctr, FRAMING.overview.fovDeg);
    world.placeSun(ctr);
  } else if (name === 'graphics') {
    const f = world.frames;
    const view = (i, idx, side, back, up, fwd) => { const p = f[idx].p, n = f[idx].n, t = f[idx].t; world.aimFixed(i, V.copy(p).addScaledVector(n, side).addScaledVector(t, -back).setY(up), new THREE.Vector3().copy(p).addScaledVector(t, fwd).setY(2.5), 52); };
    view(0, 10, 3, 26, 5, 0);
    // a rail run's flared terminal, from the verge: the W-beam, its posts and a delineator
    const term = world.graphics.terminals.find((x) => x.i > 150) ?? world.graphics.terminals[0];
    if (term) { const tf = f[term.i]; world.aimFixed(1, V.copy(term.p).addScaledVector(tf.n, term.side * 5).addScaledVector(tf.t, -7).setY(1.7), new THREE.Vector3().copy(term.p).addScaledVector(tf.t, 6).setY(0.5), 50); }
    const chev = world.graphics.chevrons[2]?.position ?? f[60].p;
    world.aimFixed(2, V.copy(chev).add(new THREE.Vector3(-14, 4, -10)), chev, 48);
    view(3, 112, 9, 18, 3.2, 8);
  }
  if (name !== 'overview' && name !== 'paint') {
    const c = world.cars[0];
    world.placeSun(name === 'grid' || name === 'tv' ? new THREE.Vector3(25, 0, 95) : (c?.pos ?? new THREE.Vector3()));
  }
}

let last = performance.now(), frames = 0;
const stats = { cpu: [], interval: [] };
function loop(now) {
  const dt = FREEZE ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
  stats.interval.push(now - last);
  last = now;
  const t0 = performance.now();
  world.step(name === 'shimmer' && !crawlRun ? 0 : dt, name === 'overview' ? 'overview' : 'race'); // a stopped #shimmer crawl also stops the sim clock (flares, beacons)
  aim(dt);
  world.render();
  if (paintBadges.length) {
    const cam = world.array.cameras[0];
    world.cars.forEach((c, i) => { const p = V.copy(c.pos).setY(-0.2).project(cam); paintBadges[i].style.left = `${(p.x * 0.5 + 0.5) * W}px`; paintBadges[i].style.top = `${(-p.y * 0.5 + 0.5) * H + 18 * k()}px`; });
  }
  if (plates.length) {
    const cam = world.array.cameras[0];
    world.cars.forEach((c, i) => { const p = V.copy(c.pos).setY(2.4).project(cam); plates[i].style.left = `${(p.x * 0.5 + 0.5) * W}px`; plates[i].style.top = `${(-p.y * 0.5 + 0.5) * H}px`; });
  }
  if (FREEZE && frames + 1 === FREEZE) { // the last frame: copy it in the same task as its render, before the canvas is presented
    snap = document.createElement('canvas'); snap.width = canvas.width; snap.height = canvas.height;
    snap.getContext('2d').drawImage(canvas, 0, 0);
  }
  stats.cpu.push(performance.now() - t0);
  if (stats.cpu.length > 600) { stats.cpu.splice(0, 300); stats.interval.splice(0, 300); }
  frames++;
  window.__world.ready = FREEZE ? frames >= FREEZE : frames > 30;
  if (FREEZE && frames >= FREEZE) return; // frozen: no more frames
  requestAnimationFrame(loop);
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };

/**
 * Which ground and which dressing the Overview camera keeps in view (P1-U05.4, POC2-08; the zones for P1-M10). The rig's
 * envelope is its centre anywhere within maxDriftM of the bowl's and its frame anywhere from minFrameM to maxFrameM; this
 * tests the extremes (both frames × centred and drifted north, south, east, west). "always" = in view in every one,
 * "sometimes" = in at least one. Ground is reported as one [xMin, xMax] span per `cellM` row (bowl-local metres; the
 * footprints are convex). Each dressing item is in view if its base or its top is.
 */
function overviewZones({ cellM = 8, reach = 220 } = {}) {
  const O = FRAMING.overview, pitch = THREE.MathUtils.degToRad(O.pitchDeg), vfov = THREE.MathUtils.degToRad(O.fovDeg);
  const cam = new THREE.PerspectiveCamera(O.fovDeg, W / H, 0.5, 3000), q = new THREE.Vector3();
  const states = [];
  for (const f of [O.minFrameM, O.maxFrameM]) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) states.push({ f, cx: dx * O.maxDriftM, cz: dz * O.maxDriftM });
  const seen = (st, x, y, z) => {
    const dist = st.f / 2 / Math.tan(vfov / 2) + 6;
    cam.position.set(BOWL.x + st.cx, Math.sin(pitch) * dist, BOWL.z + st.cz + Math.cos(pitch) * dist);
    cam.lookAt(BOWL.x + st.cx, 0, BOWL.z + st.cz); cam.updateMatrixWorld();
    q.set(BOWL.x + x, y, BOWL.z + z).project(cam);
    return Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z < 1;
  };
  const rows = { always: [], sometimes: [] };
  for (let z = -reach; z <= reach; z += cellM) {
    for (const kind of ['always', 'sometimes']) {
      const xs = [];
      for (let x = -reach; x <= reach; x += cellM) { const n = states.filter((st) => seen(st, x, 0, z)).length; if (kind === 'always' ? n === states.length : n > 0) xs.push(x); }
      if (xs.length) rows[kind].push({ z, x: [xs[0], xs.at(-1)] });
    }
  }
  const items = world.graphics.dressing.map((d) => {
    const n = states.filter((st) => seen(st, d.x, 0, d.z) || seen(st, d.x, d.h, d.z)).length;
    return { ...d, zone: n === states.length ? 'always' : n > 0 ? 'sometimes' : 'never', seenIn: `${n}/${states.length}` };
  });
  return { format: 'jj.overview-zones.v1', note: 'Bowl-local metres (x east, z south; the camera looks north). Ground spans per row; dressing classified by the Overview rig envelope (framing.json overview).', bowl: { r: BOWL.r }, envelope: { minFrameM: O.minFrameM, maxFrameM: O.maxFrameM, maxDriftM: O.maxDriftM, pitchDeg: O.pitchDeg, fovDeg: O.fovDeg, aspect: +(W / H).toFixed(3) }, cellM, ground: rows, dressing: items };
}
window.__world = {
  ready: false,
  backend: world.backend,
  looks: LOOKS,
  options: () => world.options(),
  kitStats: () => world.kitStats(),
  setLook(id) { world.applyLook(LOOKS.looks.find((l) => l.id === id)); markBar(); return world.options(); },
  /** #shimmer: stop the crawl (and the sim clock) and show the frame m metres along (two frames later it is on screen). */
  async shimmerAt(m) { crawlRun = false; crawl = m; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return m; },
  /** #shimmer: the road and its kerbs (±halfM from the centre line) in screen pixels for the first tile, as one polygon: the
   *  shimmer metric's road mask. */
  roadPolygon(halfM = 8.3) {
    const cam = world.array.cameras[0], f = world.frames, L = [], R = [], p = new THREE.Vector3();
    for (let i = 0; i < 160; i++) {
      const fr = f[i];
      for (const [side, arr] of [[-1, L], [1, R]]) {
        p.copy(fr.p).addScaledVector(fr.n, side * halfM).project(cam);
        if (p.z < 1 && p.z > -1) arr.push([(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]);
      }
    }
    return [...L, ...R.reverse()];
  },
  staticStats: world.staticStats,
  /** Each tile's cars as screen boxes (br-dim.11 ink check): the eight corners of the car box, projected through the tile's camera
   *  (CSS px, canvas top-left), clipped to the tile; only cars wholly in front of the camera and at least one pixel big. */
  carBoxes() {
    const out = [], v = new THREE.Vector3(), cb = world.carBox;
    rects.forEach((r, ti) => {
      const cam = world.array.cameras[ti], list = [];
      for (const c of world.cars) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ok = true;
        const yaw = Math.atan2(c.fwd.x, c.fwd.z), cs = Math.cos(yaw), sn = Math.sin(yaw);
        for (const x of [cb.min.x, cb.max.x]) for (const y of [cb.min.y, cb.max.y]) for (const z of [cb.min.z, cb.max.z]) {
          v.set(c.pos.x + x * cs + z * sn, y, c.pos.z - x * sn + z * cs).project(cam);
          if (v.z >= 1 || v.z <= -1) { ok = false; break; }
          const px = r.x + (v.x * 0.5 + 0.5) * r.w, py = r.y + (-v.y * 0.5 + 0.5) * r.h;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        if (!ok) continue;
        const cx0 = Math.max(x0, r.x), cy0 = Math.max(y0, r.y), cx1 = Math.min(x1, r.x + r.w), cy1 = Math.min(y1, r.y + r.h);
        if (cx1 - cx0 < 1 || cy1 - cy0 < 1) continue;
        const full = (x1 - x0) * (y1 - y0), vis = (cx1 - cx0) * (cy1 - cy0);
        if (vis < 0.6 * full) continue; // mostly off the tile: not a fair box
        list.push({ id: c.id, paint: c.paint, x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 });
      }
      out.push({ tile: ti, rect: { ...r }, cars: list });
    });
    return out;
  },
  /** ?freeze=N: the frozen frame as a 2D canvas (canvas pixels), or null before it. */
  snapshot: () => snap,
  /** The tile rectangles in canvas CSS pixels: the compare page's mask (the gutters between tiles are not the scene). */
  tileRects: () => rects.map((r) => ({ ...r })),
  overviewZones,
  /** Frame cost: `rafFrames` vsync-bound frames (rAF interval) and `gpuFrames` frames timed by GPU timestamp queries (ms of GPU
   *  execution for every render pass of the frame: the scene pass over all tiles plus the post chain). Needs ?ts=1. */
  async perf(rafFrames = 240, gpuFrames = 120) {
    const mark = frames; // a running count: the stats arrays are trimmed as they grow, so their length can't mark time
    await new Promise((res) => { const tick = () => (frames - mark >= rafFrames ? res() : requestAnimationFrame(tick)); tick(); });
    const iv = stats.interval.slice(-rafFrames), cpu = stats.cpu.slice(-rafFrames);
    const gpu = [];
    if (world.renderer.backend.trackTimestamp) {
      for (let i = 0; i < gpuFrames; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const ms = await world.renderer.resolveTimestampsAsync('render');
        if (typeof ms === 'number' && ms > 0) gpu.push(ms);
      }
    }
    return { state: location.hash || '#grid', mode, options: world.options(), viewport: `${W}x${H}`, tiles: rects.length, minTileH: Math.min(...rects.map((r) => r.h)), backend: world.backend, frame_ms_p50: +pct(iv, 0.5).toFixed(2), frame_ms_p95: +pct(iv, 0.95).toFixed(2), cpu_submit_ms_mean: +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2), gpu_ms_p50: gpu.length ? +pct(gpu, 0.5).toFixed(2) : null, gpu_ms_p95: gpu.length ? +pct(gpu, 0.95).toFixed(2) : null, gpu_samples: gpu.length };
  },
};
// ---- the look panel (P1-U05, br-dim.12): collapsed to a 44 px button in the corner by default (it never covers the view), docked to
// the right (landscape) or the bottom (portrait) when open, and dismissed by its Close or Escape (the world re-lays out beside it: it never covers a tile). &panel=1 opens it. ----
// Looks switch live; the other options reload the page with the new parameter. GTAO and SMAA are not in the panel: the A/B compare
// (docs/evidence/br-dim.12/decisions.md) found no visible benefit at the sizes players see; ?ao=1 and ?smaa=1 still work for the compare page.
const bar = el('div', 'look-bar');
const markBar = () => { for (const b of bar.querySelectorAll('[data-look]')) b.classList.toggle('on', b.dataset.look === world.options().look); };
if (q.get('bar') !== '0') {
  const toggle = el('button', 'look-toggle', 'Look');
  toggle.type = 'button'; toggle.title = 'Look settings'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'look-panel');
  bar.id = 'look-panel';
  // opening or closing re-lays the world out in the space left, so it reloads with &panel=1 (the state is in the URL)
  const setOpen = (on) => { const u = new URL(location.href); if (on) u.searchParams.set('panel', '1'); else u.searchParams.delete('panel'); location.href = u.href; };
  toggle.onclick = () => setOpen(true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) setOpen(false); });
  const head = el('div', 'look-head', '<span>Look settings</span>');
  const close = el('button', null, 'Close'); close.type = 'button'; close.onclick = () => setOpen(false); head.append(close);
  const looks = el('div', 'look-row');
  for (const L of LOOKS.looks) {
    const b = el('button', null, `${L.name.replace(' (for comparison)', '')}${L.id === LOOKS.recommended ? ' <i>recommended</i>' : ''}`);
    b.dataset.look = L.id; b.title = L.why;
    b.onclick = () => { window.__world.setLook(L.id); const u = new URL(location.href); u.searchParams.set('look', L.id); history.replaceState(null, '', u); };
    looks.append(b);
  }
  const reload = (k, v) => { const u = new URL(location.href); if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v); u.searchParams.set('panel', '1'); location.href = u.href; };
  const o = world.options();
  const pick = (label, k, values, now) => { const s = el('label', null, `${label} `); const sel = el('select'); for (const [v, t] of values) { const op = el('option', null, t); op.value = v; op.selected = String(now) === v; sel.append(op); } sel.onchange = () => reload(k, sel.value); s.append(sel); return s; };
  const opts = el('div', 'look-row small');
  opts.append(
    pick('Ink', 'ink', [['outer', 'outer silhouette (rec.)'], ['silhouette', 'silhouette only'], ['full', 'round 0 (everywhere)'], ['none', 'no ink']], o.ink),
    pick('Shadows', 'shadow', [['pcf', 'PCF 4096 (rec.)'], ['soft', 'PCF soft'], ['vsm', 'VSM'], ['csm', 'cascaded (1 view)'], ['off', 'off']], o.shadow),
    pick('Road', 'roadtex', [['1', 'textured + AF (rec.)'], ['0', 'round 1 lines']], o.roadtex ? '1' : '0'),
    pick('Emissive kit', 'emissive', [['1', 'on'], ['0', 'off']], o.emissive ? '1' : '0'),
  );
  // A/B compare: the same frozen frame with the setting on and off (compare.js)
  const cmp = el('div', 'look-row small', 'A/B compare ');
  for (const [k, t] of [['shadows', 'Shadows'], ['smaa', 'SMAA'], ['gtao', 'GTAO']]) { const b = el('button', null, t); b.type = 'button'; b.onclick = () => { const u = new URL(location.href); u.hash = `#compare=${k}`; const had = u.searchParams.delete('panel') || q.has('panel'); location.href = u.href; if (!had) location.reload(); }; cmp.append(b); }
  bar.append(head, looks, opts, cmp);
  document.body.append(bar, toggle); // outside #ui, which is sized to the view
  bar.classList.toggle('open', panelOpen); toggle.hidden = panelOpen;
  markBar();
}

requestAnimationFrame(loop);
