// reel.js — the live motion reel (P1-U05 part 3). Built on U02's TV mocks: the same world (../tv/world.js), grid rule
// (../tv/grid.js), token loader (../shared/tokens.js) and CSS (../tv/tv.css). Every duration, easing, repeat and stagger is read
// from art/ui/tokens.json (tokens.motion) at runtime; the full and reduced variants come from each named motion's `reduced` entry.
// Nothing here is game code: U02's main.js is a page, not a module, so the tile / lobby / results markup is rebuilt below with
// U02's class names (the hook that would remove that duplication is named in README.md).
//
// window.__reel = { ready, play(name), playAll(), timeline, ... } drives it from a script (record.mjs).
import { loadTokens, seatColor, asset } from '../shared/tokens.js';
import { createWorld } from '../tv/world.js';
import { layoutGrid } from '../tv/grid.js';
import { Color } from 'three';

const tokens = await loadTokens();
const MT = tokens.motion;
const warnings = [];

// ------------------------------------------------------------------------------------------------ tokens
const qs = new URLSearchParams(location.search);
const mq = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = qs.has('reduced') ? qs.get('reduced') !== '0' : mq.matches; // ?reduced=1 | 0 wins over the OS setting
const dur = (key) => MT.durationsMs[key];
/** A named motion resolved for the current mode (reduced entries override duration / repeat / does). */
function nm(name) {
  const n = MT.named[name];
  if (!n) throw new Error(`tokens.motion.named.${name} missing`);
  const r = reduced ? n.reduced : null;
  return { name, durationMs: r?.durationMs ?? n.durationMs, repeat: r?.repeat ?? n.repeat ?? 1, easing: n.easing, does: r?.does ?? n.does, full: n, reduced: n.reduced };
}
/** Pull a number the tokens only state in prose (e.g. "staggered by 150 ms"); warn and fall back if the wording changes. */
function prose(text, re, fallback, what) {
  const m = re.exec(text);
  if (m) return m.slice(1).map(Number);
  warnings.push(`tokens.motion: could not read ${what} from "${text}"; using ${JSON.stringify(fallback)}`);
  return fallback;
}
const STICKER = (() => {
  const t = MT.named['sticker-in'].does;
  const [from, to] = prose(t, /Scale\s+([\d.]+)\s+to\s+([\d.]+)/i, [0.6, 1], 'sticker-in scale');
  const [deg] = prose(t, /(\d+(?:\.\d+)?)\s*degree/i, [4], 'sticker-in settle degrees');
  return { from, to, deg };
})();
const PUNCH = (() => { const [from, to] = prose(MT.named['countdown-beat'].does, /scale\s+([\d.]+)\s+to\s+([\d.]+)/i, [1.4, 1], 'countdown-beat scale'); return { from, to }; })();
const STAGGER_MS = prose(MT.named['results-reveal'].does, /staggered by\s+(\d+)\s*ms/i, [150], 'results-reveal stagger')[0];
const SLIDE_PX = prose(MT.named.toast.does, /Slides in\s+(\d+)\s*px/i, [16], 'toast slide')[0];

// ------------------------------------------------------------------------------------------------ easing
function bezier(str) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(str);
  if (!m) return (x) => x;
  const [x1, y1, x2, y2] = m[1].split(',').map(Number);
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x; if (Math.abs(e) < 1e-6) return Y(t); const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) { const e = X(t); if (Math.abs(e - x) < 1e-6) break; if (e < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}
const EASE = Object.fromEntries(Object.entries(MT.easing).map(([k, v]) => [k, bezier(v)]));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ------------------------------------------------------------------------------------------------ clock and tweens
// One clock for everything: performance.now() minus any time spent paused for a still (record.mjs stills pass only).
let pausedAt = null, pausedTotal = 0;
const now = () => (pausedAt ?? performance.now()) - pausedTotal;
const tweens = new Set();
const timeline = [];

/** Run update(p, eased) over `duration` ms of the reel clock, starting on the first frame after `delay`. A 0 ms motion is a cut:
 * applied at once, in the caller's turn. Resolves { start, end, rawStart, rawEnd, measuredMs, frames } (start/end = first and
 * last frame the motion was applied on). marks: [[p, name]] call shot(name) when progress passes p. */
function tween({ duration, delay = 0, ease = (x) => x, update, onStart, onEnd, marks = [] }) {
  if (duration <= 0 && delay <= 0) {
    const t = now(), raw = performance.now();
    onStart?.(); update?.(1, 1); onEnd?.();
    return Promise.resolve({ start: t, end: t, rawStart: raw, rawEnd: raw, measuredMs: 0, frames: 0 });
  }
  return new Promise((resolve) => tweens.add({ due: now() + delay, duration, ease, update, onStart, onEnd, marks: [...marks].sort((a, b) => a[0] - b[0]), resolve, started: null, frames: 0 }));
}
function runTweens() {
  const t = now(), raw = performance.now();
  for (const w of [...tweens]) {
    if (t < w.due) continue;
    if (w.started === null) { w.started = t; w.rawStart = raw; w.onStart?.(); }
    const p = w.duration > 0 ? clamp01((t - w.started) / w.duration) : 1;
    w.update?.(p, w.ease(p));
    w.frames++;
    while (w.marks.length && p >= w.marks[0][0]) shot(w.marks.shift()[1]);
    if (p >= 1) {
      tweens.delete(w);
      w.onEnd?.();
      w.resolve({ start: w.started, end: t, rawStart: w.rawStart, rawEnd: raw, measuredMs: t - w.started, frames: w.frames });
    }
  }
}
const sleep = (ms) => tween({ duration: ms });
let frameWaiters = [];
const nextFrame = () => new Promise((r) => frameWaiters.push(r));

/** Hand the page to a screenshotter (record.mjs exposes __reelShot in its stills pass); the reel clock stops while it runs. */
let shotChain = Promise.resolve(), shotDepth = 0;
function shot(name) {
  if (typeof window.__reelShot !== 'function') return Promise.resolve();
  name = `${curStep ?? 'x'}-${name}`;
  if (shotDepth === 0) pausedAt = performance.now(); // the reel clock stops here, synchronously
  shotDepth++;
  shotChain = shotChain.then(() => window.__reelShot(name)).catch(() => {}).finally(() => {
    shotDepth--;
    if (shotDepth === 0) { pausedTotal += performance.now() - pausedAt; pausedAt = null; }
  });
  return shotChain;
}

// ------------------------------------------------------------------------------------------------ stage
const ui = document.getElementById('ui');
const canvas = document.getElementById('world');
const colors = tokens.identity.colors.map((c) => c.hex);
const world = await createWorld(canvas, { colors });
// U02's Identify outline is an inverted hull in the seat colour, 9 % larger than the body: on a car painted that colour it reads as a faint
// fringe. Wrapping the renderer's render() lets the reel find that group (it is private to world.js) and give it a bright, thicker rim.
let sceneRef = null;
{ const r = world.renderer, orig = r.render.bind(r); r.render = (sc, cam) => { sceneRef ??= sc; return orig(sc, cam); }; }
function brightenOutlines() {
  const grp = sceneRef?.children.find((c) => c.children.length && c.children.every((m) => m.userData?.seat));
  for (const m of grp?.children ?? []) { m.material.color.lerp(new Color('#ffffff'), 0.55); m.scale.setScalar(1.15); }
}
const rect = { sx: 0, sy: 0, sw: 1749, sh: 984 };
const W = () => rect.sw, H = () => rect.sh, K = () => rect.sh / 1080;
function layoutStage() {
  const vw = window.innerWidth, vh = window.innerHeight, vk = vh / 1080;
  const bar = Math.round(96 * vk), availH = vh - bar; // 96 px annotation bar at 1080p
  const sh = Math.floor(Math.min(availH, (vw * 9) / 16)), sw = Math.floor((sh * 16) / 9);
  Object.assign(rect, { sx: Math.round((vw - sw) / 2), sy: bar + Math.round((availH - sh) / 2), sw, sh });
  const root = document.documentElement.style;
  root.setProperty('--k', String(sh / 1080));
  root.setProperty('--vk', String(vk));
  for (const e of [canvas, ui]) Object.assign(e.style, { left: `${rect.sx}px`, top: `${rect.sy}px`, width: `${sw}px`, height: `${sh}px` });
  world.resize(sw, sh);
}
layoutStage();
window.addEventListener('resize', layoutStage);

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const icon = (name) => `<img alt="" src="${asset(`icons/${name}.svg`)}">`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ordinal = (n) => { const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; return [n, s]; };
const NAMES = ['Dusty', 'Pip', 'Ash', 'Kai', 'Big Kev', 'Mia', 'Snag', 'Shaz'];
function seatInfo(seat) { const c = seatColor(tokens, seat); return { seat, num: seat, name: NAMES[(seat - 1) % NAMES.length], color: c.hex, on: c.on }; }

let scene = { type: 'none', views: () => [], update() {} };
let layer = null;
let clearColor = tokens.palette.ink.hex;
let G = null; // the active grid scene (tiles), when scene.type === 'grid'

function newLayer({ hidden = false } = {}) {
  layer?.remove();
  layer = el('div', 'stage k');
  if (hidden) { layer.style.opacity = '0'; if (!reduced) layer.style.transform = `translateY(${SLIDE_PX * K()}px)`; }
  ui.append(layer);
  return layer;
}

// ------------------------------------------------------------------------------------------------ grid scene
const FP_SEATS = new Set([2]);
const START_N = 5, JOIN_SEAT = START_N + 1; // five racers on the grid; #6 (pink: reads on the ink gutters and on the red earth) joins, is identified, wrecks and respawns
function buildGrid(n, { fresh = false, frozen = false, hidden = false } = {}) {
  newLayer({ hidden });
  world.setMode('race');
  if (fresh) world.setCars(0);
  world.setCars(n);
  world.setOutlines([]);
  clearColor = tokens.palette.ink.hex;
  const g = { type: 'grid', n, seats: Array.from({ length: n }, (_, i) => i + 1), tiles: new Map(), frozen, fillersEl: el('div', 'fillers'), chip: null, last: new Map() };
  G = g;
  scene = g;
  layer.append(g.fillersEl);
  const lay = layoutGrid(n, { x: 0, y: 0, w: W(), h: H() }, { gutter: 6 * K() });
  g.seats.forEach((seat, i) => g.tiles.set(seat, makeTile(seat, lay.tiles[i], lay.tiles[i])));
  drawFillers(lay);
  g.views = () => gridViews(g);
  g.update = () => gridUpdate(g);
  return g;
}

function makeTile(seat, cur, tgt) {
  const info = seatInfo(seat);
  const t = el('div', 'tile');
  t.dataset.seat = String(info.num);
  t.style.setProperty('--seat', info.color);
  t.style.setProperty('--seat-on', info.on);
  const tl = el('div', 'hud-t hud-tl');
  const badge = el('span', 'badge hud-badge', `#${info.num}`);
  const name = el('span', 'hud-name');
  name.textContent = info.name;
  tl.append(badge, name);
  const top = el('div', 'hud-top');
  const tr = el('div', 'hud-t hud-tr');
  const pos = el('span', 'display hud-pos tnum');
  const lap = el('span', 'hud-lap tnum');
  tr.append(pos, lap);
  top.append(tl, tr);
  const boost = el('div', 'hud-boost', '<i></i>');
  const veil = el('div', 'veil');
  t.append(top, boost, veil);
  t.style.setProperty('--t', String(Math.max(0.35, Math.min(1.3, tgt.h / (540 * K())))));
  t.classList.toggle('compact', tgt.w < 300 * K() || tgt.h < 170 * K());
  layer.append(t);
  return { seat, el: t, badge, pos, lap, boost: boost.firstChild, veil, cur: { ...cur }, tgt: { ...tgt }, scale: 1, shake: { dx: 0, dy: 0 }, last: {} };
}

function drawFillers(lay) {
  const g = G;
  g.fillersEl.replaceChildren();
  for (const f of lay.fillers) {
    const e = el('div', 'filler');
    Object.assign(e.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    g.fillersEl.append(e);
  }
  g.chip?.remove();
  g.chip = el('div', 'joinchip', `<span class="display" style="font-size:calc(var(--k)*32px);line-height:1">ROO7</span><small>jammers.dilger.dev</small>`);
  Object.assign(g.chip.style, { right: `${0.035 * W()}px`, bottom: `${0.035 * H()}px` });
  layer.append(g.chip);
}

function gridViews(g) {
  const k = K(), out = [];
  for (const [seat, T] of g.tiles) {
    const c = T.cur, dx = T.shake.dx, dy = T.shake.dy, s = T.scale;
    Object.assign(T.el.style, { left: `${c.x + dx}px`, top: `${c.y + dy}px`, width: `${c.w}px`, height: `${c.h}px`, transform: s !== 1 ? `scale(${s})` : '' });
    const cx = c.x + dx + c.w / 2, cy = c.y + dy + c.h / 2;
    const ix = c.x + dx + 4 * k, iy = c.y + dy + 4 * k, iw = c.w - 8 * k, ih = c.h - 8 * k;
    out.push({ x: Math.round(cx + (ix - cx) * s), y: Math.round(cy + (iy - cy) * s), w: Math.round(iw * s), h: Math.round(ih * s), seat, kind: FP_SEATS.has(seat) ? 'fp' : 'tp' });
  }
  return out;
}

function gridUpdate(g) {
  const st = world.standings();
  const by = new Map(st.map((s) => [s.seat, s]));
  for (const [seat, T] of g.tiles) {
    const s = by.get(seat);
    if (!s) continue;
    if (T.last.place !== s.place) { const [n, suf] = ordinal(s.place); T.pos.innerHTML = `${n}<sup>${suf}</sup>`; T.last.place = s.place; }
    if (T.last.lap !== s.lap) { T.lap.textContent = `Lap ${s.lap}/${world.laps}`; T.last.lap = s.lap; }
    const b = Math.round(s.boost * 100);
    if (T.last.boost !== b) { T.boost.style.width = `${b}%`; T.last.boost = b; }
  }
}

// ------------------------------------------------------------------------------------------------ lobby and results scenes
function buildLobby(n, { hidden = false } = {}) {
  newLayer({ hidden });
  world.setMode('lobby');
  world.setCars(n);
  world.setOutlines([]);
  clearColor = tokens.palette.paper.hex;
  G = null;
  const ready = n - 1; // one player still choosing
  const s = el('div', 'screen k');
  s.innerHTML = `<img class="wordmark" style="left:calc(var(--k)*96px);top:calc(var(--k)*70px)" src="${asset('brand/wordmark.svg')}" alt="Joystick Jammers">
    <div class="card lobby-qr"><div class="join stack"><img class="qr" src="${asset('poc/shared/qr-roo7.svg')}" style="width:calc(var(--k)*300px);height:calc(var(--k)*300px)"><div class="display code">ROO7</div><div class="code-cap" style="max-width:none">Scan to join, or enter the code at jammers.dilger.dev</div></div></div>
    <div class="card roster"><h2 class="display italic"><span class="num tnum">${n}</span> players · <span class="num tnum">${ready}</span> ready</h2><div class="sub">Late joiners start a few seconds behind the last car. There's no player limit.</div><div class="cards" style="grid-template-columns:minmax(0,1fr)"></div></div>
    <div class="warmup"><span class="chip choosing">Lobby: pick a car on your phone</span></div>
    <div class="start"><button class="btn primary gp">${icon('flag')}Start race</button></div>`;
  layer.append(s);
  const cards = s.querySelector('.cards');
  for (let i = 1; i <= n; i++) {
    const p = seatInfo(i), isReady = i !== 4; // Kai is still choosing
    const c = el('div', 'pcard');
    c.style.setProperty('--seat', p.color);
    c.style.setProperty('--seat-on', p.on);
    c.innerHTML = `<span class="badge">#${p.num}</span><span class="nm"></span>${isReady ? `<span class="chip ready">${icon('check')}Ready</span>` : '<span class="chip choosing">choosing…</span>'}`;
    c.querySelector('.nm').textContent = p.name;
    cards.append(c);
  }
  scene = { type: 'lobby', views: () => [{ x: 0, y: 0, w: W(), h: H(), kind: 'wide' }], update() {} };
}

const RESULT_ORDER = [3, 1, 4, 6, 5, 2]; // #6 wrecked on its first lap: 4th
function buildResults(n, { hidden = false, revealed = false } = {}) {
  newLayer({ hidden });
  world.setMode('race');
  world.setCars(n);
  world.setOutlines([]);
  clearColor = '#f3dcb0';
  G = null;
  const st = RESULT_ORDER.slice(0, n).map((seat, i) => ({ seat, place: i + 1, pts: Math.max(1, 30 - i * 3) }));
  const pod = st.slice(0, 3).map((r) => { const p = seatInfo(r.seat), [num, suf] = ordinal(r.place); return `<div class="card pod"><div class="who"><span class="badge" style="--seat:${p.color};--seat-on:${p.on}">#${p.num}</span><span>${esc(p.name)}</span></div><div><div class="display italic place">${num}<span class="lc">${suf}</span></div><div class="display pts tnum">+${r.pts}</div></div></div>`; }).join('');
  const rows = st.map((r) => { const p = seatInfo(r.seat); return `<div class="trow"><span class="place">${r.place}</span><span class="badge" style="--seat:${p.color};--seat-on:${p.on}">#${p.num}</span><span class="nm">${esc(p.name)}</span><span class="pts">+${r.pts}</span></div>`; }).join('');
  const s = el('div', 'screen k');
  s.innerHTML = `<img class="wordmark" style="left:calc(var(--k)*64px);top:calc(var(--k)*20px);height:calc(var(--k)*120px)" src="${asset('brand/wordmark.svg')}" alt="Joystick Jammers">
    <div class="display italic tab" style="position:absolute;left:calc(var(--k)*420px);top:calc(var(--k)*44px);font-size:calc(var(--k)*56px)"><span>Round 3 complete</span></div>
    <div class="res-left"><div class="reel"><div class="tab display italic"><span>Round highlights</span></div></div><div class="podium">${pod}</div></div>
    <div class="card res-right"><h2 class="display italic">Next race starts in <span class="t tnum lc">42s</span></h2><div class="underline"></div><div class="sub">Rematch on the same track. Everyone keeps their number.</div><div class="table" style="grid-template-columns:minmax(0,1fr)">${rows}</div></div>
    <div class="res-bottom"><div class="join"><img class="qr" src="${asset('poc/shared/qr-roo7.svg')}" style="width:calc(var(--k)*296px);height:calc(var(--k)*296px)"><div><span class="display italic" style="font-size:calc(var(--k)*96px);line-height:1.1"><span class="lc">Jump in</span> · ROO7</span><div class="code-cap" style="max-width:none;margin-top:calc(var(--k)*8px)">Scan, or enter the code at jammers.dilger.dev. You'll race next round.</div></div></div>
      <div class="acts"><button class="btn">${icon('eye-off')}<span>Hide replay<span class="sub">Timer keeps running</span></span></button><button class="btn primary gp">${icon('play')}<span>Start next round now<span class="sub">Skips the timer</span></span></button><button class="btn">${icon('users')}<span>Return to lobby<span class="sub">Everyone stays connected</span></span></button></div></div>`;
  layer.append(s);
  const cards = [...s.querySelectorAll('.podium .card')];
  if (!revealed) for (const c of cards) c.style.visibility = 'hidden'; // until results-reveal drops them in
  const reelEl = s.querySelector('.reel');
  scene = {
    type: 'results',
    cards,
    views() {
      const r = reelEl.getBoundingClientRect(), b = 5 * K();
      return [{ x: 0, y: 0, w: W(), h: H(), kind: 'wide' }, { x: Math.round(r.x - rect.sx + b), y: Math.round(r.y - rect.sy + b), w: Math.round(r.width - 2 * b), h: Math.round(r.height - 2 * b), kind: 'reel' }];
    },
    update() {},
  };
}

// ------------------------------------------------------------------------------------------------ the annotation bar
const barName = document.getElementById('bar-name'), barDetail = document.getElementById('bar-detail'), barMeasured = document.getElementById('bar-measured');
const STEPS = [
  { id: 'a', key: 'countdown', label: 'countdown' },
  { id: 'b', key: 'join', label: 'join' },
  { id: 'c', key: 'identify', label: 'identify' },
  { id: 'd', key: 'wreck', label: 'wreck' },
  { id: 'e', key: 'phases', label: 'phases' },
  { id: 'f', key: 'results', label: 'results' },
];
const stepsNav = document.getElementById('steps');
stepsNav.append(Object.assign(el('button', 'play'), { type: 'button', textContent: '▶ Reel', title: 'Play the whole reel (P)' }));
stepsNav.firstChild.dataset.step = 'all';
for (const s of STEPS) { const b = el('button'); b.type = 'button'; b.textContent = s.id; b.title = `${s.id}: ${s.label}`; b.dataset.step = s.key; stepsNav.append(b); }
stepsNav.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || running) return;
  if (b.dataset.step === 'all') playAll(); else play(b.dataset.step);
});
const rswitch = document.getElementById('rswitch');
// POC2-15: which version is playing is never in doubt: a flag on the stage itself, not only the switch in the bar.
const modeFlag = document.createElement('div');
modeFlag.className = 'mode-flag display italic';
modeFlag.setAttribute('aria-live', 'polite');
document.body.append(modeFlag);
function syncSwitch() {
  for (const b of rswitch.querySelectorAll('button')) b.classList.toggle('on', (b.dataset.m === 'reduced') === reduced);
  document.title = `Motion reel${reduced ? ' (reduced)' : ''}`;
  modeFlag.textContent = reduced ? 'Reduced motion' : 'Full motion';
  modeFlag.classList.toggle('reduced', reduced);
  document.body.classList.toggle('is-reduced', reduced);
}
function setReduced(v) { reduced = !!v; syncSwitch(); if (!running) setNote(curStep, { idle: true }); }
rswitch.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setReduced(b.dataset.m === 'reduced'); });
mq.addEventListener?.('change', (e) => { if (!qs.has('reduced')) setReduced(e.matches); });
syncSwitch();

let curStep = null;
const ms = (n) => `${Math.round(n)} ms`;
function noteText(id, sub) {
  const sticker = nm('sticker-in'), reflow = nm('reflow'), beat = nm('countdown-beat'), idf = nm('identify-pulse'), shake = nm('wreck-shake'), toast = nm('toast'), rr = nm('results-reveal');
  const beatDetail = `${ms(beat.durationMs)} per beat · 3, 2, 1, GO full screen${reduced ? ' · no flash, numbers swap, no scale' : ` · exposure flash · punch ${PUNCH.from}→${PUNCH.to}, fade`}`;
  switch (id) {
    case 'a': return { name: '(a) Countdown · countdown-beat', detail: beatDetail };
    case 'b': return { name: '(b) Join · sticker-in + reflow', detail: `sticker-in ${ms(sticker.durationMs)}${reduced ? ' fade' : ''} · reflow ${ms(reflow.durationMs)}${reduced ? ' (tiles cut)' : ''}` };
    case 'c': return { name: '(c) Identify · identify-pulse', detail: `${idf.repeat} × ${ms(idf.durationMs)} = ${ms(idf.repeat * idf.durationMs)} · Cooee #N ${reduced ? 'with no flash' : 'over an exposure flash'} · border + badge ${reduced ? 'held, no blink or scale' : 'pulse and scale'}, outline` };
    case 'd': return { name: '(d) Wreck and respawn · wreck-shake', detail: `${reduced ? 'no shake (0 ms), WRECKED! still shows' : `shake ${ms(shake.durationMs)}, this tile only`} · respawn cuts` };
    case 'e': return { name: `(e) Phase change${sub ? ` · ${sub}` : ''}`, detail: sub === 'countdown → race' ? beatDetail.replace('per beat', 'per beat, GO starts the race') : `exit fast ${ms(dur('fast'))} + enter toast ${ms(toast.durationMs)} = ${ms(dur('fast') + toast.durationMs)}${reduced ? ' (fade only)' : ` (slide ${SLIDE_PX} px)`}` };
    case 'f': return { name: '(f) Results reveal · results-reveal', detail: reduced ? `${ms(rr.durationMs)} · cards fade in together` : `${ms(rr.durationMs)} · 3 cards drop in, ${ms(STAGGER_MS)} stagger (${ms(rr.durationMs - 2 * STAGGER_MS)} each)` };
    default: return { name: 'Motion reel · P1-U05', detail: 'Press ▶ Reel (P) to play everything, A to F for one transition, R for reduced motion' };
  }
}
function setNote(id, { sub, idle = false } = {}) {
  curStep = id;
  const t = noteText(id, sub);
  barName.textContent = t.name;
  if (reduced) barName.append(Object.assign(el('span', 'rtag'), { textContent: 'reduced motion' }));
  barDetail.textContent = t.detail;
  if (!idle) barMeasured.textContent = '';
  for (const b of stepsNav.querySelectorAll('button[data-step]')) {
    const s = STEPS.find((x) => x.key === b.dataset.step);
    b.classList.toggle('on', !!s && s.id === id);
  }
}
function noteMeasured(name, measured, token) {
  const ok = Math.abs(measured - token) <= Math.max(50, 1000 / 60);
  barMeasured.textContent += `${barMeasured.textContent ? ' · ' : '→ ms measured/token: '}${name} ${Math.round(measured)}/${Math.round(token)}${ok ? '' : ' !'}`;
}

/** Log one motion: tokenMs is what tokens.json says this should take in the current mode. */
function record(meta, r, tokenMs, extra = {}) {
  const e = { seq: timeline.length + 1, step: curStep, ...meta, reduced, tokenMs, startMs: +r.rawStart.toFixed(2), endMs: +r.rawEnd.toFixed(2), measuredMs: +r.measuredMs.toFixed(2), deltaMs: +(r.measuredMs - tokenMs).toFixed(2), frames: r.frames, ...extra };
  timeline.push(e);
  noteMeasured(meta.short ?? meta.label ?? meta.name, r.measuredMs, tokenMs);
  return e;
}

// ------------------------------------------------------------------------------------------------ motion primitives
/** sticker-in: scale 0.6 → 1 with overshoot and a 4° settle (full) | fade only (reduced). Drives --s / --settle / --o on `target`. */
function stickerIn(target, { settle = true } = {}) {
  const s = nm('sticker-in');
  if (reduced) {
    target.style.setProperty('--o', '0');
    return tween({ duration: s.durationMs, ease: EASE.enter, update: (p, e) => target.style.setProperty('--o', String(e)), onEnd: () => target.style.removeProperty('--o') });
  }
  const set = (e) => { target.style.setProperty('--s', String(STICKER.from + (STICKER.to - STICKER.from) * e)); if (settle) target.style.setProperty('--settle', `${STICKER.deg * (1 - e)}deg`); };
  set(0);
  return tween({ duration: s.durationMs, ease: EASE[s.easing], update: (p, e) => set(e), onEnd: () => { target.style.removeProperty('--s'); target.style.removeProperty('--settle'); } });
}

/** One countdown (R99, P1-U05.2): 3, 2, 1, GO as ONE full-screen overlay with the Identify flash's high exposure, one beat
 *  each (countdown-beat): the number punches in and fades while the exposure flash attacks and decays behind it. GO starts
 *  the race. Reduced: the wash holds steady through each beat and the numbers swap, no scale or fade. Returns the 4 beats. */
async function runCountdown({ phaseTag } = {}) {
  const beat = nm('countdown-beat'), punch = dur('base'), fade = dur('slow');
  const labels = ['3', '2', '1', 'GO!'];
  const o = el('div', 'cd-flash js', '<i class="flash"></i><b class="display italic tnum"></b>');
  layer.append(o);
  const flash = o.querySelector('.flash'), num = o.querySelector('b');
  const ATTACK = 60; // ms to full exposure, then it decays over the rest of the beat
  const jobs = labels.map((txt, i) => tween({
    duration: beat.durationMs,
    delay: beat.durationMs * i,
    marks: i === 0 ? [[0.12, 'countdown-3']] : i === 3 ? [[0.2, 'countdown-go']] : [],
    onStart() {
      if (i === 3) G.frozen = false; // the race starts on GO
      num.textContent = txt; // the number swaps on the beat
      num.classList.toggle('go', i === 3);
    },
    update(p) {
      const t = p * beat.durationMs;
      if (reduced) { // POC2-15: no flash and no scale; the number swaps on the beat
        flash.style.opacity = '0';
        num.style.opacity = '1';
        num.style.transform = 'rotate(-4deg)';
        return;
      }
      const s = PUNCH.from + (PUNCH.to - PUNCH.from) * EASE.enter(clamp01(t / punch));
      num.style.transform = `rotate(-4deg) scale(${s})`;
      num.style.opacity = String(1 - EASE.exit(clamp01((t - (beat.durationMs - fade)) / fade)));
      flash.style.opacity = String(t < ATTACK ? t / ATTACK : 1 - EASE.exit(clamp01((t - ATTACK) / (beat.durationMs - ATTACK))));
    },
  }));
  const results = await Promise.all(jobs);
  o.remove();
  results.forEach((r, i) => {
    const next = results[i + 1];
    record({ name: 'countdown-beat', label: `beat ${labels[i]}`, short: labels[i].replace('!', ''), detail: labels[i], ...(phaseTag && i === 3 ? { phase: 'countdown → race' } : {}) }, r, beat.durationMs, { periodMs: next ? +(next.start - r.start).toFixed(2) : null });
  });
  return results;
}

/** Join: seat n+1 appears with sticker-in while the grid reflows (320 ms, standard easing; cut when reduced). */
async function joinSeat(seat) {
  const g = G;
  const reflowSpec = nm('reflow'), stickerSpec = nm('sticker-in');
  const from = new Map([...g.tiles].map(([s, T]) => [s, { ...T.cur }]));
  g.seats.push(seat);
  g.n = g.seats.length;
  world.setCars(g.n);
  const lay = layoutGrid(g.n, { x: 0, y: 0, w: W(), h: H() }, { gutter: 6 * K() });
  const T = makeTile(seat, lay.tiles[g.seats.indexOf(seat)], lay.tiles[g.seats.indexOf(seat)]);
  g.tiles.set(seat, T);
  g.seats.forEach((s, i) => { const t = g.tiles.get(s); t.tgt = { ...lay.tiles[i] }; t.el.style.setProperty('--t', String(Math.max(0.35, Math.min(1.3, t.tgt.h / (540 * K()))))); t.el.classList.toggle('compact', t.tgt.w < 300 * K() || t.tgt.h < 170 * K()); });
  drawFillers(lay);
  g.fillersEl.style.opacity = reduced ? '1' : '0';
  T.el.classList.add('top');
  if (reduced) T.veil.style.setProperty('--veil', '1'); else { T.scale = STICKER.from; T.el.style.setProperty('--settle', `${STICKER.deg}deg`); }
  const reflow = tween({
    duration: reflowSpec.durationMs,
    ease: EASE[reflowSpec.easing],
    marks: [[0.5, 'join-mid']],
    update(p, e) {
      for (const [s, t] of g.tiles) {
        const f = from.get(s);
        if (!f) continue;
        t.cur = { x: f.x + (t.tgt.x - f.x) * e, y: f.y + (t.tgt.y - f.y) * e, w: f.w + (t.tgt.w - f.w) * e, h: f.h + (t.tgt.h - f.h) * e };
      }
      g.fillersEl.style.opacity = String(reduced ? 1 : e);
    },
    onEnd() { for (const t of g.tiles.values()) t.cur = { ...t.tgt }; g.fillersEl.style.opacity = '1'; },
  });
  const sticker = reduced
    ? tween({ duration: stickerSpec.durationMs, ease: EASE.enter, marks: [[0.5, 'join-mid']], update: (p, e) => T.veil.style.setProperty('--veil', String(1 - e)), onEnd: () => { T.veil.style.removeProperty('--veil'); T.el.classList.remove('top'); } })
    : tween({
      duration: stickerSpec.durationMs,
      ease: EASE[stickerSpec.easing],
      update(p, e) { T.scale = STICKER.from + (STICKER.to - STICKER.from) * e; T.el.style.setProperty('--settle', `${STICKER.deg * (1 - e)}deg`); },
      onEnd() { T.scale = 1; T.el.style.removeProperty('--settle'); T.el.classList.remove('top'); },
    });
  const [rf, st] = await Promise.all([reflow, sticker]);
  record({ name: 'reflow', short: 'reflow', detail: `${g.n - 1} → ${g.n} tiles` }, rf, reflowSpec.durationMs);
  record({ name: 'sticker-in', label: 'sticker-in tile', short: 'sticker-in', detail: `#${seat} tile` }, st, stickerSpec.durationMs);
}

/** Identify (R99, P1-U05.2): 3 × 500 ms. "Cooee #N" over a transparent, high-exposure flash in the seat colour (fast attack,
 *  long decay over the whole pulse), the tile border and badge pulse and scale, and the car outlined in every tile. Reduced
 *  (P1-U05.6, POC2-15): no flash and no blinking: the thick border holds for the pulse and the label shows without scale.
 *  The shared reference for the TV and the controller (P1-U03.2). */
async function identify(seat) {
  const T = G.tiles.get(seat), info = seatInfo(seat);
  const spec = nm('identify-pulse');
  const total = spec.durationMs * spec.repeat;
  const cooee = el('div', 'cooee js', `<i class="flash"></i><b class="display">Cooee #${info.num}</b>`);
  const flash = cooee.firstChild, label = cooee.lastChild;
  const cycles = [];
  const bw = T.badge.offsetWidth;
  let lastCycle = -1;
  world.setOutlines([seat]);
  brightenOutlines();
  T.el.classList.add('top');
  T.el.prepend(cooee); // under the HUD: the pills stay readable
  const pulse = tween({
    duration: total,
    marks: [[1 / (2 * spec.repeat), 'identify-peak'], [0.8, 'identify-late']],
    update(p) {
      const x = p * spec.repeat, cyc = Math.min(spec.repeat - 1, Math.floor(x)), frac = x - Math.floor(x);
      if (cyc !== lastCycle) { cycles.push(now()); lastCycle = cyc; }
      if (reduced) { // POC2-15: no flash; the label and the stepped border carry the meaning
        flash.style.opacity = '0';
        label.style.opacity = p < 1 ? '1' : '0';
        label.style.transform = 'rotate(-4deg)';
        const on = p < 1; // held for the whole pulse: no blinking in Reduced (POC2-15)
        T.el.classList.toggle('step-on', on);
        T.el.style.setProperty('--ring', on ? '13' : '5');
      } else {
        // The flash: attack to full exposure in 8% of the pulse, 0.85 by 30%, then decay to nothing at the end.
        flash.style.opacity = String(p < 0.08 ? p / 0.08 : p < 0.3 ? 1 - (0.15 * (p - 0.08)) / 0.22 : 0.85 * (1 - (p - 0.3) / 0.7));
        const ls = p < 0.1 ? 0.6 + (0.52 * p) / 0.1 : p < 0.22 ? 1.12 - (0.12 * (p - 0.1)) / 0.12 : 1;
        label.style.transform = `rotate(-4deg) scale(${ls})`;
        label.style.opacity = String(p < 0.1 ? p / 0.1 : p > 0.85 ? Math.max(0, (1 - p) / 0.15) : 1);
        const w = p >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * frac);
        T.el.style.setProperty('--ring', String(5 + 8 * w));
        T.el.style.setProperty('--bs', String(1 + 0.25 * w));
        T.el.style.setProperty('--bnx', `${0.25 * w * bw}px`);
      }
    },
    onEnd() { T.el.classList.remove('step-on', 'top'); for (const v of ['--ring', '--bs', '--bnx']) T.el.style.removeProperty(v); cooee.remove(); world.setOutlines([]); },
  });
  const r = await pulse;
  record({ name: 'identify-pulse', short: 'pulse', detail: `#${seat} · Cooee flash` }, r, total, { repeat: spec.repeat, cycleMs: cycles.slice(1).map((c, i) => +(c - cycles[i]).toFixed(2)) });
}

/** Wreck on `seat` (must be the newest seat): wreck-shake on that tile only + the WRECKED! word, 3 beats, then the respawn CUTS. */
async function wreck(seat) {
  const T = G.tiles.get(seat);
  const shakeSpec = nm('wreck-shake'), beat = dur('countdownBeat');
  const hc = el('div', 'hud-centre', `<div class="display italic wreck-word">Wrecked!</div><div class="wreck-back tnum">Back in <b class="cd">3</b> s</div>`);
  const cd = hc.querySelector('.cd');
  T.el.append(hc);
  const amp = 10 * K();
  const t0 = performance.now();
  const shake = tween({
    duration: shakeSpec.durationMs,
    marks: [[0.3, 'wreck-shake']],
    update(p) { const a = amp * (1 - p); T.shake = shakeSpec.durationMs > 0 ? { dx: a * Math.sin(p * Math.PI * 14), dy: a * 0.6 * Math.cos(p * Math.PI * 10) } : { dx: 0, dy: 0 }; },
    onEnd() { T.shake = { dx: 0, dy: 0 }; },
  });
  const word = stickerIn(hc);
  const hold = tween({ duration: beat * 3, marks: [[0.45, 'wreck-hold']], update(p) { const n = String(3 - Math.min(2, Math.floor(p * 3))); if (cd.textContent !== n) cd.textContent = n; } });
  const [sh, wd] = await Promise.all([shake, word]);
  record({ name: 'wreck-shake', short: 'shake', detail: `#${seat} tile only` }, sh, shakeSpec.durationMs);
  record({ name: 'sticker-in', label: 'sticker-in word', short: 'word', detail: 'WRECKED!' }, wd, nm('sticker-in').durationMs);
  const h = await hold;
  record({ name: 'back-in-ticks', label: 'back-in 3·2·1', short: 'back-in', detail: '3 × countdownBeat' }, h, beat * 3);
  // The respawn is a cut: the wrecked car's slot is rebuilt on the grid and its chase camera starts on the car (no lerp from the wreck).
  hc.remove();
  const r0 = performance.now();
  world.setCars(G.n - 1);
  world.setCars(G.n);
  record({ name: 'respawn-cut', short: 'cut', detail: 'camera cuts, no swoop' }, { rawStart: r0, rawEnd: performance.now(), measuredMs: 0, frames: 0 }, 0, { timeSinceWreckMs: +(r0 - t0).toFixed(2) });
  await nextFrame();
  await nextFrame();
  await shot('wreck-respawn-cut');
}

/** Phase change: the old chrome exits over `fast` (exit easing), the scene swaps, and the new chrome enters as a toast (slide 16 px + fade;
 * fade only when reduced). One tween spans both halves, so the measured time has no hand-off frame in it. */
async function phaseChange(label, build) {
  const toast = nm('toast'), fast = dur('fast'), total = fast + toast.durationMs;
  const old = layer, slide = SLIDE_PX * K();
  let swapped = false, swapAt = 0;
  const r = await tween({
    duration: total,
    marks: [[(fast + toast.durationMs / 2) / total, `phase-${label.replace(/\W+/g, '-')}-mid`]],
    update(p) {
      const t = p * total;
      if (t < fast) { if (old) old.style.opacity = String(1 - EASE.exit(t / fast)); return; }
      if (!swapped) { swapped = true; swapAt = now(); build({ hidden: true }); }
      const e = EASE[toast.easing](clamp01((t - fast) / toast.durationMs));
      layer.style.opacity = String(e);
      layer.style.transform = reduced ? '' : `translateY(${slide * (1 - e)}px)`;
    },
    onEnd() { layer.style.opacity = ''; layer.style.transform = ''; },
  });
  record({ name: 'phase-change', label: `phase ${label}`, short: `phase ${label}`, detail: label }, r, total, { exitMs: +(swapAt - r.start).toFixed(2), enterMs: +(r.end - swapAt).toFixed(2), exitTokenMs: fast, enterTokenMs: toast.durationMs });
}

/** Results reveal: the three podium cards drop in from the top, staggered (150 ms), sticker easing; reduced: fade in together. */
async function resultsReveal() {
  const spec = nm('results-reveal');
  const cards = scene.cards, total = spec.durationMs;
  const each = reduced ? total : total - STAGGER_MS * (cards.length - 1);
  const drops = cards.map((c) => { const r = c.getBoundingClientRect(); return r.bottom - rect.sy + 8; });
  for (const c of cards) { c.style.visibility = 'visible'; c.style.opacity = '0'; if (!reduced) c.style.transform = `translateY(${-drops[cards.indexOf(c)]}px)`; }
  const r = await tween({
    duration: total,
    ease: (x) => x,
    marks: reduced ? [[0.5, 'results-mid']] : [[0.3, 'results-drop-1'], [0.55, 'results-mid']],
    update(p) {
      const t = p * total;
      cards.forEach((c, i) => {
        const local = clamp01((t - (reduced ? 0 : i * STAGGER_MS)) / each);
        if (reduced) { c.style.opacity = String(EASE.enter(local)); return; }
        const e = EASE[spec.easing](local);
        c.style.opacity = local > 0 ? '1' : '0';
        c.style.transform = `translateY(${-drops[i] * (1 - e)}px)`;
      });
    },
    onEnd() { for (const c of cards) { c.style.transform = ''; c.style.opacity = ''; } },
  });
  record({ name: 'results-reveal', short: 'reveal', detail: `${cards.length} podium cards` }, r, total, { cardMs: each, staggerMs: reduced ? 0 : STAGGER_MS });
}

// ------------------------------------------------------------------------------------------------ the reel
const hold = (ms) => sleep(ms);
const GAP = () => dur('countdownBeat'); // pacing between transitions comes from tokens too

function ensureGrid(n, opts = {}) {
  if (!(scene.type === 'grid' && G.n === n) || opts.fresh) buildGrid(n, opts);
  G.frozen = !!opts.frozen;
}

const STEP_FN = {
  async countdown() {
    ensureGrid(START_N, { fresh: true, frozen: true });
    setNote('a');
    await hold(dur('reveal'));
    await runCountdown();
    await hold(GAP());
  },
  async join() {
    ensureGrid(START_N);
    setNote('b');
    await hold(dur('reveal'));
    await joinSeat(JOIN_SEAT);
    await shot('join-end');
    await hold(GAP());
  },
  async identify() {
    // Identify fires when the grid forms, so the cars sit side by side and the outline can be seen in the neighbours' tiles: cut to the
    // pre-race grid of the same six players (late joiners and respawns start behind the pack, where no other tile looks).
    ensureGrid(JOIN_SEAT, { fresh: true, frozen: true });
    setNote('c');
    await hold(dur('reveal'));
    await identify(JOIN_SEAT);
    await hold(GAP());
  },
  async wreck() {
    ensureGrid(JOIN_SEAT);
    setNote('d');
    await hold(dur('reveal'));
    await wreck(JOIN_SEAT);
    await hold(GAP());
  },
  async phases() {
    ensureGrid(JOIN_SEAT);
    setNote('e', { sub: 'race → lobby' });
    await hold(dur('reveal'));
    await phaseChange('race → lobby', (o) => buildLobby(JOIN_SEAT, o));
    await shot('phase-lobby');
    await hold(GAP() * 2);
    setNote('e', { sub: 'lobby → countdown' });
    await phaseChange('lobby → countdown', (o) => buildGrid(JOIN_SEAT, { ...o, fresh: true, frozen: true }));
    await hold(dur('reveal'));
    setNote('e', { sub: 'countdown → race' });
    await runCountdown({ phaseTag: true });
    await shot('phase-race');
    await hold(GAP() * 2);
    setNote('e', { sub: 'race → results' });
    await phaseChange('race → results', (o) => buildResults(JOIN_SEAT, o));
    await shot('phase-results');
    await hold(GAP());
  },
  async results() {
    if (scene.type !== 'results') buildResults(JOIN_SEAT);
    setNote('f');
    await hold(dur('reveal'));
    await resultsReveal();
    await shot('results-end');
    await hold(dur('podium'));
  },
};

let running = false, done = false;
const t0Ref = { t: null };
async function play(name) {
  const step = STEPS.find((s) => s.key === name || s.id === name);
  if (!step) throw new Error(`unknown transition "${name}" (${STEPS.map((s) => s.key).join(', ')})`);
  if (running) throw new Error('the reel is already playing');
  running = true;
  done = false;
  const first = timeline.length;
  document.body.classList.add('playing');
  try {
    setNote(step.id);
    await STEP_FN[step.key]();
    stepsNav.querySelector(`button[data-step="${step.key}"]`)?.classList.add('done');
  } finally { running = false; done = true; }
  return timeline.slice(first);
}
async function playAll() {
  if (running) throw new Error('the reel is already playing');
  running = true;
  done = false;
  timeline.length = 0;
  t0Ref.t = performance.now();
  for (const b of stepsNav.querySelectorAll('button')) b.classList.remove('done');
  try {
    for (const s of STEPS) {
      setNote(s.id);
      await STEP_FN[s.key]();
      stepsNav.querySelector(`button[data-step="${s.key}"]`)?.classList.add('done');
    }
  } finally { running = false; done = true; }
  return timeline.slice();
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'r') setReduced(!reduced);
  else if (!running && k === 'p') playAll();
  else if (!running && /^[1-6]$/.test(k)) play(STEPS[+k - 1].key);
});

// ------------------------------------------------------------------------------------------------ frame loop
let last = performance.now(), frames = 0, built = false;
function frame() {
  const t = performance.now();
  const dtReal = Math.min(0.05, (t - last) / 1000);
  last = t;
  runTweens();
  const dt = pausedAt !== null || (scene.type === 'grid' && G.frozen) ? 0 : dtReal;
  world.step(dt);
  const views = scene.views(dt);
  world.render(views, dt, { w: W(), h: H() }, clearColor);
  scene.update(dt, views);
  frames++;
  const w = frameWaiters;
  frameWaiters = [];
  for (const r of w) r();
  requestAnimationFrame(frame);
}

// Idle state: the six-tile grid on the starting line, waiting for play.
buildGrid(START_N, { fresh: true, frozen: true });
setNote(null, { idle: true });
requestAnimationFrame(frame);

window.__reel = {
  get ready() { return built && frames > 40; },
  get playing() { return running; },
  get done() { return done; },
  get reduced() { return reduced; },
  setReduced,
  play,
  playAll,
  timeline,
  steps: STEPS.map((s) => s.key),
  warnings,
  tokens: MT,
  backend: world.backend,
  stage: rect,
  get t0() { return t0Ref.t; },
};
built = true;
if (qs.get('embed') === '1') document.body.classList.add('embed'); // inside side.html: the side page drives it
if (qs.get('autoplay') === '1') {
  while (!window.__reel.ready) await nextFrame();
  playAll();
} else if (qs.get('autoplay') === 'both') {
  // POC2-15: the autoplay alternates Full and Reduced, flagged, so the difference shows without touching anything.
  while (!window.__reel.ready) await nextFrame();
  for (;;) {
    for (const r of [false, true]) { setReduced(r); await playAll(); await sleep(1500); }
  }
}
