// phone.js — phone controller mocks (P1-U03, reworked in P1-U03.2 for the owner's round 1: POC1-18 to 22). Every state opens
// from a URL fragment (#race&stick=preload); the live mock drives the sticks with Pointer Events (one pointer per zone, so
// two thumbs move two sticks independently), shows the indicators, the edge-safe zones and a thumb-reach overlay, and sends
// nothing anywhere.
import { loadTokens, seatColor, asset, paintPath, tiltFor } from '../shared/tokens.js';

export const STATES = {
  'In race': ['race', 'race&stick=touched', 'race&stick=preload', 'race&stick=cooldown', 'race&stick=disabled', 'race&stick=autopilot', 'identify', 'identify&at=150', 'menu', 'tutorial', 'tutorial&step=2', 'tutorial&step=4&won=1'],
  'Lobby: pick your car': ['lobby', 'lobby&car=3', 'lobby&car=5&ready=1', 'join', 'settings'],
  'Landscape first (R101)': ['gate', 'rotate'],
  'Controller states (§11)': ['finding', 'no-such-game', 'game-ended', 'preview-expired', 'connecting', 'finding-relay', 'no-route', 'ready-to-join', 'joining', 'playing', 'reconnecting', 'host-gone', 'host-paused', 'another-tab', 'update-needed'],
  'Live mock overlays': ['race&edges=1', 'race&reach=1'],
};

const tokens = await loadTokens();
const app = document.getElementById('app');
const icon = (n) => `<img class="i" alt="" src="${asset(`icons/${n}.svg`)}">`;
const parse = () => {
  const [name, ...rest] = location.hash.replace(/^#/, '').split('&');
  const p = new URLSearchParams(rest.join('&'));
  return { name: name || 'race', p, seat: +(p.get('seat') ?? 12), chrome: p.get('chrome') !== '0' };
};
let S = parse();
const me = () => { const c = seatColor(tokens, S.seat); return { num: S.seat, name: S.p.get('name') ?? 'Dusty', hex: c.hex, on: c.on }; };
const ordinal = (n) => { const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; return `${n}<sup>${s}</sup>`; };
const landscape = () => matchMedia('(orientation: landscape)').matches;
const TICKS = '<svg class="tk" viewBox="0 0 26 44" aria-hidden="true"><path d="M4 6 L22 15 M2 22 L22 22 M4 38 L22 29"/></svg>';

// R102 shapes (U01.3): torn banners and brushed tags/strips, seeded by id, never animated.
function paint(root) {
  const amp = tokens.language.banner.heading.tornAmplitudePx.handheld;
  for (const e of root.querySelectorAll('[data-torn], [data-brush]')) {
    const torn = e.dataset.torn != null, w = e.offsetWidth, h = e.offsetHeight;
    if (!w || !h) continue;
    e.querySelector(':scope > svg.paint')?.remove();
    e.insertAdjacentHTML('afterbegin', `<svg class="paint" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${paintPath(torn ? e.dataset.torn : e.dataset.brush, w, h, amp, torn ? 'torn' : 'brush')}"/></svg>`);
  }
  for (const e of root.querySelectorAll('[data-tilt]')) e.style.rotate = `${tiltFor(e.dataset.tilt, tokens.language.slant.panelTiltMaxDeg)}deg`;
}

// ---- sticks ----
const stick = { drive: { x: 0, y: 0 }, action: { x: 0, y: 0 } };
window.__phone = { ready: false, sticks: stick, sent: 0, states: STATES, tutorial: null, session: null };

function stickZone(kind, opts) {
  const z = document.createElement('div');
  z.className = `zone ${kind}${opts.disabled ? ' disabled' : ''}`;
  z.dataset.box = `zone-${kind}`;
  z.setAttribute('role', 'button');
  z.setAttribute('aria-label', kind === 'drive' ? 'Drive stick: steer, accelerate, brake and reverse' : 'Action stick: boost right, drift left, utilities up and down');
  z.innerHTML = `<span class="tag display">${kind === 'drive' ? 'Drive' : 'Action'}</span><div class="base"><div class="preload" style="--p:0%"></div><div class="knob">${kind === 'action' ? icon('zap') : ''}</div></div>`;
  return z;
}

function attachStick(z, kind, ui) {
  const base = z.querySelector('.base'), knob = z.querySelector('.knob'), preload = z.querySelector('.preload');
  let home = null, pid = null, origin = null, preloadT = 0, raf = 0;
  const R = () => base.offsetWidth * 0.42;
  const place = (x, y) => { base.style.left = `${x}px`; base.style.top = `${y}px`; };
  const setHome = () => { const r = z.getBoundingClientRect(); home = { x: r.width / 2, y: r.height * 0.58 }; if (pid == null) place(home.x, home.y); };
  new ResizeObserver(setHome).observe(z);
  setHome();
  const move = (dx, dy) => {
    const r = R(), d = Math.hypot(dx, dy), k = d > r ? r / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px) scale(1.08)`;
    stick[kind].x = +((dx * k) / r).toFixed(3);
    stick[kind].y = +((dy * k) / r).toFixed(3);
    window.__phone.sent++;
    ui?.update?.(kind, stick[kind]);
  };
  const tickPreload = () => {
    if (pid == null) return;
    if (kind === 'drive' && stick.drive.y > 0.8) preloadT = Math.min(1, preloadT + 1 / 48); else preloadT = Math.max(0, preloadT - 1 / 24);
    preload.style.setProperty('--p', `${Math.round(preloadT * 100)}%`);
    z.querySelector('.preload-label')?.toggleAttribute('hidden', preloadT === 0);
    raf = requestAnimationFrame(tickPreload);
  };
  z.addEventListener('pointerdown', (e) => {
    if (pid != null || z.classList.contains('disabled')) return;
    pid = e.pointerId;
    try { z.setPointerCapture(e.pointerId); } catch { /* capture is a nicety; zone events still arrive */ }
    const r = z.getBoundingClientRect();
    const fixed = S.p.get('fixed') === '1';
    origin = fixed ? { ...home } : { x: Math.min(Math.max(e.clientX - r.left, R() + 8), r.width - R() - 8), y: Math.min(Math.max(e.clientY - r.top, R() + 8), r.height - R() - 8) };
    place(origin.x, origin.y);
    z.classList.add('active');
    navigator.vibrate?.(8);
    move(e.clientX - r.left - origin.x, e.clientY - r.top - origin.y);
    raf = requestAnimationFrame(tickPreload);
  });
  z.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const r = z.getBoundingClientRect();
    move(e.clientX - r.left - origin.x, e.clientY - r.top - origin.y);
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    cancelAnimationFrame(raf);
    if (kind === 'drive' && preloadT >= 1) ui?.wheelie?.();
    preloadT = 0;
    preload.style.setProperty('--p', '0%');
    z.classList.remove('active');
    knob.style.transform = '';
    stick[kind].x = 0; stick[kind].y = 0;
    place(home.x, home.y);
    ui?.update?.(kind, stick[kind]);
  };
  z.addEventListener('pointerup', end);
  z.addEventListener('pointercancel', end);
  return { show(dx, dy, pre) { z.classList.add('active'); const r = R(); knob.style.transform = `translate(${dx * r}px, ${dy * r}px) scale(1.08)`; if (pre != null) { preload.style.setProperty('--p', `${pre}%`); } } };
}

// ---- the identify flash (POC1-21, R99): the TV's timed high-exposure flash in the player's colour ----
// Same tween as the TV (tokens.motion identify-pulse, 1.5 s: fast attack, long decay; P1-U05.2's motion reel is the shared
// reference); reduced motion holds the wash. `at` (ms) holds it at that moment for captures.
function cooee(m, { at = null, onEnd } = {}) {
  const c = document.createElement('div');
  c.className = 'cooee-phone';
  c.dataset.overlay = 'flash';
  c.style.setProperty('--seat', m.hex); c.style.setProperty('--seat-on', m.on);
  c.innerHTML = `<i class="flash"></i><div class="lab"><b class="display">Cooee #${m.num}</b><span>That's you on the TV</span></div>`;
  if (at != null) for (const e of c.querySelectorAll('.flash, .lab')) { e.style.animationDelay = `-${at}ms`; e.style.animationPlayState = 'paused'; }
  c.querySelector('.flash').addEventListener('animationend', () => onEnd?.(c));
  // It never covers your number or the tools (the strip stays on top, the colour frame stays round the screen).
  requestAnimationFrame(() => { const top = Math.max(0, ...[...document.querySelectorAll('[data-box=strip], [data-box=tools]')].map((e) => e.getBoundingClientRect().bottom)); c.style.top = `${top}px`; });
  return c;
}
function identifyNow() {
  const m = me();
  navigator.vibrate?.([30, 40, 30]);
  app.append(cooee(m, { onEnd: (c) => c.remove() }));
  tutorialEvent('identify');
}

// ---- screens ----
function strip(extra = '') {
  const m = me();
  return `<div class="strip" data-box="strip" style="--seat:${m.hex};--seat-on:${m.on}"><div class="who"><span class="badge">#${m.num}</span><span class="nm">${m.name}</span></div>${extra}</div>`;
}
const tools = (inline) => `<div class="tools${inline ? ' inline' : ''}" data-box="tools"><button class="btn identify" aria-label="Identify: flash my number on the TV">${icon('locate-fixed')}Identify</button><button class="btn quiet icon" aria-label="Camera: chase or in the car">${icon('video')}</button><button class="btn quiet icon" aria-label="Recover: put my car back on the road">${icon('rotate-ccw')}</button><button class="btn quiet icon" aria-label="Menu: help, settings, leave">${icon('menu')}</button></div>`;

// POC1-18: boost and power-ups sit together at the top centre, between the two sticks (landscape: a centre column;
// portrait: a centred row above the sticks), so neither thumb has to leave its stick to see them.
const pod = (cooldown) => `<div class="pod" data-box="pod"><div class="pod-boost"><span class="pod-label display">Boost</span><div class="meter" aria-label="Boost 62%"><i style="--v:62%"></i></div></div><div class="pod-items"><div class="utility${cooldown ? ' cooldown' : ''}" style="--c:35%" aria-label="Cone: ${cooldown ? 'recharging' : 'ready'}"><img alt="" src="${asset('icons/traffic-cone.svg')}"></div><div class="utility item" aria-label="Power-up: empty"><img alt="" src="${asset('icons/dices.svg')}"></div></div><span class="pod-cd">${cooldown ? 'Cone in 3 s' : 'Cone ready'}</span></div>`;

function race() {
  const m = me();
  const land = landscape();
  const stickState = S.p.get('stick') ?? 'idle';
  const s = document.createElement('div');
  s.className = 'screen';
  s.style.setProperty('--seat', m.hex); s.style.setProperty('--seat-on', m.on);
  const raceInfo = `<div class="race"><div class="pos display">${ordinal(3)}</div><div class="lap tnum">Lap 2/3</div></div>`;
  s.innerHTML = land ? strip(`${raceInfo}${tools(true)}`) : `${strip(raceInfo)}${tools(false)}`;
  if (!land) s.insertAdjacentHTML('beforeend', pod(stickState === 'cooldown'));
  const area = document.createElement('div');
  area.className = `sticks${land ? ' with-pod' : ''}`;
  const drive = stickZone('drive', { disabled: stickState === 'disabled' });
  const action = stickZone('action', { disabled: stickState === 'disabled' });
  drive.insertAdjacentHTML('beforeend', `<span class="preload-label display" hidden data-box="preload-label">Wheelie: let go to pop it</span>`);
  area.append(drive);
  if (land) area.insertAdjacentHTML('beforeend', pod(stickState === 'cooldown'));
  area.append(action);
  s.append(area);
  app.append(s);
  s.querySelector('.btn.identify').addEventListener('click', identifyNow);
  const posIndicators = () => {
    const pl = drive.querySelector('.preload-label');
    const d = drive.getBoundingClientRect();
    pl.style.left = `${d.width / 2}px`; pl.style.top = `${d.height * 0.58 - drive.querySelector('.base').offsetWidth / 2 - 54}px`;
  };
  new ResizeObserver(posIndicators).observe(drive);
  const ui = {
    update(kind, v) { tutorialStick(kind, v); },
    wheelie() { const b = document.createElement('div'); b.className = 'banner'; b.style.background = 'var(--c-saffron)'; b.style.color = 'var(--c-ink)'; b.textContent = 'Wheelie!'; s.append(b); setTimeout(() => b.remove(), 700); tutorialEvent('wheelie'); },
  };
  const dStick = attachStick(drive, 'drive', ui);
  const aStick = attachStick(action, 'action', ui);
  requestAnimationFrame(() => {
    posIndicators();
    if (stickState === 'touched') { dStick.show(-0.55, -0.6); aStick.show(0.7, 0); }
    if (stickState === 'preload') { dStick.show(0, 0.95, 70); drive.querySelector('.preload-label').hidden = false; }
  });
  if (stickState === 'autopilot') area.classList.add('autopilot');
  if (stickState === 'autopilot') area.insertAdjacentHTML('beforeend', `<div class="banner bottom" data-overlay="banner">${icon('car')}<span>Autopilot is driving your car<small>Move a stick to take over. Everyone else keeps racing.</small></span></div>`);
  if (S.name === 'tutorial') tutorial(area, s);
  if (S.name === 'menu') {
    area.insertAdjacentHTML('beforeend', `<div class="menusheet" data-overlay="menu"><h2 class="display italic">Menu</h2><div class="menu-grid">${[['locate-fixed', 'Identify: flash my number on the TV'], ['video', 'Camera: chase / in the car'], ['rotate-ccw', 'Recover my car'], ['circle-help', 'Help and tutorial'], ['settings', 'Settings'], ['log-out', 'Leave room']].map(([i, t], n) => `<button class="btn ${n === 5 ? 'danger' : n === 0 ? 'primary' : ''}" style="justify-content:flex-start">${icon(i)}${t}</button>`).join('')}<button class="btn">Close</button></div></div>`);
  }
  let promptRotate = S.name === 'rotate';
  if (!promptRotate && !land && !navigator.webdriver && S.chrome) { // the live mock asks once a visit in portrait
    try { promptRotate = sessionStorage.getItem('jj-rotate') !== '1'; sessionStorage.setItem('jj-rotate', '1'); } catch { /* no storage: don't nag */ }
  }
  if (promptRotate) {
    // R101: landscape first. In portrait the controller asks to turn sideways; it still works upright.
    area.insertAdjacentHTML('beforeend', `<div class="rotate-card panel" data-overlay="rotate"><div class="phone-turn" aria-hidden="true">${icon('smartphone')}</div><b class="display italic">Turn sideways</b><p>The sticks get the whole width, and your thumbs sit where they rest.</p><button class="btn" data-act="upright">Play upright anyway</button></div>`);
    area.querySelector('[data-act=upright]').addEventListener('click', (e) => e.target.closest('.rotate-card').remove());
  }
  if (S.p.get('edges') === '1') app.insertAdjacentHTML('beforeend', '<div class="edges"></div>');
  if (S.p.get('reach') === '1') {
    // Thumb reach from the bottom corners: comfortable (no grip change) and stretch, sized from hand-size norms as a
    // fraction of the short side; the idle sticks should sit in the comfortable band.
    const sh = Math.min(innerWidth, innerHeight), c = sh * (land ? 0.78 : 0.62), st = sh * (land ? 1.05 : 0.86);
    const arcs = (r, cls) => `<i class="${cls}" style="left:${-r}px;top:${innerHeight - r}px;width:${2 * r}px;height:${2 * r}px"></i><i class="${cls}" style="left:${innerWidth - r}px;top:${innerHeight - r}px;width:${2 * r}px;height:${2 * r}px"></i>`;
    app.insertAdjacentHTML('beforeend', `<div class="reach">${arcs(st, 'stretch')}${arcs(c, 'comfy')}<div class="legend"><span class="sw comfy"></span>Comfortable thumb reach <span class="sw stretch"></span>Stretch</div></div>`);
  }
}

// ---- the tutorial (POC1-20): bigger, central, and each step advances when the player does it ----
const STEPS = [
  { title: 'Steer', text: 'Push the left stick right, then left.', goals: [['right', 'Right'], ['left', 'Left']], stick: (k, v, g) => { if (k === 'drive' && v.x > 0.7) g.right = true; if (k === 'drive' && v.x < -0.7) g.left = true; } },
  { title: 'Go and stop', text: 'Push the left stick up to drive, then pull it back to brake.', goals: [['go', 'Go'], ['stop', 'Stop']], stick: (k, v, g) => { if (k === 'drive' && v.y < -0.7) g.go = true; if (k === 'drive' && g.go && v.y > 0.7) g.stop = true; } },
  { title: 'Boost', text: 'Hold the right stick to the right.', goals: [['boost', 'Boost']], stick: (k, v, g) => { if (k === 'action' && v.x > 0.7) g.boost = true; } },
  { title: 'Drift', text: 'Hold the right stick to the left through a corner.', goals: [['drift', 'Drift']], stick: (k, v, g) => { if (k === 'action' && v.x < -0.7) g.drift = true; } },
  { title: 'Wheelie', text: 'Pull the left stick all the way back, hold until the ring fills, then let go.', goals: [['wheelie', 'Wheelie']], event: (e, g) => { if (e === 'wheelie') g.wheelie = true; } },
  { title: 'Find yourself', text: 'Tap Identify: your number flashes on the TV.', goals: [['identify', 'Identify']], event: (e, g) => { if (e === 'identify') g.identify = true; } },
];
let tut = null;
function tutorial(area, screen) {
  const start = Math.max(0, Math.min(STEPS.length - 1, +(S.p.get('step') ?? 1) - 1));
  tut = { step: start, goals: {}, done: [], card: null, screen };
  window.__phone.tutorial = { step: tut.step, done: tut.done };
  area.classList.add('coaching');
  const card = document.createElement('div');
  card.className = 'panel coach';
  card.dataset.overlay = 'coach';
  area.append(card);
  tut.card = card;
  renderStep(S.p.get('won') === '1');
}
function renderStep(won = false) {
  const st = STEPS[tut.step], g = tut.goals;
  tut.card.innerHTML = `<div class="coach-top"><span class="tag" data-brush="coach-step"><span>Step ${tut.step + 1} of ${STEPS.length}</span></span><button class="btn quiet-ink" data-act="skip">Skip tutorial</button></div>
    <h2 class="display italic">${st.title}</h2><p>${st.text}</p>
    <div class="goals">${st.goals.map(([k, label]) => `<span class="goal${g[k] || won ? ' on' : ''}">${g[k] || won ? icon('check') : ''}${label}</span>`).join('')}</div>
    ${won ? '<span class="goodstrip" data-brush="coach-nice"><span>Nice! On to the next one</span></span>' : `<div class="dots">${STEPS.map((_, i) => `<i class="${i < tut.step ? 'done' : i === tut.step ? 'on' : ''}"></i>`).join('')}</div>`}`;
  if (won) for (const [k] of st.goals) g[k] = true;
  tut.card.querySelector('[data-act=skip]').addEventListener('click', () => { tut.card.remove(); tut.screen.querySelector('.sticks')?.classList.remove('coaching'); tut = null; });
  paint(tut.card);
}
function checkStep() {
  if (!tut) return;
  const st = STEPS[tut.step];
  if (!st.goals.every(([k]) => tut.goals[k])) { renderStep(); return; }
  if (tut.advancing) return;
  tut.advancing = true;
  tut.done.push(tut.step);
  renderStep(true);
  setTimeout(() => {
    if (!tut) return;
    tut.advancing = false;
    if (tut.step < STEPS.length - 1) { tut.step++; tut.goals = {}; renderStep(); }
    else { tut.card.innerHTML = `<h2 class="display italic">You're ready</h2><p>That's every control. The race waits for you.</p><button class="btn primary big" data-act="done">Let's race</button>`; tut.card.querySelector('[data-act=done]').addEventListener('click', () => tut?.card.remove()); tut.step = STEPS.length; }
    window.__phone.tutorial = { step: tut.step, done: [...tut.done] };
  }, 700);
  window.__phone.tutorial = { step: tut.step, done: [...tut.done] };
}
// Only a newly met goal redraws the card (sticks report every move).
const met = () => Object.keys(tut.goals).filter((k) => tut.goals[k]).join();
function tutorialStick(kind, v) { if (tut && STEPS[tut.step]?.stick) { const before = met(); STEPS[tut.step].stick(kind, v, tut.goals); if (met() !== before) checkStep(); } }
function tutorialEvent(e) { if (tut && STEPS[tut.step]?.event) { const before = met(); STEPS[tut.step].event(e, tut.goals); if (met() !== before) checkStep(); } }

function identify() {
  const m = me();
  const at = S.p.get('at');
  const s = document.createElement('div');
  s.className = 'screen';
  s.innerHTML = strip();
  app.append(s);
  const play = () => app.append(cooee(m, { at: at == null ? null : +at, onEnd: (c) => { c.remove(); setTimeout(play, 1500); } }));
  play();
}

// ---- the lobby (POC1-19): pick your car from the roster, in the R102 language ----
// The roster is the master plan's starting line-up (§7.6; working names). Only the Cruz Missile has art yet (R81's canonical
// model); the rest are silhouettes in your colour until theirs are built. Stats are mock 0-10 bars; the real ones are
// measured by the sim (§7.6, "derived, not hand-typed").
const ROSTER = [
  { name: 'Cruz Missile', cls: 'Aussie classic', blurb: 'Honest all-rounder. Loves a kerb.', art: 'renders/cruz-missile-hero.png', stats: [6, 6, 7, 5] },
  { name: 'The Gull', cls: 'Aussie classic', blurb: 'Big family sedan. Wallows, then flies.', shape: 'sedan', stats: [8, 5, 4, 7] },
  { name: 'Laser Beam', cls: 'Aussie classic', blurb: 'Light hatch, tight turns, a bit fragile.', shape: 'hatch', stats: [6, 7, 8, 3] },
  { name: 'Tri-Tonne', cls: 'Ute', blurb: 'Bouncy tray, happy off the bitumen.', shape: 'ute', stats: [6, 5, 5, 7] },
  { name: 'Land Crusher', cls: '4WD', blurb: 'Huge armour. Turns like a ship.', shape: 'wagon', stats: [5, 4, 3, 9] },
  { name: 'Billy Kart', cls: 'Kart', blurb: 'Tiny, twitchy, brilliant in a pack.', shape: 'kart', stats: [5, 8, 9, 2] },
];
const STAT_NAMES = ['Speed', 'Accel', 'Handling', 'Toughness'];
const SHAPES = { // side profiles, 200 × 90, nose to the right
  sedan: 'M14 62 L22 44 L58 40 L84 22 L134 20 L160 40 L188 46 L192 62 Z',
  hatch: 'M16 62 L22 42 L66 38 L92 20 L140 18 L168 42 L184 48 L186 62 Z',
  ute: 'M10 62 L12 38 L92 38 L94 20 L132 18 L158 40 L190 46 L192 62 Z',
  wagon: 'M12 64 L14 24 L132 18 L160 38 L190 44 L192 64 Z',
  kart: 'M24 64 L30 52 L84 48 L96 34 L112 34 L120 48 L176 52 L182 64 Z',
};
const carArt = (c, m, big) => c.art
  ? `<img class="carimg${big ? ' big' : ''}" alt="${c.name}" src="${asset(c.art)}">`
  : `<svg class="carimg sil${big ? ' big' : ''}" viewBox="0 0 200 90" role="img" aria-label="${c.name} (silhouette)"><path d="${SHAPES[c.shape]}" fill="${m.hex}" stroke="#15203A" stroke-width="5" stroke-linejoin="round"/><circle cx="52" cy="66" r="15" fill="#15203A"/><circle cx="152" cy="66" r="15" fill="#15203A"/><circle cx="52" cy="66" r="6" fill="#9AA2AB"/><circle cx="152" cy="66" r="6" fill="#9AA2AB"/></svg>`;
function lobby() {
  const m = me(), ready = S.p.get('ready') === '1';
  let pick = Math.max(0, Math.min(ROSTER.length - 1, +(S.p.get('car') ?? 1) - 1));
  const s = document.createElement('div');
  s.className = 'screen lobby2';
  s.style.setProperty('--seat', m.hex); s.style.setProperty('--seat-on', m.on);
  s.innerHTML = `${strip(`<span class="strip-acts"><button class="btn identify icon" aria-label="Identify">${icon('locate-fixed')}</button><button class="btn quiet icon" aria-label="Settings">${icon('settings')}</button></span>`)}
    <div class="picker">
      <div class="stage" data-box="car"></div>
      <div class="side">
        <div class="thumbs" data-box="thumbs" role="listbox" aria-label="Cars">${ROSTER.map((c, i) => `<button class="thumb" role="option" data-i="${i}" aria-label="${c.name}">${carArt(c, m, false)}</button>`).join('')}</div>
        <div class="panel namep" data-box="name"><p class="label">Your name</p><div class="field"><input value="${m.name}" aria-label="Your name" maxlength="64"><button class="btn icon" aria-label="New random name">${icon('dices')}</button></div></div>
        <div class="readyrow" data-box="ready"><span class="ticks">${TICKS}<button class="btn primary big">${ready ? `${icon('check')}You're ready` : 'Ready'}</button>${TICKS}</span></div>
        <div class="waiting" data-box="waiting">${ready ? 'Tap again if you need a minute.' : 'Waiting for the host to start'} · 27 of 32 ready</div>
      </div>
    </div>`;
  app.append(s);
  s.querySelector('.btn.identify').addEventListener('click', identifyNow);
  const stage = s.querySelector('.stage');
  const show = () => {
    const c = ROSTER[pick];
    stage.innerHTML = `<div class="carpanel" data-tilt="carpanel-${pick}">
        <span class="tag" data-brush="cls-${pick}"><span>${c.cls}</span></span>
        ${carArt(c, m, true)}
        ${c.art ? '' : '<span class="artnote">Art to come</span>'}
        <div class="stats">${STAT_NAMES.map((n, i) => `<div class="stat"><span>${n}</span><i style="--v:${c.stats[i] * 10}%"></i></div>`).join('')}</div>
        <p class="blurb">${c.blurb}</p>
      </div>
      <span class="bn carname" data-torn="car-${pick}">${c.name.replace(/(\S+)$/, '<span class="acc">$1</span>')}</span>
      <button class="btn icon arrow prev" aria-label="Previous car">${icon('chevron-left')}</button>
      <button class="btn icon arrow next" aria-label="Next car">${icon('chevron-right')}</button>`;
    stage.querySelector('.prev').addEventListener('click', () => { pick = (pick + ROSTER.length - 1) % ROSTER.length; show(); });
    stage.querySelector('.next').addEventListener('click', () => { pick = (pick + 1) % ROSTER.length; show(); });
    for (const t of s.querySelectorAll('.thumb')) t.setAttribute('aria-selected', String(+t.dataset.i === pick));
    requestAnimationFrame(() => paint(stage));
  };
  s.querySelector('.thumbs').addEventListener('click', (e) => { const t = e.target.closest('.thumb'); if (t) { pick = +t.dataset.i; show(); } });
  let sx = null; // swipe the stage to change car
  stage.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) sx = e.clientX; });
  stage.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 40) { pick = (pick + (e.clientX < sx ? 1 : ROSTER.length - 1)) % ROSTER.length; show(); } sx = null; });
  show();
}

// ---- landscape first, full screen and a wake lock (POC1-22, R101) ----
// The tap is the user gesture both APIs need. Fullscreen: the Fullscreen API (Android Chrome, desktop); iPhone Safari has no
// element fullscreen, so it says "Add to Home Screen" instead. Orientation lock where allowed (Android, in fullscreen).
// Wake lock: the Screen Wake Lock API (Chrome, Safari 16.4+), re-taken when the page comes back; where it's missing or
// refused, the card says the screen may dim.
let wake = null;
async function goFullscreen() {
  const res = { fullscreen: 'unsupported', orientation: 'unsupported', wakeLock: 'unsupported', order: [] };
  const el = document.documentElement;
  const fs = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (fs) { res.order.push('fullscreen'); try { await fs.call(el, { navigationUI: 'hide' }); res.fullscreen = 'on'; } catch { res.fullscreen = 'refused'; } }
  if (screen.orientation?.lock) { res.order.push('orientation'); try { await screen.orientation.lock('landscape'); res.orientation = 'locked'; } catch { res.orientation = 'refused'; } }
  if (navigator.wakeLock?.request) { res.order.push('wakeLock'); try { wake = await navigator.wakeLock.request('screen'); res.wakeLock = 'on'; } catch { res.wakeLock = 'refused'; } }
  window.__phone.session = res;
  return res;
}
document.addEventListener('visibilitychange', async () => { if (wake && document.visibilityState === 'visible') { try { wake = await navigator.wakeLock.request('screen'); } catch { /* stays as it was */ } } });
function gate() {
  const s = document.createElement('div');
  s.className = 'screen gate';
  s.innerHTML = `<div class="centre"><div class="panel gatecard" data-box="gate" data-tilt="gate">
      <span class="bn gatebn" data-torn="gate">Get <span class="acc">set</span></span>
      <div class="phone-turn" aria-hidden="true">${icon('smartphone')}</div>
      <p class="lead">Turn your phone sideways, then tap to go full screen. We'll keep the screen awake while you play.</p>
      <span class="ticks">${TICKS}<button class="btn primary big" data-act="go">${icon('maximize')}Tap to go full screen</button>${TICKS}</span>
      <div class="results" hidden></div>
      <p class="fallback">On iPhone there's no full screen in Safari: Add to Home Screen hides the browser bars. If your phone can't stay awake, it may dim; any tap wakes it.</p>
    </div></div>`;
  app.append(s);
  s.querySelector('[data-act=go]').addEventListener('click', async () => {
    const r = await goFullscreen();
    const say = { on: '✓', locked: '✓', refused: 'refused', unsupported: 'not on this phone' };
    const box = s.querySelector('.results');
    box.innerHTML = `<span>Full screen: ${say[r.fullscreen]}</span><span>Sideways lock: ${say[r.orientation]}</span><span>Screen stays awake: ${say[r.wakeLock]}</span>`;
    box.hidden = false;
  });
  requestAnimationFrame(() => paint(s));
}

function join() {
  app.insertAdjacentHTML('beforeend', `<div class="screen"><div class="scroll join" style="justify-content:center">
      <img alt="Joystick Jammers" src="${asset('brand/wordmark-on-ink.svg')}" style="width:min(260px,70%);align-self:center" data-box="wordmark">
      <div class="panel" data-box="join"><h1 class="display italic" style="margin:0 0 10px;font-size:32px">Join a game</h1><p class="label">Room code on the TV</p>
        <div class="field"><input class="code" value="ROO7" aria-label="Room code" maxlength="8" autocapitalize="characters"><button class="btn">${icon('scan-qr-code')}Scan QR code</button></div>
        <div style="height:14px"></div><button class="btn primary big">Join</button></div>
      <div class="waiting" data-box="hint">Got a link from the TV? It opens this page with the code filled in.</div>
    </div></div>`);
}

function settings() {
  const m = me();
  app.insertAdjacentHTML('beforeend', `<div class="screen" style="--seat:${m.hex};--seat-on:${m.on}">${strip()}<div class="scroll settings">
      <div class="banner" style="position:static;transform:none;max-width:none;white-space:normal" data-box="banner">${icon('car')}<span>Autopilot is driving your car<small>Everyone else keeps racing.</small></span></div>
      <div class="panel" data-box="controls"><h1 class="display italic" style="margin:0 0 12px;font-size:30px">Your controls</h1>
        <div class="seg" role="group" aria-label="Stick placement"><span class="on">Floating sticks</span><span>Fixed sticks</span></div>
        <div style="height:12px"></div>
        <div class="row">Steering<span style="display:flex;align-items:center;gap:8px;flex:1;margin-left:12px"><small>Gentle</small><span class="slider"></span><small>Direct</small></span></div>
        <div style="height:8px"></div><div class="row">Camera distance<span class="seg mini" role="group" aria-label="Camera distance"><span>Near</span><span class="on">Host's</span><span>Far</span></span></div>
        <div style="height:8px"></div><div class="row">Vibration<span class="toggle on" role="switch" aria-checked="true"></span></div>
        <div style="height:8px"></div><div class="row"><span>Reduced motion<small>Fewer flashes, no shake</small></span><span class="toggle" role="switch" aria-checked="false"></span></div>
        <div style="height:8px"></div><div class="row"><span>Remember on this device<small>Until you clear browser data</small></span><span class="toggle on" role="switch" aria-checked="true"></span></div></div>
      <div class="actions" data-box="actions"><button class="btn primary big">Save and back to driving</button>
      <button class="btn">Test these controls</button>
      <div style="display:flex;gap:10px"><button class="btn" style="flex:1">${icon('pause')}Sit out</button><button class="btn danger" style="flex:1">${icon('log-out')}Leave room</button></div></div>
    </div></div>`);
}

const CARDS = {
  finding: ['spin', 'Finding game ROO7…', 'Hang on, looking for the TV.', ['Cancel']],
  'no-such-game': ['triangle-alert', 'No game with code K7QX', 'Check the code on the TV, or scan the QR again.', ['primary:Edit the code', 'Scan again']],
  'game-ended': ['flag', 'That game has ended', 'Thanks for playing! You finished 3rd.', ['primary:Join another game']],
  'preview-expired': ['timer', 'This test build has expired', 'Preview builds last a day. The preview index has the newest one.', ['primary:Open the preview index']],
  connecting: ['spin', 'Connecting…', 'Linking your controller to the TV.', []],
  'finding-relay': ['spin', 'Finding a relay…', 'Your network is fussy. Still trying on its own.', []],
  'no-route': ['wifi-off', 'Can’t reach the host from this network', 'Try the host’s Wi-Fi, then tap Retry.', ['primary:Retry']],
  'ready-to-join': ['ok:users', 'You’re in ROO7', 'Pick a name, then join the race.', ['field', 'primary:Join the race']],
  joining: ['spin', 'Joining…', 'Saving you a number.', []],
  playing: ['ok:check', 'You’re #12', 'Watch the TV for your number and colour.', ['primary:Got it']],
  reconnecting: ['spin', 'Reconnecting as #12…', 'Your car is on autopilot until you’re back.', []],
  'host-gone': ['warn:triangle-alert', 'The host seems to have gone', 'Ask them for a new code. We’ll keep trying quietly.', ['Enter a new code']],
  'host-paused': ['pause', 'Host paused', 'Back in a moment.', []],
  'another-tab': ['smartphone', 'Playing in another tab', 'You can only drive from one tab at a time.', ['primary:Use this one']],
  'update-needed': ['spin', 'Updating…', 'A newer build is out. Reloading once.', []],
};
function card(name) {
  const [ic, title, body, acts] = CARDS[name];
  const m = me();
  const [kind, iname] = ic.includes(':') ? ic.split(':') : ['', ic];
  const head = ic === 'spin' ? '<div class="spin" aria-hidden="true"></div>' : `<div class="state-icon ${kind}">${icon(iname)}</div>`;
  const actions = acts.map((a) => (a === 'field' ? `<div class="field"><input value="${m.name}" aria-label="Your name"><button class="btn icon" aria-label="New random name">${icon('dices')}</button></div>` : a.startsWith('primary:') ? `<button class="btn primary big">${a.slice(8)}</button>` : `<button class="btn">${a}</button>`)).join('');
  app.insertAdjacentHTML('beforeend', `<div class="screen" style="--seat:${m.hex};--seat-on:${m.on}"><div class="centre"><div class="panel card on-paper" data-box="card">${head}<h1 class="display italic">${title}</h1><p>${body}</p><div class="acts">${actions}</div></div></div></div>`);
}

function mockBar() {
  if (!S.chrome) return;
  const b = document.createElement('button');
  b.className = 'mockbtn';
  b.textContent = 'Mock ▾';
  b.addEventListener('click', () => {
    const sheet = document.createElement('div');
    sheet.className = 'mocksheet';
    sheet.innerHTML = `<h2 class="display italic">Phone mock · P1-U03.2</h2><p style="font-weight:500">Nothing here is sent anywhere. Toggle the overlays, or jump to a state.</p>${Object.entries(STATES).map(([g, list]) => `<h2 class="display" style="font-size:20px;margin-top:14px">${g}</h2>${list.map((s) => `<a href="#${s}">${s}</a>`).join('')}`).join('')}<div><button class="close">Close</button></div>`;
    sheet.addEventListener('click', (e) => { if (e.target.closest('a') || e.target.closest('.close')) sheet.remove(); });
    app.append(sheet);
  });
  app.append(b);
}

function render() {
  S = parse();
  app.innerHTML = '';
  tut = null;
  window.__phone.tutorial = null;
  stick.drive.x = stick.drive.y = stick.action.x = stick.action.y = 0;
  const m = me();
  app.style.setProperty('--seat', m.hex);
  if (['race', 'tutorial', 'menu', 'rotate'].includes(S.name)) race();
  else if (S.name === 'identify') identify();
  else if (S.name === 'lobby') lobby();
  else if (S.name === 'join') join();
  else if (S.name === 'settings') settings();
  else if (S.name === 'gate') gate();
  else if (CARDS[S.name]) card(S.name);
  else race();
  // POC1-21: the player's identify colour is always on screen, as a frame round the whole controller.
  if (!['join', 'gate'].includes(S.name) && !CARDS[S.name]) app.insertAdjacentHTML('beforeend', '<div class="idframe" aria-hidden="true"></div>');
  // The live mock asks for full screen once per visit (never in automated runs, which open #gate on purpose).
  let asked = true;
  try { asked = sessionStorage.getItem('jj-gate') === '1'; } catch { /* no storage: don't nag */ }
  if (!navigator.webdriver && !asked && S.chrome && ['race', 'lobby'].includes(S.name)) {
    try { sessionStorage.setItem('jj-gate', '1'); } catch { /* ignore */ }
    location.hash = 'gate';
    return;
  }
  mockBar();
  document.title = `Phone mock · ${S.name}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { paint(app); window.__phone.ready = true; }));
}

// Touch hygiene (plan §11): keep an accidental back gesture on the controller; block pinch and double-tap zoom.
history.pushState({ guard: true }, '');
addEventListener('popstate', () => history.pushState({ guard: true }, ''));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
addEventListener('hashchange', () => { window.__phone.ready = false; render(); });
let lastOrient = landscape();
addEventListener('resize', () => { const o = landscape(); if (o !== lastOrient) { lastOrient = o; render(); } });
render();
