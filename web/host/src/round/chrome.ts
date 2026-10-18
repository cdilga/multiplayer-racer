// The host's chrome (P1-R07, owner rulings R96/R97): the bottom footer (pause / host menu, room code and domain, the
// room readout, diagnostics, the renderer's readout slot, the logo), the pause flow (Resume, the player list with Remove
// (P1-G07), End round, Disband room, each behind its own confirmation) and the diagnostics overlay (room code, phase and
// per seat: direct or relay, RTT; IPs never shown). The footer lives in the bottom safe margin the grid leaves
// (`--foot`), so nothing but the countdown and Identify ever overlays a tile. Opening the menu in a race pauses it first.
import { DERBY_MS, INTERMISSION_MS, LAPS, set as setRule } from './rules';
import type { PathStats } from '../../../shared/transport/stats';
import type { RoomView } from '../worker/client';
import type { SimInput } from '../worker/messages';
import { esc, shortName } from './format';
import { basePath } from '../../../shared/src/base';
import { paperQrCard, paperQrSvg, tokenData } from '../../../shared/ui';
import { enterFullscreen, fullscreenSupport } from '../layout/fullscreen';
import { setPositions } from '../layout/positions';
import { controlsPage } from '../../../shared/ui';
import { controlsData } from '../input/controls-data';
import { PROFILES, activeProfile, profileChoice, setProfileChoice, type ProfileChoice } from '../layout/profile';

type Seat = RoomView['seats'][number];
type UiInput = Extract<SimInput, { type: 'ui' }>['ui'];

export interface ChromeOptions {
  code: string;
  domain: string;
  /** The join URL: the footer's docked QR carries it when no spare grid cell fits a scannable one (P1-R04.3). */
  joinUrl?: string;
  input(input: SimInput): void;
  /** Selected path per endpoint (`HostHub.paths()`, N05): types, protocol, RTT, never IPs. */
  paths?: () => Promise<Record<string, PathStats | null>>;
  /** Ends the room for everyone on the network side (`HostHub.end()`): called with Disband room. */
  onDisband?: () => void;
  /** The host's own numbers for diagnostics: frame time and its p95 (ms), and host pads' input age p50 (ms). */
  hostStats?: () => Promise<HostStats>;
  controllers?: HTMLElement;
}

export interface HostStats {
  frameMs: number;
  p95Ms: number | null;
  padAgeMs: number | null;
}

export interface Chrome {
  footer: HTMLElement;
  /** Where the renderer's status chip goes (main.ts appends it here). */
  readouts: HTMLElement;
  sound: HTMLElement;
  display: HTMLElement;
  update(room: RoomView): void;
  openMenu(): void;
  /** The big join card (P1-R07b): the footer's docked QR opens it; a race pauses under it so a phone can join. */
  openJoin(): void;
  closeMenu(): void;
  /** Open the Remove confirmation for a seat (a lobby card click, or the menu's player list). */
  askRemove(seat: number): void;
  toggleDiagnostics(on?: boolean): void;
  readonly state: { menu: boolean; join: boolean; confirm: string | null; diagnostics: boolean; controls: boolean; page: string };
  /** The menu's Controls page (P1-C14): one card per source kind, read from the live key and wheel data. */
  openControls(): void;
}

const RACING = new Set(['Countdown', 'Running', 'Finalising']);
export const pathLabel = (p: PathStats | null | undefined): string => {
  if (!p) return 'connecting';
  const via = p.kind === 'coturn-relay' ? 'Relay (coturn)' : p.kind === 'cloudflare-relay' ? 'Relay (Cloudflare)' : p.kind === 'relay' ? 'Relay' : 'Direct';
  return `${via}${p.protocol ? ` · ${p.protocol}` : ''}`;
};
const seatName = (s: Seat) => s.name || (s.local ? 'Host keys' : 'Player');
const colour = (s: Seat) => `--b:var(--id-${s.colourIndex % tokenData.seatColors.length});--on:var(--id-${s.colourIndex % tokenData.seatColors.length}-on)`;

export function mountChrome(root: HTMLElement, opts: ChromeOptions, paint: (el: ParentNode) => void): Chrome {
  let room: RoomView | null = null;
  const state = { menu: false, join: false, confirm: null as string | null, diagnostics: false, controls: false, page: '' };
  // R90: the menu's recent opens, closes and renders with why and in which phase (br-b2sv: a menu that closed itself).
  const history: string[] = [];
  const note = (what: string) => {
    history.push(`${what}@${room?.phase ?? '-'}`);
    if (history.length > 24) history.shift();
  };
  const sound = document.createElement('div');
  sound.className = 'mn-sound';
  const display = document.createElement('div');
  const readouts = document.createElement('div');
  readouts.dataset.readouts = '';
  let paused = false;
  let target: number | null = null;

  const footer = document.createElement('footer');
  footer.className = 'jj-foot';
  footer.dataset.chrome = 'footer';
  footer.innerHTML = `<button class="foot-btn" type="button" data-act="menu" aria-haspopup="dialog">Host menu</button>
    ${opts.joinUrl ? `<button class="foot-qr" type="button" data-act="qr" aria-label="Show the join code bigger (pauses the game)"><img alt="" decoding="sync" src="data:image/svg+xml,${encodeURIComponent(paperQrSvg(opts.joinUrl).svg)}"></button>` : ''}
    <span class="foot-code" data-foot-code><b>${esc(opts.code)}</b><span class="foot-domain"> · ${esc(opts.domain)}</span></span>
    <span class="foot-count" data-foot-count></span>
    <span class="foot-pos" data-foot-pos data-count="0" aria-label="Positions"><span class="foot-pos-track"></span></span>
    <span class="foot-logo display">Joystick Jammers</span>`;
  const layer = document.createElement('div');
  layer.className = 'jj-overlays';
  root.append(layer, footer);
  const menuBtn = footer.querySelector<HTMLButtonElement>('[data-act=menu]')!;

  // ---------- Docked positions (P1-R04.3, owner POC round 5) ----------
  // With no spare grid cell for the standings, every racer's position docks here: all of them, scrolling as a ticker
  // when they don't fit (never cut, no count limit). The grid overlay says what is docked (html[data-grid-dock]).
  const posEl = footer.querySelector<HTMLElement>('[data-foot-pos]')!;
  const posTrack = posEl.firstElementChild as HTMLElement;
  let posKey = '';
  const fitTicker = () => {
    const run = posTrack.firstElementChild as HTMLElement | null;
    const over = !!run && run.scrollWidth > posEl.clientWidth + 0.5;
    if (over && posTrack.children.length === 1) posTrack.append(run!.cloneNode(true));
    if (!over && posTrack.children.length > 1) posTrack.lastElementChild!.remove();
    posTrack.classList.toggle('tick', over);
    if (run) posTrack.style.setProperty('--fp-w', `${run.scrollWidth}px`);
    if (run) posTrack.style.setProperty('--fp-s', `${Math.max(8, run.scrollWidth / 60)}s`);
  };
  new ResizeObserver(fitTicker).observe(posEl);
  const renderPositions = () => {
    // A derby ranks by damage points (P1-S10), a race by position.
    const derby = room?.mode === 'derby';
    const placeOf = (s: Seat) => (derby ? (s.derby?.rank ?? null) : s.position);
    const order = racing() && room ? room.seats.filter((s) => placeOf(s) !== null && s.presence !== 'Left').sort((a, b) => placeOf(a)! - placeOf(b)! || a.number - b.number) : [];
    const key = order.map((s) => `${s.seat}:${placeOf(s)}`).join();
    if (key === posKey) return;
    posKey = key;
    // The grid's Players cell reads the same list (layout/overlay.ts).
    setPositions(order.map((s) => ({ place: placeOf(s)!, number: s.number, name: shortName(seatName(s)), colour: s.colourIndex % tokenData.seatColors.length })));
    posEl.dataset.count = String(order.length);
    posTrack.innerHTML = order.length
      ? `<span class="fp-run">${order.map((s) => `<span class="fp-item"><b>${placeOf(s)}</b><span class="badge" style="${colour(s)}">#${s.number}</span><span class="nm">${esc(shortName(seatName(s)))}</span></span>`).join('')}</span>`
      : '';
    fitTicker();
  };

  const send = (ui: string, on?: boolean) => opts.input({ type: 'ui', ui: ui as UiInput, ...(on === undefined ? {} : { on }) });
  const racing = () => !!room && RACING.has(room.phase);

  // ---------- Menu and confirmations ----------
  const menuEl = document.createElement('div');
  menuEl.className = 'jj-menu';
  menuEl.hidden = true;
  menuEl.setAttribute('role', 'dialog');
  menuEl.setAttribute('aria-modal', 'true');
  layer.append(menuEl);

  // ---------- The join card (P1-R07b) ----------
  // The accepted kit's paper QR card (code and domain under it) plus the join URL in words. In the menu it sits beside the
  // title; opened from the footer's docked QR it is drawn as big as the screen allows, a whole number of px per module so
  // it stays crisp, scannable from the couch.
  const joinUrl = opts.joinUrl;
  const joinModules = joinUrl ? paperQrSvg(joinUrl).modules : 0;
  const placeJoinCard = (slot: HTMLElement | null, big: boolean) => {
    if (!slot || !joinUrl) return;
    let px: number;
    if (big) {
      // Room for the title, the code under the QR, the URL and the buttons: the QR gets what's left.
      const foot = footer.getBoundingClientRect().height;
      const h = innerHeight - foot;
      // Wide screens put the words beside the card, tall ones under it (round.css .mn-join.big).
      const fit = innerWidth > h * 1.1 ? Math.min(h * 0.7, innerWidth * 0.46) : Math.min(h * 0.4, innerWidth * 0.78);
      px = Math.max(2, Math.floor(fit / joinModules)) * joinModules;
    } else {
      const fit = Math.min((innerHeight - footer.getBoundingClientRect().height) * 0.24, innerWidth * 0.16);
      px = Math.max(2, Math.floor(fit / joinModules)) * joinModules;
    }
    const card = paperQrCard({ url: joinUrl, code: opts.code, domain: opts.domain, size: px });
    card.dataset.joinCard = big ? 'big' : 'menu';
    slot.prepend(card);
  };
  // The estimate above leaves room for the words and buttons; the profile's type scale can still need more. Shrink the QR a
  // module-pixel at a time until the panel fits without scrolling (never below the profile's scannable minimum).
  const fitJoinCard = () => {
    const panel = menuEl.querySelector<HTMLElement>('[data-join-big]');
    const card = panel?.querySelector<HTMLElement>('[data-join-card=big]');
    if (!panel || !card || !joinModules) return;
    // Below the profile's distance minimum only when the screen itself is that small: the card never scrolls or overlaps.
    const min = 2;
    let per = Math.round(card.querySelector('.qr')!.getBoundingClientRect().width / joinModules);
    while (per > min && (panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1)) {
      per--;
      card.style.setProperty('--qr-size', `${per * joinModules}px`);
    }
  };
  const joinText = () =>
    joinUrl
      ? `<p class="mn-join-how">Scan with a phone camera, or open</p><p class="mn-url" data-join-url>${esc(joinUrl).replace(/\//g, '/<wbr>')}</p>`
      : `<p class="mn-join-how">Room code <b>${esc(opts.code)}</b> at ${esc(opts.domain)}</p>`;

  const seatOf = (n: number) => (room?.seats as Seat[] | undefined)?.find((s) => s.seat === n);
  // What the open menu shows: when this is unchanged, update() leaves the buttons alone (br-b2sv).
  const menuKey = (r: RoomView) => `${state.confirm}:${state.join}:${state.controls}:${state.page}:${r.catchUp}:${r.phase}:${r.seats.map((s) => `${s.seat}${s.name}${s.presence}${s.ready}`).join()}`;
  let pressing = false;
  let redrawLater = false;
  const renderMenu = () => {
    redrawLater = false;
    // Every render records its key, so the next room update does not render the same menu a second time: that second
    // render replaces the buttons under a click that is landing (WebKit then drops the click).
    if (room) menuEl.dataset.key = menuKey(room);
    note(`render:${state.page || (state.controls ? 'controls' : state.confirm ? `confirm-${state.confirm}` : 'main')}`);
    if (!room) return;
    if (state.confirm === 'remove') {
      const s = target === null ? undefined : seatOf(target);
      menuEl.innerHTML = s
        ? `<section class="mn-panel confirm" data-confirm="remove" aria-labelledby="mn-t"><h2 id="mn-t" class="display">Remove <span class="acc">#${s.number} ${esc(shortName(seatName(s), 16))}</span>?</h2>
            <p>${racing() ? 'Their car leaves the track at the next tick; the debris stays.' : 'Their card goes from the room.'} Their points stay in the standings. They can join again as a new player.</p>
            <div class="mn-acts"><button class="btn brush danger" type="button" data-act="do-remove" data-seat="${s.seat}">Remove player</button>
            <button class="btn brush" type="button" data-act="back" data-autofocus>Keep them</button></div></section>`
        : `<section class="mn-panel confirm" data-confirm="remove"><h2 class="display">Already gone</h2><div class="mn-acts"><button class="btn brush" type="button" data-act="back" data-autofocus>Back</button></div></section>`;
    } else if (state.confirm === 'end') {
      menuEl.innerHTML = `<section class="mn-panel confirm" data-confirm="end" aria-labelledby="mn-t"><h2 id="mn-t" class="display">End this <span class="acc">round</span>?</h2>
        <p>The race stops now and the room goes to the results. Everyone stays in the room.</p>
        <div class="mn-acts"><button class="btn brush primary" type="button" data-act="do-end">End round</button>
        <button class="btn brush" type="button" data-act="back" data-autofocus>Keep racing</button></div></section>`;
    } else if (state.confirm === 'disband') {
      menuEl.innerHTML = `<section class="mn-panel confirm disband" data-confirm="disband" aria-labelledby="mn-t"><h2 id="mn-t" class="display">Disband the <span class="acc">room</span>?</h2>
        <p>Everyone is sent home and the code <b>${esc(opts.code)}</b> stops working. This cannot be undone.</p>
        <div class="mn-acts"><button class="btn brush danger" type="button" data-act="do-disband">Disband room</button>
        <button class="btn brush" type="button" data-act="back" data-autofocus>Keep the room</button></div></section>`;
    } else if (state.join) {
      // The title, the words and the buttons share a column beside the card (under it on a tall screen), so the QR gets
      // nearly the whole height.
      menuEl.innerHTML = `<section class="mn-panel join-big" data-join-big aria-labelledby="mn-t"><div class="mn-join big" data-join><div class="mn-join-words">
        <h2 id="mn-t" class="display">${racing() ? 'Paused: <span class="acc">join in</span>' : 'Join the <span class="acc">room</span>'}</h2>
        ${joinText()}<p class="mn-join-n" data-join-n>${room.seats.length} in the room</p>
        <div class="mn-acts"><button class="btn brush primary" type="button" data-act="resume" data-autofocus>${racing() ? 'Resume' : 'Close'}</button>
        <button class="btn brush" type="button" data-act="host-menu">Host menu</button></div></div></div></section>`;
    } else if (state.page === 'rules') {
      // P1-G06: the next round's mode, laps, derby length and intermission, from the next round (laps never mid-race),
      // remembered on this device.
      const r = room!;
      const choice = (rule: string, label: string, values: Array<[number | string, string]>, on: number | string | undefined) =>
        `<h3 class="display">${label}</h3><div class="mn-acts" role="group" aria-label="${label}">${values.map(([v, t]) => `<button class="btn brush${on === v ? ' primary' : ''}" type="button" data-act="rule" data-rule="${rule}" data-value="${v}" aria-pressed="${on === v}">${t}</button>`).join('')}</div>`;
      const rules = choice('mode', 'Next round', [['race', 'Race'], ['derby', 'Derby']], r.nextMode ?? 'race')
        + choice('laps', 'Laps', LAPS.map((n) => [n, String(n)]), r.laps)
        + choice('derbyMs', 'Derby length', DERBY_MS.map((ms) => [ms, `${ms / 60_000} min`]), r.derbyMs ?? 180_000)
        + choice('intermissionMs', 'Results on screen', INTERMISSION_MS.map((ms) => [ms, `${ms / 1000} s`]), r.intermissionMs ?? 10_000);
      menuEl.innerHTML = `<section class="mn-panel controls" data-race-rules aria-labelledby="mn-t"><h2 id="mn-t" class="display">Race <span class="acc">rules</span></h2>${rules}<p class="mn-hint">They apply from the next round.</p>
        <h3 class="display">Catch-up</h3><p>Give trailing racers a small speed and boost recharge advantage.</p>
        <div class="mn-acts" role="group" aria-label="Catch-up">${[false, true].map((on) => `<button class="btn brush${(room!.catchUp !== false) === on ? ' primary' : ''}" type="button" data-act="catch-up" data-on="${on}" aria-pressed="${(room!.catchUp !== false) === on}">${on ? 'Light' : 'Off'}</button>`).join('')}</div>
        <div class="mn-acts"><button class="btn brush" data-act="host-menu" data-autofocus>Back</button></div></section>`;
    } else if (state.page === 'display') {
      const fs = fullscreenSupport();
      menuEl.innerHTML = `<section class="mn-panel controls" data-display-sound aria-labelledby="mn-t"><h2 id="mn-t" class="display">Display <span class="acc">&amp; sound</span></h2>
        <h3 class="display">Viewing distance</h3><div class="mn-view" role="group" aria-label="Viewing distance">${PROFILES.map((p) => `<button class="btn brush${profileChoice() === p ? ' primary' : ''}" type="button" data-act="view" data-profile="${p}" aria-pressed="${profileChoice() === p}">${p === 'auto' ? `Auto (${activeProfile()})` : p === 'tv' ? 'TV' : p === 'desk' ? 'Desk' : 'Handheld'}</button>`).join('')}
        ${fs.fullscreen ? '<button class="btn brush" type="button" data-act="fullscreen">Full screen</button>' : ''}</div>
        ${fs.addToHomeScreenHint ? '<p class="mn-hint" data-a2hs>For full screen on this iPhone: Share, then Add to Home Screen, and open the room from there.</p>' : ''}
        <div data-display-slot></div><h3 class="display">Sound</h3><div data-sound-slot></div><div class="mn-acts"><button class="btn brush" data-act="host-menu" data-autofocus>Back</button></div></section>`;
      menuEl.querySelector('[data-display-slot]')!.append(display);
      menuEl.querySelector('[data-sound-slot]')!.append(sound);
    } else if (state.page === 'advanced') {
      menuEl.innerHTML = `<section class="mn-panel controls" data-advanced aria-labelledby="mn-t"><h2 id="mn-t" class="display">Ad<span class="acc">vanced</span></h2>
        <div data-render-readouts></div><button class="btn brush" type="button" data-act="diagnostics" aria-pressed="${state.diagnostics}">Diagnostics</button><div data-diag-slot></div>
        <div class="mn-acts"><button class="btn brush" data-act="host-menu" data-autofocus>Back</button></div></section>`;
      menuEl.querySelector('[data-diag-slot]')!.append(diagEl);
      menuEl.querySelector('[data-render-readouts]')!.append(readouts);
    } else if (state.controls) {
      menuEl.innerHTML = `<section class="mn-panel controls" data-controls-view aria-labelledby="mn-t"><h2 id="mn-t" class="display">Con<span class="acc">trols</span></h2>
        ${controlsPage(controlsData(), { compact: true })}
        <div class="mn-acts"><button class="btn brush primary" type="button" data-act="host-menu" data-autofocus>Back</button></div></section>`;
    } else if (state.page === 'controllers') {
      // Already showing: its drawer updates itself, and rewriting the panel would replace Back under a landing click
      // (WebKit drops it; a seat joining or choosing a car redraws here, br-wweu / br-b2sv).
      if (menuEl.querySelector('[data-controllers-view]')) return;
      menuEl.innerHTML =`<section class="mn-panel controls" data-controllers-view aria-labelledby="mn-t"><h2 id="mn-t" class="display">Con<span class="acc">trollers</span></h2><div data-controllers-slot></div>
        <div class="mn-acts"><button class="btn brush" data-act="controls">Control mappings</button><button class="btn brush" data-act="host-menu" data-autofocus>Back</button></div></section>`;
      if (opts.controllers) menuEl.querySelector('[data-controllers-slot]')!.append(opts.controllers);
    } else {
      const seats = [...(room.seats as Seat[])].sort((a, b) => a.number - b.number);
      // Two columns on a wide screen (round.css): the menu, and the join card with Credits beside it.
      menuEl.innerHTML = `<section class="mn-panel" data-menu aria-labelledby="mn-t"><div class="mn-main"><h2 id="mn-t" class="display">${racing() ? 'Paused' : 'Host <span class="acc">menu</span>'}</h2>
        <div class="mn-acts main"><button class="btn brush primary" type="button" data-act="resume" data-autofocus>${racing() ? 'Resume' : 'Close'}</button>
        ${racing() ? '<button class="btn brush" type="button" data-act="ask-end">End round</button>' : ''}
        <button class="btn brush danger-o" type="button" data-act="ask-disband">Disband room</button></div>
        <h3 class="display">Host settings</h3><div class="mn-acts main">
        <button class="btn brush" data-act="rules">Race rules</button><button class="btn brush" data-act="controllers">Controllers</button><button class="btn brush" data-act="display">Display &amp; sound</button><button class="btn brush quiet" data-act="advanced">Advanced</button></div>
        <h3 class="display">Players <span class="acc">${seats.length}</span></h3>
        <ul class="mn-players" data-players>${
          seats.length
            ? seats
                .map(
                  (s) => `<li data-seat="${s.seat}" data-number="${s.number}"><span class="badge" style="${colour(s)}">#${s.number}</span><span class="nm">${esc(shortName(seatName(s), 18))}</span><span class="st">${s.presence === 'Left' ? 'Away' : s.presence === 'SittingOut' ? 'Autopilot' : s.ready ? 'Ready' : ''}</span><button class="btn brush" type="button" data-act="ask-remove" data-seat="${s.seat}" aria-label="Remove #${s.number} ${esc(seatName(s))}">Remove</button></li>`,
                )
                .join('')
            : '<li class="none">Nobody has joined yet.</li>'
        }</ul></div>
        <div class="mn-join" data-join><div class="mn-join-words"><h3 class="display">Join <span class="acc">in</span></h3>${joinText()}</div>
          <a class="btn brush mn-credits" data-credits href="${basePath()}credits" target="_blank" rel="noopener">Credits</a></div></section>`;
    }
    if (!state.confirm) placeJoinCard(menuEl.querySelector<HTMLElement>('[data-join]'), state.join);
    diagEl.hidden = !state.diagnostics || state.page !== 'advanced';
    paint(menuEl);
    if (state.join && !state.confirm) fitJoinCard();
    menuEl.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  };

  const setPause = (on: boolean) => {
    if (on === paused) return;
    paused = on;
    send('pause', on);
  };
  const openMenu = (join = false, controls = false) => {
    note('open');
    pressing = false;
    state.menu = true;
    state.controls = controls;
    state.page = controls ? 'controllers' : '';
    state.join = join;
    state.confirm = null;
    target = null;
    menuEl.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    document.documentElement.dataset.jjMenu = 'open';
    if (racing()) setPause(true);
    renderMenu();
  };
  const closeMenu = (why = 'api') => {
    note(`close:${why}`);
    state.menu = false;
    state.join = false;
    state.controls = false;
    state.page = '';
    toggleDiagnostics(false);
    state.confirm = null;
    menuEl.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    delete document.documentElement.dataset.jjMenu;
    setPause(false);
    menuBtn.focus({ preventScroll: true });
  };
  const confirm = (kind: 'remove' | 'end' | 'disband', seat?: number) => {
    if (!state.menu) {
      state.menu = true;
      menuEl.hidden = false;
      if (racing()) setPause(true);
    }
    state.confirm = kind;
    target = seat ?? null;
    renderMenu();
  };
  // A room update that changes the open menu redraws it, which replaces the buttons. A press in flight (down, not yet up)
  // would lose its click when its button is replaced (WebKit drops it), so the redraw waits for the release (br-b2sv).
  // Each press and click on the menu goes in the history with the button it hit, so a lost click shows where it was lost.
  const actOf = (e: Event) => (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset.act ?? '-';
  // WebKit sends a click whose press and release landed on different nodes to their common ancestor, so a press that
  // began on a button can arrive as a click on the panel or the backdrop (br-b2sv: 'down:catch-up' then 'click:-', and a
  // backdrop close). The button the press began on answers that click.
  let pressed: { el: HTMLElement | null; at: number } = { el: null, at: 0 };
  menuEl.addEventListener('pointerdown', (e) => {
    pressing = true;
    pressed = { el: (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]') ?? null, at: performance.now() };
    note(`down:${actOf(e)}`);
  }, true);
  // The redraw runs once the click has been delivered (the window sees it after the menu's own handler), or after a short
  // wait when the press ends with no click (dragged off the button).
  const redrawNow = () => {
    pressing = false;
    if (redrawLater && state.menu) renderMenu();
  };
  const released = () => {
    if (pressing) setTimeout(redrawNow, 250);
  };
  window.addEventListener('click', redrawNow);
  window.addEventListener('pointerup', released, true);
  window.addEventListener('pointercancel', released, true);
  menuEl.addEventListener('click', (e) => {
    note(`click:${actOf(e)}`);
    const fromPress = pressed.el?.isConnected && menuEl.contains(pressed.el) && performance.now() - pressed.at < 1500 ? pressed.el : null;
    pressed = { el: null, at: 0 };
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]') ?? fromPress;
    if (!b) {
      if (e.target === menuEl) closeMenu('backdrop');
      return;
    }
    switch (b.dataset.act) {
      case 'resume':
        return closeMenu('resume');
      case 'host-menu':
        state.join = false;
        state.controls = false;
        state.page = '';
        return renderMenu();
      case 'rules':
      case 'controllers':
      case 'display':
      case 'advanced':
        state.page = b.dataset.act;
        return renderMenu();
      case 'catch-up':
        send('catch-up', b.dataset.on === 'true');
        return;
      case 'rule': {
        const rule = b.dataset.rule as 'mode' | 'laps' | 'derbyMs' | 'intermissionMs';
        setRule(opts.input, rule, rule === 'mode' ? b.dataset.value! : Number(b.dataset.value));
        return;
      }
      case 'diagnostics':
        toggleDiagnostics();
        return renderMenu();
      case 'controls':
        state.controls = true;
        return renderMenu();
      case 'back':
        // Back from a confirmation returns to the menu, or closes it if it was opened straight to the confirmation.
        state.confirm = null;
        return state.menu ? renderMenu() : undefined;
      case 'view':
        setProfileChoice(b.dataset.profile as ProfileChoice);
        return renderMenu();
      case 'fullscreen':
        // A user gesture: this click.
        return void enterFullscreen();
      case 'ask-end':
        return confirm('end');
      case 'ask-disband':
        return confirm('disband');
      case 'ask-remove':
        return confirm('remove', Number(b.dataset.seat));
      case 'do-remove':
        send(`remove-seat:${Number(b.dataset.seat)}`);
        state.confirm = null;
        return renderMenu();
      case 'do-end':
        send('end');
        return closeMenu('end');
      case 'do-disband':
        send('disband');
        opts.onDisband?.();
        return closeMenu('disband');
    }
  });

  // ---------- Diagnostics ----------
  const diagEl = document.createElement('aside');
  diagEl.className = 'jj-diag';
  diagEl.hidden = true;
  diagEl.setAttribute('aria-label', 'Diagnostics');
  let diagTimer = 0;
  const renderDiag = async () => {
    if (!room || !state.diagnostics) return;
    const paths = opts.paths ? await opts.paths().catch(() => ({}) as Record<string, PathStats | null>) : {};
    const seats = [...(room.seats as Seat[])].sort((a, b) => a.number - b.number);
    const mapped = new Set<string>();
    const rows = seats.map((s) => {
      let cell: string;
      let rtt = '–';
      if (s.local) cell = 'Host keys or pad (local)';
      else {
        const p = s.endpoint ? paths[s.endpoint] : undefined;
        if (s.endpoint) mapped.add(s.endpoint);
        cell = s.presence === 'Left' ? 'Away' : !s.endpoint ? 'unknown' : pathLabel(p);
        if (p?.rttMs !== null && p?.rttMs !== undefined) rtt = `${p.rttMs} ms`;
      }
      return `<tr data-seat="${s.seat}"><td><span class="badge" style="${colour(s)}">#${s.number}</span></td><td class="nm">${esc(shortName(seatName(s), 16))}</td><td data-path>${esc(cell)}</td><td data-rtt>${rtt}</td></tr>`;
    });
    // Peers that no seat claims yet (opened the page, not claimed): their path is still useful.
    const extra = Object.entries(paths).filter(([ep]) => !mapped.has(ep));
    const loose = extra.map(([, p], i) => `<tr class="loose"><td>–</td><td class="nm">Viewer ${i + 1}</td><td data-path>${esc(pathLabel(p))}</td><td data-rtt>${p?.rttMs ?? '–'}${p?.rttMs == null ? '' : ' ms'}</td></tr>`);
    const hs = opts.hostStats ? await opts.hostStats().catch(() => null) : null;
    const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
    const hostLine = hs
      ? `<p class="dg-line" data-diag-host>Host frame <b>${ms(hs.frameMs)}</b>${hs.p95Ms !== null ? ` · p95 ${ms(hs.p95Ms)}` : ''}${hs.padAgeMs !== null ? ` · host pads' input age ${ms(hs.padAgeMs)}` : ''}</p>`
      : '';
    // Track seeds (owner 2026-10-17): the session seed (`?seed=` on the host page replays it) and the built tracks' seeds.
    const w = window as unknown as { __jjSession?: { seed: number }; __jjPrepare?: { seeds(): Array<{ seed: number; lengthM?: number }> } };
    const built = (w.__jjPrepare?.seeds() ?? []).filter((s) => s.lengthM !== undefined);
    const seedLine = w.__jjSession
      ? `<p class="dg-line" data-diag-seed>Session seed <b>${w.__jjSession.seed}</b>${built.length ? ` · track seed <b>${built[built.length - 1]!.seed}</b>` : ''}${built.length > 1 ? ` · before: ${built.slice(-4, -1).map((s) => s.seed).join(', ')}` : ''}</p>`
      : '';
    if (!state.diagnostics) return; // closed while the numbers were fetched
    const html = `<h3 class="display">Diagnostics</h3><p class="dg-line">Room <b data-diag-code>${esc(opts.code)}</b> · ${esc(room.phase)}${room.round ? ` · round ${room.round}` : ''} · ${seats.length} in the room</p>${seedLine}${hostLine}
      <table><thead><tr><th></th><th>Player</th><th>Path</th><th>RTT</th></tr></thead><tbody>${rows.join('')}${loose.join('')}</tbody></table>
      <p class="dg-note">Addresses are never shown.</p>`;
    if (diagEl.dataset.last !== html) {
      diagEl.dataset.last = html;
      diagEl.innerHTML = html;
    }
  };
  const toggleDiagnostics = (on = !state.diagnostics) => {
    state.diagnostics = on;
    diagEl.hidden = !on;
    clearInterval(diagTimer);
    if (on) {
      void renderDiag();
      diagTimer = window.setInterval(() => void renderDiag(), 1000);
    }
  };

  footer.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    note(`footer:${act ?? (e.target as Element).nodeName}`);
    if (act === 'menu') state.menu ? closeMenu('footer') : openMenu();
    // The docked QR (no spare cell holds one): the big join card, pausing a race so a phone can join (P1-R07b).
    if (act === 'qr') {
      if (state.menu && state.join) closeMenu('qr');
      else openMenu(true);
    }
    if (act === 'diagnostics') toggleDiagnostics();
  });
  // The big card is sized to the screen: a resize (full screen, a display-mode change) redraws it.
  window.addEventListener('resize', () => {
    if (state.menu && !state.confirm) renderMenu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.menu && state.confirm) {
      state.confirm = null;
      renderMenu();
    } else if (state.menu) closeMenu('escape');
    else if (state.diagnostics) toggleDiagnostics(false);
  });

  // Test and probe surface (R90): the menu's state and the same opens the footer and the menu button use.
  (window as unknown as { __jjChrome: unknown }).__jjChrome = { state, history, openJoin: () => openMenu(true), openMenu: () => openMenu(false), openControls: () => openMenu(false, true), closeMenu };
  // The input drawer's Controls button asks for the same page (P1-C14).
  window.addEventListener('jj-open-controls', () => openMenu(false, true));
  window.addEventListener('jj-open-display', () => { openMenu(); state.page = 'display'; renderMenu(); });

  return {
    footer,
    readouts,
    sound,
    display,
    state,
    openMenu: () => openMenu(false),
    openJoin: () => openMenu(true),
    openControls: () => openMenu(false, true),
    closeMenu,
    askRemove: (seat) => confirm('remove', seat),
    toggleDiagnostics,
    update(r) {
      // A screen change (the phase moves) closes diagnostics, so it never hangs half-open over the next screen.
      if (state.diagnostics && room && room.phase !== r.phase) toggleDiagnostics(false);
      room = r;
      const n = r.seats.length;
      const ready = r.seats.filter((s) => s.ready && s.presence !== 'Left').length;
      footer.querySelector('[data-foot-count]')!.textContent = racing() ? `${n} racing${r.round ? ` · round ${r.round}` : ''}` : r.phase === 'Intermission' ? `${n} in the room${r.round ? ` · round ${r.round}` : ''}` : `${n} in the room · ${ready} ready`;
      // Only when the word changes: rewriting it every update replaces the button's text node under a click.
      const word = racing() ? 'Pause' : 'Host menu';
      if (menuBtn.textContent !== word) menuBtn.textContent = word;
      renderPositions();
      // Whatever changed under an open menu or overlay is redrawn (a player left; the phase moved).
      if (state.menu) {
        // A confirmed removal for a seat that has gone returns to the list.
        if (state.confirm === 'remove' && (target === null || !seatOf(target))) state.confirm = null;
        // The race ended or the room went to the lobby while paused: the pause lifts.
        if (paused && !racing()) {
          paused = false;
        }
        if (menuEl.dataset.key !== menuKey(r)) {
          if (pressing) redrawLater = true;
          else renderMenu();
        }
      }
      void renderDiag();
    },
  };
}
