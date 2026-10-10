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
import { icon, tokenData } from '../../../shared/ui';
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
/** Source handles on the page's connection: the touch player is 1; key clusters next; pads from 16 up, one fresh handle per pad seat. */
const KEYS_HANDLE = 2;
const PAD_HANDLE = 16;

const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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

  constructor(
    readonly id: string,
    readonly kind: SourceKind,
    readonly label: string,
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
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private list: HTMLElement | null = null;
  private lastHtml = '';
  private nextPad = 0;
  private nextHandle = PAD_HANDLE;

  /** `carrier` is the page's own session: its connection carries every source, whether or not its touch player has joined. */
  constructor(
    private readonly root: HTMLElement,
    private readonly carrier: Session,
    private readonly o: SourcesOptions = {},
  ) {
    const t = new Source('touch', 'touch', 'This device');
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
  }

  start(): void {
    this.mount();
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
      const s = new Source(`pad${n}`, 'pad', `Pad ${n}`);
      s.padIndex = p.index;
      s.padId = p.id;
      s.handle = this.nextHandle++;
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
    const session = new Session({ iceTransportPolicy: this.o.ice ?? 'all' });
    session.onChange = () => {
      if (session.phase === 'ready-to-join') session.claim(s.label);
    };
    session.onIdentify = () => {
      s.flashUntil = performance.now() + FLASH_MS;
    };
    s.session = session;
    session.attach(carrier, s.handle);
  }

  /** Leaving is a choice (chord, Leave, Remove): that seat and its car go at the next tick boundary; the others play on. */
  private leave(s: Source): void {
    s.session?.leave();
    s.session = null;
    s.state = 'left';
    s.released = false;
    s.holdSince = null;
    s.prevIdentify = s.prevReady = false;
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
      <p class="hub-hint" data-hint>Plug in a pad, or press a key cluster (W A S D or I J K L), to add a player on this device. <button type="button" class="btn quiet hub-add" data-add>Add a player</button></p>
      <div class="panel panel-ink hub-panel" data-sources-panel hidden><ul class="hub-list" data-hub-list aria-label="Players on this device"></ul></div></section>`;
    this.list = this.root.querySelector('[data-hub-list]');
    // One player per touchscreen (R65): "Add a player" cannot make a second touch player. It says how to add one (a pad or a key
    // cluster) and waits for that source's press; the claim is the press itself.
    this.root.querySelector('[data-add]')!.addEventListener('click', () => this.arm(true));
    this.list!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const s = this.sources.get(b?.closest<HTMLElement>('[data-source]')?.dataset.source ?? '');
      if (b && s && !s.external) this.leave(s);
      this.render();
    });
    this.render();
  }

  private arm(on: boolean): void {
    this.root.dataset.armed = on ? 'true' : 'false';
    const hint = this.root.querySelector<HTMLElement>('[data-hint]');
    if (!hint) return;
    hint.innerHTML = on
      ? '<b data-adding>Press a button on a pad, or a key on a cluster (W A S D or I J K L), to add a player.</b> <button type="button" class="btn quiet hub-add" data-add-cancel>Cancel</button>'
      : 'Plug in a pad, or press a key cluster (W A S D or I J K L), to add a player on this device. <button type="button" class="btn quiet hub-add" data-add>Add a player</button>';
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
    const state = { idle: 'Press to join', connecting: 'Joining…', connected: ready ? 'Ready' : 'Connected', unplugged: `Unplugged for ${sinceText(gone)}`, autopilot: 'Autopilot', left: 'Left: press to rejoin' }[s.state];
    const tone = s.state === 'unplugged' ? 'chip-warn' : s.state === 'autopilot' ? 'chip-auto' : ready ? 'chip-ready' : s.state === 'connected' ? 'chip-info' : s.state === 'connecting' ? 'chip-choosing' : '';
    const chipIcon = s.state === 'unplugged' ? 'wifi-off' : s.state === 'autopilot' ? 'car' : ready ? 'check' : s.state === 'connected' ? 'zap' : '';
    const st = s.session?.stats;
    const act =
      s.external || s.state === 'left'
        ? ''
        : s.state === 'unplugged'
          ? '<button type="button" class="btn quiet hub-act" data-act="remove" aria-label="Remove this player">Remove</button>'
          : '<button type="button" class="btn quiet hub-act" data-act="leave" aria-label="Leave: give up this seat">Leave</button>';
    return `<li class="hub-row${flash ? ' hub-flash' : ''}" data-source="${s.id}" data-kind="${s.kind}" data-state="${s.state}" style="--seat:${t ? t.fill : 'transparent'};--seat-on:${t ? t.on : 'var(--c-paper)'};" data-icon="${what}" data-chip-icon="${chipIcon}">
      ${seat}<span class="hub-kind" title="${esc(s.label)}"><span class="hub-label">${esc(s.label)}</span></span><span class="hub-state chip ${tone}" data-chip="${s.state}"><span class="hub-state-text">${state}</span></span>${act}
      <span class="hub-path" data-path>${esc(s.session && !s.external ? s.path || 'Connecting…' : '')}</span><span class="hub-bytes tnum">${st && !s.external ? `${st.stateBytes} B · ${st.batches} batches` : ''}</span></li>`;
  }

  private render(): void {
    if (!this.list) return;
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
