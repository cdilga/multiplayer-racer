// main.js — the in-world look page (P1-U05). States by URL fragment:
//   #grid&n=24        24 live tiles under U02's HUD (the cost case)       #tv          one full-screen tile
//   #overview&n=16    the derby bowl from the fixed 60° Overview camera   #paint       each identity colour as paint next to its badge
//   #graphics         the start-finish banner, W-beam guard rail, chevron posts (P1-U05.3)
// &dist=near|mid|far|round0 picks the race-tile camera distance (../shared/framing.json, P1-U05.2).
// ?mode=full|ids|plain picks the post tier (full look / outlines on objects only / no post) for the cost table.
import * as THREE from 'three/webgpu';
import { loadTokens, seatColor } from '../shared/tokens.js';
import { layoutGrid } from '../tv/grid.js';
import { createWorld, BOWL } from './world.js';

const tokens = await loadTokens();
const k = () => window.innerHeight / 1080;
document.documentElement.style.setProperty('--k', String(k()));
const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'full';
const [state, ...rest] = location.hash.replace(/^#/, '').split('&');
const P = new URLSearchParams(rest.join('&'));
const name = state || 'grid';
const N = +(P.get('n') ?? (name === 'grid' ? 24 : name === 'overview' ? 16 : 12));
const colors = tokens.identity.colors.map((c) => c.hex);
const NAMES = ['Dusty', 'Pip', 'Ash', 'Kai', 'Big Kev', 'Mia', 'Snag', 'Shaz', 'Roo Boy', 'Tiggy', 'Mack', 'Maximilian', 'Jojo', 'Nina', 'Bazza', 'Wren', 'Sakura', 'Zara', 'Tama', 'Lulu', 'Ned', 'Hamish', 'Priya', 'Wei', 'Sione', 'Ana', 'Jack', 'Ruby', 'Archie', 'Isla', 'Leo', 'Matilda'];

const canvas = document.getElementById('world');
const W = window.innerWidth, H = window.innerHeight;
const rects = (() => {
  if (name === 'grid') return layoutGrid(N, { x: 0, y: 0, w: W, h: H }, { gutter: 6 * k() }).tiles.map((t) => ({ x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h) }));
  if (name === 'graphics') { const w = Math.floor(W / 2), h = Math.floor(H / 2); return [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({ x, y, w, h })); }
  return [{ x: 0, y: 0, w: W, h: H }];
})();
const world = await createWorld(canvas, { colors, tileHeight: Math.min(...rects.map((r) => r.h)), mode, trackTimestamp: q.get('ts') === '1', overrides: Object.fromEntries(['bloom', 'halftone', 'fxaa'].filter((k) => q.has(k)).map((k) => [k, q.get(k) === '1'])) });
world.resize(W, H);

const ui = document.getElementById('ui');
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let cars = [];
if (name === 'paint') {
  // On the bowl's clean floor, nose-on in a shallow arc, so each paint reads lit and in shade next to its flat badge.
  cars = colors.map((paint, i) => ({ paint, fixed: true, x: BOWL.x + (i - (colors.length - 1) / 2) * 3.3, z: BOWL.z - Math.abs(i - (colors.length - 1) / 2) * 0.35, yaw0: 0.32 }));
} else if (name === 'overview') {
  cars = Array.from({ length: N }, (_, i) => ({ paint: colors[i % colors.length] }));
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
function aim(dt) {
  if (name === 'grid' || name === 'tv') {
    rects.forEach((r, i) => world.aimTile(i, world.cars[i % world.cars.length], (name === 'grid' && [4, 11, 18].includes(i)) ? 'fp' : 'tp', P.get('dist') ?? undefined));
  } else if (name === 'paint') {
    world.aimFixed(0, V.set(BOWL.x + 3, 6.6, BOWL.z + 34), new THREE.Vector3(BOWL.x, 0.2, BOWL.z - 1), 42);
    world.placeSun(new THREE.Vector3(BOWL.x, 0, BOWL.z));
  } else if (name === 'overview') {
    const box = new THREE.Box3();
    for (const c of world.cars) box.expandByPoint(c.pos);
    box.expandByScalar(9);
    const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const pitch = THREE.MathUtils.degToRad(60), aspect = W / H, vfov = THREE.MathUtils.degToRad(48);
    const dist = Math.max(size.z * Math.sin(pitch) + 4, size.x / aspect) / 2 / Math.tan(vfov / 2) + 6;
    world.aimFixed(0, V.set(ctr.x, Math.sin(pitch) * dist, ctr.z + Math.cos(pitch) * dist), ctr, 48);
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
  const dt = Math.min(0.05, (now - last) / 1000);
  stats.interval.push(now - last);
  last = now;
  const t0 = performance.now();
  world.step(dt, name === 'overview' ? 'overview' : 'race');
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
  stats.cpu.push(performance.now() - t0);
  if (stats.cpu.length > 600) { stats.cpu.splice(0, 300); stats.interval.splice(0, 300); }
  frames++;
  window.__world.ready = frames > 30;
  requestAnimationFrame(loop);
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
window.__world = {
  ready: false,
  backend: world.backend,
  staticStats: world.staticStats,
  /** Frame cost: `rafFrames` vsync-bound frames (rAF interval) and `gpuFrames` frames timed by GPU timestamp queries (ms of GPU
   *  execution for every render pass of the frame: the scene pass over all tiles plus the post chain). Needs ?ts=1. */
  async perf(rafFrames = 240, gpuFrames = 120) {
    const mark = stats.interval.length;
    await new Promise((res) => { const tick = () => (stats.interval.length - mark >= rafFrames ? res() : requestAnimationFrame(tick)); tick(); });
    const iv = stats.interval.slice(-rafFrames), cpu = stats.cpu.slice(-rafFrames);
    const gpu = [];
    if (world.renderer.backend.trackTimestamp) {
      for (let i = 0; i < gpuFrames; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const ms = await world.renderer.resolveTimestampsAsync('render');
        if (typeof ms === 'number' && ms > 0) gpu.push(ms);
      }
    }
    return { state: location.hash || '#grid', mode, viewport: `${W}x${H}`, tiles: rects.length, minTileH: Math.min(...rects.map((r) => r.h)), backend: world.backend, frame_ms_p50: +pct(iv, 0.5).toFixed(2), frame_ms_p95: +pct(iv, 0.95).toFixed(2), cpu_submit_ms_mean: +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2), gpu_ms_p50: gpu.length ? +pct(gpu, 0.5).toFixed(2) : null, gpu_ms_p95: gpu.length ? +pct(gpu, 0.95).toFixed(2) : null, gpu_samples: gpu.length };
  },
};
requestAnimationFrame(loop);
