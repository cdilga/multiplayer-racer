// The controller's screens (P1-C02/C03): one card per §11 state with its next useful action, the join card (name +
// Join the race), and the driving screen (strip with your number in your colour, tools, two sticks, HUD). Class names
// follow the POC phone mock (art/ui/poc/phone/) so its accepted styling ports on top (C02.style / C03.style).
// Copy says "room", never "game" (R112).
import { icon, paintKit } from '../../../shared/ui';
import { mountSound } from './sound';
import { attachStick, stickZone, type StickHandle } from './sticks';
import type { Phase, Session } from './session';
import { Tutorial } from './tutorial';
import './settings.css';
import './layout-short.css';
import { watchBadge } from '../hub/badge';
import { ausName } from './ausname';
import { DEADZONES, SENSITIVITIES, Tilt, applyTilt } from './tilt';
import { Preferences, SettingsSheet, shape } from './settings';
import { CarSheet, rosterOf } from './carsheet';

/** One §11 card (art/ui/poc/phone/phone.js `CARDS`, accepted 2026-10-07): an icon (or the spinner), the title, the line under it, and
 *  the next useful actions, the first of them the primary one. Copy says "room", never "game" (R112). */
interface Card {
  spin?: boolean;
  icon?: string;
  tone?: 'warn' | 'ok';
  title: string;
  body: string;
  /** [action, label, 'quiet' for the plain button; the first of the rest is the primary one] */
  actions?: Array<[act: string, label: string, kind?: 'quiet']>;
}
const place = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const CARDS: Partial<Record<Phase, (s: Session) => Card>> = {
  finding: (s) => ({ spin: true, title: `Finding room ${s.code}…`, body: 'Hang on, looking for the TV.', actions: [['cancel', 'Cancel']] }),
  'no-such-room': (s) => ({ icon: 'triangle-alert', title: `No room with code ${s.code}`, body: 'Check the code on the TV, or scan the QR again.', actions: [['edit', 'Edit the code'], ['scan', 'Scan again']] }),
  'room-ended': (s) => {
    const mine = s.you ? s.results?.find((r) => r.number === s.you?.number) : undefined;
    return { icon: 'flag', title: 'That room has ended', body: mine?.place ? `Cheers for playing! You finished ${place(mine.place)}.` : 'Cheers for playing!', actions: [['edit', 'Join another room']] };
  },
  'preview-expired': () => ({ icon: 'timer', title: 'This test build has expired', body: 'Preview builds last a day. The preview index has the newest one.', actions: [['index', 'Open the preview index']] }),
  connecting: () => ({ spin: true, title: 'Connecting…', body: 'Linking your controller to the TV.' }),
  'finding-relay': () => ({ spin: true, title: 'Finding a relay…', body: 'Your network is fussy. Still trying on its own.' }),
  'no-route': () => ({ icon: 'wifi-off', title: 'Can’t reach the host from this network', body: 'Try the host’s Wi-Fi, then tap Retry.', actions: [['retry', 'Retry']] }),
  joining: () => ({ spin: true, title: 'Joining…', body: 'Saving you a number.' }),
  reconnecting: (s) => ({ spin: true, title: `Reconnecting as #${s.you?.number ?? ''}…`, body: 'Your car is on autopilot until you’re back.' }),
  'host-gone': () => ({ icon: 'triangle-alert', tone: 'warn', title: 'The host seems to have gone', body: 'Ask them for a new code. We’ll keep trying quietly.', actions: [['edit', 'Enter a new code', 'quiet']] }),
  'host-paused': () => ({ icon: 'pause', title: 'Host paused', body: 'Back in a moment.' }),
  'another-tab': () => ({ icon: 'smartphone', title: 'Playing in another tab', body: 'You can only drive from one tab at a time.', actions: [['takeover', 'Use this one']] }),
  'update-needed': () => ({ spin: true, title: 'Updating…', body: 'A newer build is out. Reloading once.' }),
};

/** The icon placeholders in a string of markup become the kit's icon elements (they carry their own mask URL). */
function dress(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-ico]')) {
    el.replaceWith(icon(el.dataset.ico!));
  }
}

/** The strip's tools (accepted mock: Identify with its label, the rest icon-only; every one keeps its spoken name). */
const TOOLS = `<div class="tools" data-box="tools"><button class="btn primary" data-act="ready" aria-label="Ready: start the race when everyone is">Ready</button><button class="btn identify" data-act="identify" aria-label="Identify: flash my number on the TV"><i data-ico="locate-fixed"></i>Identify</button><button class="btn quiet icon" data-act="car" aria-label="Car: choose your car" hidden><i data-ico="car"></i></button><button class="btn quiet icon" data-act="camera" aria-label="Camera: chase or in the car"><i data-ico="video"></i></button><button class="btn quiet icon" data-act="recover" aria-label="Recover: put my car back on the road"><i data-ico="rotate-ccw"></i></button><button class="btn quiet icon" data-act="help" aria-label="Help: the controls tutorial"><i data-ico="circle-help"></i></button><button class="btn quiet icon" data-act="settings" aria-label="Settings: your controls"><i data-ico="settings"></i></button><button class="btn quiet icon" data-act="leave" aria-label="Leave the room"><i data-ico="log-out"></i></button></div>`;

/** Indicators, not buttons (br-dim.10): flat wells the action stick lights, never focusable or tappable. */
const POD = `<div class="pod" data-box="pod" role="group" aria-label="Boost and utilities, fired by the action stick"><div class="pod-boost" data-ind="boost" role="img" aria-label="Boost: action stick right"><span class="pod-label display">Boost <b class="dir" aria-hidden="true">→</b></span><div class="meter"><i data-hud="boost" style="--v:0%"></i></div></div></div>`;

/** Text colour on a seat colour (the kit's table, by luminance). */
const seatOn = (rgb: [number, number, number]) => ((0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.55 ? '#15203A' : '#FFF4DE');
const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mountController(app: HTMLElement, session: Session, prefillName: () => string): void {
  const sound = mountSound();
  let sticks: { drive: StickHandle; action: StickHandle } | null = null;
  let tutorial: Tutorial | null = null;
  let tutorialOffered = false;
  let firstPerson = false;
  let shown: string | null = null;
  let prefs: Preferences | null = null;
  let sheet: SettingsSheet | null = null;
  let cars: CarSheet | null = null;
  const tilt = new Tilt({ deadzoneDeg: DEADZONES.medium, fullLockDeg: SENSITIVITIES.normal });
  /** Applies the saved tilt settings to the sensor. */
  const syncTilt = () => {
    const v = prefsNow().value;
    tilt.settings = { deadzoneDeg: DEADZONES[v.tiltDeadzone], fullLockDeg: SENSITIVITIES[v.tiltSensitivity] };
    tilt.neutral = v.tiltNeutral;
  };
  let stopBadge: (() => void) | null = null;
  const prefsNow = () => {
    prefs ??= new Preferences(session.realm);
    session.cameraDistance = prefs.value.cameraDistance;
    return prefs;
  };

  const render = () => {
    const key = session.phase === 'playing' ? `play:${session.you?.number}` : `${session.phase}:${session.code}`;
    if (key === shown) return void updateHud();
    shown = key;
    sticks?.drive.release();
    sticks?.action.release();
    sticks = null;
    if (session.phase === 'ready-to-join') return joinCard();
    if (key.startsWith('play:')) return playScreen();
    const c = CARDS[session.phase]?.(session) ?? { title: session.phase, body: '' };
    const head = c.spin ? '<div class="spin" aria-hidden="true"></div>' : c.icon ? `<div class="state-icon ${c.tone ?? ''}"><i data-ico="${c.icon}"></i></div>` : '';
    const acts = (c.actions ?? []).map(([act, label, kind], i) => `<button class="btn brush${i === 0 && act !== 'cancel' && kind !== 'quiet' ? ' primary big' : ''}" data-act="${act}">${esc(label)}</button>`).join('');
    app.innerHTML = `<section class="screen card-screen" data-state="${session.phase}"><div class="panel state-card card">${head}<h1 class="display italic">${esc(c.title)}</h1>${c.body ? `<p>${esc(c.body)}</p>` : ''}${acts ? `<div class="acts">${acts}</div>` : ''}</div></section>`;
    dress(app);
    paintKit(app);
    const landing = (q = '') => location.assign(new URL(`../${q}`, location.href).href);
    app.querySelector('[data-act=edit]')?.addEventListener('click', () => landing());
    app.querySelector('[data-act=cancel]')?.addEventListener('click', () => landing());
    app.querySelector('[data-act=scan]')?.addEventListener('click', () => landing('?scan=1'));
    app.querySelector('[data-act=index]')?.addEventListener('click', () => location.assign(new URL('/', location.href).href));
    app.querySelector('[data-act=retry]')?.addEventListener('click', () => location.reload());
    app.querySelector('[data-act=takeover]')?.addEventListener('click', () => void session.takeOver());
  };

  const joinCard = () => {
    app.innerHTML = `<section class="screen card-screen" data-state="ready-to-join"><form class="panel state-card join-card card"><div class="state-icon ok"><i data-ico="users"></i></div><h1 class="display italic">You’re in ${esc(session.code)}</h1><p>Pick a name, then join the race.</p>${session.removed ? '<p class="note" data-note="removed">The host removed you. Join again whenever you like.</p>' : ''}<div class="field name-field"><input id="name" name="name" aria-label="Your name" maxlength="64" autocomplete="nickname" autocapitalize="words" spellcheck="false" value="${esc(session.name || prefillName())}"><button type="button" class="btn icon" data-act="dice" aria-label="New random name"><i data-ico="dices"></i></button><button type="button" class="btn" data-act="aussie" aria-label="Make my name Australian">Aussie</button></div><p class="aussie-note" data-note="aussie" role="status" hidden></p><button class="btn brush primary big" type="submit">Join the race</button>${session.persisted ? '' : '<p class="note">This browser won\'t remember you, so a reload may lose your seat.</p>'}</form></section>`;
    dress(app);
    paintKit(app);
    app.querySelector('[data-act=dice]')!.addEventListener('click', () => {
      app.querySelector<HTMLInputElement>('#name')!.value = prefillName();
      app.querySelector<HTMLElement>('[data-note=aussie]')!.hidden = true;
    });
    // The Australian name button: only on a tap, and one tap of Undo puts back what was typed.
    const nameEl = app.querySelector<HTMLInputElement>('#name')!;
    const aussieBtn = app.querySelector<HTMLButtonElement>('[data-act=aussie]')!;
    const aussieNote = app.querySelector<HTMLElement>('[data-note=aussie]')!;
    aussieBtn.addEventListener('click', async () => {
      const typed = nameEl.value;
      aussieBtn.disabled = true;
      const r = await ausName(typed);
      aussieBtn.disabled = false;
      aussieNote.hidden = false;
      if (r.how === 'none' || r.how === 'same') {
        aussieNote.textContent = r.how === 'same' ? 'That already sounds Australian.' : "No Australian version of that one, so it's left as typed.";
        return;
      }
      nameEl.value = r.name;
      aussieNote.innerHTML = `<span><b>${esc(r.name)}</b> instead of ${esc(typed.trim())}.</span> <button type="button" class="btn quiet" data-act="aussie-undo">Undo</button>`;
      aussieNote.querySelector('[data-act=aussie-undo]')!.addEventListener('click', () => {
        nameEl.value = typed;
        aussieNote.hidden = true;
        nameEl.focus();
      });
    });
    app.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = app.querySelector<HTMLInputElement>('#name')!.value.trim().normalize('NFC') || prefillName();
      void requestPlayMode(prefsNow().value.keepAwake);
      session.claim(name);
    });
  };

  const playScreen = () => {
    const you = session.you!;
    const colour = hex(you.rgb);
    app.innerHTML = `<section class="screen play" data-state="playing" style="--seat:${colour}">
      <div class="strip" data-box="strip"><div class="who"><span class="seatno">#${you.number}</span><span class="nm">${esc(session.name)}</span></div><div class="race"><span class="conn" data-hud="conn" role="status"></span><span class="pos display" data-hud="pos"></span><span class="lap tnum" data-hud="lap"></span></div>
</div>
    </section>`;
    // The pod (boost, utilities) sits between the sticks in landscape and in a row above them in portrait (POC1-18);
    // the tools ride in the strip in landscape and get their own row under it in portrait, so the name keeps its room.
    const screenEl = app.querySelector<HTMLElement>('.screen')!;
    const land = matchMedia('(orientation: landscape)').matches;
    const toolsHolder = document.createElement('div');
    toolsHolder.innerHTML = TOOLS;
    dress(toolsHolder);
    if (land) screenEl.querySelector('.strip')!.append(toolsHolder.firstElementChild!);
    else screenEl.append(toolsHolder.firstElementChild!);
    const area = document.createElement('div');
    area.className = `sticks${land ? ' with-pod' : ''}`;
    const dz = stickZone('drive');
    const az = stickZone('action');
    az.querySelector('.knob')?.append(icon('zap'));
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
    // Tutorial-lite (P1-C06): newcomers get it in the Lobby; Help shows it again. It only coaches.
    tutorial = new Tutorial(area, (open) => session.menu(open), () => session.identify());
    if (session.roomPhase === 'Lobby') {
      tutorialOffered = true;
      if (Tutorial.wanted()) tutorial.show();
    }
    session.onAction = (kind) => tutorial?.action(kind);
    session.onSticks = (d, a) => {
      tutorial?.stick('drive', d);
      tutorial?.stick('action', a);
    };
    const p = prefsNow();
    const steering = () => prefsNow().value.steering;
    // Tilt (C07.2, opt-in) replaces only the DRIVE steer axis; everything else is the sticks'.
    const push = () => {
      if (!sticks) return;
      const [d, a] = applyTilt(shape(sticks.drive.value, steering()), shape(sticks.action.value, steering()), sheet?.open ? null : tilt.steer);
      session.setSticks(d, a);
    };
    tilt.onChange = push;
    syncTilt();
    // An Android phone (or a returning visit) turns the sensor on again without a tap; iOS needs the tap in Settings.
    if (p.value.tilt && tilt.state === 'off') void tilt.enable();
    const buzz = () => prefsNow().value.vibration;
    sticks = { drive: attachStick(dz, push, p.value.layout === 'fixed', buzz), action: attachStick(az, push, p.value.layout === 'fixed', buzz) };
    sheet = null;
    cars = null;
    p.subscribe((v) => {
      session.cameraDistance = v.cameraDistance;
      syncTilt();
    });
    app.querySelector('[data-act=help]')!.addEventListener('click', () => tutorial?.show());
    app.querySelector('[data-act=settings]')!.addEventListener('click', () => openSettings(screenEl));
    app.querySelector('[data-act=car]')!.addEventListener('click', () => openCars(screenEl));
    app.querySelector('[data-act=identify]')!.addEventListener('click', () => session.identify());
    app.querySelector('[data-act=ready]')!.addEventListener('click', () => session.ready(!session.isReady));
    app.querySelector('[data-act=camera]')!.addEventListener('click', () => session.setCamera((firstPerson = !firstPerson)));
    app.querySelector('[data-act=recover]')!.addEventListener('click', () => session.recover());
    app.querySelector('[data-act=leave]')!.addEventListener('click', () => {
      // Personal confirmation while driving (master §10.6a).
      if (confirmLeave()) session.leave();
    });
    stopBadge?.();
    stopBadge = watchBadge(session, app.querySelector<HTMLElement>('[data-hud=conn]')!);
    updateHud();
  };

  /** Settings (C07): neutral first, then `Menu{open:true}` (the host's autopilot drives); closing is neutral, then `Menu{open:false}`. */
  const openSettings = (host: HTMLElement) => {
    if (sheet?.open || tutorial?.open || !session.you) return;
    const you = session.you;
    sheet = new SettingsSheet(host, {
      prefs: prefsNow(),
      you: { number: you.number, colour: hex(you.rgb), name: session.name },
      onOpen: () => {
        sticks?.drive.release();
        sticks?.action.release();
        session.menu(true);
      },
      onClose: () => {
        sticks?.drive.release();
        sticks?.action.release();
        session.menu(false);
        sheet = null;
      },
      tilt,
      onSitOut: () => session.sitOut(),
      onLeave: () => session.leave(),
      onIdentify: () => session.identify(),
    });
  };

  /** The lobby's car picker (R101/R110): opened from the Car button, closed with Done; Ready is never behind it. */
  const openCars = (host: HTMLElement) => {
    if (cars?.open || sheet?.open || tutorial?.open || !session.you) return;
    const key = `jj.car.${session.realm}`;
    const roster = rosterOf(Number(new URLSearchParams(location.hash.replace(/^#/, '')).get('roster') ?? 0) || 0);
    let saved = '';
    try {
      saved = localStorage.getItem(key) ?? '';
    } catch {
      // No storage: the pick lasts for this visit.
    }
    const current = () => roster.find((r) => r.id === (session.carChoice || saved)) ?? roster[0]!;
    session.pick(current().id, true); // the picker is open: the TV says so
    cars = new CarSheet(host, {
      roster,
      start: Math.max(0, roster.findIndex((r) => r.id === saved)),
      colour: hex(session.you.rgb),
      onPick: (car) => {
        session.pick(car.id, true);
        try {
          localStorage.setItem(key, car.id);
        } catch {
          // Kept for now only.
        }
      },
      onClose: () => {
        cars = null;
        session.pick(current().id, false);
      },
    });
  };

  const updateHud = () => {
    // The round (P1-G01): Ready in the Lobby only; a banner for the countdown and the round's results.
    const readyBtn = app.querySelector<HTMLButtonElement>('[data-act=ready]');
    if (readyBtn) {
      readyBtn.hidden = session.roomPhase !== 'Lobby' && session.roomPhase !== 'Results';
      readyBtn.textContent = session.isReady ? 'Ready ✓' : 'Ready';
      readyBtn.setAttribute('aria-pressed', String(session.isReady));
    }
    roundBanner(app, session);
    // The race is starting: the tutorial (the controller's menu, G03) gets out of the way, or the car would start on
    // the autopilot. Help shows it again.
    if (tutorial?.open && session.roomPhase === 'Countdown') tutorial.close(false);
    if (sheet?.open && session.roomPhase === 'Countdown') sheet.close();
    if (cars?.open && session.roomPhase === 'Countdown') cars.close();
    const carBtn = app.querySelector<HTMLButtonElement>('[data-act=car]');
    if (carBtn) carBtn.hidden = session.roomPhase !== 'Lobby';
    // The Lobby state can arrive just after the play screen: offer the tutorial once then.
    if (tutorial && !tutorialOffered && session.roomPhase === 'Lobby') {
      tutorialOffered = true;
      if (Tutorial.wanted() && !tutorial.open) tutorial.show();
    }
    const h = session.hud;
    const set = (k: string, t: string) => {
      const e = app.querySelector<HTMLElement>(`[data-hud=${k}]`);
      if (e) e.textContent = t;
    };
    const posEl = app.querySelector<HTMLElement>('[data-hud=pos]');
    if (posEl) posEl.innerHTML = h?.position ? `${h.position}<sup>${place(h.position).slice(String(h.position).length)}</sup>` : '';
    set('lap', h?.lap ? `Lap ${h.lap[0]}/${h.lap[1]}` : '');
    app.querySelector<HTMLElement>('[data-hud=boost]')?.style.setProperty('--v', `${Math.round(((h?.boost ?? 0) / 255) * 100)}%`);
    app.querySelector('.screen')?.toggleAttribute('data-paused', session.phase === 'host-paused');
  };

  session.onChange = render;
  (window as unknown as { __jjSettings: unknown }).__jjSettings = {
    inspect: () => ({ open: sheet?.open ?? false, prefs: prefs?.value ?? null, saveFailed: prefs?.saveFailed ?? false, test: sheet?.inspectTest() ?? null, cars: cars?.open ? { index: cars.index } : null }),
  };
  (window as unknown as { __jjTutorial: unknown }).__jjTutorial = { inspect: () => tutorial?.inspect() ?? null, show: () => tutorial?.show() };
  matchMedia('(orientation: landscape)').addEventListener('change', () => {
    // Turning the phone rebuilds the play screen; an open settings sheet moves onto the new one (still open, Menu still held).
    const keep = sheet?.open ? sheet : null;
    const keepCars = cars?.open ? cars : null;
    shown = null;
    render();
    const screenEl = app.querySelector<HTMLElement>('.screen.play');
    if (keep && screenEl) {
      sheet = keep;
      keep.rehost(screenEl);
    }
    if (keepCars && screenEl) {
      cars = keepCars;
      keepCars.rehost(screenEl);
    }
  });
  session.onIdentify = () => {
    flash(app, session);
    sound.ping();
  };
  render();
}

/** The portrait 'Turn sideways' card was dismissed this visit. */
let uprightOk = false;

/** The phone's view of the round: "Get ready: 3…" in the countdown, "Race on!" at GO, and your place on the results. */
function roundBanner(app: HTMLElement, session: Session): void {
  let b = app.querySelector<HTMLElement>('[data-round-banner]');
  const screen = app.querySelector('.screen.play');
  if (!screen) return;
  if (!b) {
    b = document.createElement('div');
    b.dataset.roundBanner = '';
    b.className = 'banner round-banner';
    screen.append(b);
  }
  let text = '';
  if (session.idleCueAt !== null && session.roomPhase === 'Racing') {
    // G03: idle while racing. The countdown to the autopilot, then who's driving until the player steers.
    const left = session.idleCueMs - (performance.now() - session.idleCueAt);
    text = left > 0 ? `Still there? Steer to keep your car: ${Math.ceil(left / 1000)}` : 'The autopilot is driving: steer to take over';
  } else if (session.roomPhase === 'Countdown') {
    const left = (session.countdownMs ?? 0) - (performance.now() - session.countdownAt);
    text = left > 0 ? `Get ready: ${Math.ceil(left / 1000)}` : 'Go!';
  } else if (session.roomPhase === 'Results' && session.results && session.you) {
    const me = session.results.find((r) => r.number === session.you?.number);
    text = me ? `You came ${me.place ? ordinal(me.place) : '–'} · ${me.points} points` : 'Round complete';
  } else if (session.roomPhase === 'Lobby') {
    text = session.isReady ? 'Ready! Waiting for the others' : 'Tap Ready when you are';
  }
  b.textContent = text;
  b.hidden = text === '';
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
function ordinal(n: number): string {
  const t = n % 100;
  const suffix = t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

let leaveArmed = 0;
/** Leave needs a second tap within 3 s (no browser dialogs: they block the page). */
function confirmLeave(): boolean {
  const now = Date.now();
  if (now - leaveArmed < 3000) return true;
  leaveArmed = now;
  const b = document.querySelector<HTMLElement>('[data-act=leave]');
  if (b) {
    // The icon button turns into words for three seconds, then goes back to its icon.
    const was = b.innerHTML;
    b.classList.remove('icon');
    b.textContent = 'Tap again to leave';
    setTimeout(() => {
      b.innerHTML = was;
      b.classList.add('icon');
    }, 3000);
  }
  return false;
}

/** Identify (R99): the timed high-exposure flash in your colour with "Cooee #N", as the TV shows it. */
function flash(app: HTMLElement, session: Session): void {
  const you = session.you;
  if (!you) return;
  const f = document.createElement('div');
  f.className = 'cooee-phone';
  f.dataset.overlay = 'flash';
  f.style.setProperty('--seat', hex(you.rgb));
  f.style.setProperty('--seat-on', seatOn(you.rgb));
  // The accepted mock's flash (phone.js `cooee`): the seat colour washes the screen, "Cooee #N" on a chip, and the line under it.
  f.innerHTML = `<i class="flash"></i><div class="lab"><b class="display">Cooee #${you.number}</b><span>That’s you on the TV</span></div>`;
  // It never covers your number or the tools: the strip stays on top.
  const bottoms = [...app.querySelectorAll('.strip, .tools')].map((e) => e.getBoundingClientRect().bottom);
  f.style.top = `${Math.max(0, ...bottoms)}px`;
  app.append(f);
  setTimeout(() => f.remove(), 1500);
}

/** R101: the first tap asks for full screen, landscape and a wake lock; each is a nicety where the phone allows it. */
let wake: WakeLockSentinel | null = null;
async function requestPlayMode(keepAwake = true): Promise<void> {
  if (!keepAwake) return;
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
