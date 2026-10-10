// The host's round screens over the world (P1-G01 wiring, P1-R07 look): Lobby (no cars, R110: the join QR with the room
// code, every player's card with their Ready state, Start race), the 3-2-1-GO countdown, the per-tile HUD while racing
// and Round complete (the reel's slot, every placing, the join QR, the next round's timer). Built to the accepted POC
// (art/ui/accepted/2026-10-07/poc/tv: Lobby br-dim.6, Round complete br-dim.7, Per-tile HUD, Countdown R99). Driven by the
// worker's room view (`SimClient.onRoom`). Any N, any aspect: the roster and the placings pick the richest card tier that
// stays legible and never cap, scroll or page (fit.ts). Copy says room and round, never game (R112).
import roster from '../../../shared/src/roster.json' with { type: 'json' };
import { installBrushSkins, paintKit, paperQrCard, paperQrSvg, tokenData } from '../../../shared/ui';
import type { RoomView } from '../worker/client';
import type { SimInput } from '../worker/messages';
import { onProfileChange, screenScale } from '../layout/profile';
import { esc, raceTime, secs, shortName } from './format';
import type { PathStats } from '../../../shared/transport/stats';
import { type Chrome, type HostStats, mountChrome } from './chrome';
import { fitGrid, type Fit, type Tier } from './fit';
import { mountHud, type Hud } from './hud';
import './round.css';

export interface RoundClient {
  onRoom: (room: RoomView) => void;
  room: RoomView | null;
  input(input: SimInput): void;
}

export interface RoundScreens {
  hud: Hud;
  /** The footer, host menu and diagnostics (R96/R97). */
  chrome: Chrome;
  /** Feed the renderer's layout callback: tile rects in device px and device px per CSS px. */
  place(rects: { seat: number; x: number; y: number; w: number; h: number }[] | null, scale: number): void;
  /** Test/dev: render a room view directly. */
  show(room: RoomView): void;
}

// Card tiers, richest first (CSS px at 1080p; scaled by k). The last has no floor: below the legible size it is still drawn.
const LOBBY: Tier[] = [
  { id: 'full', minW: 400, minH: 56, maxW: 560, maxH: 100, em: 17 },
  { id: 'name', minW: 270, minH: 44, maxW: 460, maxH: 84, em: 12 },
  { id: 'seat', minW: 120, minH: 40, maxW: 220, maxH: 72, em: 5.6 },
  { id: 'num', minW: 70, minH: 34, maxW: 140, maxH: 64, em: 3.8 },
  { id: 'tiny', minW: 0, minH: 0, maxW: 140, maxH: 64, em: 3.8 },
];
const PLACINGS: Tier[] = [
  { id: 'row', minW: 320, minH: 52, maxW: 1400, maxH: 84, em: 15 },
  { id: 'name', minW: 230, minH: 40, maxW: 1400, maxH: 72, em: 11.5 },
  { id: 'seat', minW: 130, minH: 36, maxW: 1400, maxH: 64, em: 6.5 },
  { id: 'num', minW: 80, minH: 32, maxW: 1400, maxH: 64, em: 4.2 },
  { id: 'tiny', minW: 0, minH: 0, maxW: 1400, maxH: 64, em: 4.2 },
];

/** One screen scale for every px in the design (TV px at 1080p): the display's profile decides (layout/profile.ts, P1-R08). */
export const screenK = (w = window.innerWidth, h = window.innerHeight): number => screenScale(w, h);

const colourVars = (i: number) => `--b:var(--id-${i % tokenData.seatColors.length});--on:var(--id-${i % tokenData.seatColors.length}-on)`;
const nameOf = (s: RoomView['seats'][number]) => s.name || (s.local ? 'Host keys' : 'Player');
/** "12s", "3m 05s": how long a pad has been unplugged (R119). */
const unpluggedFor = (ms: number): string => (ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`);
type LobbyState = 'ready' | 'choosing' | 'picked' | 'away';
/** Ready; a car picked and the picker closed; away; else still choosing (no pick yet, or the picker is open). */
const stateOf = (s: RoomView['seats'][number]): LobbyState => (s.presence === 'Left' || (s.unpluggedMs ?? null) !== null ? 'away' : s.ready ? 'ready' : s.vehicle && !s.choosing ? 'picked' : 'choosing');
const LABEL = { ready: 'Ready', choosing: 'Choosing car…', picked: 'Picked', away: 'Away' } as const;
const CAR_NAMES = new Map((roster.cars as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
/** What the card says: the car's name once it is picked (a roster id the host doesn't know shows tidied up). */
const labelOf = (st: LobbyState, s: RoomView['seats'][number]): string => {
  if (st === 'away' && (s.unpluggedMs ?? null) !== null) return `Unplugged ${unpluggedFor(s.unpluggedMs!)}`;
  if (st !== 'picked' || !s.vehicle) return LABEL[st];
  const id = s.vehicle;
  return CAR_NAMES.get(id) ?? id.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
};

export interface JoinInfo {
  code: string;
  joinUrl: string;
  /** Selected path per endpoint for the diagnostics overlay (`HostHub.paths()`). */
  paths?: () => Promise<Record<string, PathStats | null>>;
  /** Ends the room on the network side (`HostHub.end()`) when the host disbands it. */
  onDisband?: () => void;
  /** The host's frame time and host pads' input age for diagnostics. */
  hostStats?: () => Promise<HostStats>;
}

export function mountRoundScreens(client: RoundClient, join: JoinInfo): RoundScreens {
  const root = document.createElement('div');
  root.className = 'jj-round';
  // On the body, not in #app: #app is fixed (its own stacking context), and the round screens sit above the host's
  // input drawer and the grid's join chip. The HUD layer sits under the screens.
  document.body.append(root);
  const hud = mountHud(document.body, screenK);
  const screen = document.createElement('div');
  screen.className = 'jj-screen';
  root.append(screen);

  let shown = '';
  let lastRoom: RoomView | null = null;
  let relayout: (() => void) | null = null;
  let lastPhase: RoomView['phase'] | null = null;
  let goTimer = 0;

  const applyK = () => {
    const k = screenK();
    root.style.setProperty('--rk', String(k));
    document.documentElement.style.setProperty('--rk', String(k));
    installBrushSkins(document.documentElement, { stroke: Math.max(1.5, 3 * k) });
  };
  applyK();

  const domain = join.joinUrl ? new URL(join.joinUrl).host : '';
  const chrome = mountChrome(root, { code: join.code, domain, joinUrl: join.joinUrl, input: (i) => client.input(i), paths: join.paths, onDisband: join.onDisband, hostStats: join.hostStats }, paintKit);
  /** The join QR card sized to whole device pixels per module (never under `minPx` CSS px per module: the bead's 4 px at 1080p). */
  const qrCard = (maxPx: number) => {
    const modules = paperQrSvg(join.joinUrl).modules;
    const dpr = window.devicePixelRatio || 1;
    const k = screenK();
    const minPx = Math.max(4, Math.round(5 * k));
    const d = Math.max(minPx * dpr, Math.floor((maxPx / modules) * dpr)) / dpr;
    return paperQrCard({ url: join.joinUrl, code: join.code, domain, size: Math.round(d * modules * dpr) / dpr });
  };

  const applyFit = (box: HTMLElement, f: Fit, gap: number, fluid = false) => {
    box.dataset.tier = f.tier.id;
    box.dataset.cols = String(f.cols);
    box.dataset.rows = String(f.rows);
    box.style.cssText = `grid-template-columns:repeat(${f.cols},${fluid ? 'minmax(0,1fr)' : `${f.cw}px`});grid-template-rows:repeat(${f.rows},${f.ch}px);gap:${gap}px;--fs:${f.fs}px`;
  };

  // ---------- Lobby ----------
  const lobby = (room: RoomView) => {
    const ready = room.seats.filter((s) => stateOf(s) === 'ready').length;
    const n = room.seats.length;
    screen.innerHTML = `<section class="lobby" data-screen="lobby" data-count="${n}">
      <header class="lb-head"><span class="bn display">Lob<span class="acc">by</span></span>
        <span class="tag"><b data-count-label>${n}</b> in the room · <b>${ready}</b> ready</span>
        <span class="strip">Pick a car on your phone · the host starts the race</span></header>
      <div class="lb-side"><div class="lb-join"></div>
      <div class="lb-go"><button class="btn brush primary big" data-act="start" type="button" ${n ? '' : 'disabled'}>Start race</button>
        <p class="lb-hint">${n ? `${room.armed ? 'Everyone ready starts the race on its own' : 'Start race when everyone\'s ready'} · ${room.laps} lap${room.laps === 1 ? '' : 's'}` : 'Scan to join on your phone, or press a key cluster or pad'}</p></div></div>
      <div class="lb-roster" data-players></div></section>`;
    const box = screen.querySelector<HTMLElement>('.lb-roster')!;
    const joinEl = screen.querySelector<HTMLElement>('.lb-join')!;
    joinEl.append(qrCard(Math.min(window.innerHeight * 0.44, 380 * screenK())));
    const cardHtml = (s: RoomView['seats'][number], tier: string) => {
      const st = stateOf(s);
      const tick = `<span class="tick ${st}" aria-label="${esc(labelOf(st, s))}">${st === 'ready' ? '✓' : st === 'away' ? '–' : st === 'picked' ? '•' : '…'}</span>`;
      const badge = `<span class="badge" style="${colourVars(s.colourIndex)}">#${s.number}</span>`;
      const nm = `<span class="nm">${esc(shortName(nameOf(s)))}</span>`;
      const body =
        tier === 'full' ? `${badge}${nm}<span class="chip lb-state ${st}">${esc(labelOf(st, s))}</span>` : tier === 'name' ? `${badge}${nm}${tick}` : tier === 'seat' ? `${badge}${tick}` : badge;
      return `<div class="lcard ${st}" role="button" tabindex="0" data-seat="${s.seat}" data-number="${s.number}" data-state="${st}" data-ready="${st === 'ready'}" style="--seat:var(--id-${s.colourIndex % tokenData.seatColors.length})" title="#${s.number} ${esc(nameOf(s))} · ${esc(labelOf(st, s))} (select to remove)">${body}</div>`;
    };
    relayout = () => {
      const k = screenK();
      const r = box.getBoundingClientRect();
      const gap = 8 * k;
      const tiers = LOBBY.map((t) => ({ ...t, minW: t.minW * k, minH: t.minH * k, maxW: t.maxW * k, maxH: t.maxH * k }));
      const f = fitGrid(n, r.width, r.height, gap, tiers, 40 * k);
      applyFit(box, f, gap);
      box.className = `lb-roster t-${f.tier.id}`;
      box.innerHTML = room.seats.map((s) => cardHtml(s, f.tier.id)).join('');
    };
    relayout();
    paintKit(screen);
    screen.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
    // Select a card to remove that player (P1-G07): works at every tier, and asks first.
    const pick = (e: Event) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.lcard');
      if (c) chrome.askRemove(Number(c.dataset.seat));
    };
    box.addEventListener('click', pick);
    box.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(e)));
  };

  // ---------- Countdown ----------
  const countdown = (room: RoomView) => {
    const prep = room.phase === 'Preparing' || room.remainingMs === null;
    const n = secs(room.remainingMs);
    const word = prep ? 'Get set…' : String(n);
    const key = `cd:${word}`;
    if (shown === key) return;
    shown = key;
    relayout = null;
    screen.innerHTML = `<div class="countdown ${prep ? 'prep' : ''}" data-screen="countdown" data-count="${prep ? '' : n}"><span class="display cd-num" key="${word}">${word}</span></div>`;
  };
  const go = () => {
    shown = 'go';
    relayout = null;
    screen.innerHTML = `<div class="countdown" data-screen="countdown" data-count="GO"><span class="display cd-num go">GO!</span></div>`;
    clearTimeout(goTimer);
    goTimer = window.setTimeout(() => {
      if (shown === 'go') screen.replaceChildren();
    }, 900);
  };

  // ---------- Round complete ----------
  const results = (room: RoomView) => {
    const rows = [...(room.results ?? [])].sort((a, b) => (a.place || 1e9) - (b.place || 1e9));
    const seatOf = (num: number) => room.seats.find((s) => s.number === num);
    const winner = rows[0];
    const ws = winner ? seatOf(winner.number) : undefined;
    screen.innerHTML = `<section class="results" data-screen="results" data-count="${rows.length}">
      <div class="rs-reel" data-reel>
        <header class="rs-head"><span class="bn display">Round ${room.round ?? ''} <span class="acc">complete</span></span>
          <span class="strip">Rematch on the same track · everyone keeps their number</span></header>
        ${winner ? `<div class="rs-winner"><small>Winner</small><span class="badge" style="${colourVars(ws?.colourIndex ?? winner.number - 1)}">#${winner.number}</span><b class="display">${esc(shortName(winner.name || 'Player', 16))}</b><span class="pts">+${winner.points}</span></div>` : ''}
      </div>
      <div class="rs-side">
        <div class="rs-list" data-results data-count="${rows.length}"></div>
        <div class="rs-foot"><div class="rs-join"></div>
          <div class="rs-acts"><span class="tag next" data-next>Next race in ${secs(room.remainingMs)} s</span>
            <button class="btn brush primary big" data-act="start" type="button">Start next round now</button>
            <button class="btn brush" data-act="lobby" type="button">Return to lobby</button></div></div>
      </div></section>`;
    const list = screen.querySelector<HTMLElement>('[data-results]')!;
    screen.querySelector<HTMLElement>('.rs-join')!.append(qrCard(Math.min(window.innerHeight * 0.3, 240 * screenK())));
    const rowHtml = (r: (typeof rows)[number], tier: string, i: number) => {
      const s = seatOf(r.number);
      const place = r.place || '–';
      const badge = `<span class="badge" style="${colourVars(s?.colourIndex ?? r.number - 1)}">#${r.number}</span>`;
      const pts = `<span class="pts">+${r.points}</span>`;
      const nm = `<span class="nm">${esc(shortName(r.name || 'Player', 12))}</span>`;
      const body =
        tier === 'row' ? `<span class="pl display">${place}</span>${badge}${nm}<span class="tm">${raceTime(r.time_ms)}</span>${pts}`
        : tier === 'name' ? `<span class="pl display">${place}</span>${badge}${nm}${pts}`
        : tier === 'seat' ? `<span class="pl display">${place}</span>${badge}${pts}`
        : `<span class="pl display">${place}</span>${badge}`;
      return `<div class="rcard ${i < 3 && r.place ? `top top-${i + 1}` : ''}" data-row data-place="${r.place}" data-number="${r.number}">${body}</div>`;
    };
    relayout = () => {
      const k = screenK();
      const rect = list.getBoundingClientRect();
      const gap = 6 * k;
      const tiers = PLACINGS.map((t) => ({ ...t, minW: t.minW * k, minH: t.minH * k, maxW: t.maxW * k, maxH: t.maxH * k }));
      const f = fitGrid(rows.length, rect.width, rect.height, gap, tiers, 34 * k);
      applyFit(list, f, gap, true);
      list.dataset.tier = f.tier.id;
      list.innerHTML = rows.map((r, i) => rowHtml(r, f.tier.id, i)).join('');
    };
    relayout();
    paintKit(screen);
    screen.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
    screen.querySelector('[data-act=lobby]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'end' }));
  };

  const render = (room: RoomView) => {
    lastRoom = room;
    hud.update(room);
    chrome.update(room);
    const phase = room.phase;
    const wasCountdown = lastPhase === 'Countdown';
    lastPhase = phase;
    document.documentElement.dataset.jjPhase = phase;
    const key = `${phase}:${room.round}:${room.armed}:${room.seats.map((s) => `${s.seat}${s.number}${s.name}${s.ready}${s.presence}${s.unpluggedMs == null ? '' : Math.floor(s.unpluggedMs / 1000)}${s.vehicle ?? ''}${s.choosing ? 1 : 0}`).join()}`;
    const racing = phase === 'Running' || phase === 'Finalising' || phase === 'Countdown';
    hud.show(racing);
    if (phase === 'Countdown' || phase === 'Preparing') return countdown(room);
    if (phase === 'Intermission') {
      // The results screen shows the round's results and nothing of the roster's churn: it is rebuilt only when the results
      // themselves change. Keyed on the seats (ready, presence) it rebuilt every time a phone's heartbeat flapped, which on
      // a slow host replaced the "Start next round now" button faster than a click could find it still.
      const rkey = `${phase}:${room.round}:${(room.results ?? []).map((r) => `${r.number}:${r.place}:${r.points}:${r.time_ms}`).join()}`;
      if (shown === rkey) {
        const next = screen.querySelector('[data-next]');
        if (next) next.textContent = `Next race in ${secs(room.remainingMs)} s`;
        return;
      }
      shown = rkey;
      return results(room);
    }
    if (phase === 'Lobby' || phase === 'Disbanded') {
      if (shown !== key) {
        shown = key;
        lobby(room);
      }
      return;
    }
    // Running and Finalising: the tiles and their HUD are the screen; GO! shows for the first moment of the race.
    if (wasCountdown && phase === 'Running') return go();
    if (shown !== 'go') {
      shown = key;
      relayout = null;
      screen.replaceChildren();
    }
  };

  const reflow = () => {
    applyK();
    relayout?.();
    hud.update(client.room ?? lastRoom!);
  };
  window.addEventListener('resize', () => {
    applyK();
    relayout?.();
  });
  onProfileChange(() => lastRoom && reflow());
  client.onRoom = render;
  if (client.room) render(client.room);
  return {
    hud,
    chrome,
    place: (r, s) => hud.place(r, s),
    show: render,
  };
}
