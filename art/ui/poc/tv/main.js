// main.js — TV mocks (P1-U02): every state opens from a URL fragment, e.g. #grid&n=7&fp=2,5 (see STATES below and the
// contents page at #). The 3D tiles are live (world.js); the HUD is one DOM layer positioned over the tile viewports,
// built the way the game would build it, so its cost can be measured (window.__poc.perf).
import { loadTokens, seatColor, asset, paintPath, tiltFor } from '../shared/tokens.js';
import { createWorld, FRAMING } from './world.js';
import { layoutGrid, PSEUDOCODE } from './grid.js';
import { STATES } from './states.js';


const NAMES = ['Dusty', 'Pip', 'Ash', 'Kai', 'Big Kev', 'Mia', 'Snag', 'Shaz', 'Roo Boy', 'Tiggy', 'Mack', 'Maximilian Alexander Fitzgerald!', 'Jojo', 'Nina', 'Bazza', 'Wren', 'さくら', 'Zara', 'Tama', 'Lulu', 'Ned', 'Hamish', 'Priya', 'Wei', 'Sione', 'Ana', 'Jack', 'Ruby', 'Archie', 'Isla', 'Leo', 'Matilda', 'Kiri', 'Ollie', 'Ngữ Phương', 'Dmitri', 'Captain Snag', 'Dusty Ute', 'Bec', 'Tash'];
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const shortName = (name, max = 12) => { const g = [...seg.segment(name)].map((s) => s.segment); return g.length > max ? `${g.slice(0, max).join('').trimEnd()}…` : name; };
const ordinal = (n) => { const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; return [n, s]; };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const icon = (name) => `<img alt="" src="${asset(`icons/${name}.svg`)}">`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Identify (R99): "Cooee #N" over a transparent, high-exposure flash in the seat colour, tweened over 1.5 s
// (tokens.motion identify-pulse); with prefers-reduced-motion it holds a steady tint for the same time (tv.css).
const cooee = (num) => el('div', 'cooee', `<i class="flash"></i><b class="display">Cooee #${num}</b>`);

const tokens = await loadTokens();
// br-dim.7: the merged round screen's layout rule is data: the video's share of the screen per aspect band.
const ROUND_LAYOUT = await (await fetch(new URL('./round-layout.json', import.meta.url))).json();
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
const colors = tokens.identity.colors.map((c) => c.hex);
const canvas = document.getElementById('world');
const ui = document.getElementById('ui');
const world = await createWorld(canvas, { colors });
const W = () => window.innerWidth, H = () => window.innerHeight, K = () => kNow;

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [name, ...rest] = raw.split('&');
  const p = new URLSearchParams(rest.join('&'));
  return { name: name || 'contents', n: +(p.get('n') ?? 8), fp: new Set((p.get('fp') ?? '').split(',').filter(Boolean).map(Number)), base: +(p.get('base') ?? 0), kind: p.get('kind') ?? 'footer', seat: +(p.get('seat') ?? 3), hud: p.get('hud') !== '0', layout: p.get('layout') === 'static' ? 'static' : 'dynamic', sub: p.get('sub') ?? '', mirror: p.get('mirror') !== '0',
    // Camera distance (R98): &dist= the host default; &pdist=3:far,5:near per-player overrides; &cam=round0 the old rig.
    dist: p.get('dist') ?? FRAMING.distance.default, pdist: new Map((p.get('pdist') ?? '').split(',').filter(Boolean).map((x) => x.split(':')).map(([s, d]) => [+s, d])), cam: p.get('cam') ?? 'framing', p };
}

let S = parseHash();
let scene = null; // { views(dt): [], update(dt), layout() }
const relayouts = []; // the live scene's grid layouts, re-run on every viewport change (start() clears them)
let frames = 0, settled = false;
// The footer band (POC1-08, R96/R97) in TV px at 1080p; the race grid fills the screen above it.
const FOOT = 88;
// The pause flow and the QR hover stop the world (the loop skips world.step): nothing overlays a playing tile.
let gamePaused = false;
let cd = null; // the countdown state's beat control, for captures
const CAPTION = 'Final lap! Give it everything!';
const perfStats = { hudMs: [], renderMs: [], stepMs: [], draws: 0 };

function seatInfo(i) { // i = 1-based seat index in this room; display number may be offset (3-digit stress)
  const num = i + S.base;
  const c = seatColor(tokens, num);
  return { seat: i, num, name: NAMES[(i - 1) % NAMES.length], color: c.hex, on: c.on };
}

// ---------- grid scene (grid, hud, countdown, identify, captions, footer, menu, diagnostics, overlays, grid-player) ----------
// `foot` reserves the footer band under the grid (POC1-08). `layout` is the host setting (R96): dynamic moves the join
// QR, the player list and captions into spare cells when they fit; static keeps them in the footer.
function gridScene({ rect, seats, fp = new Set(), hudStates = {}, overlays = false, plates = false, cornerChip = true, foot = true, layout = S.layout, caption = null, menu = false, diag = false } = {}) {
  const layer = el('div', 'k');
  ui.append(layer);
  const footer = foot ? makeFooter({ menu, diag, layout, onLayout: (m) => { layout = m; relayout(true); }, onDiag: (on) => { diag = on; relayout(true); } }) : null;
  rect ??= () => ({ x: 0, y: 0, w: W(), h: H() - (foot ? footer.height() : 0) });
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
    // dim.5: the bottom row holds the boost bar (left) and a status chip (right), side by side and never stacked.
    const bottom = el('div', 'hud-bottom');
    bottom.append(boost);
    t.append(top, bottom);
    let mirror = null;
    if ((hudStates[seat]?.camera ?? (fp.has(seat) ? 'fp' : 'tp')) === 'fp' && S.mirror) {
      // Segmented first person (R98): the rear-view mirror's frame over its viewport; mirrorBox() places both.
      mirror = el('div', 'mirror');
      t.append(mirror);
    }
    const st = hudStates[seat];
    // A compact tile keeps the chip's icon and colour and drops its word (the label stays for screen readers).
    if (st?.status) bottom.append(el('div', 'hud-status', st.status === 'autopilot' ? `<span class="chip autopilot" aria-label="Autopilot">${icon('car')}<span class="lbl">Autopilot</span></span>` : `<span class="chip reconnecting" aria-label="Reconnecting">${icon('wifi-off')}<span class="lbl">Reconnecting…</span></span>`));
    if (st?.wreck) t.append(el('div', 'hud-centre', `<div class="display italic wreck-word">Wrecked!</div><div class="wreck-back tnum" aria-label="Back in 3 seconds"><span class="lbl">Back in </span><b class="cd">3</b> s</div>`));
    if (st?.identify) { t.classList.add('identify'); t.prepend(cooee(info.num)); } // under the HUD: the pills stay readable
    if (!S.hud) t.replaceChildren();
    layer.append(t);
    return { el: t, pos, lap, boost: boost.firstChild, name, mirror, tp: 1, last: {}, cur: null, tgt: null, t0: 0, from: null, plates: [], arrow: null };
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
      t.tp = Math.max(0.35, Math.min(1.3, tgt.h / (540 * k)));
      t.el.style.setProperty('--t', String(t.tp));
      t.el.classList.toggle('compact', tgt.w < 230 * k || tgt.h < 140 * k);
    });
    // gutter background = ink behind the grid area
    layer.style.cssText = '';
    for (const f of fillerEls) f.remove();
    fillerEls = [];
    joinChip?.remove();
    joinChip = null;
    // Filler roles (R95): empty cells first, in reading order, then margins, largest first. With the footer (R96):
    // dynamic puts the join QR in the first spare cell that fits a scannable QR, then the standings, then a global caption;
    // whatever doesn't fit stays in the footer. Static leaves all three in the footer. Without a footer (the grid player)
    // joining comes first: the QR or, with no room for one, the room code. Everything else is the painted backdrop.
    const QR = 37 * tokens.qr.minModulePx.tv * k; // 8 px per module at 1080p: scannable from the couch
    const fits = { qr: (f) => f.w >= QR + 40 * k && f.h >= QR + 40 * k, standings: (f) => f.w >= 260 * k && f.h >= 200 * k, code: (f) => f.w >= 220 * k && f.h >= 120 * k, caption: (f) => f.w >= 300 * k && f.h >= 120 * k };
    const roles = lay.fillers.map(() => 'backdrop');
    const give = (role) => { const i = lay.fillers.findIndex((f, j) => roles[j] === 'backdrop' && fits[role](f)); if (i >= 0) roles[i] = role; return i >= 0; };
    let hasQr = false, hasCode = false, capInCell = false;
    if (!foot) { hasQr = give('qr'); hasCode = !hasQr && give('code'); give('standings'); }
    else if (layout === 'dynamic') { hasQr = give('qr'); give('standings'); capInCell = !!caption && give('caption'); }
    lay.fillers.forEach((f, i) => {
      const e = el('div', `filler ${f.kind}`);
      e.dataset.role = roles[i];
      Object.assign(e.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
      if (roles[i] === 'qr') e.append(joinCard(f.w < f.h * 1.3));
      else if (roles[i] === 'standings') e.append(standingsCard(Math.max(3, Math.min(8, Math.floor((f.h / k - 80) / 38)))));
      else if (roles[i] === 'code') e.append(codeCard());
      else if (roles[i] === 'caption') e.append(el('div', 'caption cellcap', esc(caption)));
      layer.prepend(e);
      fillerEls.push(e);
    });
    footer?.update({ qr: !hasQr, caption: capInCell ? null : caption, players: seats().length, layout });
    if (!foot && cornerChip && !hasQr && !hasCode) {
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
  function codeCard() {
    return el('div', 'card join stack codecard', `<div class="display code">ROO7</div><div class="code-cap">Join at jammers.dilger.dev</div>`);
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
      if (t.mirror) {
        const b = mirrorBox(t);
        Object.assign(t.mirror.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      }
    }
    if (!moving) settled = true;
  }

  // The rear-view mirror (R98) takes the strip of sky at the top of a first-person tile, in the tile's own fractions,
  // but never sits on the top HUD row: on a small tile the number and position pills reach into that strip, so the
  // mirror drops to just below them (dim.2). Tile-local px; the frame and the mirror's 3D viewport both use this.
  function mirrorBox(t) {
    const k = K(), m = FRAMING.firstPerson.mirror, ins = 4 * k;
    const hud = Math.min(32 * k, Math.max(16 * k, k * t.tp * 40.5)); // tv.css --hud
    const inner = { w: t.cur.w - 2 * ins, h: t.cur.h - 2 * ins };
    return { x: ins + inner.w * m.x, y: Math.max(ins + inner.h * m.y, hud * 2.35), w: inner.w * m.w, h: inner.h * m.h };
  }

  // The mock replays Identify every 3 s so the review can watch it (a real one fires once per press, join or respawn).
  let flashAt = performance.now();
  function replayIdentify() {
    flashAt = performance.now();
    for (const t of tiles.values()) {
      const c = t.el.querySelector('.cooee');
      if (!c) continue;
      c.replaceWith(c.cloneNode(true));
      t.el.classList.remove('identify');
      void t.el.offsetWidth;
      t.el.classList.add('identify');
    }
  }

  const order = new Map();
  function updateHud(dt, views) {
    if (!S.hud) return; // hud=0: measure the frame without the HUD layer
    if (performance.now() - flashAt > 3000 && !window.__poc.held) replayIdentify();
    const st = world.standings();
    st.forEach((s) => order.set(s.seat, s));
    for (const [seat, t] of tiles) {
      const s = order.get(seat);
      if (!s) continue;
      if (t.last.place !== s.place) { const [n, suf] = ordinal(s.place); t.pos.innerHTML = `${n}<sup>${suf}</sup>`; t.last.place = s.place; }
      if (t.last.lap !== s.lap) { t.lap.textContent = `Lap ${s.lap}/${world.laps}`; t.last.lap = s.lap; }
      const b = Math.round((hudStates[seat]?.boost ?? s.boost) * 100);
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
    footer?.tick(st);
    if (overlays) drawOverlays(views);
    // wreck countdown
    const cd = Math.max(1, 3 - Math.floor((performance.now() / 1000) % 3));
    for (const e of layer.querySelectorAll('.cd')) if (e.textContent !== String(cd)) e.textContent = String(cd);
  }

  // Over-3D overlays on the per-player grid: the Identify outline and an off-screen arrow to your own car. Name plates
  // over other cars are only for Derby and other single-shared-screen modes (R100, the Overview state).
  function drawOverlays(views) {
    const k = K();
    for (const v of views) {
      const t = tiles.get(v.seat);
      if (!t || !v.camera || v.kind === 'mirror') continue;
      if (!plates) { drawArrow(v, t, k); continue; }
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
      drawArrow(v, t, k);
    }
  }

  // Off-screen arrow to your own car.
  function drawArrow(v, t, k) {
    const me = world.project(v.seat, v.camera, v);
    const off = !me || me.z > 1 || me.x < v.x || me.x > v.x + v.w || me.y < v.y || me.y > v.y + v.h;
    if (off && me) {
      // The arrow belongs to its own tile (data-own): the overlay check allows it there and nowhere else.
      if (!t.arrow) { t.arrow = el('div', 'arrow', `<i></i><b>Your car</b>`); t.arrow.style.setProperty('--seat', seatInfo(v.seat).color); t.arrow.dataset.own = String(seatInfo(v.seat).num); layer.append(t.arrow); }
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

  relayouts.push(() => relayout(false));
  return {
    layer,
    relayout,
    views() {
      animateTiles();
      const ins = Math.round(4 * K()); // whole pixels: equal tiles give equal viewports
      const out = [];
      for (const [seat, t] of tiles) {
        const v = { x: Math.round(t.cur.x) + ins, y: Math.round(t.cur.y) + ins, w: Math.round(t.cur.w) - 2 * ins, h: Math.round(t.cur.h) - 2 * ins, seat, kind: hudStates[seat]?.camera ?? (fp.has(seat) ? 'fp' : 'tp') };
        out.push(v);
        if (v.kind === 'fp' && t.mirror) {
          const b = mirrorBox(t);
          out.push({ x: Math.round(t.cur.x + b.x), y: Math.round(t.cur.y + b.y), w: Math.round(b.w), h: Math.round(b.h), seat, kind: 'mirror' });
        }
      }
      return out;
    },
    update: updateHud,
    replayIdentify,
    footer,
    tiles,
    get layout() { return lay; },
  };
}

// ---------- the footer band (P1-U02.3: POC1-08 to 11, R96, R97) ----------
// One ink band under the grid, after Physical Soccer's host footer (refs/owner-2026-10-03/ps-host-footer.jpg): the join
// (a small QR when no spare cell holds the big one, the room code, the address and the player count), the race readouts
// or a global caption, the logo, Pause (top-level), Fullscreen and the host menu. The menu swaps the band's middle for the
// host's buttons in place, so it never covers or reflows a tile. Diagnostics grow the band upward and the grid reflows
// above it. Anything that needs the whole screen (settings, players and controllers, ending the round) goes through the
// pause flow, which pauses first. Hovering the QR shows it big for a while and pauses the game.
const DIAG = { colPx: 330, gapPx: 16, rowPx: 34, headPx: 46 };
function makeFooter({ menu = false, diag = false, layout = 'dynamic', onLayout, onDiag, action = null, noPause = false } = {}) {
  const f = el('footer', 'foot k');
  f.setAttribute('aria-label', 'Host toolbar');
  f.innerHTML = `<div class="f-diag" hidden></div>
    <div class="f-row">
      <div class="f-join"><button class="f-qr" type="button" aria-label="Show the join code bigger (pauses the game)"><img class="qr" alt="" src="${asset('poc/shared/qr-roo7.svg')}"></button>
        <div class="f-room"><span class="f-code"><small>Room</small><b class="display code">ROO7</b></span><span class="f-sub">jammers.dilger.dev · <b class="f-n tnum">0</b> players</span></div></div>
      <div class="f-mid"></div>
      <div class="f-right"><img class="f-logo" alt="Joystick Jammers" src="${asset('brand/wordmark-on-ink.svg')}">
        <button class="fbtn f-pause" type="button" aria-label="Pause">${icon('pause')}<span class="lbl">Pause</span></button>
        <button class="fbtn icon f-full" type="button" aria-label="Fullscreen">${icon('maximize')}</button>
        <button class="fbtn icon f-menu" type="button" aria-label="Host menu" aria-expanded="false">${icon('menu')}</button></div>
    </div>`;
  ui.append(f);
  const mid = f.querySelector('.f-mid'), dEl = f.querySelector('.f-diag');
  // A readout shows whole or not at all: on a narrow footer (a phone as the host) one that doesn't fit is hidden rather
  // than clipped to a fragment. Re-fitted whenever the readouts or the space change size (late fonts, resizes).
  const fitMid = () => {
    if (!mid.querySelector('.f-read')) return;
    const box = mid.getBoundingClientRect();
    for (const c of mid.children) {
      c.style.visibility = '';
      const r = c.getBoundingClientRect();
      // Off either side, or wrapped onto the clipped second line.
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top > box.top + r.height / 2) c.style.visibility = 'hidden';
    }
  };
  const midFit = new ResizeObserver(fitMid);
  midFit.observe(mid);
  document.fonts?.ready.then(fitMid);
  let state = { qr: true, caption: null, players: S.n, layout };
  const diagRows = () => {
    const cols = Math.max(1, Math.floor((W() / K() - 56 + DIAG.gapPx) / (DIAG.colPx + DIAG.gapPx)));
    return Math.ceil(state.players / cols);
  };
  const diagPx = () => (diag ? DIAG.headPx + diagRows() * DIAG.rowPx + 8 : 0);
  const readouts = () => `<span class="f-read"><b>Race</b> · <span class="f-lap tnum">Lap 1/3</span></span><span class="f-read">Leader <span class="f-lead"></span></span><span class="f-read tnum f-time">0:00</span>`;
  const menuRow = () => `<button class="fbtn" type="button" data-go="players">${icon('users')}Players</button>`
    + `<button class="fbtn${diag ? ' on' : ''}" type="button" data-go="diag" aria-pressed="${diag}">${icon('bug')}Diagnostics</button>`
    + `<span class="fseg" role="group" aria-label="Player list, QR and captions"><span>Layout</span><button type="button" data-go="dynamic" class="${state.layout === 'dynamic' ? 'on' : ''}">Dynamic</button><button type="button" data-go="static" class="${state.layout === 'static' ? 'on' : ''}">Static</button></span>`
    + `<button class="fbtn" type="button" data-go="settings">${icon('settings')}Settings…</button>`;
  function renderDiag() {
    const ms = perfStats.renderMs.at(-1) ?? 0;
    dEl.style.height = `${(diagPx() - 8) * K()}px`;
    dEl.innerHTML = `<h3 class="display">Diagnostics <small class="tnum">path · round trip · input age · loss · ${esc(world.backend.slice(0, 32))} · render ${ms.toFixed(1)} ms · draws ${perfStats.draws}</small></h3>`
      + Array.from({ length: state.players }, (_, i) => {
        const s = seatInfo(i + 1), relay = i % 4 === 1;
        return `<span class="drow tnum"><span class="badge" style="--seat:${s.color};--seat-on:${s.on}">#${s.num}</span>${relay ? '<b class="relay">relay</b>' : 'direct'} ${relay ? 92 : 30 + (i % 9) * 3} ms · ${relay ? 61 : 18 + (i % 7)} ms · ${relay ? '0.4' : '0.0'}%</span>`;
      }).join('');
  }
  const render = () => {
    f.classList.toggle('has-qr', state.qr);
    f.querySelector('.f-join').style.display = state.join === false ? 'none' : ''; // (the class's display beats [hidden])
    f.querySelector('.f-pause').style.display = noPause ? 'none' : '';
    f.classList.toggle('menu-open', menu);
    const pb = f.querySelector('.f-pause');
    const [pIcon, pLabel] = action ? [action.icon, action.label] : state.paused ? ['play', 'Resume'] : ['pause', 'Pause'];
    pb.innerHTML = `${icon(pIcon)}<span class="lbl">${pLabel}</span>`; // a narrow footer shows the icon; the label stays
    pb.setAttribute('aria-label', pLabel);
    f.querySelector('.f-n').textContent = String(state.players);
    mid.innerHTML = menu ? menuRow() : state.caption ? `<span class="caption footcap">${esc(state.caption)}</span>` : readouts();
    if (!menu && !state.caption) for (const c of mid.children) midFit.observe(c);
    requestAnimationFrame(fitMid);
    const mb = f.querySelector('.f-menu');
    mb.setAttribute('aria-expanded', String(menu));
    mb.classList.toggle('on', menu);
    dEl.hidden = !diag;
    if (diag) renderDiag();
  };
  // The mock's controls work, so the review can click through them.
  f.querySelector('.f-pause').addEventListener('click', () => { if (action) { location.hash = action.go; return; } location.hash = `${state.paused ? 'grid' : 'paused'}&n=${S.n}${S.base ? `&base=${S.base}` : ''}&layout=${state.layout}`; });
  f.querySelector('.f-full').addEventListener('click', () => document.documentElement.requestFullscreen?.().catch(() => {}));
  f.querySelector('.f-menu').addEventListener('click', () => { menu = !menu; render(); });
  mid.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]')?.dataset.go;
    if (!go) return;
    if (go === 'players' || go === 'settings') location.hash = `paused&n=${S.n}&layout=${state.layout}${go === 'players' ? '&sub=players' : ''}`;
    else if (go === 'diag') { diag = !diag; render(); onDiag?.(diag); }
    else { state.layout = go; render(); onLayout?.(go); }
  });
  let pop = null, popTimer = 0;
  const hidePop = () => { pop?.remove(); pop = null; gamePaused = false; f.classList.remove('qr-open'); };
  function showQrPop(hold = false) {
    clearTimeout(popTimer);
    if (!pop) {
      pop = el('div', 'qr-pop k', `<div class="card"><img class="qr" alt="Join QR" src="${asset('poc/shared/qr-roo7.svg')}"><div><div class="display code">ROO7</div><div class="code-cap">Scan to join, or enter the code at jammers.dilger.dev</div><div class="qr-note">${icon('pause')}Game paused while the code is up</div></div></div>`);
      ui.append(pop);
      gamePaused = true;
      f.classList.add('qr-open');
    }
    if (!hold) popTimer = setTimeout(hidePop, 10000); // "for a while": then the race carries on
  }
  const qrBtn = f.querySelector('.f-qr');
  qrBtn.addEventListener('mouseenter', () => showQrPop());
  qrBtn.addEventListener('focus', () => showQrPop());
  qrBtn.addEventListener('mouseleave', () => { clearTimeout(popTimer); popTimer = setTimeout(hidePop, 1500); });
  render();
  const t0 = performance.now();
  return {
    el: f,
    height: () => (FOOT + diagPx()) * K(),
    update(next) { state = { ...state, ...next }; render(); },
    tick(st) {
      if (menu || state.caption) return;
      const lead = st[0];
      const le = f.querySelector('.f-lead');
      if (lead && le) { const i = seatInfo(lead.seat); const html = `<span class="badge" style="--seat:${i.color};--seat-on:${i.on}">#${i.num}</span> ${esc(shortName(i.name, 10))}`; if (le.dataset.k !== html) { le.innerHTML = html; le.dataset.k = html; } }
      const lap = f.querySelector('.f-lap');
      if (lead && lap) lap.textContent = `Lap ${lead.lap}/${world.laps}`;
      const tm = f.querySelector('.f-time');
      if (tm) { const sec = Math.floor((performance.now() - t0) / 1000); tm.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
    },
    showQrPop,
  };
}

// The R102 shapes (U01.3) for the pause flow: torn banners, brushed tags and strips, seeded tilts.
function paint(root) {
  const amp = tokens.language.banner.heading.tornAmplitudePx.tv * K();
  for (const e of root.querySelectorAll('[data-torn], [data-brush]')) {
    const torn = e.dataset.torn != null, w = e.offsetWidth, h = e.offsetHeight;
    e.insertAdjacentHTML('afterbegin', `<svg class="paint" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${paintPath(torn ? e.dataset.torn : e.dataset.brush, w, h, amp, torn ? 'torn' : 'brush')}"/></svg>`);
  }
  for (const e of root.querySelectorAll('[data-tilt]')) e.style.rotate = `${tiltFor(e.dataset.tilt, tokens.language.slant.panelTiltMaxDeg)}deg`;
}

// Gutters between tiles are the renderer's ink clear colour; screens without a grid clear to paper.
let clearColor = '#fff4de';
function gutterBackground() {
  clearColor = tokens.palette.ink.hex;
  return document.createComment('gutters: ink clear colour');
}

// A race grid of S.n seats with the footer (the shared start of most states).
function raceGrid(opts = {}) {
  world.setMode('race');
  world.setCars(S.n, S.base);
  ui.append(gutterBackground());
  const g = gridScene({ seats: () => Array.from({ length: S.n }, (_, i) => i + 1), fp: S.fp, ...opts });
  g.relayout(false);
  return g;
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
    return raceGrid();
  },

  'grid-player'() {
    world.setMode('race');
    world.setCars(32);
    const k = K();
    // Portrait or narrow screens (a phone or tablet host): the grid sits on top at full width and the rule scrolls below it.
    const stacked = () => W() < H() || W() < 700;
    const rect = () => {
      if (stacked()) { const w = W() - 80 * K(), h = Math.min(H() * 0.4, (w * 9) / 16); return { x: 40 * K(), y: 40 * K(), w, h }; }
      const w = W() * 0.56, h = Math.min(H() - 80 * K(), (w * 9) / 16); return { x: 40 * K(), y: (H() - h) / 2, w, h };
    };
    const r0 = rect();
    ui.append(gutterBackground(r0));
    const frame = el('div', 'gp-frame');
    Object.assign(frame.style, { left: `${r0.x - 4 * k}px`, top: `${r0.y - 4 * k}px`, width: `${r0.w + 8 * k}px`, height: `${r0.h + 8 * k}px` });
    const panel = el('div', 'card pseudo k');
    if (stacked()) Object.assign(panel.style, { left: `${40 * k}px`, top: `${r0.y + r0.h + 40 * k}px` });
    else panel.style.left = `${r0.x + r0.w + 40 * k}px`;
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
    const g = gridScene({ rect, seats: () => active, cornerChip: false, foot: false });
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
    // &states=matrix (dim.5) gives the seats every combination of the tile states in turn: status (none, Autopilot,
    // Reconnecting) × Wrecked × boost (empty, full), twelve combinations, so one page shows them all at one tile size.
    const combo = (i) => ({ status: [null, 'autopilot', 'reconnecting'][i % 3], wreck: Math.floor(i / 3) % 2 === 1, boost: Math.floor(i / 6) % 2 });
    const hudStates = S.p.get('states') === 'matrix'
      ? Object.fromEntries(seats().map((s) => [s, combo(s - 1)]))
      : { 2: { status: 'autopilot' }, 4: { status: 'reconnecting' }, 5: { wreck: true }, 3: { identify: true }, 6: { camera: 'fp' } };
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

  // The 3-2-1 (R99, POC1-13): one full-screen overlay with the Identify flash's high exposure, one beat each
  // (tokens.motion countdown-beat), the world held until GO. Reduced motion holds the wash and swaps the numbers.
  // The mock loops it so the review can watch.
  countdown() {
    const g = raceGrid();
    const o = el('div', 'cd-flash k', '<i class="flash"></i><b class="display italic tnum"></b>');
    o.setAttribute('aria-live', 'assertive');
    ui.append(o);
    const beat = tokens.motion.named['countdown-beat'].durationMs, labels = ['3', '2', '1', 'GO!'];
    let shown = -1, t0 = performance.now();
    const show = (i) => {
      shown = i;
      o.hidden = i < 0 || i > 3;
      gamePaused = i >= 0 && i < 3;
      if (o.hidden) return;
      const b = o.querySelector('b');
      b.textContent = labels[i];
      b.classList.toggle('go', i === 3);
      for (const e of o.children) e.replaceWith(e.cloneNode(true)); // restart the tween on every beat
    };
    cd = { show, beat };
    return { ...g, update(dt, views) {
      g.update(dt, views);
      if (window.__poc.held) return;
      const i = Math.floor((performance.now() - t0) / beat) % (labels.length + 2); // two quiet beats, then again
      if (i !== shown) show(i);
    } };
  },

  // Captions are global (POC1-11, R96): never on one player's tile. Dynamic puts the line in a spare cell when one is
  // free after the QR and the standings; otherwise, and always when static, it takes the middle of the footer.
  captions() {
    return raceGrid({ caption: CAPTION });
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

  // The host menu, open in the footer (POC1-09): the puck is gone; its buttons take the band's middle.
  menu() {
    return raceGrid({ menu: true });
  },

  // Hovering the footer QR shows it big and pauses the game for a while (POC1-08, R97).
  'qr-hover'() {
    const g = raceGrid();
    g.footer.showQrPop(true);
    return g;
  },

  // Diagnostics while playing (POC1-10): the footer grows upward; nothing sits over a tile.
  diagnostics() {
    return raceGrid({ diag: true, menu: true });
  },

  // The pause flow (POC1-09/10), in the language of refs/owner-2026-10-03/tv-pause-menu.jpg (U01.3): everything that
  // needs the whole screen lives here, and it pauses first. sub = players | end | disband.
  paused() {
    const g = raceGrid();
    gamePaused = true;
    g.footer.update({ paused: true });
    const seg = (opts, on) => `<span class="seg">${opts.map((o, i) => `<b class="${i === on ? 'on' : ''}">${o}</b>`).join('')}</span>`;
    const row = (ic, label, control) => `<div class="pset"><span class="pic">${icon(ic)}</span><span>${label}</span>${control}</div>`;
    const back = `<button class="btn" type="button" data-go="">${icon('chevron-left')}Back</button>`;
    let body;
    if (S.sub === 'players') {
      const rows = [
        [1, 'Phone', 'Direct on the Wi-Fi · 38 ms', ''], [2, 'Phone', 'Through the relay · 92 ms', 'relay'], [3, 'Pad 1 on this laptop', 'Wired to the host', ''],
        [4, 'Keys A (WASD + TFGH)', 'This laptop', ''], [5, 'Phone + pad', 'Pad paired to #5’s phone · direct · 41 ms', ''], [6, 'Hub laptop: pad 2', 'Hub · direct · 22 ms', ''],
        [7, 'Hub laptop: keys', 'Hub · direct · 22 ms', ''], [8, 'Phone', 'Reconnecting…', 'relay'],
      ].slice(0, Math.max(1, S.n));
      body = `<span class="bn pbn" data-torn="pause-players">Players and <span class="acc">controllers</span></span>
        <p class="pnote">How each player is connected. Press <b>A</b> on a pad, or a cluster's keys, to join from this laptop.</p>
        <div class="plist">${rows.map(([seat, what, how, cls]) => { const i = seatInfo(seat); return `<div class="src"><span class="badge" style="--seat:${i.color};--seat-on:${i.on}">#${i.num}</span><span><b>${esc(shortName(i.name))}</b> · ${what}<br><span class="how ${cls}">${how}</span></span><span class="srcacts"><button class="btn" type="button">${icon('eye-off')}Sit out</button><button class="btn" type="button">${icon('user-minus')}Remove</button></span></div>`; }).join('')}</div>
        <div class="pacts">${back}</div>`;
    } else if (S.sub === 'end') {
      body = `<span class="bn pbn" data-torn="pause-end">End the <span class="acc">round</span>?</span>
        <p class="plead">Everyone goes back to the lobby and keeps their number. The room and ROO7 stay open.</p>
        <div class="pacts row">${back}<span class="slip" data-torn="slip-1"><button class="btn primary gp" type="button">${icon('flag')}End round</button></span></div>`;
    } else if (S.sub === 'disband') {
      body = `<span class="bn pbn" data-torn="pause-disband">Disband <span class="acc">ROO7</span>?</span>
        <span class="strip danger" data-brush="pause-disband-strip"><span>${icon('triangle-alert')}This disconnects everyone</span></span>
        <p class="plead">Phones are told the room ended and can't rejoin. Playing again needs a new room and code.</p>
        <div class="pacts row"><button class="btn gp" type="button" data-go="">${icon('chevron-left')}Keep playing</button><button class="btn danger" type="button">${icon('log-out')}Disband room</button></div>`;
    } else {
      body = `<span class="bn pbn" data-torn="pause">Race <span class="acc">paused</span></span>
        <span class="strip ink psub" data-brush="pause-sub"><span>${icon('pause')}Host pause · every car frozen where it is</span></span>
        <div class="pcols">
          <div class="pcol"><span class="tag" data-brush="t-tv"><span>On this TV</span></span>
            ${row('video', 'Camera', seg(['Chase', 'High'], 0))}${row('monitor', 'View', seg(['Grid', 'Overview'], 0))}${row('volume-2', 'Sound', seg(['On', 'Off'], 0))}${row('eye-off', 'Reduced motion', seg(['Off', 'On'], 0))}</div>
          <div class="pcol"><span class="tag warning" data-brush="t-room"><span>This room</span></span>
            ${row('locate-fixed', 'Camera distance', seg(['Near', 'Mid', 'Far'], 1))}${row('qr-code', 'QR, players, captions', seg(['Dynamic', 'Static'], S.layout === 'static' ? 1 : 0))}${row('flag', 'Laps', seg(['3', '5', '8'], 0))}${row('user-plus', 'Late joiners', seg(['Join now', 'Next race'], 0))}
            <p class="pnote">Changes apply now; laps from the next race.</p></div>
        </div>
        <div class="pacts">
          <span class="slip" data-torn="slip-2"><button class="btn primary gp pres" type="button" data-go="resume">${icon('play')}Resume race</button></span>
          <div class="prow"><button class="btn" type="button" data-go="players">${icon('users')}Players and controllers</button><button class="btn" type="button" data-go="end">${icon('flag')}End round…</button><button class="btn danger-o" type="button" data-go="disband">${icon('log-out')}Disband room…</button></div>
          <p class="pnote">End round goes back to the lobby; everyone keeps their number. Disband disconnects everyone and ROO7 stops working.</p>
        </div>`;
    }
    const shell = el('div', 'pause k', `<div class="scrim"></div><div class="pcard${S.sub ? ` sub-${S.sub}` : ''}" data-tilt="pause-${S.sub || 'main'}">${body}</div>`);
    shell.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]')?.dataset.go;
      if (go == null) return;
      const base = `n=${S.n}&layout=${S.layout}`;
      location.hash = go === 'resume' ? `grid&${base}` : `paused&${base}${go ? `&sub=${go}` : ''}`;
    });
    ui.append(shell);
    paint(shell);
    g.paused = true;
    return g;
  },

  // Lobby (br-dim.6, supersedes the warm-up yard of POC1-15). Nothing to drive: the background is a generic, non-interactive
  // crane view of the upcoming track, and the screen is the roster: one card per player (seat number, name, state: joining,
  // choosing car, ready), all visible at once at any N and any aspect. Density comes from the race grid's rule (grid.js
  // layoutGrid, run on the roster's box with card aspect bands): the richest card tier whose cells stay legible, then
  // thinner tiers (no state label, then number and state only), never a scroll, a page or a cap. The join QR and the host's
  // Start race share the layout: a side column on landscape screens, a row above the roster on portrait ones.
  lobby() {
    world.setMode('race');
    world.setCars(0);
    clearColor = tokens.palette.paper.hex;
    const forced = S.p.get('st'); // &st=joining|choosing|ready forces every seat into one state (the review matrix)
    const stateOf = (seat) => forced || (seat % 9 === 0 ? 'joining' : seat % 6 === 0 ? 'choosing' : 'ready');
    const LABEL = { joining: 'Joining…', choosing: 'Choosing car…', ready: 'Ready' };
    const seats = Array.from({ length: S.n }, (_, i) => i + 1);
    const count = (st) => seats.filter((x) => stateOf(x) === st).length;
    const s = el('div', 'screen k lobby');
    s.innerHTML = `<div class="lob-head"><span class="bn wbn" data-torn="lobby">Lob<span class="acc">by</span></span>
        <span class="tag" data-brush="lobby-count"><span><b class="tnum">${S.n}</b> in the room · <b class="tnum">${count('ready')}</b> ready</span></span>
        <span class="strip ink" data-brush="lobby-sub"><span>${icon('car')}Pick a car on your phone · the host starts the race</span></span></div>
      <div class="card lob-join" data-tilt="lobby-join"><img class="qr" alt="Join QR" src="${asset('poc/shared/qr-roo7.svg')}"><div class="wj-text"><small>Room</small><b class="display code">ROO7</b><span class="code-cap">Scan, or enter the code at jammers.dilger.dev</span></div></div>
      <div class="lob-roster"></div>
      <div class="lob-go"><span class="slip" data-torn="slip-3"><button class="btn primary gp" type="button" data-go="countdown">${icon('flag')}Start race</button></span></div>`;
    ui.append(s);
    const footer = makeFooter({ noPause: true });
    footer.update({ qr: false, join: false, players: S.n, caption: 'Late joiners welcome' });
    wireActs(s);
    paint(s);
    const head = s.querySelector('.lob-head'), joinEl = s.querySelector('.lob-join'), go = s.querySelector('.lob-go'), box = s.querySelector('.lob-roster');
    // Card tiers, richest first: [name, minimum cell in TV px, card aspect band, text size in em of the cell's natural width].
    const TIERS = [
      { name: 'full', minW: 480, minH: 60, band: { min: 2.6, max: 12 }, em: 19 },
      { name: 'name', minW: 330, minH: 44, band: { min: 2.6, max: 12 }, em: 13.5 },
      { name: 'seat', minW: 120, minH: 44, band: { min: 1.6, max: 6 }, em: 5.6 },
      { name: 'num', minW: 100, minH: 44, band: { min: 1.2, max: 4 }, em: 4.2 },
      { name: 'tiny', minW: 0, minH: 0, band: { min: 1, max: 4 }, em: 4.2 }, // below the legible floor: reported, never a cap
    ];
    const layout = () => {
      const k = K(), w = W(), h = H(), m = Math.max(16, 0.05 * w), land = w >= h * 1.1, fh = Math.max(footer.height(), ui.querySelector('.foot')?.offsetHeight ?? 0);
      const sideW = 440 * k;
      // The join card and Start race: a side column (landscape) or a row above and a button under the roster (portrait).
      let rect;
      joinEl.style.width = ''; joinEl.classList.toggle('row', !land);
      head.style.left = `${m + 16 * k}px`; head.style.top = `${Math.max(12, 72 * k)}px`; head.style.maxWidth = `${(land ? w - 2 * m - sideW - 24 * k : w - 2 * m) - 16 * k}px`;
      const headB = head.getBoundingClientRect().bottom + 14 * k;
      if (land) {
        joinEl.style.cssText = `right:${m}px;top:${Math.max(12, 54 * k)}px;width:${sideW}px`;
        go.style.cssText = `right:${m}px;width:${sideW}px;top:${joinEl.getBoundingClientRect().bottom + 22 * k}px`;
        rect = { x: m, y: headB, w: w - 2 * m - sideW - 24 * k, h: h - fh - 14 * k - headB };
      } else {
        joinEl.style.cssText = `left:${m}px;right:${m}px;top:${headB}px`;
        const jb = joinEl.getBoundingClientRect().bottom + 14 * k;
        go.style.cssText = `left:${m}px;right:${m}px;top:0`;
        const goH = go.getBoundingClientRect().height;
        go.style.top = `${h - fh - 14 * k - goH}px`;
        rect = { x: m, y: jb, w: w - 2 * m, h: h - fh - 14 * k - goH - 14 * k - jb };
      }
      box.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px`;
      const gap = 8 * k;
      let tier = TIERS[TIERS.length - 1], g = null;
      for (const t of TIERS) {
        g = layoutGrid(S.n, { x: 0, y: 0, w: rect.w + gap, h: rect.h + gap }, { band: t.band, min: { w: t.minW * k + gap, h: t.minH * k + gap } });
        if (g) { tier = t; break; }
      }
      // Cards never grow past a comfortable size; the block sits top-centre, so a few players read like a few.
      const cw = Math.min(g.cell.w, 620 * k + gap), ch = Math.min(g.cell.h, 128 * k + gap);
      const x0 = (rect.w + gap - g.cols * cw) / 2;
      const fs = Math.max(8, Math.min(ch * 0.42, (cw - gap) / tier.em, 40 * k));
      box.className = `lob-roster t-${tier.name}`;
      box.style.setProperty('--fs', `${fs}px`);
      box.dataset.tier = tier.name; box.dataset.cols = g.cols; box.dataset.rows = g.rows;
      box.innerHTML = '';
      for (const seat of seats) {
        const p = seatInfo(seat), st = stateOf(seat), i = seat - 1, c = el('div', `lcard ${st}`);
        c.style.cssText = `left:${x0 + (i % g.cols) * cw}px;top:${Math.floor(i / g.cols) * ch}px;width:${cw - gap}px;height:${ch - gap}px;--seat:${p.color};--seat-on:${p.on}`;
        c.dataset.seat = seat; c.dataset.state = st;
        const glyph = `<span class="tick ${st}" title="${LABEL[st]}">${st === 'ready' ? '✓' : '…'}</span>`;
        c.innerHTML = tier.name === 'full' ? `<span class="badge">#${p.num}</span><span class="nm"></span><span class="chip ${st}">${st === 'ready' ? icon('check') : ''}${LABEL[st]}</span>`
          : tier.name === 'name' ? `<span class="badge">#${p.num}</span><span class="nm"></span>${glyph}`
          : tier.name === 'seat' ? `<span class="badge">#${p.num}</span>${glyph}` : `<span class="badge">#${p.num}</span>`;
        c.querySelector('.nm')?.append(shortName(p.name, 12));
        c.title = `#${p.num} ${p.name} · ${LABEL[st]}`;
        box.append(c);
      }
    };
    layout();
    relayouts.push(layout);
    return { views: () => [{ x: 0, y: 0, w: W(), h: H() - footer.height(), kind: 'wide' }], update() {} };
  },

  // Round complete + highlights (br-dim.7): ONE screen. The owner merged the end-of-round card and the intermission because
  // both ask the same thing of the TV (what happened, who's next, how to join, what to press) and the highlights ARE the
  // fun of the round-complete screen. #results and #intermission both open it. See roundScreen() and round-layout.json.
  results() { return roundScreen(); },
  intermission() { return roundScreen(); },

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
    const plates = nameplates(s);
    const rect = () => ({ x: 0, y: Math.round(74 * K()), w: Math.round(W() - bandW), h: Math.round(H() - 74 * K()) });
    return {
      views: () => [{ ...rect(), kind: 'overview' }],
      update(dt, views) { plates(views[0]); },
    };
  },
};

// ---------- shared by the lobby, end of round, intermission and Overview (U02.4) ----------
// Nameplates over the cars in a wide view: the badge, the name while there's room (12 cars or fewer) and an optional suffix
// (an optional tick), pushed upward where two would overlap. Past `badgesTo` cars the plates go: a crowd of plates
// hides the cars, so the identity rings under them and the roster carry identity, and Cooee finds your own car. No
// arbitrary cap on cars: this is per-view decluttering. Plates stay inside the title-safe area (GUIDE §4).
function nameplates(layer, { suffix = () => '', badgesTo = Infinity } = {}) {
  const plates = new Map(), placed = [];
  return (v) => {
    if (!v?.camera || S.n > badgesTo) return;
    const k = K(), safe = { l: 0.05 * W(), r: 0.95 * W(), t: 0.05 * H() };
    for (let seat = 1; seat <= S.n; seat++) {
      const p = world.project(seat, v.camera, v);
      let pl = plates.get(seat);
      if (!pl) { const i = seatInfo(seat); pl = el('div', 'plate'); pl.style.setProperty('--seat', i.color); pl.style.setProperty('--seat-on', i.on); pl.innerHTML = `<span class="badge">#${i.num}</span>${S.n > 12 ? '' : esc(shortName(i.name, 8))}${suffix(seat)}`; layer.append(pl); plates.set(seat, pl); }
      if (!p) continue;
      pl.style.fontSize = `${Math.max(24 * k, Math.min(28 * k, (2600 * k) / p.dist))}px`;
      const y0 = p.y - 6 * k;
      const fs = parseFloat(pl.style.fontSize), pw = pl.offsetWidth, ph = fs * 1.5;
      // Pushed up one step at most where two would overlap; past that a crowd's plates overlap at their cars, rather than
      // stacking into a tower far from them. Never off the view.
      let y = y0;
      for (const q of placed) if (Math.abs(q.x - p.x) < pw && Math.abs(q.y - y) < ph) y = Math.max(y0 - ph, q.y - ph);
      y = Math.max(Math.max(v.y, safe.t) + pl.offsetHeight + 2 * k, y);
      placed.push({ x: p.x, y });
      pl.style.left = `${Math.min(Math.min(v.x + v.w, safe.r) - pw / 2, Math.max(Math.max(v.x, safe.l) + pw / 2, p.x))}px`; pl.style.top = `${y}px`;
    }
    placed.length = 0;
  };
}

// ---------- the merged round-complete + highlights screen (br-dim.7) ----------
// The video replay is the screen: its share of the whole screen area comes from round-layout.json (data, per aspect band),
// expanding vertically on the left under the heading (landscape) or stacked on top at full width (portrait). Everything
// else lives in the other region, compact and packed: the placings (richer rows for the top three: trophy, points, colour),
// the join QR and code, the next-race chip and the host's buttons. The placings never truncate and never cap: the rows
// that don't fit as full rows become denser cells by grid.js's rule (row, seat, number, then the tiniest), exactly as the
// lobby roster does. The region's own scale grows (up to 1.5x) when few players leave room, so it never has a dead block.
const REST_TIERS = [
  { name: 'row', minW: 300, minH: 40, band: { min: 3, max: 24 }, em: 12.5 },
  { name: 'seat', minW: 110, minH: 40, band: { min: 1.6, max: 8 }, em: 5.4 },
  { name: 'num', minW: 80, minH: 36, band: { min: 1.3, max: 6 }, em: 3.8 },
  { name: 'tiny', minW: 0, minH: 0, band: { min: 1, max: 6 }, em: 2.7 }, // below the legible floor: reported, never a cap
];
const TOP_RH = [76, 62, 50, 40]; // TV px: the top-three rows, richest first

function roundScreen() {
  world.setMode('race');
  world.setCars(S.n, S.base);
  clearColor = tokens.palette.paper.hex;
  const n = S.n, st = mockStandings();
  const sty = (seat) => { const p = seatInfo(seat); return `--seat:${p.color};--seat-on:${p.on}`; };
  const who = (seat) => `<span class="badge" style="${sty(seat)}">#${seatInfo(seat).num}</span>`;
  const pick = (i) => st[Math.min(st.length - 1, i)].seat;
  const reel = [['Fastest lap', pick(4)], ['Closest finish', pick(1)], ['Most wrecks', pick(2)], ['Longest drift', pick(5)], ['Comeback of the round', pick(st.length - 1)]];
  const now = 0;
  const s = el('div', 'screen k round');
  s.innerHTML = `<div class="rd-head"><span class="bn" data-torn="round">Round 3 <span class="acc">complete</span></span>
      <span class="strip ink" data-brush="round-sub"><span>${icon('video')}Highlights · ${reel.length} to watch</span></span></div>
    <div class="rd-video"><div class="hl-view" data-seat="${reel[now][1]}"></div>
      <span class="tag hl-cap" data-brush="hl-cap"><span>${reel[now][0]} · ${who(reel[now][1])} ${esc(shortName(seatInfo(reel[now][1]).name, 10))}</span></span>
      <span class="hl-count tnum">${now + 1} / ${reel.length}</span><div class="hl-bar"><i style="width:38%"></i></div></div>
    <div class="rd-right">
      <div class="rd-list"><span class="tag" data-brush="rd-results"><span>Results</span></span><div class="rd-top"></div><div class="rd-rest"></div></div>
      <div class="rd-join"><img class="qr" alt="Join QR" src="${asset('poc/shared/qr-roo7.svg')}"><div class="rd-code"><small>Jump in</small><b class="display code">ROO7</b><span class="rd-cap">Scan to join, or enter the code</span></div></div>
      <span class="tag warning rd-next" data-brush="rd-next"><span>${icon('timer')}Next <span class="rd-lng">race </span>in <b class="tnum">42<span class="lc">s</span></b></span></span>
      <div class="rd-acts">${[['chevron-right', 'Skip highlight', 'Next one plays', 'results'], ['flag', 'Start next round now', 'Skips the timer', 'countdown', true], ['users', 'Return to lobby', 'Everyone stays connected', 'lobby']]
        .map(([ic, label, sub, go, primary]) => `<button class="btn${primary ? ' primary gp' : ''}" type="button" data-go="${go}">${icon(ic)}<span>${label}<span class="sub">${sub}</span></span></button>`).join('')}</div>
    </div>`;
  ui.append(s);
  wireActs(s);
  const $ = (sel) => s.querySelector(sel);
  const head = $('.rd-head'), bn = $('.rd-head .bn'), sub = $('.rd-head .strip'), vid = $('.rd-video'), right = $('.rd-right'), list = $('.rd-list'), tag = $('.rd-list > .tag'),
    top = $('.rd-top'), rest = $('.rd-rest'), join = $('.rd-join'), qr = $('.rd-join .qr'), code = $('.rd-code'), nxt = $('.rd-next'), acts = $('.rd-acts');
  const first = st.slice(0, 3), others = st.slice(3);
  const nm = (p) => esc(shortName(p.name, 12));

  // Fits the heading's banner inside `maxW` (a phone's width is far under the TV's), returns the heading's height.
  const fitHead = (maxW) => {
    bn.style.fontSize = '';
    head.style.maxWidth = `${maxW}px`;
    const bw = bn.offsetWidth;
    if (bw > maxW) bn.style.fontSize = `${parseFloat(getComputedStyle(bn).fontSize) * (maxW / bw) * 0.97}px`;
    return head.offsetHeight;
  };

  // The placings in a box W_ x H_ at scale q: the top-three rows (richest height that still leaves the rest a legible tier),
  // then everyone else as grid cells, column by column in placing order. Returns the plan; write=true builds the DOM.
  let tierCap = 2; // the poorest tier a plan may use and still count as fitting (arrange() raises it only when it must)
  const planList = (W_, H_, q, tagH, write) => {
    const gl = Math.max(5, 8 * q), gc = Math.max(3, 5 * q), t = Math.min(3, n);
    let best = null;
    for (const rh of TOP_RH.filter((v) => v >= 50 || tierCap > 1)) { // the top three stay rich unless the rest has nowhere else to go
      const topH = t * rh * q + (t - 1) * gl, usedTop = tagH + gl + topH;
      if (n <= 3) { const p = { rh, tier: null, idx: -1, used: usedTop, fits: usedTop <= H_, area: 1e9 }; if (p.fits || rh === TOP_RH.filter((v) => v >= 50 || tierCap > 1).pop()) { best = p; break; } continue; }
      const restH = Math.max(14, H_ - usedTop - gl);
      let pick = null;
      for (let i = 0; i < REST_TIERS.length; i++) {
        const T = REST_TIERS[i];
        const g = layoutGrid(n - 3, { x: 0, y: 0, w: W_ + gc, h: restH + gc }, { band: T.band, min: T.minW ? { w: T.minW * q + gc, h: T.minH * q + gc } : null });
        if (g) { pick = { i, T, g }; break; }
      }
      const { i, T, g } = pick;
      const ch = Math.min(g.cell.h, 54 * q + gc), cw = g.cell.w;
      const p = { rh, tier: T, idx: i, g, cw, ch, used: usedTop + gl + g.rows * ch - gc, fits: (i <= tierCap || tierCap > 2) && usedTop + gl + g.rows * ch - gc <= H_ + 1, area: g.cell.w * ch, restH };
      if (!best || (p.fits && !best.fits) || (!best.fits && (p.idx < best.idx || (p.idx === best.idx && p.area > best.area)))) best = p;
      if (p.fits) break;
    }
    if (write) {
      const rh = best.rh * q, fs = Math.max(13, Math.min(rh * 0.5, W_ / 16.5, 34 * q));
      top.innerHTML = first.map((r, k) => { const p = seatInfo(r.seat), [num, suf] = ordinal(r.place);
        return `<div class="rd-row p${r.place}" style="${sty(r.seat)};top:${k * (rh + gl)}px;height:${rh}px;font-size:${fs}px"><span class="display italic rd-pl">${num}<span class="lc">${suf}</span></span><span class="badge">#${p.num}</span><span class="nm">${nm(p)}</span>${r.place === 1 ? icon('trophy') : ''}<b class="display tnum pts">+${r.pts}</b></div>`; }).join('');
      top.style.cssText = `left:0;right:0;top:${tagH + gl}px`;
      rest.innerHTML = '';
      if (best.g) {
        const { tier: T, g, cw, ch } = best, fsr = Math.max(8, Math.min(ch * 0.6, (cw - gc) / T.em, 30 * q));
        rest.style.cssText = `left:0;top:${tagH + gl + t * rh + (t - 1) * gl + gl}px;width:${W_}px;height:${g.rows * ch}px`;
        rest.className = `rd-rest t-${T.name}`;
        rest.style.setProperty('--fs', `${fsr}px`);
        rest.dataset.tier = T.name; rest.dataset.cols = g.cols; rest.dataset.rows = g.rows;
        others.forEach((r, i) => {
          const p = seatInfo(r.seat), c = el('div', 'rd-cell');
          c.style.cssText = `${sty(r.seat)};left:${Math.floor(i / g.rows) * cw}px;top:${(i % g.rows) * ch}px;width:${cw - gc}px;height:${ch - gc}px`;
          c.innerHTML = T.name === 'row' ? `<span class="rd-pl">${r.place}</span><span class="badge">#${p.num}</span><span class="nm">${nm(p)}</span><b class="pts tnum">+${r.pts}</b>`
            : T.name === 'seat' ? `<span class="rd-pl">${r.place}</span><span class="badge">#${p.num}</span>` : `<span class="badge">${T.name === 'tiny' ? p.num : `#${p.num}`}</span>`;
          c.title = `${r.place}. #${p.num} ${p.name} +${r.pts}`;
          rest.append(c);
        });
      }
    }
    return best;
  };

  // Everything in the region R at one candidate (mode, scale, QR size): measured, never drawn, unless write.
  const plan = (R, mode, sc, qrPx, swf, write) => {
    // mode: 'stack' (list over join over buttons), 'split' (list beside a column of join, chip, buttons) or 'splitrow' (as
    // split, with the chip beside the QR instead of under it: the shortest column, for a short phone).
    const q = Math.max(K(), 0.5) * sc, g = Math.max(6, 10 * q), split = mode !== 'stack', row2 = mode === 'splitrow';
    right.style.setProperty('--k', q);
    right.classList.toggle('split', split);
    right.classList.toggle('row2', row2);
    const sw = split ? Math.min(R.w * swf, Math.max(R.w * 0.4, row2 ? 220 : 140)) : R.w;
    const lw = split ? R.w - sw - g : R.w;
    const qrS = Math.min(qrPx(q), row2 ? sw * 0.5 : split ? sw : sw * 0.62);
    for (const e of [join, acts]) e.style.width = `${sw}px`;
    nxt.style.width = row2 ? `${sw - qrS - g}px` : split ? `${sw}px` : '';
    qr.style.width = qr.style.height = `${qrS}px`;
    const tagH = tag.offsetHeight, hN = nxt.offsetHeight, hA = acts.offsetHeight, hC = code.offsetHeight;
    const hJ = row2 ? Math.max(qrS, hC + 4 * q + hN) : split ? qrS + 6 * q + hC : Math.max(qrS, hC);
    const gaps = row2 ? 1 : 2, col = hJ + (row2 ? 0 : hN) + hA + gaps * g;
    const lh = split ? R.h : R.h - col - g;
    const L = planList(lw, lh, q, tagH, write);
    const total = split ? Math.max(col, L.used) : L.used + g + col;
    // The unused block rule: whatever is left over is spread over the right-hand blocks' gaps (and, beside them, the list's own
    // tail) and every such block stays under one button row.
    const rowH = acts.firstElementChild.offsetHeight;
    const gapOk = split ? g + Math.max(0, R.h - col) / gaps <= rowH && R.h - L.used <= rowH : g + Math.max(0, R.h - total) / 3 <= rowH;
    const codeRoom = split && !row2 ? sw : sw - qrS - g; // the room code never spills out of its column
    const widthOk = $('.rd-code .code').offsetWidth <= codeRoom - 8 && nxt.offsetWidth <= (row2 ? sw - qrS - g : sw) + 1 && [...acts.children].every((b) => b.scrollWidth <= b.clientWidth + 1);
    const fits = total <= R.h + 1 && col <= R.h + 1 && L.fits && gapOk && widthOk;
    if (write) {
      list.style.cssText = `left:0;top:0;width:${lw}px;height:${L.used}px`;
      const x = split ? lw + g : 0;
      const gapUse = split ? g + Math.max(0, R.h - col) / gaps : g + Math.max(0, R.h - total) / 3;
      let y = split ? 0 : L.used + gapUse;
      join.style.cssText = `left:${x}px;top:${y}px;width:${sw}px`;
      if (row2) { nxt.style.left = `${x + qrS + g}px`; nxt.style.top = `${y + hC + 4 * q}px`; y += hJ + gapUse; }
      else { y += hJ + gapUse; nxt.style.left = `${x}px`; nxt.style.top = `${y}px`; y += hN + gapUse; }
      acts.style.cssText = `left:${x}px;top:${y}px;width:${sw}px`;
    }
    return { fits, L, q, sc, qrS, mode, total, over: total > R.h + 1 ? 1 : 0, idx: L.idx, area: L.area ?? 0 };
  };

  const arrange = (R) => {
    right.style.cssText = `left:${R.x}px;top:${R.y}px;width:${R.w}px;height:${R.h}px`;
    const small = W() < 1200;
    const qrSizes = (small ? [(q) => 260 * q, (q) => 200 * q, () => 140, () => 125, () => 110] : [260, 230, 200].map((v) => (q) => v * q));
    // Tall regions (the TV's column) stack first, wide ones (a phone's strip under the video) put the list beside the rest.
    const modes = R.h / R.w >= 1.3 ? ['stack', 'split', 'splitrow'] : ['split', 'splitrow', 'stack'];
    let best = null, fallback = null;
    search: for (tierCap = 0; tierCap <= 3; tierCap++) {
      let widest = null; // tierCap 3 (everything allowed): the plan that gives the denser cells the most room
      for (const mode of modes) {
        for (const sc of [1.5, 1.4, 1.3, 1.2, 1.1, 1]) {
          for (const swf of mode === 'stack' ? [1] : [0.4, 0.5, 0.6]) {
            for (const qf of qrSizes) {
              const p = plan(R, mode, sc, qf, swf, false);
              if (p.fits && tierCap < 3) { best = { mode, sc, qf, swf }; break search; }
              if (p.fits && (!widest || p.area > widest.p.area)) widest = { p, mode, sc, qf, swf };
              if (tierCap === 3 && sc === 1 && (!fallback || p.over < fallback.p.over || (p.over === fallback.p.over && (p.idx < fallback.p.idx || (p.idx === fallback.p.idx && (p.qrS > fallback.p.qrS + 1 || (Math.abs(p.qrS - fallback.p.qrS) <= 1 && p.area > fallback.p.area))))))) fallback = { p, mode, sc, qf, swf };
            }
          }
        }
      }
      if (widest) { best = widest; break; }
    }
    best ??= fallback;
    tierCap = Math.min(tierCap, 3);
    return plan(R, best.mode, best.sc, best.qf, best.swf, true);
  };

  const layout = () => {
    const w = W(), h = H(), kc = Math.max(K(), 0.5), gap = Math.max(8, 14 * kc);
    s.style.setProperty('--k', kc);
    s.querySelectorAll('svg.paint').forEach((e) => e.remove());
    const band = ROUND_LAYOUT.bands.find((b) => w / h <= b.maxAspect) ?? ROUND_LAYOUT.bands[ROUND_LAYOUT.bands.length - 1];
    const small = w < 1200, mx = small ? Math.max(8, 0.02 * Math.min(w, h)) : 0.05 * w, my = small ? mx : 0.05 * h;
    // The banner is tilted and its painted edge reaches past its box, so the heading sits a little inside the title-safe edge.
    const hx = small ? 0 : 24 * kc, hy = small ? 0 : 20 * kc;
    head.style.left = `${mx + hx}px`; head.style.top = `${my + hy}px`;
    // On a phone held upright the banner takes the whole width, so the "Highlights" strip rides in the video's top-left corner.
    const tight = band.stack === 'top' && w < 600;
    (tight ? vid : head).append(sub);
    sub.classList.toggle('in-video', tight);
    let vx, vy, vw, vh, R;
    if (band.stack === 'top') {
      const hh = fitHead(w - 2 * mx) + hy;
      vh = Math.ceil(band.video * h); vw = w; vx = 0; vy = my + hh + gap;
      const ry = vy + vh + gap * 1.6;
      R = { x: mx, y: ry, w: w - 2 * mx, h: h - ry - my };
    } else {
      const minRight = Math.max(300, 380 * kc);
      const solve = (hh) => { vh = Math.floor(h - 2 * my - hh - gap); vw = Math.min(Math.ceil((band.video * w * h) / vh), Math.floor(w - 2 * mx - 2 * gap - minRight)); };
      let hh = fitHead(0.6 * w - hx) + hy;
      solve(hh); hh = fitHead(vw - hx) + hy; solve(hh);
      vx = mx; vy = my + hh + gap;
      R = { x: vx + vw + 2 * gap, y: my, w: w - mx - (vx + vw + 2 * gap), h: h - 2 * my };
    }
    vid.style.cssText = `left:${vx}px;top:${vy}px;width:${vw}px;height:${vh}px`;
    arrange(R);
    paint(s);
  };
  layout();
  relayouts.push(layout);
  // Text widths decide the packing: measure again once the page's fonts are in (and whenever more load).
  // Anything that changes size after the plan (a late font, an icon) re-plans; a stable layout changes nothing, so it settles.
  let replans = 0, queued = false;
  const ro = new ResizeObserver(() => {
    if (queued || replans > 8 || !s.isConnected) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; replans++; if (s.isConnected) layout(); });
  });
  for (const e of [acts, nxt, code, head, bn]) ro.observe(e);
  const box = (e, kind) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), kind, seat: +e.dataset.seat }; };
  return { views: () => [box($('.hl-view'), 'highlight')], update() {} };
}

// The round's mock result: every seat placed, points by place.
const mockStandings = () => Array.from({ length: S.n }, (_, i) => ({ seat: ((i * 7) % S.n) + 1, place: i + 1, pts: Math.max(1, 30 - i * (S.n > 10 ? 1 : 3)) }));

// Standings in a box: more columns down to the legible minimum, then pages (never truncated).
function standingsTable(table, note, st) {
  const k = K();
  table.innerHTML = st.map((r) => { const p = seatInfo(r.seat); return `<div class="trow"><span class="place">${r.place}</span><span class="badge" style="--seat:${p.color};--seat-on:${p.on}">#${p.num}</span><span class="nm"></span><span class="pts">+${r.pts}</span></div>`; }).join('');
  table.querySelectorAll('.trow .nm').forEach((e, i) => { e.textContent = seatInfo(st[i].seat).name; });
  const box = table.getBoundingClientRect();
  const rowH = (table.firstElementChild?.getBoundingClientRect().height ?? 36 * k) + 6 * k, maxRows = Math.max(1, Math.floor(box.height / rowH));
  const maxCols = Math.max(1, Math.floor((box.width + 26 * k) / (300 * k + 26 * k)));
  let pageRows = maxRows;
  if (st.length > maxCols * pageRows) pageRows = Math.max(1, pageRows - 1);
  const tcols = Math.min(maxCols, Math.ceil(st.length / pageRows)), perPage = tcols * pageRows;
  table.style.gridTemplateColumns = `repeat(${tcols}, minmax(0,1fr))`;
  table.style.gridTemplateRows = `repeat(${Math.min(pageRows, Math.ceil(st.length / tcols))}, ${rowH}px)`;
  table.style.gridAutoFlow = 'column';
  [...table.children].forEach((r, i) => { if (i >= perPage) r.remove(); });
  // Few players: the rows grow to fill the card (up to 1.4×) rather than leaving half of it blank.
  if (st.length <= maxRows && tcols === 1) {
    const grow = Math.min(1.4, box.height / (st.length * rowH));
    if (grow > 1.05) { table.style.setProperty('--grow', grow.toFixed(3)); table.style.gridTemplateRows = `repeat(${st.length}, ${rowH * grow}px)`; }
  }
  note.textContent = st.length > perPage ? `Page 1 of ${Math.ceil(st.length / perPage)}; pages turn every 6 s.` : '';
}

// The join band of the between-rounds screens: the QR big at the left (joining mid-session is the point), what this screen
// adds in the middle, the host's actions at the right. acts: [icon, label, sub, goes-to state, primary?]; row = side by side.
function joinBand({ mid = '', acts = [], row = false } = {}) {
  return `<div class="jband${row ? ' row' : ''}"><div class="jb-join"><img class="qr" alt="Join QR" src="${asset('poc/shared/qr-roo7.svg')}"><div><span class="display italic jb-code"><span class="lc">Jump in</span> · <span class="hi">ROO7</span></span><span class="code-cap">Scan, or enter the code at jammers.dilger.dev. You'll race next round.</span></div></div>
    <div class="jb-mid">${mid}</div>
    <div class="jb-acts">${acts.map(([ic, label, sub, go, primary]) => `<button class="btn${primary ? ' primary gp' : ''}" type="button" data-go="${go}">${icon(ic)}<span>${label}<span class="sub">${sub}</span></span></button>`).join('')}</div></div>`;
}
// The mock's buttons work, so the review can click through the flow.
const wireActs = (root) => root.addEventListener('click', (e) => { const go = e.target.closest('[data-go]')?.dataset.go; if (go) location.hash = `${go}&n=${S.n}`; });

function start() {
  ui.innerHTML = '';
  relayouts.length = 0; // the old scene's layout goes with it
  gamePaused = false;
  cd = null;
  world.setFraming({ distance: parseHash().dist, perSeat: parseHash().pdist, rig: parseHash().cam });
  world.setOutlines([]);
  S = parseHash();
  clearColor = tokens.palette.paper.hex;
  frames = 0;
  settled = true;
  world.resize(W(), H());
  const setup = SETUP[S.name] ?? SETUP.contents;
  scene = setup();
  document.title = `TV mock · ${S.name}`;
  window.__poc.hash = location.hash; // which state `ready` refers to (hash navigations don't reload the page)
  window.__poc.held = false;
}
window.addEventListener('hashchange', start);
// dim.2: every viewport change (a resize, the mobile browser's bars coming and going, a rotation, full screen on or off)
// recomputes the scale, the world and the live scene's layout: one pass per frame, then once more after the browser has
// finished changing the viewport (bars animate, rotations report late), so a fresh load at that size is what you see.
let viewportQueued = false;
const onViewport = () => {
  if (viewportQueued) return;
  viewportQueued = true;
  requestAnimationFrame(() => {
    viewportQueued = false;
    setK();
    world.resize(W(), H());
    for (const r of relayouts) r();
  });
};
for (const [target, type] of [[window, 'resize'], [window, 'orientationchange'], [document, 'fullscreenchange'], [window.visualViewport, 'resize']]) {
  target?.addEventListener(type, () => {
    onViewport();
    setTimeout(onViewport, 250);
  });
}
window.addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') location.hash = ''; });

let last = performance.now();
let lastViews = [];
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  if (!gamePaused) world.step(dt);
  const t1 = performance.now();
  const views = scene.views(dt);
  const r = world.render(views, dt, { w: W(), h: H() }, clearColor);
  lastViews = views;
  const t2 = performance.now();
  scene.update(dt, views);
  const t3 = performance.now();
  perfStats.stepMs.push(t1 - t0); perfStats.renderMs.push(t2 - t1); perfStats.hudMs.push(t3 - t2); perfStats.draws = r.draws;
  if (perfStats.hudMs.length > 600) for (const a of [perfStats.stepMs, perfStats.renderMs, perfStats.hudMs]) a.splice(0, 300);
  frames++;
  window.__poc.ready = frames > 40 && settled;
  requestAnimationFrame(loop);
}

/** Shows countdown beat `i` (0 = "3" … 3 = "GO!") and holds its animations at `ms` (captures of the countdown). */
async function beatAt(i, ms) {
  window.__poc.held = true;
  cd?.show(i);
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Holds every CSS animation at `ms` after a fresh Identify (captures of the flash, frame by frame). */
async function identifyAt(ms) {
  window.__poc.held = true;
  if (ms === 0) scene.replayIdentify?.();
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
window.__poc = {
  ready: false,
  held: false,
  identifyAt,
  /** Whether the world is stopped (the pause flow, the QR hover): only then may anything cover a tile. */
  paused: () => gamePaused,
  /** The 3D viewports the current state renders (one per tile on the grid, plus a mirror per first-person tile). */
  views: () => scene.views(0),
  beatAt,
  /** The Overview camera's motion stats, round 0 against the new rig on the same derby (P1-U05.4). */
  overviewTrace: (o) => world.overviewTrace(o),
  /** Per tile: how much of it the player's own car fills and where the horizon sits (P1-U05.2 framing evidence). */
  framing: () => lastViews.filter((v) => (v.kind === 'tp' || v.kind === 'fp') && v.camera).map((v) => ({ seat: v.seat, kind: v.kind, h: v.h, ...world.framingOf(v.seat, v.camera, v) })),
  /** The wide views (podium, highlights): for each, which seats' cars are inside it on screen (P1-U02.4). */
  carsSeen: () => lastViews.filter((v) => v.camera && ['overview', 'reel', 'highlight', 'wide'].includes(v.kind)).map((v) => ({ kind: v.kind, seat: v.seat ?? null, x: v.x, y: v.y, w: v.w, h: v.h, inside: Array.from({ length: S.n }, (_, i) => i + 1).filter((seat) => { const p = world.project(seat, v.camera, v); return p && p.z < 1 && p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h; }) })),
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
