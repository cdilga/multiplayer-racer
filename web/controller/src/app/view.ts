// The controller's screens (P1-C02/C03): one card per §11 state with its next useful action, the join card (name +
// Join the race), and the driving screen (strip with your number in your colour, tools, two sticks, HUD). Class names
// follow the POC phone mock (art/ui/poc/phone/) so its accepted styling ports on top (C02.style / C03.style).
// Copy says "room", never "game" (R112).
import { attachStick, stickZone, type StickHandle } from './sticks';
import type { Phase, Session } from './session';

const CARDS: Partial<Record<Phase, (s: Session) => { title: string; body: string; action?: [string, string] }>> = {
  finding: (s) => ({ title: `Finding room ${s.code}…`, body: '' }),
  'no-such-room': (s) => ({ title: `No room with code ${s.code}`, body: 'Check the code on the big screen, or scan the QR again.', action: ['edit', 'Try another code'] }),
  'room-ended': () => ({ title: 'That room has ended', body: 'Thanks for playing.', action: ['edit', 'Join another room'] }),
  'preview-expired': () => ({ title: 'This test build has expired', body: 'Ask the host for a fresh link.' }),
  connecting: () => ({ title: 'Connecting…', body: '' }),
  'finding-relay': () => ({ title: 'Finding a relay…', body: 'This network is fussy; trying another way in.' }),
  'no-route': () => ({ title: "Can't reach the host from this network", body: "Try the host's Wi-Fi.", action: ['retry', 'Retry'] }),
  joining: () => ({ title: 'Joining…', body: '' }),
  reconnecting: (s) => ({ title: `Reconnecting as #${s.you?.number ?? ''}…`, body: 'Your car is on autopilot.' }),
  'host-gone': () => ({ title: 'The host seems to have gone', body: 'Ask them for a new code.', action: ['edit', 'Enter a new code'] }),
  'host-paused': () => ({ title: 'Host paused', body: 'Back in a moment.' }),
  'another-tab': () => ({ title: 'Playing in another tab', body: '', action: ['takeover', 'Use this one'] }),
  'update-needed': () => ({ title: 'Updating…', body: 'Loading the new version.' }),
};

const TOOLS = `<div class="tools" data-box="tools"><button class="btn identify" data-act="identify" aria-label="Identify: flash my number on the TV">Identify</button><button class="btn quiet" data-act="camera" aria-label="Camera: chase or in the car">Camera</button><button class="btn quiet" data-act="recover" aria-label="Recover: put my car back on the road">Recover</button><button class="btn quiet" data-act="leave" aria-label="Leave the room">Leave</button></div>`;

/** Indicators, not buttons (br-dim.10): flat wells the action stick lights, never focusable or tappable. */
const POD = `<div class="pod" data-box="pod" role="group" aria-label="Boost and utilities, fired by the action stick"><div class="pod-boost" data-ind="boost" role="img" aria-label="Boost: action stick right"><span class="pod-label display">Boost <b class="dir" aria-hidden="true">→</b></span><div class="meter"><i data-hud="boost" style="--v:0%"></i></div></div></div>`;

const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mountController(app: HTMLElement, session: Session, prefillName: () => string): void {
  let sticks: { drive: StickHandle; action: StickHandle } | null = null;
  let firstPerson = false;
  let shown: string | null = null;

  const render = () => {
    const key = session.phase === 'playing' || session.phase === 'host-paused' ? `play:${session.you?.number}` : session.phase;
    if (key === shown) return void updateHud();
    shown = key;
    sticks?.drive.release();
    sticks?.action.release();
    sticks = null;
    if (session.phase === 'ready-to-join') return joinCard();
    if (key.startsWith('play:')) return playScreen();
    const c = CARDS[session.phase]?.(session) ?? { title: session.phase, body: '' };
    app.innerHTML = `<section class="screen card-screen" data-state="${session.phase}"><div class="panel state-card"><h1 class="display italic">${esc(c.title)}</h1>${c.body ? `<p>${esc(c.body)}</p>` : ''}${c.action ? `<button class="btn primary big" data-act="${c.action[0]}">${esc(c.action[1])}</button>` : ''}</div></section>`;
    app.querySelector('[data-act=edit]')?.addEventListener('click', () => location.assign(new URL('../', location.href).href));
    app.querySelector('[data-act=retry]')?.addEventListener('click', () => location.reload());
    app.querySelector('[data-act=takeover]')?.addEventListener('click', () => void session.takeOver());
  };

  const joinCard = () => {
    app.innerHTML = `<section class="screen card-screen" data-state="ready-to-join"><form class="panel state-card join-card"><h1 class="display italic">Room ${esc(session.code)}</h1><label for="name">Your name</label><input id="name" name="name" maxlength="64" autocomplete="nickname" autocapitalize="words" spellcheck="false" value="${esc(session.name || prefillName())}"><button class="btn primary big" type="submit">Join the race</button>${session.persisted ? '' : '<p class="note">This browser won\'t remember you, so a reload may lose your seat.</p>'}</form></section>`;
    app.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = app.querySelector<HTMLInputElement>('#name')!.value.trim().normalize('NFC') || prefillName();
      void requestPlayMode();
      session.claim(name);
    });
  };

  const playScreen = () => {
    const you = session.you!;
    const colour = hex(you.rgb);
    app.innerHTML = `<section class="screen play" data-state="playing" style="--seat:${colour}">
      <div class="strip" data-box="strip"><div class="who"><span class="seatno">#${you.number}</span><span class="nm">${esc(session.name)}</span></div><div class="race"><span class="pos display" data-hud="pos"></span><span class="lap tnum" data-hud="lap"></span></div>
</div>
    </section>`;
    // The pod (boost, utilities) sits between the sticks in landscape and in a row above them in portrait (POC1-18);
    // the tools ride in the strip in landscape and get their own row under it in portrait, so the name keeps its room.
    const screenEl = app.querySelector<HTMLElement>('.screen')!;
    const land = matchMedia('(orientation: landscape)').matches;
    const toolsHolder = document.createElement('div');
    toolsHolder.innerHTML = TOOLS;
    if (land) screenEl.querySelector('.strip')!.append(toolsHolder.firstElementChild!);
    else screenEl.append(toolsHolder.firstElementChild!);
    const area = document.createElement('div');
    area.className = `sticks${land ? ' with-pod' : ''}`;
    const dz = stickZone('drive');
    const az = stickZone('action');
    const pod = document.createElement('div');
    pod.innerHTML = POD;
    if (land) area.append(dz, pod.firstElementChild!, az);
    else {
      screenEl.append(pod.firstElementChild!);
      area.append(dz, az);
    }
    screenEl.append(area);
    // R101: landscape first. Upright, the controller asks once a visit to turn sideways; it still works upright.
    if (!land && !uprightOk) {
      area.insertAdjacentHTML(
        'beforeend',
        `<div class="rotate-card panel" data-overlay="rotate"><b class="display italic">Turn sideways</b><p>The sticks get the whole width, and your thumbs sit where they rest.</p><button class="btn" data-act="upright">Play upright anyway</button></div>`,
      );
      area.querySelector('[data-act=upright]')!.addEventListener('click', (e) => {
        uprightOk = true;
        (e.target as HTMLElement).closest('.rotate-card')?.remove();
      });
    }
    const push = () => sticks && session.setSticks({ ...sticks.drive.value }, { ...sticks.action.value });
    sticks = { drive: attachStick(dz, push), action: attachStick(az, push) };
    app.querySelector('[data-act=identify]')!.addEventListener('click', () => session.identify());
    app.querySelector('[data-act=camera]')!.addEventListener('click', () => session.setCamera((firstPerson = !firstPerson)));
    app.querySelector('[data-act=recover]')!.addEventListener('click', () => session.recover());
    app.querySelector('[data-act=leave]')!.addEventListener('click', () => {
      // Personal confirmation while driving (master §10.6a).
      if (confirmLeave()) session.leave();
    });
    updateHud();
  };

  const updateHud = () => {
    const h = session.hud;
    const set = (k: string, t: string) => {
      const e = app.querySelector<HTMLElement>(`[data-hud=${k}]`);
      if (e) e.textContent = t;
    };
    set('pos', h?.position ? `P${h.position}` : '');
    set('lap', h?.lap ? `Lap ${h.lap[0]}/${h.lap[1]}` : '');
    app.querySelector<HTMLElement>('[data-hud=boost]')?.style.setProperty('--v', `${Math.round(((h?.boost ?? 0) / 255) * 100)}%`);
    app.querySelector('.screen')?.toggleAttribute('data-paused', session.phase === 'host-paused');
  };

  session.onChange = render;
  matchMedia('(orientation: landscape)').addEventListener('change', () => {
    shown = null;
    render();
  });
  session.onIdentify = () => flash(app, session);
  render();
}

/** The portrait 'Turn sideways' card was dismissed this visit. */
let uprightOk = false;

let leaveArmed = 0;
/** Leave needs a second tap within 3 s (no browser dialogs: they block the page). */
function confirmLeave(): boolean {
  const now = Date.now();
  if (now - leaveArmed < 3000) return true;
  leaveArmed = now;
  const b = document.querySelector<HTMLElement>('[data-act=leave]');
  if (b) {
    b.textContent = 'Tap again to leave';
    setTimeout(() => (b.textContent = 'Leave'), 3000);
  }
  return false;
}

/** Identify (R99): the timed high-exposure flash in your colour with "Cooee #N", as the TV shows it. */
function flash(app: HTMLElement, session: Session): void {
  const you = session.you;
  if (!you) return;
  const f = document.createElement('div');
  f.className = 'cooee';
  f.style.setProperty('--seat', hex(you.rgb));
  f.innerHTML = `<div class="flash"></div><span class="display italic">Cooee #${you.number}</span>`;
  app.append(f);
  setTimeout(() => f.remove(), 1500);
}

/** R101: the first tap asks for full screen, landscape and a wake lock; each is a nicety where the phone allows it. */
let wake: WakeLockSentinel | null = null;
async function requestPlayMode(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    // iPhone Safari has no element full screen.
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    // Not allowed outside full screen on most phones.
  }
  await requestWake();
}

async function requestWake(): Promise<void> {
  try {
    wake = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wake = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wake) void requestWake();
});

/** Test readout: whether a wake lock is held. */
export function wakeHeld(): boolean {
  return wake !== null && !wake.released;
}
