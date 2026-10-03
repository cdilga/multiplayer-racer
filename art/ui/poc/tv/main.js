// main.js — TV mocks (P1-U02): every state opens from a URL fragment, e.g. #grid&n=7&fp=2,5 (see STATES below and the
// contents page at #). The 3D tiles are live (world.js); the HUD is one DOM layer positioned over the tile viewports,
// built the way the game would build it, so its cost can be measured (window.__poc.perf).
import { loadTokens, seatColor, asset } from '../shared/tokens.js';
import { createWorld } from './world.js';
import { layoutGrid, PSEUDOCODE } from './grid.js';
import { STATES } from './states.js';


const NAMES = ['Dusty', 'Pip', 'Ash', 'Kai', 'Big Kev', 'Mia', 'Snag', 'Shaz', 'Roo Boy', 'Tiggy', 'Mack', 'Maximilian Alexander Fitzgerald!', 'Jojo', 'Nina', 'Bazza', 'Wren', 'さくら', 'Zara', 'Tama', 'Lulu', 'Ned', 'Hamish', 'Priya', 'Wei', 'Sione', 'Ana', 'Jack', 'Ruby', 'Archie', 'Isla', 'Leo', 'Matilda', 'Kiri', 'Ollie', 'Ngữ Phương', 'Dmitri', 'Captain Snag', 'Dusty Ute', 'Bec', 'Tash'];
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const shortName = (name, max = 12) => { const g = [...seg.segment(name)].map((s) => s.segment); return g.length > max ? `${g.slice(0, max).join('').trimEnd()}…` : name; };
const ordinal = (n) => { const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; return [n, s]; };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const icon = (name) => `<img alt="" src="${asset(`icons/${name}.svg`)}">`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const tokens = await loadTokens();
// TV px at 1080p scaled by output height. A portrait screen is a phone host held at arm's length: scale by width,
// never below the handheld profile's minimum text (13 px for the 24 px TV minimum).
let kNow = 1;
const setK = () => {
  const portrait = window.innerHeight > window.innerWidth;
  const minK = tokens.type.profiles.handheld.minTextPx / tokens.type.profiles.tv.minTextPx;
  kNow = portrait ? Math.max(minK, window.innerWidth / 1080) : window.innerHeight / 1080;
  document.documentElement.style.setProperty('--k', String(kNow));
};
setK();
window.addEventListener('resize', setK);
const colors = tokens.identity.colors.map((c) => c.hex);
const canvas = document.getElementById('world');
const ui = document.getElementById('ui');
const world = await createWorld(canvas, { colors });
const W = () => window.innerWidth, H = () => window.innerHeight, K = () => kNow;

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [name, ...rest] = raw.split('&');
  const p = new URLSearchParams(rest.join('&'));
  return { name: name || 'contents', n: +(p.get('n') ?? 8), fp: new Set((p.get('fp') ?? '').split(',').filter(Boolean).map(Number)), base: +(p.get('base') ?? 0), kind: p.get('kind') ?? 'global', seat: +(p.get('seat') ?? 3), hud: p.get('hud') !== '0', p };
}

let S = parseHash();
let scene = null; // { views(dt): [], update(dt), layout() }
let frames = 0, settled = false;
const perfStats = { hudMs: [], renderMs: [], stepMs: [], draws: 0 };

function seatInfo(i) { // i = 1-based seat index in this room; display number may be offset (3-digit stress)
  const num = i + S.base;
  const c = seatColor(tokens, num);
  return { seat: i, num, name: NAMES[(i - 1) % NAMES.length], color: c.hex, on: c.on };
}

// ---------- grid scene (grid, hud, countdown, identify, captions, host*, overlays, grid-player) ----------
function gridScene({ rect = () => ({ x: 0, y: 0, w: W(), h: H() }), seats, fp = new Set(), hudStates = {}, overlays = false, cornerChip = true } = {}) {
  const layer = el('div', 'k');
  ui.append(layer);
  const tiles = new Map(); // seat → { el, cur, tgt, t0, from, hud refs }
  let fillerEls = [];
  let joinChip = null;
  let lay = null;

  function makeTile(seat) {
    const info = seatInfo(seat);
    const t = el('div', 'tile');
    t.dataset.seat = String(info.num);
    t.style.setProperty('--seat', info.color);
    t.style.setProperty('--seat-on', info.on);
    const tl = el('div', 'hud-t hud-tl');
    const badge = el('span', 'badge hud-badge', `#${info.num}`);
    const name = el('span', 'hud-name');
    name.textContent = shortName(info.name);
    name.title = info.name;
    tl.append(badge, name);
    const top = el('div', 'hud-top');
    const tr = el('div', 'hud-t hud-tr');
    const pos = el('span', 'display hud-pos tnum');
    const lap = el('span', 'hud-lap tnum');
    tr.append(pos, lap);
    const boost = el('div', 'hud-boost', '<i></i>');
    top.append(tl, tr);
    t.append(top, boost);
    const st = hudStates[seat];
    if (st?.status) t.append(el('div', 'hud-status', st.status === 'autopilot' ? `<span class="chip autopilot">${icon('car')}Autopilot</span>` : `<span class="chip reconnecting">${icon('wifi-off')}Reconnecting…</span>`));
    if (st?.wreck) t.append(el('div', 'hud-centre', `<div class="display italic wreck-word">Wrecked!</div><div class="wreck-back tnum">Back in <b class="cd">3</b> s</div>`));
    if (st?.identify) { t.classList.add('identify'); t.append(el('div', 'burst display italic', `#${info.num} that's you!`)); }
    if (st?.caption) { const c = el('div', 'caption player'); c.textContent = st.caption; c.style.left = '50%'; c.style.transform = 'translateX(-50%)'; c.dataset.under = 'hud'; t.append(c); }
    if (!S.hud) t.replaceChildren();
    layer.append(t);
    return { el: t, pos, lap, boost: boost.firstChild, name, last: {}, cur: null, tgt: null, t0: 0, from: null, plates: [], arrow: null, caption: t.querySelector('.caption') };
  }

  function relayout(animate) {
    const r = rect();
    const k = K();
    lay = layoutGrid(seats().length, r, { gutter: 6 * k });
    const now = performance.now();
    const live = new Set(seats());
    for (const [seat, t] of tiles) if (!live.has(seat)) { t.el.remove(); tiles.delete(seat); }
    seats().forEach((seat, i) => {
      let t = tiles.get(seat);
      const tgt = lay.tiles[i];
      if (!t) {
        t = makeTile(seat);
        tiles.set(seat, t);
        t.cur = animate ? { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2, w: 0, h: 0 } : { ...tgt };
      }
      t.from = { ...t.cur };
      t.tgt = tgt;
      t.t0 = animate ? now : now - 1000;
      t.el.style.setProperty('--t', String(Math.max(0.35, Math.min(1.3, tgt.h / (540 * k)))));
      t.el.classList.toggle('compact', tgt.w < 300 * k || tgt.h < 170 * k);
    });
    // gutter background = ink behind the grid area
    layer.style.cssText = '';
    for (const f of fillerEls) f.remove();
    fillerEls = [];
    joinChip?.remove();
    joinChip = null;
    const QR = 37 * tokens.qr.minModulePx.tv * k; // 8 px per module at 1080p: scannable from the couch
    const big = (f) => f.w >= QR + 40 * k && f.h >= QR + 40 * k;
    const mid = (f) => f.w >= 260 * k && f.h >= 200 * k;
    lay.fillers.forEach((f, i) => {
      const e = el('div', 'filler');
      Object.assign(e.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
      if (i === 0 && big(f)) e.append(joinCard(f.w < f.h * 1.3));
      else if (i === 1 && mid(f)) e.append(standingsCard(Math.max(3, Math.min(8, Math.floor((f.h / k - 80) / 38)))));
      layer.prepend(e);
      fillerEls.push(e);
    });
    if (cornerChip && !(lay.fillers[0] && big(lay.fillers[0]))) {
      // One player: a full-size corner QR (plan §10). More players and no free cell: the code only, because a QR
      // smaller than 8 px per module won't scan from the couch (tokens.qr).
      joinChip = seats().length === 1
        ? el('div', 'joinchip', `<img class="qr" src="${asset('poc/shared/qr-roo7.svg')}" style="width:${QR}px;height:${QR}px"><div><span class="display code">ROO7</span><small>Scan to join</small></div>`)
        : el('div', 'joinchip', `<span class="display" style="font-size:calc(var(--k)*32px);line-height:1">ROO7</span><small>jammers.dilger.dev</small>`);
      Object.assign(joinChip.style, { right: `${W() - (r.x + r.w) + 0.035 * W()}px`, bottom: `${H() - (r.y + r.h) + 0.035 * H()}px` });
      layer.append(joinChip);
    }
    settled = !animate;
  }

  function joinCard(stack) {
    const c = el('div', `card join${stack ? ' stack' : ''}`);
    c.innerHTML = `<img class="qr" src="${asset('poc/shared/qr-roo7.svg')}" style="width:calc(var(--k)*296px);height:calc(var(--k)*296px)"><div><div class="display code">ROO7</div><div class="code-cap">Scan to join, or enter the code at jammers.dilger.dev</div></div>`;
    return c;
  }
  function standingsCard(rows) {
    const c = el('div', 'card standings');
    c.dataset.rows = rows;
    c.innerHTML = `<h3 class="display">Standings</h3><div class="rows"></div>`;
    return c;
  }

  function animateTiles() {
    const now = performance.now();
    let moving = false;
    for (const t of tiles.values()) {
      const a = Math.min(1, (now - t.t0) / 320), e = 1 - Math.pow(1 - a, 3);
      if (a < 1) moving = true;
      t.cur = { x: t.from.x + (t.tgt.x - t.from.x) * e, y: t.from.y + (t.tgt.y - t.from.y) * e, w: t.from.w + (t.tgt.w - t.from.w) * e, h: t.from.h + (t.tgt.h - t.from.h) * e };
      Object.assign(t.el.style, { left: `${t.cur.x}px`, top: `${t.cur.y}px`, width: `${t.cur.w}px`, height: `${t.cur.h}px` });
    }
    if (!moving) settled = true;
  }

  const order = new Map();
  function updateHud(dt, views) {
    if (!S.hud) return; // hud=0: measure the frame without the HUD layer
    const st = world.standings();
    st.forEach((s) => order.set(s.seat, s));
    for (const [seat, t] of tiles) {
      const s = order.get(seat);
      if (!s) continue;
      if (t.last.place !== s.place) { const [n, suf] = ordinal(s.place); t.pos.innerHTML = `${n}<sup>${suf}</sup>`; t.last.place = s.place; }
      if (t.last.lap !== s.lap) { t.lap.textContent = `Lap ${s.lap}/${world.laps}`; t.last.lap = s.lap; }
      const b = Math.round(s.boost * 100);
      if (t.last.boost !== b) { t.boost.style.width = `${b}%`; t.last.boost = b; }
    }
    // filler standings
    for (const f of fillerEls) {
      const card = f.querySelector('.standings');
      if (!card) continue;
      const rows = +card.dataset.rows;
      const key = st.slice(0, rows).map((s) => s.seat).join(',');
      if (card.dataset.key === key) continue;
      card.dataset.key = key;
      card.querySelector('.rows').innerHTML = st.slice(0, rows).map((s) => { const i = seatInfo(s.seat); return `<div class="srow"><span class="place">${s.place}</span><span class="badge" style="--seat:${i.color};--seat-on:${i.on}">#${i.num}</span><span>${esc(shortName(i.name, 10))}</span></div>`; }).join('');
    }
    if (overlays) drawOverlays(views);
    // wreck countdown
    const cd = Math.max(1, 3 - Math.floor((performance.now() / 1000) % 3));
    for (const e of layer.querySelectorAll('.cd')) if (e.textContent !== String(cd)) e.textContent = String(cd);
    // player caption sits under the tile's HUD band
    for (const t of tiles.values()) if (t.caption) t.caption.style.top = `${t.el.querySelector('.hud-tl').offsetHeight + 24 * K()}px`;
  }

  // Nameplates over other cars in each tile, the Identify outline and an off-screen arrow (over-3D overlays).
  function drawOverlays(views) {
    const k = K();
    for (const v of views) {
      const t = tiles.get(v.seat);
      if (!t || !v.camera) continue;
      let used = 0;
      const placed = [];
      const near = seats().filter((o) => o !== v.seat).map((o) => ({ o, p: world.project(o, v.camera, v) })).sort((a, b) => (b.p?.y ?? 0) - (a.p?.y ?? 0)).map((x) => x.o);
      for (const other of near) {
        const p = world.project(other, v.camera, v);
        const topBand = v.y + t.el.querySelector('.hud-tl').offsetHeight + 34 * k, bottomBand = v.y + v.h - 56 * k;
        if (!p || p.z > 1 || p.dist > 90 || p.x < v.x + 40 * k || p.x > v.x + v.w - 40 * k || p.y < topBand + 30 * k || p.y > bottomBand) continue;
        const i = seatInfo(other);
        let pl = t.plates[used];
        if (!pl) { pl = el('div', 'plate'); layer.append(pl); t.plates.push(pl); }
        pl.style.display = '';
        pl.style.setProperty('--seat', i.color); pl.style.setProperty('--seat-on', i.on);
        const size = Math.max(24 * k, Math.min(30 * k, (900 * k) / p.dist));
        pl.style.fontSize = `${size}px`;
        const html = `<span class="badge">#${i.num}</span>${esc(shortName(i.name, 8))}`;
        if (pl.dataset.html !== html) { pl.innerHTML = html; pl.dataset.html = html; }
        let y = p.y;
        const pw = size * 5.2, ph = size * 1.5;
        for (const q of placed) if (Math.abs(q.x - p.x) < pw && Math.abs(q.y - y) < ph) y = q.y - ph;
        if (y - ph < topBand) { pl.style.display = 'none'; continue; }
        placed.push({ x: p.x, y });
        const half = pl.offsetWidth / 2 + 6 * k;
        pl.style.left = `${Math.min(Math.max(p.x, v.x + half), v.x + v.w - half)}px`; pl.style.top = `${y}px`;
        used++;
      }
      for (let j = used; j < t.plates.length; j++) t.plates[j].style.display = 'none';
      // off-screen arrow to your own car
      const me = world.project(v.seat, v.camera, v);
      const off = !me || me.z > 1 || me.x < v.x || me.x > v.x + v.w || me.y < v.y || me.y > v.y + v.h;
      if (off && me) {
        if (!t.arrow) { t.arrow = el('div', 'arrow', `<i></i><b>Your car</b>`); t.arrow.style.setProperty('--seat', seatInfo(v.seat).color); layer.append(t.arrow); }
        let dx = me.ndc.x, dy = -me.ndc.y;
        if (me.z > 1) { dx = -dx; dy = -dy; if (Math.abs(dx) + Math.abs(dy) < 0.01) dy = 1; }
        const ang = Math.atan2(dy, dx), cx = v.x + v.w / 2, cy = v.y + v.h / 2;
        const rx = v.w / 2 - 60 * k, ry = v.h / 2 - 60 * k;
        const sc = 1 / Math.max(Math.abs(Math.cos(ang)) / rx, Math.abs(Math.sin(ang)) / ry);
        t.arrow.style.display = '';
        t.arrow.style.left = `${cx + Math.cos(ang) * sc}px`; t.arrow.style.top = `${cy + Math.sin(ang) * sc}px`;
        t.arrow.querySelector('i').style.transform = `rotate(${ang}rad)`;
      } else if (t.arrow) t.arrow.style.display = 'none';
    }
  }

  window.addEventListener('resize', () => relayout(false));
  return {
    layer,
    relayout,
    views() {
      animateTiles();
      const k = K();
      return [...tiles.entries()].map(([seat, t]) => ({ x: Math.round(t.cur.x + 4 * k), y: Math.round(t.cur.y + 4 * k), w: Math.round(t.cur.w - 8 * k), h: Math.round(t.cur.h - 8 * k), seat, kind: hudStates[seat]?.camera ?? (fp.has(seat) ? 'fp' : 'tp') }));
    },
    update: updateHud,
    tiles,
    get layout() { return lay; },
  };
}

// Gutters between tiles are the renderer's ink clear colour; screens without a grid clear to paper.
let clearColor = '#fff4de';
function gutterBackground() {
  clearColor = tokens.palette.ink.hex;
  return document.createComment('gutters: ink clear colour');
}

// ---------- states ----------
const SETUP = {
  contents() {
    world.setCars(0);
    const c = el('div', 'contents');
    c.innerHTML = `<h1 class="display italic">TV mocks · P1-U02</h1><p>Live layout mocks for the design review (G-DESIGN, plan §3a). Every state opens from a URL fragment; tiles are live three.js (Spike J's Cruz Missile on a greybox loop); the HUD is one DOM layer over the tile viewports, the way the game would build it. Built from <code>art/ui/tokens.json</code>. Press <b>H</b> on any state to come back here.</p>`;
    for (const [group, list] of Object.entries(STATES)) {
      const g = el('div', 'group', `<h2 class="display">${group}</h2>`);
      for (const s of list) { const a = el('a'); a.href = `#${s}`; a.textContent = s; g.append(a); }
      c.append(g);
    }
    ui.append(c);
    return { views: () => [], update() {} };
  },

  grid() {
    world.setMode('race');
    world.setCars(S.n, S.base);
    ui.append(gutterBackground({ x: 0, y: 0, w: W(), h: H() }));
    const seats = () => Array.from({ length: S.n }, (_, i) => i + 1);
    const g = gridScene({ seats, fp: S.fp });
    g.relayout(false);
    return g;
  },

  'grid-player'() {
    world.setMode('race');
    world.setCars(32);
    const k = K();
    const rect = () => { const w = W() * 0.56, h = Math.min(H() - 80 * K(), (w * 9) / 16); return { x: 40 * K(), y: (H() - h) / 2, w, h }; };
    const r0 = rect();
    ui.append(gutterBackground(r0));
    const frame = el('div', 'gp-frame');
    Object.assign(frame.style, { left: `${r0.x - 4 * k}px`, top: `${r0.y - 4 * k}px`, width: `${r0.w + 8 * k}px`, height: `${r0.h + 8 * k}px` });
    const panel = el('div', 'card pseudo k');
    panel.style.left = `${r0.x + r0.w + 40 * k}px`;
    panel.innerHTML = `<h2 class="display italic">The grid rule</h2><div class="n display tnum">N = <span>1</span></div><pre></pre>`;
    panel.querySelector('pre').textContent = PSEUDOCODE;
    ui.append(frame, panel);
    let active = [1];
    const seqUp = Array.from({ length: 31 }, (_, i) => ({ add: i + 2 }));
    const r = (() => { let s = 99; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
    const seqDown = [];
    { const pool = Array.from({ length: 32 }, (_, i) => i + 1); while (pool.length > 1) seqDown.push({ remove: pool.splice(Math.floor(r() * pool.length), 1)[0] }); }
    const seq = [...seqUp, ...seqDown];
    let idx = 0, next = performance.now() + 900;
    const g = gridScene({ rect, seats: () => active, cornerChip: false });
    g.relayout(false);
    const freeze = S.p.get('at');
    if (freeze) { active = Array.from({ length: +freeze }, (_, i) => i + 1); g.relayout(false); panel.querySelector('.n span').textContent = String(active.length); }
    return {
      views: g.views,
      update(dt, views) {
        if (!freeze && performance.now() > next) {
          const step = seq[idx % seq.length];
          if (idx % seq.length === 0) active = [1];
          if (step.add) active = [...active, step.add].sort((a, b) => a - b);
          if (step.remove) active = active.filter((s) => s !== step.remove);
          idx++;
          next = performance.now() + (step.add ? 650 : 750);
          g.relayout(true);
          panel.querySelector('.n span').textContent = String(active.length);
        }
        g.update(dt, views);
      },
    };
  },

  hud() {
    world.setMode('race');
    world.setCars(S.n, S.base);
    ui.append(gutterBackground({ x: 0, y: 0, w: W(), h: H() }));
    const seats = () => Array.from({ length: S.n }, (_, i) => i + 1);
    const hudStates = { 2: { status: 'autopilot' }, 4: { status: 'reconnecting' }, 5: { wreck: true }, 3: { identify: true }, 6: { camera: 'fp' } };
    world.setOutlines([3]);
    const g = gridScene({ seats, hudStates, fp: S.fp });
    g.relayout(false);
    return g;
  },

  identify() {
    world.setMode('race');
    world.setCars(S.n, S.base);
    ui.append(gutterBackground({ x: 0, y: 0, w: W(), h: H() }));
    world.setOutlines([S.seat]);
    const g = gridScene({ seats: () => Array.from({ length: S.n }, (_, i) => i + 1), hudStates: { [S.seat]: { identify: true } } });
    g.relayout(false);
    return g;
  },

  countdown() {
    const g = SETUP.grid();
    for (const t of g.tiles.values()) t.el.append(el('div', 'tile-count display italic tnum', '3'));
    return g;
  },

  captions() {
    const g = SETUP.grid();
    const k = K();
    if (S.kind === 'player') {
      ui.innerHTML = '';
      ui.append(gutterBackground({ x: 0, y: 0, w: W(), h: H() }));
      const g2 = gridScene({ seats: () => Array.from({ length: S.n }, (_, i) => i + 1), hudStates: { 5: { caption: 'Door off! Someone’s leaving bits all over the track.' } } });
      g2.relayout(false);
      return g2;
    }
    const cap = el('div', 'caption k', 'Final lap! <b>Give it everything!</b>');
    const lay = g.layout;
    const filler = lay.fillers[1] ?? lay.fillers[0];
    if (S.kind === 'filler' && filler && filler.w >= 300 * k) {
      Object.assign(cap.style, { left: `${filler.x + filler.w / 2}px`, top: `${filler.y + 30 * k}px`, transform: 'translateX(-50%)', maxWidth: `${filler.w - 40 * k}px` });
    } else {
      const top = lay.tiles[0];
      Object.assign(cap.style, { left: '50%', top: `${top.y + 150 * k * Math.max(0.6, Math.min(1, top.h / (540 * k)))}px`, transform: 'translateX(-50%)' });
    }
    ui.append(cap);
    return g;
  },

  overlays() {
    world.setMode('race');
    world.setCars(S.n, S.base);
    ui.append(gutterBackground({ x: 0, y: 0, w: W(), h: H() }));
    world.setOutlines([3]);
    const g = gridScene({ seats: () => Array.from({ length: S.n }, (_, i) => i + 1), hudStates: { 3: { identify: true }, 6: { camera: 'back' } }, overlays: true });
    g.relayout(false);
    return g;
  },

  host() {
    const g = SETUP.grid();
    const k = K();
    const puck = el('div', 'puck k', `<div class="row"><button class="btn">${icon('pause')}Pause</button><button class="btn">${icon('gamepad-2')}Players</button><button class="btn">${icon('bug')}Diagnostics</button></div><div class="row"><button class="btn danger">${icon('flag')}End round…</button><span class="joinchip" style="position:static"><span><span class="display code">ROO7</span><small>Host · hides in 4 s</small></span></span></div>`);
    Object.assign(puck.style, { right: `${0.035 * W()}px`, bottom: `${0.035 * H()}px` });
    ui.querySelector('.joinchip')?.remove();
    ui.append(puck);
    return g;
  },

  'host-end'() {
    const g = SETUP.grid();
    ui.append(el('div', 'overlay-centre k', `<div class="scrim"></div><div class="card modal"><h2 class="display italic">End the round?</h2><p><b>End round</b> takes everyone back to the lobby with their numbers. <b>Disband room</b> disconnects everyone and closes ROO7.</p><div class="actions"><button class="btn gp">Cancel</button><button class="btn">${icon('users')}End round</button><button class="btn danger">${icon('log-out')}Disband room</button></div></div>`));
    return g;
  },

  'input-drawer'() {
    const g = SETUP.grid();
    const rows = [
      [1, 'Phone', 'Direct on the Wi-Fi · 38 ms', ''], [2, 'Phone', 'Through the relay · 92 ms', 'relay'], [3, 'Pad 1 on this laptop', 'Wired to the host', ''],
      [4, 'Keyboard: WASD + arrows', 'This laptop', ''], [5, 'Phone + pad', 'Pad paired to #5’s phone · direct · 41 ms', ''], [6, 'Hub laptop: pad 2', 'Hub · direct · 22 ms', ''],
      [7, 'Hub laptop: keyboard', 'Hub · direct · 22 ms', ''], [8, 'Phone', 'Reconnecting…', 'relay'],
    ];
    const d = el('div', 'drawer k', `<h2 class="display italic">Players and controllers</h2><p class="lede">How each player is connected. Press <b>A</b> on a pad or <b>Enter</b> on a keyboard to join from this laptop.</p>`);
    for (const [seat, what, how, cls] of rows) {
      const i = seatInfo(seat);
      d.append(el('div', 'src', `<span class="badge" style="--seat:${i.color};--seat-on:${i.on};font-size:calc(var(--k)*28px)">#${i.num}</span><span><b>${esc(shortName(i.name))}</b> · ${what}<br><span class="how ${cls}">${how}</span></span><button class="btn">${icon('user-minus')}Remove</button>`));
    }
    ui.append(d);
    return g;
  },

  diagnostics() {
    const g = SETUP.grid();
    const d = el('div', 'diag k');
    d.innerHTML = `<h3 class="display">Diagnostics</h3><div class="fr tnum"></div><table><tr><th>Player</th><th>Path</th><th>RTT</th><th>Input age</th><th>Pkts/s</th><th>Loss</th></tr>${Array.from({ length: S.n }, (_, i) => { const s = seatInfo(i + 1), relay = i % 4 === 1; return `<tr><td>#${s.num} ${esc(shortName(s.name, 8))}</td><td class="${relay ? 'relay' : ''}">${relay ? 'relay' : 'direct'}</td><td>${relay ? 92 : 30 + i * 3} ms</td><td>${relay ? 61 : 18 + i} ms</td><td>60</td><td>${relay ? '0.4' : '0.0'} %</td></tr>`; }).join('')}</table>`;
    ui.append(d);
    const fr = d.querySelector('.fr');
    return { ...g, update(dt, views) { g.update(dt, views); const ms = perfStats.renderMs.at(-1) ?? 0; fr.textContent = `${world.backend.slice(0, 48)} · render ${ms.toFixed(1)} ms · draws ${perfStats.draws}`; } };
  },

  paused() {
    const g = SETUP.grid();
    ui.append(el('div', 'overlay-centre k', `<div class="scrim"></div><div class="card modal"><h2 class="display italic">Paused</h2><p>Host paused: back in a moment.</p><div class="actions"><button class="btn">${icon('flag')}End round…</button><button class="btn primary gp">${icon('play')}Resume</button></div></div>`));
    return g;
  },

  lobby() {
    world.setMode('lobby');
    world.setCars(Math.min(S.n, 32));
    const k = K();
    const s = el('div', 'screen k');
    const ready = Math.round(S.n * 0.84);
    s.innerHTML = `<img class="wordmark" style="left:calc(var(--k)*96px);top:calc(var(--k)*70px)" src="${asset('brand/wordmark.svg')}" alt="Joystick Jammers">
      <div class="card lobby-qr"><div class="join stack"><img class="qr" src="${asset('poc/shared/qr-roo7.svg')}" style="width:calc(var(--k)*300px);height:calc(var(--k)*300px)"><div class="display code">ROO7</div><div class="code-cap" style="max-width:none">Scan to join, or enter the code at jammers.dilger.dev</div></div></div>
      <div class="card roster"><h2 class="display italic"><span class="num tnum">${S.n}</span> players · <span class="num tnum">${ready}</span> ready</h2><div class="sub">Late joiners start a few seconds behind the last car. There's no player limit.</div><div class="cards"></div><div class="page-note"></div></div>
      <div class="warmup"><span class="chip choosing">Warm-up: drive around while everyone joins</span></div>
      <div class="start"><button class="btn primary gp">${icon('flag')}Start race</button></div>`;
    ui.append(s);
    const cards = s.querySelector('.cards'), note = s.querySelector('.page-note');
    // Roster rule: full cards reflow into more columns down to the legible minimum, then number + name chips, then pages.
    const area = cards.getBoundingClientRect();
    area.height -= 44 * k; // keep the page note inside the card
    const gap = 10 * k;
    const fit = (minW, rowH) => { const cols = Math.max(1, Math.floor((area.width + gap) / (minW + gap))); const rows = Math.max(1, Math.floor((area.height + gap) / (rowH + gap))); return { cols, rows, per: cols * rows }; };
    let mode = 'card', f = null;
    for (const cols of [1, 2, 3, 4]) { const minW = (area.width + gap) / cols - gap; if (minW < 300 * k) break; const g2 = fit(minW, 62 * k); if (g2.per >= S.n && g2.cols >= cols) { f = { ...g2, cols }; break; } }
    if (!f) { mode = 'chip'; f = fit(205 * k, 44 * k); }
    const per = f.cols * f.rows, pages = Math.ceil(S.n / per);
    cards.style.gridTemplateColumns = `repeat(${f.cols}, minmax(0, 1fr))`;
    const page = +(S.p.get('page') ?? 1) - 1;
    for (let i = page * per + 1; i <= Math.min(S.n, (page + 1) * per); i++) {
      const p = seatInfo(i), isReady = i % 6 !== 0;
      const c = el('div', `pcard${mode === 'chip' ? ' chipmode' : ''}`);
      c.style.setProperty('--seat', p.color); c.style.setProperty('--seat-on', p.on);
      c.innerHTML = mode === 'chip'
        ? `<span class="badge">#${p.num}</span><span class="nm"></span><span class="tick${isReady ? '' : ' wait'}" title="${isReady ? 'Ready' : 'Choosing'}">${isReady ? '✓' : '…'}</span>`
        : `<span class="badge">#${p.num}</span><span class="nm"></span>${isReady ? `<span class="chip ready">${icon('check')}Ready</span>` : '<span class="chip choosing">choosing…</span>'}`;
      c.querySelector('.nm').textContent = p.name;
      cards.append(c);
    }
    note.textContent = mode === 'card' ? '' : pages > 1 ? `Page ${page + 1} of ${pages}; pages turn every 6 s. ✓ is Ready.` : '✓ is Ready, … is still choosing.';
    return { views: () => [{ x: 0, y: 0, w: W(), h: H(), kind: 'wide' }], update() {} };
  },

  results() {
    world.setMode('race');
    world.setCars(Math.min(S.n, 32));
    const k = K();
    const s = el('div', 'screen k');
    clearColor = '#f3dcb0';
    const st = Array.from({ length: S.n }, (_, i) => ({ seat: ((i * 7) % S.n) + 1, place: i + 1, pts: Math.max(1, 30 - i * (S.n > 10 ? 1 : 3)) }));
    const pod = st.slice(0, 3).map((r) => { const p = seatInfo(r.seat), [n, suf] = ordinal(r.place); return `<div class="card pod"><div class="who"><span class="badge" style="--seat:${p.color};--seat-on:${p.on}">#${p.num}</span><span>${esc(shortName(p.name, 10))}</span></div><div><div class="display italic place">${n}<span class="lc">${suf}</span></div><div class="display pts tnum">+${r.pts}</div></div></div>`; }).join('');
        const rows = st.map((r) => { const p = seatInfo(r.seat); return `<div class="trow"><span class="place">${r.place}</span><span class="badge" style="--seat:${p.color};--seat-on:${p.on}">#${p.num}</span><span class="nm"></span><span class="pts">+${r.pts}</span></div>`; }).join('');
    s.innerHTML = `<img class="wordmark" style="left:calc(var(--k)*64px);top:calc(var(--k)*20px);height:calc(var(--k)*120px)" src="${asset('brand/wordmark.svg')}" alt="Joystick Jammers">
      <div class="display italic tab" style="position:absolute;left:calc(var(--k)*420px);top:calc(var(--k)*44px);font-size:calc(var(--k)*56px)"><span>Round 3 complete</span></div>
      <div class="res-left"><div class="reel"><div class="tab display italic"><span>Round highlights</span></div></div><div class="podium">${pod}</div></div>
      <div class="card res-right"><h2 class="display italic">Next race starts in <span class="t tnum lc">42s</span></h2><div class="underline"></div><div class="sub">Rematch on the same track. Everyone keeps their number.</div><div class="table">${rows}</div><div class="page-note"></div></div>
      <div class="res-bottom"><div class="join"><img class="qr" src="${asset('poc/shared/qr-roo7.svg')}" style="width:calc(var(--k)*296px);height:calc(var(--k)*296px)"><div><span class="display italic" style="font-size:calc(var(--k)*96px);line-height:1.1"><span class="lc">Jump in</span> · ROO7</span><div class="code-cap" style="max-width:none;margin-top:calc(var(--k)*8px)">Scan, or enter the code at jammers.dilger.dev. You'll race next round.</div></div></div>
        <div class="acts"><button class="btn">${icon('eye-off')}<span>Hide replay<span class="sub">Timer keeps running</span></span></button><button class="btn primary gp">${icon('play')}<span>Start next round now<span class="sub">Skips the timer</span></span></button><button class="btn">${icon('users')}<span>Return to lobby<span class="sub">Everyone stays connected</span></span></button></div></div>`;
    s.querySelectorAll('.trow .nm').forEach((e, i) => { e.textContent = seatInfo(st[i].seat).name; });
    ui.append(s);
    // Standings fit like the lobby roster: more columns down to the legible minimum, then pages (never truncated).
    const table = s.querySelector('.table');
    const box = table.getBoundingClientRect();
    const rowH = (table.firstElementChild?.getBoundingClientRect().height ?? 36 * k) + 6 * k, maxRows = Math.max(1, Math.floor(box.height / rowH));
    const maxCols = Math.max(1, Math.floor((box.width + 26 * k) / (320 * k + 26 * k))); // keep room for the name
    let pageRows = maxRows;
    if (S.n > maxCols * pageRows) pageRows = Math.max(1, pageRows - 1); // leave room for the page note
    const tcols = Math.min(maxCols, Math.ceil(S.n / pageRows)), perPage = tcols * pageRows;
    table.style.gridTemplateColumns = `repeat(${tcols}, minmax(0,1fr))`;
    table.style.gridTemplateRows = `repeat(${Math.min(pageRows, Math.ceil(S.n / tcols))}, ${rowH}px)`;
    table.style.gridAutoFlow = 'column';
    [...table.children].forEach((r, i) => { if (i >= perPage) r.remove(); });
    if (S.n > perPage) s.querySelector('.res-right .page-note').textContent = `Page 1 of ${Math.ceil(S.n / perPage)}; pages turn every 6 s.`;
    const reel = s.querySelector('.reel');
    return { views() { const r = reel.getBoundingClientRect(); const b = 5 * K(); return [{ x: 0, y: 0, w: W(), h: H(), kind: 'wide' }, { x: Math.round(r.x + b), y: Math.round(r.y + b), w: Math.round(r.width - 2 * b), h: Math.round(r.height - 2 * b), kind: 'reel' }]; }, update() {} };
  },

  overview() {
    world.setCars(S.n, S.base);
    world.setMode('overview');
    const k = K();
    const s = el('div', 'screen k');
    s.innerHTML = `<div class="band-top"><span class="display italic" style="font-size:calc(var(--k)*40px)">Derby · damage dealt</span><span class="display timer tnum">2:41</span><span class="switch"><span>Grid</span><span class="on">Overview</span></span></div><div class="band-right standings"><h3 class="display">Damage points</h3><div class="rows"></div></div>`;
    ui.append(s);
    const rowsEl = s.querySelector('.rows');
    rowsEl.innerHTML = Array.from({ length: S.n }, (_, i) => { const p = seatInfo(((i * 5) % S.n) + 1); return `<div class="srow"><span class="place">${i + 1}</span><span class="badge" style="--seat:${p.color};--seat-on:${p.on}">#${p.num}</span><span>${Math.max(0, 420 - i * 13)}</span></div>`; }).join('');
    const band = s.querySelector('.band-right');
    const rowH = rowsEl.firstElementChild.getBoundingClientRect().height + 4 * k;
    const perCol = Math.max(1, Math.floor((band.clientHeight - rowsEl.offsetTop - 14 * k) / rowH));
    const cols = Math.ceil(S.n / perCol), colW = 190 * k;
    rowsEl.style.cssText = `display:grid;grid-auto-flow:column;grid-template-rows:repeat(${Math.min(perCol, S.n)}, ${rowH}px);grid-template-columns:repeat(${cols}, ${colW}px);column-gap:calc(var(--k)*10px)`;
    const bandW = Math.max(300 * k, cols * colW + (cols - 1) * 10 * k + 28 * k);
    band.style.width = `${bandW}px`;
    const plates = new Map();
    const placedO = [];
    const rect = () => ({ x: 0, y: Math.round(74 * K()), w: Math.round(W() - bandW), h: Math.round(H() - 74 * K()) });
    return {
      views: () => [{ ...rect(), kind: 'overview' }],
      update(dt, views) {
        const v = views[0];
        if (!v?.camera) return;
        for (let seat = 1; seat <= S.n; seat++) {
          const p = world.project(seat, v.camera, v);
          let pl = plates.get(seat);
          if (!pl) { const i = seatInfo(seat); pl = el('div', 'plate'); pl.style.setProperty('--seat', i.color); pl.style.setProperty('--seat-on', i.on); pl.innerHTML = S.n > 12 ? `<span class="badge">#${i.num}</span>` : `<span class="badge">#${i.num}</span>${esc(shortName(i.name, 8))}`; s.append(pl); plates.set(seat, pl); }
          if (!p) continue;
          pl.style.fontSize = `${Math.max(24 * k, Math.min(28 * k, (2600 * k) / p.dist))}px`;
          let y = p.y - 6 * k;
          const fs = parseFloat(pl.style.fontSize), pw = pl.offsetWidth, ph = fs * 1.5;
          for (const q of placedO) if (Math.abs(q.x - p.x) < pw && Math.abs(q.y - y) < ph) y = q.y - ph;
          placedO.push({ x: p.x, y });
          pl.style.left = `${p.x}px`; pl.style.top = `${y}px`;
        }
        placedO.length = 0;
      },
    };
  },
};

function start() {
  ui.innerHTML = '';
  world.setOutlines([]);
  S = parseHash();
  clearColor = tokens.palette.paper.hex;
  frames = 0;
  settled = true;
  world.resize(W(), H());
  const setup = SETUP[S.name] ?? SETUP.contents;
  scene = setup();
  document.title = `TV mock · ${S.name}`;
}
window.addEventListener('hashchange', start);
window.addEventListener('resize', () => world.resize(W(), H()));
window.addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') location.hash = ''; });

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  world.step(dt);
  const t1 = performance.now();
  const views = scene.views(dt);
  const r = world.render(views, dt, { w: W(), h: H() }, clearColor);
  const t2 = performance.now();
  scene.update(dt, views);
  const t3 = performance.now();
  perfStats.stepMs.push(t1 - t0); perfStats.renderMs.push(t2 - t1); perfStats.hudMs.push(t3 - t2); perfStats.draws = r.draws;
  if (perfStats.hudMs.length > 600) for (const a of [perfStats.stepMs, perfStats.renderMs, perfStats.hudMs]) a.splice(0, 300);
  frames++;
  window.__poc.ready = frames > 40 && settled;
  requestAnimationFrame(loop);
}

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
window.__poc = {
  ready: false,
  tokens,
  backend: world.backend,
  /** Frame cost over `frames` frames: rAF interval, sim step, render submit and HUD update times (ms). */
  perf(framesWanted = 300) {
    return new Promise((resolve) => {
      const iv = [];
      const mark = perfStats.hudMs.length;
      let prev = performance.now();
      const tick = (t) => {
        iv.push(t - prev); prev = t;
        if (iv.length < framesWanted) return requestAnimationFrame(tick);
        const hud = perfStats.hudMs.slice(-framesWanted), ren = perfStats.renderMs.slice(-framesWanted), stp = perfStats.stepMs.slice(-framesWanted);
        const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
        resolve({ state: location.hash, viewport: `${W()}x${H()}`, tiles: (scene.tiles?.size ?? 0), backend: world.backend, frames: iv.length, frame_ms_p50: +pct(iv, 0.5).toFixed(2), frame_ms_p95: +pct(iv, 0.95).toFixed(2), hud_ms_mean: +mean(hud).toFixed(3), hud_ms_p95: +pct(hud, 0.95).toFixed(3), render_submit_ms_mean: +mean(ren).toFixed(2), sim_step_ms_mean: +mean(stp).toFixed(2), draws: perfStats.draws, hud: S.hud, mark });
      };
      requestAnimationFrame(tick);
    });
  },
};

start();
requestAnimationFrame(loop);
