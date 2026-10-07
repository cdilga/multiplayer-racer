// The controller's session (P1-C02 sending, P1-C03 join/claim/resume): one endpoint, one WebRTC link (N05), the
// `jj-wasm-input` facade (N06) for StateBatches and Actions, and the §11 controller states. UI-free: the view renders
// `Session.phase` and calls the methods; tests drive it through `window.__jjController`.
//
// Identity (§5.5): the endpoint id and secret live in localStorage, namespaced by realm and room, so a reload or a
// tab that comes back gets the same seat (`Hello{resume: secret}`); rooms reported ended/not-found are pruned. Storage
// that throws still plays, with `persisted = false` for the honest note.
import { underBase } from '../../../shared/src/base';
import { ApiError, ControllerLink, type LinkState, type TransportOptions } from '../../../shared/transport';
import init, * as wasm from '../pkg/jj_wasm_input.js';

export type Phase =
  | 'finding'
  | 'no-such-room'
  | 'room-ended'
  | 'preview-expired'
  | 'connecting'
  | 'finding-relay'
  | 'no-route'
  | 'ready-to-join'
  | 'joining'
  | 'playing'
  | 'reconnecting'
  | 'host-gone'
  | 'host-paused'
  | 'another-tab'
  | 'update-needed';

export interface You {
  seat: number;
  number: number;
  rgb: [number, number, number];
  source: number;
}

export interface Hud {
  position: number | null;
  lap: [number, number] | null;
  boost: number;
  pause: string | null;
}

interface Stored {
  endpointId: string;
  secret: string;
  requestId: number;
  seated: boolean;
}

/** `jj-wasm-input`'s neutralise reasons (Rust consts, not exported to JS). */
const WHY_HIDDEN = 1;
const WHY_DISCONNECTED = 2;

/** The send loop's period: the scheduler decides what's due (60 Hz on change, 20 Hz refresh, prompt neutral). */
const POLL_MS = 8;
/** Reconnecting for this long without the room answering `available` means the host has gone (§11). */
const HOST_GONE_MS = 120_000;
/** With the relay unavailable and the link still down this long, the card says the network can't reach the host. */
const RELAY_GIVE_UP_MS = 8_000;

let wasmReady: Promise<unknown> | null = null;
export function loadInput(): Promise<unknown> {
  wasmReady ??= init();
  return wasmReady;
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    s.setItem('jj.probe', '1');
    s.removeItem('jj.probe');
    return s;
  } catch {
    return null;
  }
}

/** Phases that end a hub's connection for every source on it. */
const FATAL: ReadonlySet<Phase> = new Set<Phase>(['no-such-room', 'room-ended', 'preview-expired', 'no-route', 'host-gone', 'another-tab', 'update-needed']);

/** A state batch is a 7-byte header then 13-byte records, each starting with its source's u16 (jj-protocol `state`). */
const BATCH_HEADER = 7;
const RECORD_LEN = 13;

export interface Stick {
  x: number;
  y: number;
  touch: boolean;
}

export class Session {
  phase: Phase = 'finding';
  code = '';
  realm = 'dev';
  build = 'dev';
  you: You | null = null;
  hud: Hud | null = null;
  roomPhase: string | null = null;
  /** The round loop as the host reports it (P1-G01): this seat's Ready, the countdown or intermission timer, results. */
  isReady = false;
  countdownMs: number | null = null;
  countdownAt = 0;
  /** The host removed this player (P1-G07): the join card says so until they join again. */
  removed = false;
  /** G03's idle cue: when it arrived (null once the player steers) and the autopilot's delay after it. */
  idleCueAt: number | null = null;
  idleCueMs = 0;
  results: Array<{ number: number; name: string; place: number; time_ms: number | null; points: number }> | null = null;
  persisted = true;
  /** The hub's per-source identity (C08): a source is its own endpoint, so it has its own stored seat and tab fence. */
  slot = '';
  name = '';
  private rawLink: ControllerLink | null = null;
  /** The WebRTC link: a hub source rides its carrier's (one connection, many seats: C08). */
  get link(): ControllerLink | null {
    return this.parent ? this.parent.link : this.rawLink;
  }
  /** A hub source: the session whose connection carries this source's commands (wrapped `ForSource`) and input. */
  private parent: Session | null = null;
  private via = 0;
  /** Sources riding this session's connection, by source handle (any number). */
  private readonly kids = new Map<number, Session>();
  /** One endpoint for all the sources riding this connection, so their records share batches (fair batching, R80). */
  private shared: wasm.WasmEndpoint | null = null;
  /** The connection said Hello (sources attach and claim after it). */
  helloed = false;
  /** Counters for tests and the debug readout. */
  stats = { batches: 0, stateBytes: 0, actions: 0, cmds: 0, records: 0 };
  onChange: () => void = () => {};
  onIdentify: () => void = () => {};
  /** Every stick sample (the tutorial listens). */
  onSticks: (drive: Stick, action: Stick) => void = () => {};
  /** A discrete action fired (wheelie, OI!, cone): the tutorial listens. */
  onAction: (kind: number) => void = () => {};

  private endpoint: wasm.WasmEndpoint | null = null;
  private srcIdx = -1;
  private stored: Stored | null = null;
  private store = storage();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lostAt = 0;
  private relayTimer: ReturnType<typeof setInterval> | undefined;
  private relayGaveUpAt = 0;
  private drive: Stick = { x: 0, y: 0, touch: false };
  private action: Stick = { x: 0, y: 0, touch: false };
  private tabs: BroadcastChannel | null = null;
  private readonly tabId = Math.random().toString(36).slice(2);

  constructor(private readonly opts: TransportOptions = {}) {}

  private set(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.onChange();
    if (FATAL.has(p)) for (const k of [...this.kids.values()]) k.set(p);
  }

  private key(): string {
    return `jj.ctl.${this.realm}.${this.code}${this.slot ? `.${this.slot}` : ''}`;
  }

  private save(): void {
    if (!this.stored) return;
    try {
      this.store?.setItem(this.key(), JSON.stringify(this.stored));
    } catch {
      this.persisted = false;
    }
  }

  private forget(): void {
    try {
      this.store?.removeItem(this.key());
    } catch {
      // Nothing kept.
    }
  }

  /** Joins the room by code: identity from storage (or new), then connect. Opening a URL never claims a seat. */
  async start(code: string): Promise<void> {
    this.code = code.toUpperCase();
    this.set('finding');
    await loadInput();
    try {
      const v = (await (await fetch(underBase('version'), { cache: 'no-store' })).json()) as { build: string; realm: string };
      this.realm = v.realm;
      this.build = v.build;
    } catch {
      // Defaults stand; the server will say what it needs.
    }
    this.persisted = this.store !== null;
    try {
      this.carChoice = this.store?.getItem(`jj.car.${this.realm}`) ?? '';
    } catch {
      this.carChoice = '';
    }
    try {
      const raw = this.store?.getItem(this.key());
      if (raw) this.stored = JSON.parse(raw) as Stored;
    } catch {
      this.stored = null;
    }
    this.name = this.loadName();
    this.claimTab();
    const link = new ControllerLink(
      {
        onState: (s) => this.onLink(s),
        onOpen: () => this.hello(),
        onMessage: (ch, data) => this.onMessage(ch, data),
      },
      this.opts,
      this.stored ? { endpointId: this.stored.endpointId, secret: this.stored.secret } : undefined,
    );
    this.rawLink = link;
    this.stored ??= { endpointId: link.endpointId, secret: link.secret, requestId: 1 + Math.floor(Math.random() * 1e9), seated: false };
    this.save();
    try {
      await link.join(this.code);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'room-ended') return this.ended();
      if (e instanceof ApiError && (e.status === 410 || e.reason === 'preview-expired')) return this.set('preview-expired');
      if (msg === 'room-not-found') {
        if (this.stored.seated) this.set('host-gone');
        else this.set('no-such-room');
        this.forget();
        return;
      }
      this.set('no-route');
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    this.watchRelay();
  }

  /** §11 "Finding a relay…" while the link asks for a relay credential, and "Can't reach the host" once it has none to try and
   *  the link still isn't up (the relay said no: 503). A link that connects after all carries straight on. */
  private watchRelay(): void {
    clearInterval(this.relayTimer);
    this.relayGaveUpAt = 0;
    this.relayTimer = setInterval(() => {
      const link = this.link;
      if (!link || this.you || this.phase === 'ready-to-join' || this.phase === 'joining' || this.phase === 'playing') return;
      const r = (link.inspect().relayFallback ?? {}) as { state?: string };
      if (r.state === 'finding') this.set('finding-relay');
      else if (r.state === 'unavailable' && link.state !== 'connected') {
        this.relayGaveUpAt ||= Date.now();
        if (Date.now() - this.relayGaveUpAt > RELAY_GIVE_UP_MS) this.set('no-route');
      }
    }, 400);
  }

  private onLink(s: LinkState): void {
    for (const k of [...this.kids.values()]) k.onLink(s);
    if (s === 'connecting' && !this.you) this.set('connecting');
    else if (s === 'restarting' || s === 'rebuilding') {
      this.lostAt ||= Date.now();
      if (this.you) this.set('reconnecting');
      if (this.endpoint && this.srcIdx >= 0) this.endpoint.neutralise(this.srcIdx, WHY_DISCONNECTED);
      if (!this.parent && s === 'restarting') this.helloed = false;
    } else if (s === 'ended') this.ended();
    if (s === 'connected') this.lostAt = 0;
    if (this.lostAt && Date.now() - this.lostAt > HOST_GONE_MS) this.set('host-gone');
  }

  private ended(): void {
    const kids = [...this.kids.values()];
    this.forget();
    this.stop();
    this.set('room-ended');
    for (const k of kids) k.ended();
  }

  private send(ch: 'state' | 'cmd', bytes: Uint8Array): void {
    if (this.parent) {
      // A hub source's commands travel wrapped with its source; its input rides the carrier's shared batches.
      if (ch === 'state') return;
      const wrapped = wasm.encodeForSource(this.via, bytes);
      if (wrapped.length) this.parent.send('cmd', wrapped);
      this.stats.cmds += 1;
      return;
    }
    const c = this.link?.channels?.[ch];
    if (!c || c.readyState !== 'open') return;
    c.send(bytes as Uint8Array<ArrayBuffer>);
    if (ch === 'cmd') this.stats.cmds += 1;
  }

  /** Every (re)connection starts with Hello; a seated controller gets its seat back, a new one waits for Join. */
  private hello(): void {
    if (!this.stored) return;
    this.send('cmd', wasm.encodeHello(this.build, this.stored.endpointId, this.stored.secret));
    this.helloed = true;
    if (this.stored.seated) {
      // Hello{resume} brings the seat back; Welcome confirms it.
      this.set(this.you ? 'reconnecting' : 'joining');
    } else this.set('ready-to-join');
    for (const k of [...this.kids.values()]) k.afterHello();
  }

  /** A hub source's own phase once its carrier's connection has said Hello. */
  private afterHello(): void {
    if (this.stored?.seated) this.set(this.you ? 'reconnecting' : 'joining');
    else this.set('ready-to-join');
  }

  /**
   * Makes this session one source of `parent`'s connection (the hub, C08): the parent's endpoint identity and link carry
   * it, its commands go wrapped `ForSource{source}`, and its seat is its own (claim, identify, ready, leave, dropout).
   * The parent must have started (`start`) so its identity is known; the source keeps its own `seated` memory per room.
   */
  attach(parent: Session, source: number): void {
    this.parent = parent;
    this.via = source;
    this.slot = `src${source}`;
    this.code = parent.code;
    this.realm = parent.realm;
    this.build = parent.build;
    this.persisted = this.store !== null;
    let mine: Partial<Stored> = {};
    try {
      const raw = this.store?.getItem(this.key());
      if (raw) mine = JSON.parse(raw) as Partial<Stored>;
    } catch {
      mine = {};
    }
    this.stored = {
      endpointId: parent.stored?.endpointId ?? '',
      secret: parent.stored?.secret ?? '',
      requestId: mine.requestId ?? 1 + Math.floor(Math.random() * 1e9),
      seated: mine.seated ?? false,
    };
    this.save();
    this.carChoice = parent.carChoice;
    parent.kids.set(source, this);
    if (parent.helloed) this.afterHello();
    else this.set('connecting');
  }

  /** The endpoint every attached source samples into (created on the first use). */
  private sharedEndpoint(): wasm.WasmEndpoint {
    this.shared ??= new wasm.WasmEndpoint();
    return this.shared;
  }

  /** Join the race: Claim with a stable request id (a lost reply retried gives one seat). */
  claim(name: string): void {
    if (!this.stored) return;
    this.removed = false;
    this.name = name;
    this.saveName(name);
    this.set('joining');
    this.send('cmd', wasm.encodeClaim(this.stored.requestId, name));
  }

  private onMessage(ch: 'state' | 'cmd', data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    if (ch === 'state') {
      const j = wasm.decodeHud(bytes);
      if (!j) return;
      const h = (JSON.parse(j) as { hud: { position: number | null; lap: [number, number] | null; boost: number; pause: string | null } }).hud;
      this.hud = { position: h.position, lap: h.lap, boost: h.boost, pause: h.pause };
      if (h.pause === 'HostHidden' && this.you) this.set('host-paused');
      else if (this.phase === 'host-paused') this.set('playing');
      this.onChange();
      return;
    }
    const j = wasm.decodeHostCmd(bytes);
    if (!j) return;
    const cmd = JSON.parse(j) as Record<string, unknown> | string;
    // A reply for one source of this connection goes to that source's session; the rest are this session's own.
    if (typeof cmd === 'object' && 'ForSource' in cmd) {
      const f = cmd.ForSource as { source: number; cmd: Record<string, unknown> | string };
      this.kids.get(f.source)?.handleCmd(f.cmd);
      return;
    }
    this.handleCmd(cmd);
  }

  private handleCmd(cmd: Record<string, unknown> | string): void {
    if (cmd === 'Ended') return this.ended();
    if (cmd === 'Removed') {
      // P1-G07: the host removed this player. The seat is gone; joining again is a new claim.
      this.removed = true;
      this.you = null;
      if (this.stored) this.stored.seated = false;
      this.save();
      this.set('ready-to-join');
      this.onChange();
      return;
    }
    if (typeof cmd !== 'object') return;
    if ('Welcome' in cmd) {
      const w = cmd.Welcome as { seat: number; number: number; colour: { rgb: [number, number, number] }; source: number };
      this.you = { seat: w.seat, number: w.number, rgb: w.colour.rgb, source: w.source };
      this.stored!.seated = true;
      this.save();
      if (this.parent) {
        // A hub source samples into its carrier's shared endpoint, added once (a re-welcome keeps its place).
        this.endpoint = this.parent.sharedEndpoint();
        if (this.srcIdx < 0) this.srcIdx = this.endpoint.addSource(w.source);
      } else {
        this.endpoint?.free();
        this.endpoint = new wasm.WasmEndpoint();
        this.srcIdx = this.endpoint.addSource(w.source);
      }
      this.set('playing');
      if (this.carChoice) this.send('cmd', wasm.encodePick(this.carChoice, false));
      this.onChange();
    } else if ('ClaimRejected' in cmd) {
      const r = (cmd.ClaimRejected as { reason: string }).reason;
      if (r === 'Build') {
        this.set('update-needed');
        if (!sessionStorage.getItem('jj.reloaded')) {
          sessionStorage.setItem('jj.reloaded', '1');
          location.reload();
        }
      } else if (r === 'Ended') this.ended();
      else this.set('ready-to-join');
    } else if ('IdleCue' in cmd) {
      // G03: no deliberate input while racing; the autopilot takes over unless the player steers.
      this.idleCueAt = performance.now();
      this.idleCueMs = (cmd.IdleCue as { autopilot_in_ms: number }).autopilot_in_ms;
      this.onChange();
    } else if ('RoomState' in cmd) {
      const rs = cmd.RoomState as {
        phase: string;
        you: { ready: boolean } | null;
        countdown_ms: number | null;
        results: Array<{ number: number; name: string; place: number; time_ms: number | null; points: number }> | null;
      };
      this.roomPhase = rs.phase;
      if (rs.phase !== 'Racing') this.idleCueAt = null;
      this.isReady = rs.you?.ready ?? false;
      this.countdownMs = rs.countdown_ms;
      this.countdownAt = performance.now();
      this.results = rs.results;
      this.onChange();
    }
  }

  /** Stick input at input-event rate (shaped −1..1; y down is positive, as the screen). */
  setSticks(drive: Stick, action: Stick): void {
    this.drive = { ...drive };
    this.action = { ...action };
    this.onSticks(drive, action);
    if (this.idleCueAt !== null && Math.max(Math.hypot(drive.x, drive.y), Math.hypot(action.x, action.y)) > 0.3) {
      // Deliberate input: the host hands the car back (if the autopilot had it), so the cue goes.
      this.idleCueAt = null;
      this.onChange();
    }
    this.sample();
  }

  private sample(): void {
    if (!this.endpoint || this.srcIdx < 0) return;
    const q = (v: number) => wasm.quantise(v);
    // The wire's drive Y is up-positive (throttle); the screen's is down-positive.
    const actions = this.endpoint.sample(
      this.srcIdx,
      q(this.drive.x),
      q(-this.drive.y),
      q(this.action.x),
      q(-this.action.y),
      this.drive.touch,
      this.action.touch,
      performance.now(),
    );
    for (const a of actions) {
      const r = this.you;
      this.send('cmd', wasm.encodeAction(a.id, r?.source ?? 0, a.kindTag, a.preloadMs, 0, 0, a.atSourceSeq));
      this.stats.actions += 1;
      this.onAction(a.kindTag);
      a.free();
    }
  }

  private poll(): void {
    // The link can retry for ever without changing state (a host that vanished): the liveness check runs here too.
    if (this.lostAt && this.phase === 'reconnecting' && Date.now() - this.lostAt > HOST_GONE_MS) this.set('host-gone');
    if (this.endpoint && this.srcIdx >= 0) this.sample();
    this.flush(this.endpoint, false);
    this.flush(this.shared, true);
  }

  /** Sends what the scheduler says is due; a hub's batches are counted to the sources whose records are in them. */
  private flush(endpoint: wasm.WasmEndpoint | null, hub: boolean): void {
    const flush = endpoint?.poll(performance.now());
    if (!flush) return;
    for (let i = 0; i < flush.batchCount; i++) {
      const b = flush.batch(i);
      this.send('state', b);
      this.stats.batches += 1;
      this.stats.stateBytes += b.byteLength;
      if (!hub) continue;
      for (let at = BATCH_HEADER; at + RECORD_LEN <= b.byteLength; at += RECORD_LEN) {
        const k = this.kids.get(b[at]! | (b[at + 1]! << 8));
        if (k) {
          k.stats.stateBytes += RECORD_LEN;
          k.stats.records += 1;
        }
      }
      for (const k of this.kids.values()) k.stats.batches += 1;
    }
    flush.free();
  }

  identify(): void {
    this.send('cmd', wasm.encodeIdentify());
    this.onIdentify();
  }

  setCamera(firstPerson: boolean): void {
    this.send('cmd', wasm.encodeSetCamera(firstPerson));
  }

  recover(): void {
    this.send('cmd', wasm.encodeRecover());
  }

  /** A menu (Help) opened or closed: the host's autopilot drives while it's open (G03). */
  menu(open: boolean): void {
    this.send('cmd', wasm.encodeMenu(open));
  }

  /** A source that went away (an unplugged pad, C08): neutral at once, and the host's autopilot takes the seat; `false` brings it back. */
  unavailable(on: boolean): void {
    if (!this.endpoint || this.srcIdx < 0) return;
    if (on) this.endpoint.neutralise(this.srcIdx, WHY_DISCONNECTED);
    else this.endpoint.resume(this.srcIdx);
  }

  /** The lobby's car pick goes to the host: a roster id, and whether the picker is still open (the TV says "Choosing car…"). */
  pick(vehicle: string, open: boolean): void {
    this.carChoice = vehicle;
    this.send('cmd', wasm.encodePick(vehicle, open));
  }

  /** Sit out (the settings sheet, C07): the seat steps out of the next round and the car is parked. */
  sitOut(): void {
    this.send('cmd', wasm.encodeSitOut());
  }

  /** The player's camera-distance preference (C07). There is no wire message for it yet: the value is kept for the host. */
  cameraDistance: 'near' | 'host' | 'far' = 'host';
  /** The car the player picked in the lobby (an id from roster.json); a per-device preference, not on the wire yet. */
  carChoice = '';

  ready(on: boolean): void {
    this.send('cmd', wasm.encodeReady(on));
  }

  leave(): void {
    this.send('cmd', wasm.encodeLeave());
    this.forget();
    this.stop();
    this.you = null;
    this.set('room-ended');
  }

  private onVisibility = (): void => {
    for (const k of [...this.kids.values()]) k.onVisibility();
    if (!this.endpoint || this.srcIdx < 0) return;
    if (document.visibilityState === 'hidden') this.endpoint.neutralise(this.srcIdx, WHY_HIDDEN);
    else {
      this.endpoint.resume(this.srcIdx);
      this.link?.resume();
    }
  };

  /** One tab per seat (§11): a newer tab for the same room fences this one; "Use this one" takes it back. */
  private claimTab(): void {
    try {
      this.tabs?.close();
      this.tabs = new BroadcastChannel(`jj.tab.${this.realm}.${this.code}${this.slot ? `.${this.slot}` : ''}`);
      this.tabs.onmessage = (e: MessageEvent<{ tab: string }>) => {
        if (e.data.tab === this.tabId || this.phase === 'another-tab') return;
        this.stop();
        this.set('another-tab');
      };
      this.tabs.postMessage({ tab: this.tabId });
    } catch {
      // No BroadcastChannel: the host's resume fencing still holds.
    }
  }

  /** "Use this one": take the seat back in this tab. */
  async takeOver(): Promise<void> {
    this.you = null;
    await this.start(this.code);
  }

  stop(): void {
    if (this.parent) {
      // A hub source leaves its carrier; the connection stays up for the others.
      if (this.parent.kids.get(this.via) === this) this.parent.kids.delete(this.via);
      this.parent = null;
      return;
    }
    clearInterval(this.pollTimer);
    clearInterval(this.relayTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.rawLink?.end();
    this.rawLink = null;
  }

  private loadName(): string {
    try {
      return this.store?.getItem(`jj.name.${this.realm}`) ?? '';
    } catch {
      return '';
    }
  }

  private saveName(name: string): void {
    try {
      this.store?.setItem(`jj.name.${this.realm}`, name);
    } catch {
      this.persisted = false;
    }
  }

  inspect(): Record<string, unknown> {
    return {
      phase: this.phase,
      code: this.code,
      you: this.you,
      hud: this.hud,
      roomPhase: this.roomPhase,
      ready: this.isReady,
      countdownMs: this.countdownMs,
      results: this.results,
      persisted: this.persisted,
      cameraDistance: this.cameraDistance,
      carChoice: this.carChoice,
      sticks: { drive: { ...this.drive }, action: { ...this.action } },
      stats: { ...this.stats },
      link: this.link?.inspect() ?? null,
      source: this.parent ? this.via : null,
      kids: [...this.kids.keys()],
      inputAgeMs: this.endpoint && this.srcIdx >= 0 ? this.endpoint.sampleAgeMs(this.srcIdx, performance.now()) : null,
      drive: this.endpoint && this.srcIdx >= 0 ? { steer: this.endpoint.driveSteer(this.srcIdx), throttle: this.endpoint.driveThrottle(this.srcIdx), brake: this.endpoint.driveBrake(this.srcIdx) } : null,
    };
  }
}
