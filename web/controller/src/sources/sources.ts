import { applySeatPattern } from '../../../shared/ui/patterns';
// The sources on a joined controller (P1-C08, folded into the one join journey by P1-C13 / R119). Whatever joined (a phone or a
// laptop) is also a carrier: a pad pressed or a key cluster pressed on it claims a seat for that source, straight away, over the
// page's one connection; the page's own touch player is optional (a laptop never needs to tap in). Every source joins and
// leaves ON ITS OWN. Unplug = that seat's car goes to the autopilot with the seat held (never paused, never expired: the row
// says how long it has been unplugged and has a Remove); re-plug the same pad model and press = the same seat and car; a
// different model on that index is a new player. Leaving is a choice: the chord, Leave, or Remove. Sources are a sample, never a
// limit (R66): the list grows with whatever is plugged in.
//
// TRANSPORT: ONE connection per page (protocol 3). The page's own session owns the endpoint and the WebRTC link; each source
// is a `Session` attached to it (`Session.attach`) that claims, identifies, readies, leaves and drops out under its own source
// handle (`ForSource`), and all their input shares the carrier's batches.
import { controlsCard, icon, tokenData, type ControlsSource } from '../../../shared/ui';
import { keyLabel } from '../../../shared/ui';
import words from '../../../shared/ui/controls.json';
import { morePadsHint } from '../../../shared/ui/controller-options';
import { ROSTER } from '../app/carsheet';
import { Session } from '../app/session';
import { pathLabel } from './badge';
import { CLUSTERS, KeyCluster, LEAVE_HOLD_MS, NEUTRAL, isPress, padSample, type Sample } from './input';
import './sources.css';

export type SourceKind = 'pad' | 'keys' | 'touch';
export type SourceState = 'idle' | 'connecting' | 'connected' | 'unplugged' | 'autopilot' | 'left';

const TICK_MS = 16;
const RENDER_MS = 250;
const PATH_MS = 2000;
const FLASH_MS = 1500;
const STALL_MS = 12_000;
/** A row's Leave or Remove needs a second tap within this (ms), as the phone's own Leave does. */
const LEAVE_CONFIRM_MS = 3000;
/** The right stick past this, sideways, steps the Lobby's car pick (the host's own pads use the same .6: local.ts). */
const PICK_FLICK = 0.6;
/** A seat name is at most 32 graphemes (jj-session `MAX_NAME_GRAPHEMES`); a longer claim is refused, so the carrier's name is cut. */
const MAX_NAME = 32;
/** Source handles on the page's connection: the touch player is 1; key clusters next; pads from 16 up, one fresh handle per pad seat. */
const KEYS_HANDLE = 2;
const PAD_HANDLE = 16;
/** Where a seat chooses its car: the Lobby, and between rounds (council review 2026-11-15: a pad chose once, in the first
 *  Lobby, and never again; one that joined mid-race raced with no car of its own). The wire calls the intermission `Results`. */
const pickPhase = (phase: string | null | undefined): boolean => phase === 'Lobby' || phase === 'Results';

/** A pad seat this page holds in a room, kept across a reload: its source handle, the pad model and its number ("pad 2"). */
interface PadSlot {
  handle: number;
  padId: string;
  n: number;
  /** Given up (Leave, Remove): its handle is never reused, and no pad takes it back. */
  left?: boolean;
}

const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (t: string): string[] => (segmenter ? [...segmenter.segment(t)].map((g) => g.segment) : [...t]);
/** The controls cards' data: this page's clusters (the host's clusters.json); a hub has no wheels (they map on the host). */
const CONTROLS = { clusters: CLUSTERS, wheels: [] };
const clustersHint = CLUSTERS.map((c) => Object.values(c.drive).map(keyLabel).join(' ')).join(' or ');
/** Whether this device is a phone or tablet (a touchscreen without a mouse): its extra players come on Bluetooth pads, and
 *  key clusters aren't worth a mention. */
const touchFirst = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
/** The hub in a guest's words (council review 2026-11-15: "press a key cluster (W S A D or …)" read as noise on a phone, and
 *  nobody learnt their phone could carry a mate): every controller here is another player. */
const restingHint = (): string =>
  touchFirst()
    ? 'Got a Bluetooth controller? Pair it with this phone and press any button on it: a friend joins as another player.'
    : `Plug in a controller and press any button, or press ${clustersHint} on the keyboard: each one is another player.`;
const armedHint = (): string =>
  `<b data-adding>${touchFirst() ? 'Press any button on the controller paired with this phone' : `Press any button on a controller, or ${clustersHint}`} to add the player.</b> <button type="button" class="btn quiet hub-add" data-add-cancel>Cancel</button>`;

export class Source {
  session: Session | null = null;
  state: SourceState = 'idle';
  keys?: KeyCluster;
  padIndex?: number;
  /** The Gamepad API's `id` of the model that holds this seat: a re-plug resumes only when it matches (no serial numbers exist). */
  padId = '';
  /** When the pad was unplugged (performance.now ms); null while plugged. */
  unpluggedAt: number | null = null;
  /** Identify / READY were down last tick (edges act, levels don't). */
  prevIdentify = false;
  prevReady = false;
  holdSince: number | null = null;
  /** Let go since leaving: the next press joins again as a new player. */
  released = true;
  flashUntil = 0;
  path = '';
  pathAt = 0;
  sample: Sample = NEUTRAL;
  /** Pad: the device is currently present. */
  plugged = true;
  /** When this source last started connecting (ms): a join that stalls is retried. */
  connectingSince = 0;
  /** The page's own touch session: listed here once it has a seat, but not driven by this class. */
  external = false;
  /** This source's handle on the page's one connection (the touch player is 1). */
  handle = 0;
  /** The seat whose arrival this source last saw: a new seat starts its edges from the buttons as they are (the joining press is
   *  never Ready as well), and a pad's seat starts with the first-drive prompts on, as a host pad's does. */
  seatSeen = -1;
  /**
   * The Lobby's car pick for this seat (council review 2026-11-15: a pad on a phone or laptop could not choose a car, and its
   * joining press made it READY with none). The host pads' steps (web/host/src/input/local.ts `lobbyChoice`): the remembered car
   * opens, the right stick sideways steps through the roster, READY (Menu, or the cluster's Ready key) chooses it, and READY
   * again is Ready.
   */
  pick: { seat: number; vehicle: string; confirmed: boolean; open: boolean; direction: number } | null = null;

  constructor(
    readonly id: string,
    readonly kind: SourceKind,
    /** "Pad 2": a pad's number is settled when it first claims (a reloaded page gives it the number it had). */
    public label: string,
  ) {}
}

export interface SourcesOptions {
  /** TURN-only test switch (the controller's `?ice=relay`). */
  ice?: 'all' | 'relay';
}

/** "12s", "3m 05s": how long a pad has been unplugged. */
export function sinceText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const editable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
};

export class Sources {
  readonly sources = new Map<string, Source>();
  /** When a row's Leave or Remove was first tapped (ms): a second tap within LEAVE_CONFIRM_MS confirms it. */
  private readonly leaveArmed = new Map<string, number>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private list: HTMLElement | null = null;
  private lastHtml = '';
  private lastCards = '';
  private nextPad = 0;
  private nextHandle = PAD_HANDLE;
  private traySize: ResizeObserver | null = null;

  /** `carrier` is the page's own session: its connection carries every source, whether or not its touch player has joined. */
  constructor(
    private readonly root: HTMLElement,
    private readonly carrier: Session,
    private readonly o: SourcesOptions = {},
  ) {
    // "You" (council review 2026-11-15: "This device" was the engineer's word for the phone's own player).
    const t = new Source('touch', 'touch', 'You');
    t.session = carrier;
    t.external = true;
    t.handle = 1;
    this.sources.set(t.id, t);
    for (const c of CLUSTERS) {
      const s = new Source(`keys${c.id}`, 'keys', c.label);
      s.handle = KEYS_HANDLE + this.sources.size - 1;
      s.keys = new KeyCluster(c);
      this.sources.set(s.id, s);
    }
    this.nextHandle = Math.max(PAD_HANDLE, KEYS_HANDLE + CLUSTERS.length);
  }

  start(): void {
    this.mount();
    // Reserve the actual hint/list height on the join card, including when there are no seated players yet.
    this.traySize = new ResizeObserver(() => {
      document.body.style.setProperty('--jj-source-tray-height', `${Math.ceil(this.root.getBoundingClientRect().height) + 16}px`);
    });
    this.traySize.observe(this.root);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
    this.timers.push(setInterval(() => this.tick(), TICK_MS), setInterval(() => this.render(), RENDER_MS), setInterval(() => void this.paths(), PATH_MS));
  }

  stop(): void {
    this.traySize?.disconnect();
    this.traySize = null;
    document.body.style.removeProperty('--jj-source-tray-height');
    document.body.removeAttribute('data-hub-only');
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    for (const s of this.sources.values()) if (!s.external) s.session?.stop();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const down = e.type === 'keydown';
    // Typing a name is not playing: a cluster's keys act only outside text fields (a key-up always lets go).
    if (down && editable(e.target)) return;
    for (const s of this.sources.values()) {
      if (s.keys?.owns(e.code)) {
        s.keys.key(e.code, down);
        if (down) e.preventDefault();
      }
    }
  };

  private onBlur = (): void => {
    for (const s of this.sources.values()) s.keys?.releaseAll();
  };

  /**
   * Pads present now. A pad still bound to its seat (same index, same model) is just read. A pad that has gone unplugs its
   * seat. A pad that appears resumes an unplugged seat of the SAME model (the Gamepad API has no serial number: two identical
   * models are indistinguishable, the first unplugged one resumes), else it is a new player on a fresh source handle.
   */
  private scanPads(now: number): void {
    const present = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
    const pads = [...this.sources.values()].filter((s) => s.kind === 'pad');
    const bound = new Set<string>();
    const fresh: Gamepad[] = [];
    for (const p of present) {
      const s = pads.find((x) => x.plugged && x.padIndex === p.index && x.padId === p.id);
      if (s) bound.add(s.id);
      else fresh.push(p);
    }
    for (const s of pads) {
      if (!s.plugged || bound.has(s.id)) continue;
      if (!s.session) this.sources.delete(s.id);
      else this.unplug(s, now);
    }
    for (const p of fresh) {
      const same = pads.filter((x) => !x.plugged && x.padId === p.id && this.sources.has(x.id));
      const back = same.find((x) => x.padIndex === p.index) ?? same[0];
      if (back) {
        // Plugged back in: still held and neutral until it is pressed again.
        back.plugged = true;
        back.padIndex = p.index;
        back.sample = NEUTRAL;
        continue;
      }
      const n = ++this.nextPad;
      const s = new Source(`pad${n}`, 'pad', 'Pad');
      s.padIndex = p.index;
      s.padId = p.id;
      // Its handle and number are settled by its first press (`place`), when the room is known.
      this.sources.set(s.id, s);
      pads.push(s);
    }
  }

  /** Unplugged: this seat alone goes neutral at once and to the autopilot after the host's dropout time; it is held, never expired. */
  private unplug(s: Source, now: number): void {
    s.plugged = false;
    s.state = 'unplugged';
    s.unpluggedAt = now;
    s.sample = NEUTRAL;
    s.session?.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false });
    s.session?.unavailable(true);
  }

  private read(s: Source, now: number): Sample {
    if (s.keys) return s.keys.sample(now);
    const p = s.padIndex === undefined ? null : navigator.getGamepads?.()[s.padIndex];
    return p && p.connected && p.id === s.padId ? padSample(p) : NEUTRAL;
  }

  private tick(): void {
    const now = performance.now();
    this.scanPads(now);
    for (const s of [...this.sources.values()]) {
      if (s.external) {
        s.state = s.session?.you ? (s.session.phase === 'playing' ? 'connected' : 'connecting') : 'idle';
        continue;
      }
      if (s.kind === 'pad' && !s.plugged) continue;
      const smp = (s.sample = this.read(s, now));
      const pressed = isPress(smp);
      if (!s.session || s.state === 'left') {
        if (!pressed) s.released = true;
        else if (s.released) this.join(s);
        continue;
      }
      if (s.state === 'unplugged') {
        // Plugged back and pressed: the seat comes back, in the same car.
        if (pressed) {
          s.session.unavailable(false);
          s.unpluggedAt = null;
          s.state = 'connected';
        }
        continue;
      }
      if (s.session.phase !== 'playing' && s.session.phase !== 'host-paused') {
        s.state = 'connecting';
        // A join that stalls (a Claim lost before the connection was up) starts over under the same source handle.
        if (now - s.connectingSince > STALL_MS && this.carrier.helloed) this.join(s);
        continue;
      }
      s.state = s.session.idleCueAt !== null && s.session.idleCueMs - (now - s.session.idleCueAt) <= 0 ? 'autopilot' : 'connected';
      s.session.setSticks({ ...smp.drive, touch: Math.hypot(smp.drive.x, smp.drive.y) > 0 }, { ...smp.action, touch: Math.hypot(smp.action.x, smp.action.y) > 0 });
      const you = s.session.you;
      if (you && s.seatSeen !== you.seat) {
        s.seatSeen = you.seat;
        s.prevIdentify = smp.identify;
        s.prevReady = smp.ready;
        // Council review 2026-11-15: a pad on a phone or laptop got no first-drive prompts on its TV tile, where a host pad's seat
        // starts with them on. A pad's sticks are the phone's sticks, so the tile's wording fits; a key cluster's would not (the
        // host has no field saying a remote seat is keys), so a cluster's seat is left without.
        if (s.kind === 'pad') s.session.tutorial(true);
      }
      if (smp.identify && !s.prevIdentify) s.session.identify();
      const readyPress = smp.ready && !s.prevReady && !smp.identify;
      const picked = !!you && this.carPick(s, you.seat, smp, readyPress);
      // A press that chose the car is not Ready as well.
      if (readyPress && !picked) s.session.ready(!s.session.isReady);
      s.prevIdentify = smp.identify;
      s.prevReady = smp.ready;
      if (smp.identify && smp.ready) {
        s.holdSince ??= now;
        if (now - s.holdSince >= LEAVE_HOLD_MS) this.leave(s);
      } else s.holdSince = null;
    }
  }

  /**
   * The seat's car pick (see `Source.pick`); true when this tick's READY press went to it. It opens in the Lobby and between
   * rounds, for a new seat and for one that joined mid-race; a flick on a car already chosen opens it again, so a pad can
   * change car before any round, as a phone's "Change car" can. Outside those phases an open pick closes (the car is the one
   * it showed) until the next.
   */
  private carPick(s: Source, seat: number, smp: Sample, readyPress: boolean): boolean {
    const session = s.session!;
    const dir = Math.abs(smp.action.x) > PICK_FLICK ? Math.sign(smp.action.x) : 0;
    if (s.pick?.seat !== seat) {
      // A stick already pushed (the joining press) steps nothing until it comes back.
      s.pick = { seat, vehicle: this.remembered(s), confirmed: false, open: false, direction: dir };
    }
    const p = s.pick;
    const flick = dir !== 0 && dir !== p.direction;
    p.direction = dir;
    if (!pickPhase(session.roomPhase)) {
      if (p.open) {
        p.open = false;
        session.pick(p.vehicle, false);
      }
      return false;
    }
    if (!p.confirmed && !p.open) {
      this.choose(s, p.vehicle, true);
      return false;
    }
    if (flick) {
      const i = ROSTER.findIndex((c) => c.id === p.vehicle);
      this.choose(s, ROSTER[(i + dir + ROSTER.length) % ROSTER.length]!.id, true);
      return readyPress;
    }
    if (p.confirmed || !readyPress) return false;
    this.choose(s, p.vehicle, false);
    return true;
  }

  private choose(s: Source, vehicle: string, open: boolean): void {
    if (!s.pick || !s.session) return;
    s.pick.vehicle = vehicle;
    s.pick.confirmed = !open;
    s.pick.open = open;
    s.session.pick(vehicle, open);
    try {
      localStorage.setItem(this.vehicleKey(s), vehicle);
    } catch {
      // This visit only.
    }
  }

  /** The car this source chose last time, or the roster's first. */
  private remembered(s: Source): string {
    let saved = '';
    try {
      saved = localStorage.getItem(this.vehicleKey(s)) ?? '';
    } catch {
      // No storage: the roster's first car.
    }
    return ROSTER.find((c) => c.id === saved)?.id ?? ROSTER[0]!.id;
  }

  /** A pad's car is remembered per model (as the host's own pads, `jj.hostVehicle.<padId>`), a cluster's per cluster. */
  private vehicleKey(s: Source): string {
    return `jj.hubVehicle.${s.padId || s.id}`;
  }

  /**
   * The seat's name on the TV (council review 2026-11-15: three seats were "Pad 1", one with a "#6" beside badge #6): the
   * carrier's name and the source, "Davo's pad", "Davo's pad 2", "Davo's keys A". With no name on this device yet it is blank,
   * so the host names it "Player <n>" as it names its own pads; it follows when the carrier's name arrives or changes.
   */
  private nameFor(s: Source): string {
    const owner = this.carrier.name.trim();
    if (!owner) return '';
    const what = s.kind === 'pad' ? (s.label === 'Pad 1' ? 'pad' : s.label.replace(/^Pad/, 'pad')) : s.label.replace(/^Keys/, 'keys');
    const tail = `’s ${what}`;
    const g = graphemes(owner);
    const room = MAX_NAME - graphemes(tail).length;
    return `${g.length > room ? g.slice(0, room).join('').trimEnd() : owner}${tail}`;
  }

  /** Every seated source keeps its carrier-based name (the carrier joined, or renamed, after the source claimed). */
  private rename(): void {
    for (const s of this.sources.values()) {
      if (s.external || !s.session?.you) continue;
      const want = this.nameFor(s);
      if (want !== s.session.name) s.session.setName(want);
    }
  }

  /** The press that claims this source's seat: a session of its own on the page's connection, under its source handle. */
  private join(s: Source): void {
    // A press before the connection is up waits (it is still down: the next tick tries again).
    const carrier = this.carrier;
    if (!carrier.helloed) return;
    s.released = false;
    if (this.root.dataset.armed === 'true') this.arm(false);
    s.state = 'connecting';
    s.connectingSince = performance.now();
    s.session?.stop();
    if (s.kind === 'pad') this.place(s);
    const session = new Session({ iceTransportPolicy: this.o.ice ?? 'all' });
    let claimed = false;
    session.onChange = () => {
      // A source that held a seat before this page reloaded comes up 'joining' (its stored seat), waiting for a Welcome the
      // reload already spent (council review 2026-11-15: its pads sat at "Joining…" for good). It claims as a new one does:
      // the host's claim is idempotent per source, so it gets that seat back.
      if (session.phase === 'ready-to-join' || (session.phase === 'joining' && !session.you && !claimed)) {
        claimed = true;
        session.claim(this.nameFor(s));
      }
    };
    session.onIdentify = () => {
      s.flashUntil = performance.now() + FLASH_MS;
    };
    s.session = session;
    session.attach(carrier, s.handle);
    // The remembered car goes with the Welcome, so a seat that joins mid-race races it; the pick opens in the next Lobby or
    // between rounds.
    session.carChoice = this.remembered(s);
  }

  /** This room's pad seats on this page, as stored (a reload reads them back). */
  private slotsKey(): string {
    return `jj.hubPads.${this.carrier.realm}.${this.carrier.code}`;
  }

  private slots(): PadSlot[] {
    try {
      const v = JSON.parse(localStorage.getItem(this.slotsKey()) ?? '[]') as unknown;
      return Array.isArray(v) ? (v as PadSlot[]) : [];
    } catch {
      return [];
    }
  }

  private keepSlots(slots: PadSlot[]): void {
    try {
      localStorage.setItem(this.slotsKey(), JSON.stringify(slots));
    } catch {
      // This page only: a reload then starts the pads over as new players.
    }
  }

  /**
   * A pad's handle and number on its first press (council review 2026-11-15: handles restarted at 16 on every page load, so a
   * reloaded phone's pads claimed handles whose seats were still held and were never answered). A pad of the same model as a
   * seat this page held before a reload takes that seat's handle back (the Gamepad API has no serial numbers: the first such
   * seat); any other gets a handle no seat here has ever had.
   */
  private place(s: Source): void {
    const slots = this.slots();
    const live = [...this.sources.values()].filter((x) => x !== s && x.kind === 'pad');
    if (!s.handle) {
      const busy = new Set(live.map((x) => x.handle));
      const back = slots.find((x) => !x.left && x.padId === s.padId && !busy.has(x.handle));
      if (back) {
        s.handle = back.handle;
        s.label = `Pad ${back.n}`;
      } else {
        s.handle = Math.max(this.nextHandle, ...slots.map((x) => x.handle + 1));
        const taken = new Set([...live.map((x) => Number(x.label.slice(4)) || 0), ...slots.filter((x) => !x.left).map((x) => x.n)]);
        let n = 1;
        while (taken.has(n)) n++;
        s.label = `Pad ${n}`;
      }
      this.nextHandle = Math.max(this.nextHandle, s.handle + 1);
    }
    const n = Number(s.label.slice(4)) || 1;
    this.keepSlots([...slots.filter((x) => x.handle !== s.handle), { handle: s.handle, padId: s.padId, n }]);
  }

  /** Leaving is a choice (chord, Leave, Remove): that seat and its car go at the next tick boundary; the others play on. */
  private leave(s: Source): void {
    if (s.kind === 'pad' && s.handle) this.keepSlots(this.slots().map((x) => (x.handle === s.handle ? { ...x, left: true } : x)));
    s.session?.leave();
    s.session = null;
    s.state = 'left';
    s.released = false;
    s.holdSince = null;
    s.prevIdentify = s.prevReady = false;
    s.seatSeen = -1;
    s.pick = null;
    s.path = '';
    // A removed unplugged pad has nothing left to show; a plugged one stays as "Left: press to rejoin".
    if (s.kind === 'pad' && !s.plugged) this.sources.delete(s.id);
  }

  private async paths(): Promise<void> {
    for (const s of this.sources.values()) {
      if (!s.session || s.external) continue;
      const l = await pathLabel(s.session);
      s.path = l.text;
      s.pathAt = performance.now();
    }
  }

  private mount(): void {
    this.root.innerHTML = `<section class="hub tray" data-sources>
      <p class="hub-hint" data-hint>${restingHint()} <button type="button" class="btn quiet hub-add" data-add>Add a player</button></p>
      <p class="hub-hint" data-more-pads hidden></p>
      <div class="panel panel-ink hub-panel" data-sources-panel hidden><ul class="hub-list" data-hub-list aria-label="Players on this device"></ul></div>
      <div class="hub-cards" data-hub-cards hidden></div></section>`;
    this.list = this.root.querySelector('[data-hub-list]');
    // One player per touchscreen (R65): "Add a player" cannot make a second touch player. It says how to add one (a pad or a key
    // cluster) and waits for that source's press; the claim is the press itself.
    this.root.querySelector('[data-add]')!.addEventListener('click', () => this.arm(true));
    this.list!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const s = this.sources.get(b?.closest<HTMLElement>('[data-source]')?.dataset.source ?? '');
      // Leave and Remove take a second tap within 3 s, as the phone's own Leave does (council review 2026-11-15: the row
      // sits between the thumbs, and one stray tap took a friend's car and standings away mid-race).
      if (b && s && !s.external) {
        const now = Date.now();
        if (now - (this.leaveArmed.get(s.id) ?? 0) < LEAVE_CONFIRM_MS) {
          this.leaveArmed.delete(s.id);
          this.leave(s);
        } else {
          this.leaveArmed.set(s.id, now);
          setTimeout(() => this.render(), LEAVE_CONFIRM_MS + 50);
        }
      }
      this.render();
    });
    this.render();
  }

  private arm(on: boolean): void {
    this.root.dataset.armed = on ? 'true' : 'false';
    const hint = this.root.querySelector<HTMLElement>('[data-hint]');
    if (!hint) return;
    hint.innerHTML = on ? armedHint() : `${restingHint()} <button type="button" class="btn quiet hub-add" data-add>Add a player</button>`;
    hint.querySelector('[data-add]')?.addEventListener('click', () => this.arm(true));
    hint.querySelector('[data-add-cancel]')?.addEventListener('click', () => this.arm(false));
  }

  /** The seat's colour as the kit's token when it is a palette colour (it is, for every seat), else the raw colour with a readable text colour. */
  private seatTokens(rgb: [number, number, number]): { fill: string; on: string } {
    const h = hex(rgb).toLowerCase();
    const i = tokenData.seatColors.findIndex((c) => c.hex.toLowerCase() === h);
    if (i >= 0) return { fill: `var(--id-${i})`, on: `var(--id-${i}-on)` };
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return { fill: h, on: lum > 0.6 ? 'var(--c-ink)' : 'var(--c-paper)' };
  }

  /** Shown in the list: a source with a seat, one that left, one unplugged, and the touch player once it has a seat. Idle ones wait for a press. */
  private visible(): Source[] {
    return [...this.sources.values()].filter((s) => (s.external ? !!s.session?.you : s.state !== 'idle'));
  }

  private row(s: Source): string {
    const you = s.session?.you;
    const t = you ? this.seatTokens(you.rgb) : null;
    const seat = you ? `<b class="badge hub-badge" style="--b:${t!.fill};--on:${t!.on}">#${you.number}</b>` : '<b class="hub-badge none" aria-label="No seat yet">–</b>';
    const flash = performance.now() < s.flashUntil;
    const what = s.kind === 'keys' ? 'keyboard' : s.kind === 'pad' ? 'gamepad-2' : 'smartphone';
    const ready = s.state === 'connected' && s.session?.isReady;
    const gone = s.unpluggedAt === null ? 0 : performance.now() - s.unpluggedAt;
    // In the Lobby the row is the seat's car picker (the host pads' tile line, on the carrier's own screen).
    const pick = s.pick && pickPhase(s.session?.roomPhase) && s.state === 'connected' ? s.pick : null;
    const choosing = !!pick?.open;
    const state = { idle: 'Press to join', connecting: 'Joining…', connected: ready ? 'Ready' : choosing ? 'Choosing car' : 'Connected', unplugged: `Unplugged for ${sinceText(gone)}`, autopilot: 'Autopilot', left: 'Left: press to rejoin' }[s.state];
    const tone = s.state === 'unplugged' ? 'chip-warn' : s.state === 'autopilot' ? 'chip-auto' : ready ? 'chip-ready' : choosing ? 'chip-choosing' : s.state === 'connected' ? 'chip-info' : s.state === 'connecting' ? 'chip-choosing' : '';
    const chipIcon = s.state === 'unplugged' ? 'wifi-off' : s.state === 'autopilot' ? 'car' : ready ? 'check' : choosing ? 'car' : s.state === 'connected' ? 'zap' : '';
    const car = pick ? ROSTER.find((c) => c.id === pick.vehicle) : undefined;
    const keys = s.keys?.cluster;
    const step = keys ? `${keyLabel(keys.drive.left)} ${keyLabel(keys.drive.right)}` : 'Right stick';
    const readyName = keys ? keyLabel(keys.ready) : words.pad.ready;
    const carLine = car
      ? `<span class="hub-car" data-car="${choosing ? 'choosing' : 'chosen'}" data-vehicle="${esc(car.id)}">${
          choosing
            ? `<b>‹ ${esc(car.name)} ›</b> <span class="tnum">${ROSTER.indexOf(car) + 1}/${ROSTER.length}</span><span class="hub-car-how"> · ${esc(step)}: change</span> · <kbd>${esc(readyName)}</kbd>: choose`
            : `<b>${esc(car.name)}</b> · ${ready ? 'ready to race' : `<kbd>${esc(readyName)}</kbd>: Ready`}`
        }</span>`
      : '';
    const st = s.session?.stats;
    const armed = Date.now() - (this.leaveArmed.get(s.id) ?? 0) < LEAVE_CONFIRM_MS;
    const act =
      s.external || s.state === 'left'
        ? ''
        : s.state === 'unplugged'
          ? `<button type="button" class="btn quiet hub-act" data-act="remove" aria-label="Remove this player"${armed ? ' data-armed' : ''}>${armed ? 'Tap again' : 'Remove'}</button>`
          : `<button type="button" class="btn quiet hub-act" data-act="leave" aria-label="Leave: give up this seat"${armed ? ' data-armed' : ''}>${armed ? 'Tap again' : 'Leave'}</button>`;
    return `<li class="hub-row${flash ? ' hub-flash' : ''}" data-source="${s.id}" data-kind="${s.kind}" data-state="${s.state}" style="--seat:${t ? t.fill : 'transparent'};--seat-on:${t ? t.on : 'var(--c-paper)'};" data-icon="${what}" data-chip-icon="${chipIcon}">
      ${seat}<span class="hub-kind" title="${esc(s.label)}"><span class="hub-label">${esc(s.label)}</span></span><span class="hub-state chip ${tone}" data-chip="${s.state}"><span class="hub-state-text">${state}</span></span>${act}
      ${carLine}<span class="hub-path" data-path>${esc(s.session && !s.external ? s.path || 'Connecting…' : '')}</span><span class="hub-bytes tnum">${st && !s.external ? `${st.stateBytes} B · ${st.batches} batches` : ''}</span></li>`;
  }

  private render(): void {
    if (!this.list) return;
    this.rename();
    // Council review 2026-11-15: a laptop carrying only pads and keys showed "Pick a name, then join the race" over its players.
    // While a source here has a seat and the touch player has none, the join card folds to "Add a touch player" and the
    // list (with each source's controls card) has the page.
    const seated = [...this.sources.values()].filter((s) => !s.external && !!s.session?.you && s.state !== 'left');
    document.body.toggleAttribute('data-hub-only', seated.length > 0 && !this.carrier.you);
    const kinds: ControlsSource[] = [];
    if (seated.some((s) => s.kind === 'pad')) kinds.push({ kind: 'pad' });
    for (const s of seated) if (s.keys) kinds.push({ kind: 'keys', cluster: s.keys.cluster.id });
    const cards = this.root.querySelector<HTMLElement>('[data-hub-cards]')!;
    const cardsHtml = kinds.map((k) => controlsCard(k, CONTROLS, { compact: true })).join('');
    cards.hidden = !cardsHtml;
    if (this.lastCards !== cardsHtml) {
      this.lastCards = cardsHtml;
      cards.innerHTML = cardsHtml;
    }
    const hint = this.root.querySelector<HTMLElement>('[data-more-pads]')!;
    const text = morePadsHint([...(navigator.getGamepads?.() ?? [])]);
    hint.hidden = !text;
    if (hint.textContent !== text) hint.textContent = text;
    const rows = this.visible();
    const panel = this.list.closest<HTMLElement>('[data-sources-panel]')!;
    panel.hidden = rows.length === 0;
    this.root.dataset.count = String(rows.length);
    const html = rows.map((s) => this.row(s)).join('');
    // Repainting only on change keeps a tap on Leave or Remove from landing on a list that was just rebuilt.
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.list.innerHTML = html;
    // The kit's icon element carries its own mask URL, so it is added as an element, not written into the markup.
    for (const li of this.list.querySelectorAll<HTMLElement>('[data-icon]')) {
      const badge = li.querySelector<HTMLElement>('.hub-badge.badge');
      if (badge) applySeatPattern(badge, Number(badge.textContent?.replace('#', '')));
      li.querySelector('.hub-kind')?.prepend(icon(li.dataset.icon!));
      if (li.dataset.chipIcon) li.querySelector('.hub-state')?.prepend(icon(li.dataset.chipIcon));
    }
  }

  /** How many distinct WebRTC links this page's sources ride (one, by design: R80 / C08). */
  connections(): number {
    return new Set([...this.sources.values()].map((s) => s.session?.link).filter(Boolean)).size;
  }

  /** Readout for tests and the debug overlay (R90): per source seat, kind, state, path and wire counters. */
  inspect(): Array<Record<string, unknown>> {
    return this.visible().map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      state: s.state,
      phase: s.session?.phase ?? null,
      plugged: s.plugged,
      unpluggedMs: s.unpluggedAt === null ? null : performance.now() - s.unpluggedAt,
      padId: s.padId || null,
      seat: s.session?.you?.number ?? null,
      source: s.session?.you?.source ?? null,
      endpoint: (s.session?.link?.inspect().endpointId as string | undefined) ?? null,
      ready: s.session?.isReady ?? false,
      name: s.external ? null : (s.session?.name ?? null),
      vehicle: s.pick?.vehicle ?? null,
      choosing: !!s.pick?.open,
      path: s.path,
      stats: s.session ? { ...s.session.stats } : null,
      drive: s.session?.inspect().drive ?? null,
      inputAgeMs: s.session?.inspect().inputAgeMs ?? null,
    }));
  }
}

/** The page's sources panel (R119): every joined controller carries extra players; a slim list shows them, with Leave and Remove. */
export function mountSources(session: Session, root: HTMLElement, ice: 'all' | 'relay' = 'all'): Sources {
  const sources = new Sources(root, session, { ice });
  sources.start();
  (window as unknown as { __jjSources: unknown }).__jjSources = { inspect: () => sources.inspect(), sources };
  return sources;
}
