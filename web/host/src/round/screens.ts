// The host's round screens over the world (P1-G01 wiring, P1-R07 look): Lobby (no cars, R110: the join QR with the room
// code, every player's card with their Ready state, Start race), the 3-2-1-GO countdown, the per-tile HUD while racing
// and Round complete (the reel's slot, every placing, the join QR, the next round's timer). Built to the accepted POC
// (art/ui/accepted/2026-10-07/poc/tv: Lobby br-dim.6, Round complete br-dim.7, Per-tile HUD, Countdown R99). Driven by the
// worker's room view (`SimClient.onRoom`). Any N, any aspect: the roster and the placings pick the richest card tier that
// stays legible and never cap, scroll or page (fit.ts). Copy says room and round, never game (R112).
import { set as setRule } from './rules';
import roster from '../../../shared/src/roster.json' with { type: 'json' };
import { controlsCard, installBrushSkins, paintKit, paperQrCard, paperQrSvg, tokenData } from '../../../shared/ui';
import { controlsData, localView, sourceOf } from '../input/controls-data';
import type { RoomView } from '../worker/client';
import type { SimInput } from '../worker/messages';
import { onProfileChange, screenScale } from '../layout/profile';
import { esc, raceTime, secs, shortName } from './format';
import { bestLaps, currentKey, keepCurrent, kept, keyOf, noteLaps } from './favourites';
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
  /** The round-complete presentation slot, plus a refit after Hide replay changes the available standings area. */
  replaySlot(): HTMLElement | null;
  refit(): void;
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
  controllers?: HTMLElement;
  localChoose?: (source: number, vehicle: string, open: boolean) => void;
  localReady?: (source: number) => void;
}

/** A derby round's length for the lobby hint: whole minutes, or seconds under one. */
const derbyLength = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

export function mountRoundScreens(client: RoundClient, join: JoinInfo): RoundScreens {
  const root = document.createElement('div');
  root.className = 'jj-round';
  // On the body, not in #app: #app is fixed (its own stacking context), and the round screens sit above the host's
  // input drawer and the grid's join chip. The HUD layer sits under the screens.
  document.body.append(root);
  // HUD badges inherit the same rebuilt brush masks as lobby and results after profile/resize changes.
  const hud = mountHud(root, screenK);
  const screen = document.createElement('div');
  screen.className = 'jj-screen';
  root.append(screen);

  let shown = '';
  let lastRoom: RoomView | null = null;
  let relayout: (() => void) | null = null;
  let resultsObserver: ResizeObserver | null = null;
  let lastPhase: RoomView['phase'] | null = null;
  let goTimer = 0;

  const applyK = () => {
    const k = screenK();
    root.style.setProperty('--rk', String(k));
    document.documentElement.style.setProperty('--rk', String(k));
    installBrushSkins(root, { stroke: Math.max(1.5, 3 * k) });
  };
  applyK();

  const domain = join.joinUrl ? new URL(join.joinUrl).host : '';
  const chrome = mountChrome(root, { code: join.code, domain, joinUrl: join.joinUrl, input: (i) => client.input(i), paths: join.paths, onDisband: join.onDisband, hostStats: join.hostStats, controllers: join.controllers }, paintKit);
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

  // ---------- Lobby controls cards (P1-C14) ----------
  // A pad, wheel or key cluster that claimed a seat gets a card for its kind under the roster: its own glyphs, two sticks and
  // Identify/READY. It folds away once the host has seen every control used (the seat's first-drive prompt is over) and with
  // the lobby itself at the countdown; holding the source's Identify shows it again. A phone's seat never gets one.
  let strip = '';
  const stripHtml = (room: RoomView): string => {
    const data = controlsData();
    return [...room.seats]
      .sort((a, b) => a.number - b.number)
      .flatMap((s) => {
        const src = sourceOf(s.localSource);
        if (!src || s.presence === 'Left') return [];
        const held = localView(s.localSource)?.identifyHeld === true;
        // The six controls (steer, go, brake, launch, OI!, cone: no drift since R128).
        const used = (localView(s.localSource)?.used.length ?? 0) >= 6;
        // Where this pick sits in the roster, as the phone's picker says it (br-bwju.9): every option and how many there are.
        const at = roster.cars.findIndex((c) => c.id === s.vehicle);
        const count = `<span class="lb-local-count tnum" data-local-count>${at >= 0 ? `Car ${at + 1} of ${roster.cars.length}` : `${roster.cars.length} cars`}</span>`;
        const choice = `<div class="lb-local-choice">${count}<label>Vehicle for #${s.number}<select data-local-vehicle="${s.localSource}" aria-label="Vehicle for #${s.number}">${roster.cars.map((c) => `<option value="${c.id}"${c.id === s.vehicle ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><button class="btn brush" data-local-use="${s.localSource}">Use vehicle</button><button class="btn brush primary" data-local-ready="${s.localSource}"${!s.vehicle || s.choosing ? ' disabled' : ''}>${s.ready ? 'Ready ✓' : 'Ready'}</button><small>${s.choosing || !s.vehicle ? 'Steer to choose · Ready button to confirm, then Ready again' : 'Vehicle chosen · press Ready when you are'}</small></div>`;
        return ['<div class="lb-cc" data-seat="' + s.seat + '" data-number="' + s.number + '" data-held="' + held + '"><span class="badge" style="' + colourVars(s.colourIndex) + '">#' + s.number + '</span>' + choice + (!used || held ? controlsCard(src, data, { compact: true }) : '') + '</div>'];
      })
      .join('');
  };
  const paintStrip = (room: RoomView, force = false) => {
    const el = screen.querySelector<HTMLElement>('[data-controls]');
    if (!el) return;
    const html = stripHtml(room);
    if (!force && html === strip) return;
    strip = html;
    el.innerHTML = html;
    paintKit(el);
    el.querySelectorAll<HTMLSelectElement>('[data-local-vehicle]').forEach((select) => select.addEventListener('change', () => join.localChoose?.(Number(select.dataset.localVehicle), select.value, true)));
    el.querySelectorAll<HTMLButtonElement>('[data-local-use]').forEach((button) => button.addEventListener('click', () => {
      const source = Number(button.dataset.localUse);
      const select = el.querySelector<HTMLSelectElement>(`[data-local-vehicle="${source}"]`)!;
      join.localChoose?.(source, select.value, false);
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-local-ready]').forEach((button) => button.addEventListener('click', () => join.localReady?.(Number(button.dataset.localReady))));
    el.hidden = !html;
    relayout?.();
  };

  // br-m1xe: the lobby says when the next race is a kept track (the host chose it on the Tracks page).
  const nextKept = (room: RoomView) => {
    const fav = room.preparation?.favourite;
    if (!fav) return '';
    const k = kept().find((t) => t.seed === fav.seed && t.recipe === fav.recipe);
    return `<p class="lb-hint lb-kept">Next track: kept ${esc(k?.code ?? 'track')}</p>`;
  };

  // ---------- Lobby ----------
  const lobby = (room: RoomView) => {
    const ready = room.seats.filter((s) => stateOf(s) === 'ready').length;
    const n = room.seats.length;
    // P1-G06: the next round's mode, Race or Derby (applies from the next round; remembered on this device).
    const derby = room.nextMode === 'derby';
    screen.innerHTML = `<section class="lobby" data-screen="lobby" data-count="${n}">
      <header class="lb-head"><span class="bn display">Lob<span class="acc">by</span></span>
        <span class="tag"><b data-count-label>${n}</b> in the room · <b>${ready}</b> ready</span>
        <span class="strip">Join → choose your vehicle → Ready</span></header>
      <div class="lb-side"><div class="lb-join"></div>
      <div class="lb-go"><div class="lb-mode" role="group" aria-label="Next round">${(['race', 'derby'] as const).map((m) => `<button class="btn brush${derby === (m === 'derby') ? ' primary' : ''}" type="button" data-act="mode" data-mode="${m}" aria-pressed="${derby === (m === 'derby')}">${m === 'derby' ? 'Derby' : 'Race'}</button>`).join('')}</div>
        <button class="btn brush primary big" data-act="start" type="button" ${n ? '' : 'disabled'}>${derby ? 'Start derby' : 'Start race'}</button>
        <p class="lb-hint">${n ? `${room.armed ? `Everyone ready starts the ${derby ? 'derby' : 'race'} on its own` : `Start the ${derby ? 'derby' : 'race'} when everyone's ready`} · ${derby ? `${derbyLength(room.derbyMs ?? 180_000)} in the bowl, most damage dealt wins` : `${room.laps} lap${room.laps === 1 ? '' : 's'}`}` : 'Scan to join on your phone, or press a key cluster or pad'}</p>
        ${nextKept(room)}<p class="lb-hint">Got a pad or keyboard? Press any button to join · Host menu → Controllers</p></div></div>
      <div class="lb-rwrap"><div class="lb-roster" data-players></div><div class="lb-controls" data-controls hidden></div></div></section>`;
    const box = screen.querySelector<HTMLElement>('.lb-roster')!;
    const joinEl = screen.querySelector<HTMLElement>('.lb-join')!;
    const joinCard = qrCard(Math.min(window.innerHeight * 0.44, 380 * screenK()));
    joinEl.append(joinCard);
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
      const portrait = window.innerWidth / window.innerHeight <= 1.1;
      joinCard.style.setProperty('--qr-size', qrCard(Math.min(window.innerHeight * (portrait ? .18 : .44), 380 * k)).style.getPropertyValue('--qr-size'));
      const r = box.getBoundingClientRect();
      const gap = 8 * k;
      const tiers = LOBBY.map((t) => ({ ...t, minW: t.minW * k, minH: t.minH * k, maxW: t.maxW * k, maxH: t.maxH * k }));
      const f = fitGrid(n, r.width, r.height, gap, tiers, 40 * k);
      applyFit(box, f, gap);
      box.className = `lb-roster t-${f.tier.id}`;
      box.innerHTML = room.seats.map((s) => cardHtml(s, f.tier.id)).join('');
      paintKit(box);
    };
    relayout();
    paintStrip(room, true);
    paintKit(screen);
    screen.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
    screen.querySelectorAll<HTMLButtonElement>('[data-act=mode]').forEach((b) => b.addEventListener('click', () => setRule((i) => client.input(i), 'mode', b.dataset.mode!)));
    screen.querySelector('[data-act=catch-up]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'catch-up', on: room.catchUp === false }));
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

  // ---------- Between rounds (br-qw28, R125) ----------
  // The vote on the results screen: three cards with their tallies, the leader lit while it's open, the result once it's
  // closed. The host taps one to choose instead (tap it again to go back to the vote).
  const CHOICES = [
    ['rematch', 'Rematch', 'Same track'],
    ['new', 'New track', 'Same style'],
    ['surprise', 'Surprise me', 'Any style'],
  ] as const;
  const choiceName = (c: string | null | undefined) => CHOICES.find(([k]) => k === c)?.[1] ?? 'Rematch';
  // The room view's times are as of its last change: the seconds count down here between updates.
  let roomAt = performance.now();
  const left = (ms: number | null) => (ms == null ? null : Math.max(0, ms - (performance.now() - roomAt)));
  let voteTimer = 0;
  // Built once per results screen; afterwards only its words, counts and states change, so a press on a card is never
  // lost to a redraw (the seconds tick four times a second).
  const paintVote = (room: RoomView) => {
    const el = screen.querySelector<HTMLElement>('[data-vote]');
    if (!el) return;
    clearTimeout(voteTimer);
    const b = room.between;
    if (b?.active && !b.decided) voteTimer = window.setTimeout(() => lastRoom && paintVote(lastRoom), 250);
    if (!b) {
      el.innerHTML = `<span class="tag next" data-next>Next race in ${secs(room.remainingMs)} s</span>`;
      return;
    }
    if (!el.querySelector('.vcards')) {
      el.innerHTML = `<div class="vhead" data-vote-head></div><div class="vcards">${CHOICES.map(([k, title, sub]) => `<button class="vcard" type="button" data-act="next-track" data-choice="${k}" aria-pressed="false">
        <b>${title}</b><small>${sub}</small><span class="vn" data-votes="${k}">0</span></button>`).join('')}</div><div class="vfoot"></div>`;
      paintKit(el);
    }
    const head = b.decided
      ? `Next: <b>${choiceName(b.decided)}</b>`
      : b.voteOpen
        ? `Vote on your phone · <b>${secs(left(b.voteLeftMs))} s</b>`
        : `Vote opens in ${secs(left(b.resultsLeftMs))} s`;
    const headEl = el.querySelector<HTMLElement>('[data-vote-head]')!;
    if (headEl.innerHTML !== head) headEl.innerHTML = head;
    // The card that will win: the result, else the host's pick, else the vote's leader.
    const winning = b.decided ?? b.hostChoice ?? (b.voteOpen ? b.leading : null);
    for (const [k] of CHOICES) {
      const card = el.querySelector<HTMLElement>(`[data-choice=${k}]`)!;
      const n = String(b.votes[k]);
      const count = card.querySelector<HTMLElement>('[data-votes]')!;
      if (count.textContent !== n) count.textContent = n;
      card.classList.toggle('lead', winning === k);
      card.classList.toggle('host', b.hostChoice === k);
      card.setAttribute('aria-pressed', String(b.hostChoice === k));
    }
    const foot = b.hostChoice ? `Host's pick · ${choiceName(b.hostChoice)} (tap again for the vote)` : 'Most votes wins · a tie is a Rematch · host: tap to choose';
    const footEl = el.querySelector<HTMLElement>('.vfoot')!;
    if (footEl.textContent !== foot) footEl.textContent = foot;
  };
  // The flyover: the TV flies along the next track; nothing but a caption over it.
  const flyover = (room: RoomView) => {
    const key = `fly:${room.between?.decided}`;
    if (shown === key) return;
    shown = key;
    relayout = null;
    screen.innerHTML = `<div class="flyover" data-screen="flyover"><span class="fo-tag display">Next: ${esc(choiceName(room.between?.decided))}</span>
      <span class="fo-hint">Any button skips · you can still change car</span>
      <button class="btn brush" type="button" data-act="start">Skip</button></div>`;
    paintKit(screen);
    screen.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
  };

  // br-m1xe: a race's results offer to keep its track (with its share code) and show the track's best lap per car,
  // this round's laps counted in first (once a round). Derbies and authored maps have no kept track.
  let lapsNoted = '';
  const paintKeep = async (room: RoomView) => {
    const keep = screen.querySelector<HTMLElement>('[data-keep]');
    const best = screen.querySelector<HTMLElement>('[data-best]');
    if (!keep || !best || room.mode === 'derby') return;
    const now = await currentKey();
    if (!now) return;
    const roundKey = `${now.key}#${room.round}`;
    if (lapsNoted !== roundKey) {
      lapsNoted = roundKey;
      // A seat that never picked drives the roster's first car (the host's default).
      const laps = room.seats
        .filter((s) => (s.lapMs?.length ?? 0) > 0)
        .map((s) => ({ vehicle: s.vehicle ?? room.vehicles?.[0] ?? 'car', ms: Math.min(...s.lapMs!), name: s.name || 'Player' }));
      noteLaps(now.key, laps);
    }
    const isKept = kept().some((k) => keyOf(k) === now.key);
    keep.hidden = false;
    const btn = keep.querySelector<HTMLButtonElement>('[data-act=keep]')!;
    btn.disabled = isKept;
    btn.textContent = isKept ? 'Kept ✓' : 'Keep this track';
    keep.querySelector<HTMLElement>('[data-code]')!.textContent = now.code ?? 'tuned generator: kept on this host only';
    const rows = Object.entries(bestLaps(now.key)).sort((a, b) => a[1].ms - b[1].ms);
    best.hidden = rows.length === 0;
    best.innerHTML = rows.length
      ? `<b>Best laps here</b> ${rows.map(([car, l]) => `<span class="bl">${esc(CAR_NAMES.get(car) ?? car)} ${raceTime(l.ms)} <small>${esc(shortName(l.name, 12))}</small></span>`).join(' · ')}`
      : '';
  };

  // ---------- Round complete ----------
  const results = (room: RoomView) => {
    const rows = [...(room.results ?? [])].sort((a, b) => (a.place || 1e9) - (b.place || 1e9));
    const seatOf = (num: number) => room.seats.find((s) => s.number === num);
    const winner = rows[0];
    const ws = winner ? seatOf(winner.number) : undefined;
    // P1-G06: a derby ranks by raw points; it has no times.
    const derby = room.mode === 'derby';
    screen.innerHTML = `<section class="results" data-screen="results" data-count="${rows.length}">
      <div class="rs-reel" data-reel>
        <header class="rs-head"><span class="bn display">${derby ? 'Derby' : 'Round'} ${room.round ?? ''} <span class="acc">complete</span></span>
          <span class="strip">${derby ? 'Most damage dealt wins · everyone keeps their number' : 'Vote for the next track · everyone keeps their number'}</span></header>
        ${winner ? `<div class="rs-winner"><small>Winner</small><span class="badge" style="${colourVars(ws?.colourIndex ?? winner.number - 1)}">#${winner.number}</span><b class="display">${esc(shortName(winner.name || 'Player', 16))}</b><span class="pts">+${winner.points}</span></div>` : ''}
      </div>
      <div class="rs-side">
        <div class="rs-list" data-results data-count="${rows.length}"></div>
        <div class="rs-foot"><div class="rs-join"></div>
          <div class="rs-acts"><div class="rs-vote" data-vote role="group" aria-label="Next track"></div>
            <div class="rs-keep" data-keep hidden><button class="btn brush" data-act="keep" type="button">Keep this track</button><span class="rs-code" data-code></span></div>
            <p class="rs-best" data-best hidden></p>
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
        tier === 'row' ? `<span class="pl display">${place}</span>${badge}${nm}<span class="tm">${derby ? '' : raceTime(r.time_ms)}</span>${pts}`
        : tier === 'name' ? `<span class="pl display">${place}</span>${badge}${nm}${pts}`
        : tier === 'seat' ? `<span class="pl display">${place}</span>${badge}${pts}`
        : `<span class="pl display">${place}</span>${badge}`;
      return `<div class="rcard ${i < 3 && r.place ? `top top-${i + 1}` : ''}" data-row data-place="${r.place}" data-number="${r.number}">${body}</div>`;
    };
    relayout = () => {
      const k = screenK();
      const side = screen.querySelector<HTMLElement>('.rs-side')!;
      const sideRect = side.getBoundingClientRect();
      const compact = sideRect.width < 560 && sideRect.height < 500;
      side.classList.toggle('compact-foot', compact);
      // The small portrait results region cannot stack a full QR above all its actions and placings.
      // Keep the QR's whole modules and minimum pitch, while using the adjacent column for actions.
      const card = side.querySelector<HTMLElement>('.qr-card')!;
      const desired = compact ? Math.min(sideRect.width * .44, sideRect.height * .52) : Math.min(window.innerHeight * .3, 240 * k);
      card.style.setProperty('--qr-size', qrCard(desired).style.getPropertyValue('--qr-size'));
      const rect = list.getBoundingClientRect();
      const gap = 6 * k;
      const tiers = PLACINGS.map((t) => ({ ...t, minW: t.minW * k, minH: t.minH * k, maxW: t.maxW * k, maxH: t.maxH * k }));
      const f = fitGrid(rows.length, rect.width, rect.height, gap, tiers, 34 * k);
      applyFit(list, f, gap, true);
      list.dataset.tier = f.tier.id;
      list.innerHTML = rows.map((r, i) => rowHtml(r, f.tier.id, i)).join('');
      paintKit(list);
    };
    relayout();
    paintKit(screen);
    paintVote(room);
    void paintKeep(room);
    screen.querySelector('[data-act=keep]')?.addEventListener('click', () => void keepCurrent().then(() => lastRoom && paintKeep(lastRoom)));
    screen.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
    screen.querySelector('[data-act=lobby]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'end' }));
    screen.querySelector('[data-vote]')?.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-act=next-track]')?.dataset.choice as 'rematch' | 'new' | 'surprise' | undefined;
      if (!c) return;
      client.input({ type: 'ui', ui: `next-track:${lastRoom?.between?.hostChoice === c ? 'vote' : c}` });
    });
    resultsObserver?.disconnect();
    resultsObserver = new ResizeObserver(() => relayout?.());
    resultsObserver.observe(screen.querySelector('.rs-side')!);
  };

  const render = (room: RoomView) => {
    lastRoom = room;
    roomAt = performance.now();
    hud.update(room);
    chrome.update(room);
    const phase = room.phase;
    if (phase !== 'Intermission') { resultsObserver?.disconnect(); resultsObserver = null; }
    const wasCountdown = lastPhase === 'Countdown';
    lastPhase = phase;
    document.documentElement.dataset.jjPhase = phase;
    // The lobby's Race/Derby choice, its hint (laps or derby length) and the results' derby layout are part of what's drawn.
    const key = `${phase}:${room.round}:${room.armed}:${room.catchUp}:${room.nextMode}:${room.mode}:${room.derbyMs}:${room.laps}:${JSON.stringify(room.preparation?.favourite ?? null)}:${room.seats.map((s) => `${s.seat}${s.number}${s.name}${s.ready}${s.presence}${s.unpluggedMs == null ? '' : Math.floor(s.unpluggedMs / 1000)}${s.vehicle ?? ''}${s.choosing ? 1 : 0}`).join()}`;
    const racing = phase === 'Running' || phase === 'Finalising' || phase === 'Countdown';
    hud.show(racing);
    if (room.between?.flyoverLeftMs != null) return flyover(room);
    if (phase === 'Countdown' || phase === 'Preparing') return countdown(room);
    if (phase === 'Intermission') {
      // The results screen shows the round's results and nothing of the roster's churn: it is rebuilt only when the results
      // themselves change. Keyed on the seats (ready, presence) it rebuilt every time a phone's heartbeat flapped, which on
      // a slow host replaced the "Start next round now" button faster than a click could find it still.
      const rkey = `${phase}:${room.round}:${(room.results ?? []).map((r) => `${r.number}:${r.place}:${r.points}:${r.time_ms}`).join()}`;
      if (shown === rkey) {
        const next = screen.querySelector('[data-next]');
        if (next) next.textContent = `Next race in ${secs(room.remainingMs)} s`;
        paintVote(room);
        return;
      }
      shown = rkey;
      return results(room);
    }
    if (phase === 'Lobby' || phase === 'Disbanded') {
      if (shown !== key) {
        shown = key;
        lobby(room);
      } else paintStrip(room);
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
  // What a pad or cluster has used, and whether its Identify is down, live on this page rather than in the room view: the lobby's
  // controls cards follow it a few times a second (a room update isn't sent for a stick moving).
  setInterval(() => {
    if (lastRoom?.phase === 'Lobby') paintStrip(lastRoom);
  }, 200);
  client.onRoom = render;
  if (client.room) render(client.room);
  return {
    hud,
    chrome,
    place: (r, s) => hud.place(r, s),
    show: render,
    replaySlot: () => screen.querySelector<HTMLElement>('[data-reel]'),
    refit: () => relayout?.(),
  };
}
