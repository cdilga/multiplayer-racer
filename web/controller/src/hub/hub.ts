// The hub (P1-C08): a second laptop with pads or a keyboard, or a phone with a paired pad, where every source (a pad, a
// key cluster, the phone's own touch sticks) joins and leaves ON ITS OWN. A press claims that source's seat (number,
// colour, name); View/Select (pads) or the cluster's Identify key flashes its row here in its colour (and its number on
// the TV); Start or the cluster's READY key is READY; holding both leaves. An unplugged pad is reported on its own while
// the others play on. Sources are a sample, never a limit (R66): the list grows with whatever is plugged in.
//
// TRANSPORT NOTE: the protocol seats one endpoint with one seat (jj-session `Endpoint.seat`), so until the host grows a
// multi-source `Claim` each source here is its own endpoint with its own link (`Session.slot`). Nothing above `Source`
// knows that: the day one connection carries several sources only `Source.join` changes.
import { icon } from '../../../shared/ui';
import { Session } from '../app/session';
import { pathLabel } from './badge';
import { CLUSTERS, KeyCluster, LEAVE_HOLD_MS, NEUTRAL, isPress, padSample, type Sample } from './input';
import './hub.css';

export type SourceKind = 'pad' | 'keys' | 'touch';
export type SourceState = 'idle' | 'connecting' | 'connected' | 'unplugged' | 'autopilot' | 'left';

const TICK_MS = 16;
const RENDER_MS = 250;
const PATH_MS = 2000;
const FLASH_MS = 1500;
const STALL_MS = 12_000;

const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class Source {
  session: Session | null = null;
  state: SourceState = 'idle';
  keys?: KeyCluster;
  padIndex?: number;
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
  /** A phone's own session (touch): the hub shows it but doesn't drive it. */
  external = false;

  constructor(
    readonly id: string,
    readonly kind: SourceKind,
    readonly label: string,
  ) {}
}

export interface HubOptions {
  code: string;
  /** TURN-only test switch (the controller's `?ice=relay`). */
  ice?: 'all' | 'relay';
  /** Where to show the list; the phone-with-pad uses a small tray, the hub page the full list. */
  tray?: boolean;
}

export class Hub {
  readonly sources = new Map<string, Source>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private list: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement | null,
    private readonly o: HubOptions,
  ) {
    for (const c of CLUSTERS) {
      const s = new Source(`keys${c.id}`, 'keys', c.label);
      s.keys = new KeyCluster(c);
      this.sources.set(s.id, s);
    }
  }

  start(): void {
    if (this.root) this.mount(this.root);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
    this.timers.push(setInterval(() => this.tick(), TICK_MS), setInterval(() => this.render(), RENDER_MS), setInterval(() => void this.paths(), PATH_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    for (const s of this.sources.values()) if (!s.external) s.session?.stop();
  }

  /** The phone's own touch session as a source (the phone with a paired pad: two seats). */
  addTouch(session: Session): void {
    const s = new Source('touch', 'touch', 'This phone');
    s.session = session;
    s.external = true;
    s.state = 'connected';
    this.sources.set(s.id, s);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    for (const s of this.sources.values()) {
      if (s.keys?.owns(e.code)) {
        s.keys.key(e.code, e.type === 'keydown');
        e.preventDefault();
      }
    }
  };

  private onBlur = (): void => {
    for (const s of this.sources.values()) s.keys?.releaseAll();
  };

  /** Pads present now: a new standard pad becomes a source (idle until pressed); a gone one is reported unplugged. */
  private scanPads(): void {
    const pads = [...(navigator.getGamepads?.() ?? [])];
    const present = new Set<number>();
    for (const p of pads) {
      if (!p || !p.connected || p.mapping !== 'standard') continue;
      present.add(p.index);
      const id = `pad${p.index}`;
      let s = this.sources.get(id);
      if (!s) {
        s = new Source(id, 'pad', `Pad ${p.index + 1}`);
        s.padIndex = p.index;
        this.sources.set(id, s);
      }
      if (!s.plugged) {
        // Plugged back in: still neutral until it is pressed again.
        s.plugged = true;
      }
    }
    for (const s of [...this.sources.values()]) {
      if (s.kind !== 'pad' || present.has(s.padIndex!)) continue;
      if (!s.session) this.sources.delete(s.id);
      else if (s.plugged) this.unplug(s);
    }
  }

  /** Unplugged: this seat alone goes neutral at once and to the autopilot after the host's dropout time. */
  private unplug(s: Source): void {
    s.plugged = false;
    s.state = 'unplugged';
    s.sample = NEUTRAL;
    s.session?.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false });
    s.session?.unavailable(true);
  }

  private read(s: Source, now: number): Sample {
    if (s.keys) return s.keys.sample(now);
    const p = s.padIndex === undefined ? null : navigator.getGamepads?.()[s.padIndex];
    return p && p.connected ? padSample(p) : NEUTRAL;
  }

  private tick(): void {
    const now = performance.now();
    this.scanPads();
    for (const s of this.sources.values()) {
      if (s.external) {
        s.state = s.session?.phase === 'playing' ? 'connected' : 'connecting';
        continue;
      }
      if (s.kind === 'pad' && !s.plugged) continue;
      const smp = (s.sample = this.read(s, now));
      const pressed = isPress(smp);
      if (!s.session || s.state === 'left') {
        if (!pressed) s.released = true;
        // One join at a time: six links negotiating at once leave one stuck; a pressed source waits its turn.
        else if (s.released && !this.joining()) this.join(s);
        continue;
      }
      if (s.state === 'unplugged') {
        // Plugged back and pressed: the seat comes back.
        if (pressed) {
          s.session.unavailable(false);
          s.state = 'connected';
        }
        continue;
      }
      if (s.session.phase !== 'playing' && s.session.phase !== 'host-paused') {
        s.state = 'connecting';
        // A join that stalls (a lost signalling race among many sources arriving at once) starts over; the stored
        // identity makes the retry the same endpoint.
        if (now - s.connectingSince > STALL_MS) this.join(s);
        continue;
      }
      s.state = s.session.idleCueAt !== null && s.session.idleCueMs - (now - s.session.idleCueAt) <= 0 ? 'autopilot' : 'connected';
      s.session.setSticks({ ...smp.drive, touch: Math.hypot(smp.drive.x, smp.drive.y) > 0 }, { ...smp.action, touch: Math.hypot(smp.action.x, smp.action.y) > 0 });
      if (smp.identify && !s.prevIdentify) s.session.identify();
      if (smp.ready && !s.prevReady && !smp.identify) s.session.ready(!s.session.isReady);
      s.prevIdentify = smp.identify;
      s.prevReady = smp.ready;
      if (smp.identify && smp.ready) {
        s.holdSince ??= now;
        if (now - s.holdSince >= LEAVE_HOLD_MS) this.leave(s);
      } else s.holdSince = null;
    }
  }

  private joining(): boolean {
    return [...this.sources.values()].some((o) => o.session && !o.external && o.state === 'connecting');
  }

  /** The press that claims this source's seat: its own session, endpoint and seat. */
  private join(s: Source): void {
    s.released = false;
    s.state = 'connecting';
    s.connectingSince = performance.now();
    s.session?.stop();
    const session = new Session({ iceTransportPolicy: this.o.ice ?? 'all' });
    session.slot = s.id;
    session.onChange = () => {
      if (session.phase === 'ready-to-join') session.claim(s.label);
    };
    session.onIdentify = () => {
      s.flashUntil = performance.now() + FLASH_MS;
    };
    s.session = session;
    void session.start(this.o.code);
  }

  private leave(s: Source): void {
    s.session?.leave();
    s.session = null;
    s.state = 'left';
    s.released = false;
    s.holdSince = null;
    s.prevIdentify = s.prevReady = false;
    s.path = '';
  }

  private async paths(): Promise<void> {
    for (const s of this.sources.values()) {
      if (!s.session) continue;
      const l = await pathLabel(s.session);
      s.path = l.text;
      s.pathAt = performance.now();
    }
  }

  private mount(root: HTMLElement): void {
    root.innerHTML = `<section class="hub${this.o.tray ? ' tray' : ''}" data-hub>
      <header class="hub-head"><h1 class="display italic">${this.o.tray ? 'Pads on this phone' : `Hub · room ${esc(this.o.code)}`}</h1>
      <p>${this.o.tray ? 'Press a button on a paired pad to join.' : 'Press a button on a pad, or a key on a cluster, to join. View/Select flashes your row and number; Start is Ready; hold both to leave.'}</p></header>
      <ul class="hub-list" data-hub-list aria-label="Sources"></ul></section>`;
    this.list = root.querySelector('[data-hub-list]');
    this.render();
  }

  private row(s: Source): string {
    const you = s.session?.you;
    const seat = you ? `<b class="hub-badge" style="background:${hex(you.rgb)}">#${you.number}</b>` : '<b class="hub-badge none">–</b>';
    const flash = performance.now() < s.flashUntil;
    const what = s.kind === 'keys' ? 'keyboard' : s.kind === 'pad' ? 'gamepad-2' : 'smartphone';
    const iconUrl = (icon(what).style.getPropertyValue('--ic') || '').toString();
    const state = { idle: 'Press to join', connecting: 'Joining…', connected: s.session?.isReady ? 'Ready' : 'Connected', unplugged: 'Unplugged', autopilot: 'Autopilot', left: 'Left: press to rejoin' }[s.state];
    const st = s.session?.stats;
    return `<li class="hub-row${flash ? ' flash' : ''}" data-source="${s.id}" data-kind="${s.kind}" data-state="${s.state}" style="--seat:${you ? hex(you.rgb) : 'transparent'};--ic:${iconUrl}">
      ${seat}<span class="hub-kind"><i class="ic" aria-hidden="true"></i>${esc(s.label)}</span><span class="hub-state" data-chip="${s.state}">${state}</span>
      <span class="hub-path" data-path>${esc(s.session ? s.path || 'Connecting…' : '')}</span><span class="hub-bytes tnum">${st ? `${st.stateBytes} B · ${st.batches} batches` : ''}</span></li>`;
  }

  private render(): void {
    if (!this.list) return;
    this.list.innerHTML = [...this.sources.values()].map((s) => this.row(s)).join('');
  }

  /** Readout for tests and the debug overlay (R90): per source seat, kind, state, path and wire counters. */
  inspect(): Array<Record<string, unknown>> {
    return [...this.sources.values()].map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      state: s.state,
      phase: s.session?.phase ?? null,
      plugged: s.plugged,
      seat: s.session?.you?.number ?? null,
      source: s.session?.you?.source ?? null,
      endpoint: (s.session?.link?.inspect().endpointId as string | undefined) ?? null,
      ready: s.session?.isReady ?? false,
      path: s.path,
      stats: s.session ? { ...s.session.stats } : null,
      drive: s.session?.inspect().drive ?? null,
    }));
  }
}

/** The `/hub` page: every source of this browser. `?hub` on a room's join URL (`B/j/<CODE>?hub`). */
export function mountHub(root: HTMLElement, code: string, ice: 'all' | 'relay' = 'all'): Hub {
  const hub = new Hub(root, { code, ice });
  hub.start();
  (window as unknown as { __jjHub: unknown }).__jjHub = { inspect: () => hub.inspect(), hub };
  return hub;
}

/** A phone with a paired pad: the phone's own seat plus one more per pad that is pressed. */
export function pairPads(session: Session, tray: HTMLElement): Hub {
  const hub = new Hub(tray, { code: session.code, tray: true });
  hub.addTouch(session);
  for (const c of [...hub.sources.keys()]) if (c.startsWith('keys')) hub.sources.delete(c); // a phone has no key clusters
  hub.start();
  (window as unknown as { __jjHub: unknown }).__jjHub = { inspect: () => hub.inspect(), hub };
  return hub;
}
