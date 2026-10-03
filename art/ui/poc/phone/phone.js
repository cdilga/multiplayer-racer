// phone.js — phone controller mocks (P1-U03). Every state opens from a URL fragment (#race&stick=preload); the live
// mock drives the sticks with Pointer Events (one pointer per zone, so two thumbs move two sticks independently),
// shows the indicators, the edge-safe zones and a thumb-reach overlay, and sends nothing anywhere.
import { loadTokens, seatColor, asset } from '../shared/tokens.js';

export const STATES = {
  'In race': ['race', 'race&stick=touched', 'race&stick=preload', 'race&stick=cooldown', 'race&stick=disabled', 'race&stick=autopilot', 'identify', 'menu', 'tutorial'],
  'Lobby, join and settings': ['lobby', 'lobby&ready=1', 'join', 'settings'],
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

// ---- sticks ----
const stick = { drive: { x: 0, y: 0 }, action: { x: 0, y: 0 } };
window.__phone = { ready: false, sticks: stick, sent: 0, states: STATES };

function stickZone(kind, opts) {
  const z = document.createElement('div');
  z.className = `zone ${kind}${opts.disabled ? ' disabled' : ''}`;
  z.dataset.box = `zone-${kind}`;
  z.setAttribute('role', 'button');
  z.setAttribute('aria-label', kind === 'drive' ? 'Drive stick: steer, accelerate, brake and reverse' : 'Action stick: weapon front and back, boost and drift');
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
    ui?.update?.(stick[kind]);
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
    ui?.update?.(stick[kind]);
  };
  z.addEventListener('pointerup', end);
  z.addEventListener('pointercancel', end);
  return { show(dx, dy, pre) { z.classList.add('active'); const r = R(); knob.style.transform = `translate(${dx * r}px, ${dy * r}px) scale(1.08)`; if (pre != null) { preload.style.setProperty('--p', `${pre}%`); } } };
}

// ---- screens ----
function strip(extra = '') {
  const m = me();
  return `<div class="strip" data-box="strip" style="--seat:${m.hex};--seat-on:${m.on}"><div class="who"><span class="badge">#${m.num}</span><span class="nm">${m.name}</span></div>${extra}</div>`;
}
const tools = (inline) => `<div class="tools${inline ? ' inline' : ''}" data-box="tools"><button class="btn identify" aria-label="Identify: flash my number on the TV">${icon('locate-fixed')}Identify</button><button class="btn quiet icon" aria-label="Camera: chase or in the car">${icon('video')}</button><button class="btn quiet icon" aria-label="Recover: put my car back on the road">${icon('rotate-ccw')}</button><button class="btn quiet icon" aria-label="Menu: help, settings, leave">${icon('menu')}</button></div>`;

function race() {
  const m = me();
  const landscape = matchMedia('(orientation: landscape)').matches;
  const stickState = S.p.get('stick') ?? 'idle';
  const s = document.createElement('div');
  s.className = 'screen';
  s.style.setProperty('--seat', m.hex); s.style.setProperty('--seat-on', m.on);
  const raceInfo = `<div class="race"><div class="pos display">${ordinal(3)}</div><div class="lap tnum">Lap 2/3</div></div>`;
  s.innerHTML = landscape ? strip(`${raceInfo}${tools(true)}`) : `${strip(raceInfo)}${tools(false)}`;
  const area = document.createElement('div');
  area.className = 'sticks';
  const drive = stickZone('drive', { disabled: stickState === 'disabled' });
  const action = stickZone('action', { disabled: stickState === 'disabled' });
  drive.insertAdjacentHTML('beforeend', `<span class="preload-label display" hidden data-box="preload-label">Wheelie: let go to pop it</span>`);
  action.insertAdjacentHTML('beforeend', `<div class="meter" data-box="boost-meter" aria-label="Boost"><i style="--v:62%"></i></div><span class="meter-label" data-box="boost-label">Boost</span><div class="utility${stickState === 'cooldown' ? ' cooldown' : ''}" data-box="utility" style="--c:35%" aria-label="Cone: ${stickState === 'cooldown' ? 'recharging' : 'ready'}"><img alt="" src="${asset('icons/traffic-cone.svg')}"><span class="cd">${stickState === 'cooldown' ? 'Cone in 3 s' : 'Cone ready'}</span></div>`);
  area.append(drive, action);
  s.append(area);
  app.append(s);
  const posIndicators = () => {
    // Indicators hug the sticks (plan §11): the boost meter and the cone sit just above the ACTION stick's home
    // position, the wheelie preload label just above the DRIVE stick's.
    const a = action.getBoundingClientRect(), baseR = action.querySelector('.base').offsetWidth / 2;
    const meter = action.querySelector('.meter'), lab = action.querySelector('.meter-label'), util = action.querySelector('.utility');
    const homeY = a.height * 0.58, topOfBase = homeY - baseR;
    const mw = Math.min(a.width - 28 - 64, Math.max(90, baseR * 2));
    meter.style.width = `${mw}px`;
    meter.style.left = `${(a.width - mw - 64) / 2}px`; meter.style.top = `${topOfBase - 44}px`;
    lab.style.left = `${(a.width - mw - 64) / 2 + mw / 2}px`; lab.style.top = `${topOfBase - 22}px`;
    util.style.left = `${(a.width - mw - 64) / 2 + mw + 40}px`; util.style.top = `${topOfBase - 48}px`;
    const pl = drive.querySelector('.preload-label');
    const d = drive.getBoundingClientRect();
    pl.style.left = `${d.width / 2}px`; pl.style.top = `${d.height * 0.58 - drive.querySelector('.base').offsetWidth / 2 - 54}px`;
  };
  new ResizeObserver(posIndicators).observe(action);
  const ui = {
    update() {},
    wheelie() { const b = document.createElement('div'); b.className = 'banner'; b.style.background = 'var(--c-saffron)'; b.style.color = 'var(--c-ink)'; b.textContent = 'Wheelie!'; s.append(b); setTimeout(() => b.remove(), 700); },
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
  if (S.name === 'tutorial') {
    area.insertAdjacentHTML('beforeend', `<div class="panel coach" data-overlay="coach"><h2 class="display italic">Steer</h2><p>Push the left stick sideways to steer. Pull it back to brake, then reverse.</p><div class="acts"><div class="dots">${'<i></i>'.repeat(7).replace('<i></i>', '<i class="on"></i>')}</div><div style="display:flex;gap:8px"><button class="btn">Skip</button><button class="btn primary">Next</button></div></div></div>`);
    requestAnimationFrame(() => { const d = drive.getBoundingClientRect(); s.insertAdjacentHTML('beforeend', `<div class="arrow-hint" style="left:${d.left + d.width / 2}px;top:${d.top + d.height * 0.58}px">◀&nbsp;&nbsp;&nbsp;&nbsp;▶</div>`); });
  }
  if (S.name === 'menu') {
    area.insertAdjacentHTML('beforeend', `<div class="menusheet" data-overlay="menu"><h2 class="display italic">Menu</h2><div class="menu-grid">${[['locate-fixed', 'Identify: flash my number on the TV'], ['video', 'Camera: chase / in the car'], ['rotate-ccw', 'Recover my car'], ['circle-help', 'Help and tutorial'], ['settings', 'Settings'], ['log-out', 'Leave room']].map(([i, t], n) => `<button class="btn ${n === 5 ? 'danger' : n === 0 ? 'primary' : ''}" style="justify-content:flex-start">${icon(i)}${t}</button>`).join('')}<button class="btn">Close</button></div></div>`);
  }
  if (S.p.get('edges') === '1') app.insertAdjacentHTML('beforeend', '<div class="edges"></div>');
  if (S.p.get('reach') === '1') {
    // Thumb reach from the bottom corners: comfortable (no grip change) and stretch, sized from hand-size norms as a
    // fraction of the short side; the idle sticks should sit in the comfortable band.
    const sh = Math.min(innerWidth, innerHeight), c = sh * (landscape ? 0.78 : 0.62), st = sh * (landscape ? 1.05 : 0.86);
    const arcs = (r, cls) => `<i class="${cls}" style="left:${-r}px;top:${innerHeight - r}px;width:${2 * r}px;height:${2 * r}px"></i><i class="${cls}" style="left:${innerWidth - r}px;top:${innerHeight - r}px;width:${2 * r}px;height:${2 * r}px"></i>`;
    app.insertAdjacentHTML('beforeend', `<div class="reach">${arcs(st, 'stretch')}${arcs(c, 'comfy')}<div class="legend"><span class="sw comfy"></span>Comfortable thumb reach <span class="sw stretch"></span>Stretch</div></div>`);
  }
}

function identify() {
  const m = me();
  app.innerHTML = `<div class="flash" style="--seat:${m.hex};--seat-on:${m.on}" data-box="flash"><div><div class="n display italic tnum">#${m.num}</div><p>That's you on the TV</p></div></div>`;
}

function lobby() {
  const m = me(), ready = S.p.get('ready') === '1';
  app.insertAdjacentHTML('beforeend', `<div class="screen" style="--seat:${m.hex};--seat-on:${m.on}">${strip(`<span style="margin-left:auto;display:flex;gap:8px"><button class="btn identify icon" style="background:var(--seat)" aria-label="Identify">${icon('locate-fixed')}</button><button class="btn quiet icon" aria-label="Settings">${icon('settings')}</button></span>`)}
    <div class="scroll lobby">
      <div class="panel car" data-box="car"><img alt="The Cruz Missile" src="./cruz-still.png"><div class="what"><b>Cruz Missile</b>Small, quick and cheeky. Loves a kerb.</div></div>
      <div class="panel" data-box="name"><p class="label">Your name</p><div class="field"><input value="${m.name}" aria-label="Your name" maxlength="64"><button class="btn icon" aria-label="New random name">${icon('dices')}</button></div></div>
      <button class="btn primary big" data-box="ready">${ready ? `${icon('check')}You're ready` : 'Ready'}</button>
      <div class="waiting" data-box="waiting">${ready ? 'Tap again if you need a minute.' : 'Waiting for the host to start'} · 27 of 32 ready</div>
    </div></div>`);
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
    sheet.innerHTML = `<h2 class="display italic">Phone mock · P1-U03</h2><p style="font-weight:500">Nothing here is sent anywhere. Toggle the overlays, or jump to a state.</p>${Object.entries(STATES).map(([g, list]) => `<h2 class="display" style="font-size:20px;margin-top:14px">${g}</h2>${list.map((s) => `<a href="#${s}">${s}</a>`).join('')}`).join('')}<div><button class="close">Close</button></div>`;
    sheet.addEventListener('click', (e) => { if (e.target.closest('a') || e.target.closest('.close')) sheet.remove(); });
    app.append(sheet);
  });
  app.append(b);
}

function render() {
  S = parse();
  app.innerHTML = '';
  stick.drive.x = stick.drive.y = stick.action.x = stick.action.y = 0;
  if (S.name === 'race' || S.name === 'tutorial' || S.name === 'menu') race();
  else if (S.name === 'identify') identify();
  else if (S.name === 'lobby') lobby();
  else if (S.name === 'join') join();
  else if (S.name === 'settings') settings();
  else if (CARDS[S.name]) card(S.name);
  else race();
  mockBar();
  document.title = `Phone mock · ${S.name}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__phone.ready = true; }));
}

// Touch hygiene (plan §11): keep an accidental back gesture on the controller; block pinch and double-tap zoom.
history.pushState({ guard: true }, '');
addEventListener('popstate', () => history.pushState({ guard: true }, ''));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
addEventListener('hashchange', () => { window.__phone.ready = false; render(); });
let lastOrient = matchMedia('(orientation: landscape)').matches;
addEventListener('resize', () => { const o = matchMedia('(orientation: landscape)').matches; if (o !== lastOrient) { lastOrient = o; render(); } });
render();
