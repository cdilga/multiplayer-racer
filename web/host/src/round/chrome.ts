// The host's chrome (P1-R07, owner rulings R96/R97): the bottom footer (pause / host menu, room code and domain, the
// room readout, diagnostics, the renderer's readout slot, the logo), the pause flow (Resume, the player list with Remove
// (P1-G07), End round, Disband room, each behind its own confirmation) and the diagnostics overlay (room code, phase and
// per seat: direct or relay, RTT; IPs never shown). The footer lives in the bottom safe margin the grid leaves
// (`--foot`), so nothing but the countdown and Identify ever overlays a tile. Opening the menu in a race pauses it first.
import type { PathStats } from '../../../shared/transport/stats';
import type { RoomView } from '../worker/client';
import type { SimInput } from '../worker/messages';
import { esc, shortName } from './format';
import { basePath } from '../../../shared/src/base';
import { paperQrSvg, tokenData } from '../../../shared/ui';
import { enterFullscreen, fullscreenSupport } from '../layout/fullscreen';
import { setPositions } from '../layout/positions';
import { PROFILES, activeProfile, profileChoice, setProfileChoice, type ProfileChoice } from '../layout/profile';

type Seat = RoomView['seats'][number] & { endpoint?: string };
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
}

export interface Chrome {
  footer: HTMLElement;
  /** Where the renderer's status chip goes (main.ts appends it here). */
  readouts: HTMLElement;
  update(room: RoomView): void;
  openMenu(): void;
  closeMenu(): void;
  /** Open the Remove confirmation for a seat (a lobby card click, or the menu's player list). */
  askRemove(seat: number): void;
  toggleDiagnostics(on?: boolean): void;
  readonly state: { menu: boolean; confirm: string | null; diagnostics: boolean };
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
  const state = { menu: false, confirm: null as string | null, diagnostics: false };
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
    <button class="foot-btn quiet" type="button" data-act="diagnostics" aria-pressed="false">Diagnostics</button>
    <span class="foot-readouts" data-readouts></span>
    <span class="foot-logo display">Joystick Jammers</span>`;
  const layer = document.createElement('div');
  layer.className = 'jj-overlays';
  root.append(layer, footer);
  const menuBtn = footer.querySelector<HTMLButtonElement>('[data-act=menu]')!;
  const diagBtn = footer.querySelector<HTMLButtonElement>('[data-act=diagnostics]')!;

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
    const order = racing() && room ? room.seats.filter((s) => s.position !== null && s.presence !== 'Left').sort((a, b) => a.position! - b.position!) : [];
    const key = order.map((s) => `${s.seat}:${s.position}`).join();
    if (key === posKey) return;
    posKey = key;
    // The grid's Players cell reads the same list (layout/overlay.ts).
    setPositions(order.map((s) => ({ place: s.position!, number: s.number, name: shortName(seatName(s)), colour: s.colourIndex % tokenData.seatColors.length })));
    posEl.dataset.count = String(order.length);
    posTrack.innerHTML = order.length
      ? `<span class="fp-run">${order.map((s) => `<span class="fp-item"><b>${s.position}</b><span class="badge" style="${colour(s)}">#${s.number}</span><span class="nm">${esc(shortName(seatName(s)))}</span></span>`).join('')}</span>`
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

  const seatOf = (n: number) => (room?.seats as Seat[] | undefined)?.find((s) => s.seat === n);
  const renderMenu = () => {
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
    } else {
      const seats = [...(room.seats as Seat[])].sort((a, b) => a.number - b.number);
      const fs = fullscreenSupport();
      menuEl.innerHTML = `<section class="mn-panel" data-menu aria-labelledby="mn-t"><h2 id="mn-t" class="display">${racing() ? 'Paused' : 'Host <span class="acc">menu</span>'}</h2>
        <div class="mn-acts main"><button class="btn brush primary" type="button" data-act="resume" data-autofocus>${racing() ? 'Resume' : 'Close'}</button>
        ${racing() ? '<button class="btn brush" type="button" data-act="ask-end">End round</button>' : ''}
        <button class="btn brush danger-o" type="button" data-act="ask-disband">Disband room</button>
        <a class="btn brush" data-credits href="${basePath()}credits" target="_blank" rel="noopener">Credits</a></div>
        <h3 class="display">Display</h3>
        <div class="mn-view" data-view role="group" aria-label="Viewing distance">${PROFILES.map((p) => `<button class="btn brush${profileChoice() === p ? ' primary' : ''}" type="button" data-act="view" data-profile="${p}" aria-pressed="${profileChoice() === p}">${p === 'auto' ? `Auto (${activeProfile()})` : p === 'tv' ? 'TV' : p === 'desk' ? 'Desk' : 'Handheld'}</button>`).join('')}
          ${fs.fullscreen ? '<button class="btn brush" type="button" data-act="fullscreen">Full screen</button>' : ''}</div>
        ${fs.addToHomeScreenHint ? '<p class="mn-hint" data-a2hs>For full screen on this iPhone: Share, then Add to Home Screen, and open the room from there.</p>' : ''}
        <h3 class="display">Players <span class="acc">${seats.length}</span></h3>
        <ul class="mn-players" data-players>${
          seats.length
            ? seats
                .map(
                  (s) => `<li data-seat="${s.seat}" data-number="${s.number}"><span class="badge" style="${colour(s)}">#${s.number}</span><span class="nm">${esc(shortName(seatName(s), 18))}</span><span class="st">${s.presence === 'Left' ? 'Away' : s.presence === 'SittingOut' ? 'Autopilot' : s.ready ? 'Ready' : ''}</span><button class="btn brush" type="button" data-act="ask-remove" data-seat="${s.seat}" aria-label="Remove #${s.number} ${esc(seatName(s))}">Remove</button></li>`,
                )
                .join('')
            : '<li class="none">Nobody has joined yet.</li>'
        }</ul></section>`;
    }
    paint(menuEl);
    menuEl.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  };

  const setPause = (on: boolean) => {
    if (on === paused) return;
    paused = on;
    send('pause', on);
  };
  const openMenu = () => {
    state.menu = true;
    state.confirm = null;
    target = null;
    menuEl.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    if (racing()) setPause(true);
    renderMenu();
  };
  const closeMenu = () => {
    state.menu = false;
    state.confirm = null;
    menuEl.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
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
  menuEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) {
      if (e.target === menuEl) closeMenu();
      return;
    }
    switch (b.dataset.act) {
      case 'resume':
        return closeMenu();
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
        return closeMenu();
      case 'do-disband':
        send('disband');
        opts.onDisband?.();
        return closeMenu();
    }
  });

  // ---------- Diagnostics ----------
  const diagEl = document.createElement('aside');
  diagEl.className = 'jj-diag';
  diagEl.hidden = true;
  diagEl.setAttribute('aria-label', 'Diagnostics');
  layer.append(diagEl);
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
        const p = s.endpoint === undefined ? undefined : paths[s.endpoint];
        if (s.endpoint !== undefined) mapped.add(s.endpoint);
        cell = s.presence === 'Left' ? 'Away' : s.endpoint === undefined ? 'unknown' : pathLabel(p);
        if (p?.rttMs !== null && p?.rttMs !== undefined) rtt = `${p.rttMs} ms`;
      }
      return `<tr data-seat="${s.seat}"><td><span class="badge" style="${colour(s)}">#${s.number}</span></td><td class="nm">${esc(shortName(seatName(s), 16))}</td><td data-path>${esc(cell)}</td><td data-rtt>${rtt}</td></tr>`;
    });
    // Peers that no seat claims yet (opened the page, not claimed): their path is still useful.
    const extra = Object.entries(paths).filter(([ep]) => !mapped.has(ep));
    const loose = extra.map(([, p], i) => `<tr class="loose"><td>–</td><td class="nm">Viewer ${i + 1}</td><td data-path>${esc(pathLabel(p))}</td><td data-rtt>${p?.rttMs ?? '–'}${p?.rttMs == null ? '' : ' ms'}</td></tr>`);
    const html = `<h3 class="display">Diagnostics</h3><p class="dg-line">Room <b data-diag-code>${esc(opts.code)}</b> · ${esc(room.phase)}${room.round ? ` · round ${room.round}` : ''} · ${seats.length} in the room</p>
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
    diagBtn.setAttribute('aria-pressed', String(on));
    clearInterval(diagTimer);
    if (on) {
      void renderDiag();
      diagTimer = window.setInterval(() => void renderDiag(), 1000);
    }
  };

  footer.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'menu') state.menu ? closeMenu() : openMenu();
    // The docked QR (no spare cell holds one): opening the menu pauses a race, so a phone can join.
    if (act === 'qr' && !state.menu) openMenu();
    if (act === 'diagnostics') toggleDiagnostics();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.menu && state.confirm) {
      state.confirm = null;
      renderMenu();
    } else if (state.menu) closeMenu();
    else if (state.diagnostics) toggleDiagnostics(false);
  });

  return {
    footer,
    readouts: footer.querySelector<HTMLElement>('[data-readouts]')!,
    state,
    openMenu,
    closeMenu,
    askRemove: (seat) => confirm('remove', seat),
    toggleDiagnostics,
    update(r) {
      room = r;
      const n = r.seats.length;
      const ready = r.seats.filter((s) => s.ready && s.presence !== 'Left').length;
      footer.querySelector('[data-foot-count]')!.textContent = racing() ? `${n} racing${r.round ? ` · round ${r.round}` : ''}` : r.phase === 'Intermission' ? `${n} in the room${r.round ? ` · round ${r.round}` : ''}` : `${n} in the room · ${ready} ready`;
      menuBtn.textContent = racing() ? 'Pause' : 'Host menu';
      renderPositions();
      // Whatever changed under an open menu or overlay is redrawn (a player left; the phase moved).
      if (state.menu) {
        // A confirmed removal for a seat that has gone returns to the list.
        if (state.confirm === 'remove' && (target === null || !seatOf(target))) state.confirm = null;
        // The race ended or the room went to the lobby while paused: the pause lifts.
        if (paused && !racing()) {
          paused = false;
        }
        const key = `${state.confirm}:${r.phase}:${r.seats.map((s) => `${s.seat}${s.name}${s.presence}${s.ready}`).join()}`;
        if (menuEl.dataset.key !== key) {
          menuEl.dataset.key = key;
          renderMenu();
        }
      }
      void renderDiag();
    },
  };
}
