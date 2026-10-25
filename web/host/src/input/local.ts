// Host pads and keyboard clusters as players (P1-C05). Each is a local source the worker interprets with the same
// jj-input path as a phone (source-blind DriveIntent): this module only samples sticks and buttons and sends
// `LocalSource{source, axes, buttons, seq}` (plan §4.4).
// - Claim-by-press: a source sends nothing until its first press, so a plugged-in pad or an idle keyboard never
//   makes a phantom seat. From then on it sends every poll while connected.
// - Pads use the standard mapping: left stick DRIVE, right stick ACTION, View/Select = Identify, Start = READY.
//   Key clusters come from `clusters.json` (data). Holding Identify + READY for `leaveHoldMs` leaves the seat.
// - Digital steering is rate-shaped (keys ramp the right stick's x axis, R116); everything else is immediate.
// - Steering wheels with pedals (P1-C05.2) map onto the same two sticks through a profile (`wheel.ts`): a shipped one
//   matched by USB ids, or one saved by calibrating that device in the input drawer. A non-standard device with an
//   axis resting far from centre (pedals) and no profile sends nothing until it's mapped, so it can't claim a seat
//   with its brake on. While a source calibrates, its seat gets neutral input.
// - An unplugged pad sends one `LOCAL_UNAVAILABLE` sample and goes quiet: neutral at once, its car to the autopilot
//   after the worker's dropout time, and back when it's plugged in and pressed again.
// - The native input helper (P1-C12.1, `helper.ts`) adds one source per keyboard and per pad on this computer: each helper
//   keyboard plays the first cluster's layout (Keys A), so two keyboards are two players with the same keys. While the
//   helper has a keyboard (a pad), the browser's own clusters (Gamepad API pads) stand down, so nothing is read twice;
//   host UI keys (clusters.json `reserved`) are never cluster keys and keep working.
import map from './clusters.json';
import roster from '../../../shared/src/roster.json';
import type { SimClient } from '../worker/client';
import { LOCAL_IDENTIFY, LOCAL_LEAVE, LOCAL_READY, LOCAL_UNAVAILABLE } from '../worker/messages';
import { HelperClient, type HelperDevice, helperSourceBase } from './helper';
import { CAL_PROMPTS, Calibration, type PadLike, type WheelProfile, pedal, profileFor, saveProfile, savedProfiles, wheelSample } from './wheel';

type Axes = [number, number, number, number];
type Stick = { up: string; down: string; left: string; right: string };
type FlickKeys = { up: string; down: string };
export interface Cluster {
  id: number;
  label: string;
  drive: Stick;
  action: FlickKeys;
  identify: string;
  ready: string;
}

export interface LocalSourceView {
  source: number;
  kind: 'pad' | 'keys' | 'wheel';
  label: string;
  connected: boolean;
  /** Pressed at least once: it has (or had) a seat. */
  claimed: boolean;
  /** Its seat left; its next press (after letting go) joins as a new player. */
  left: boolean;
  /** Its seat is sitting out (from the drawer). */
  sittingOut: boolean;
  /** A device read by the native input helper (P1-C12.1). */
  helper?: boolean;
  /** A browser cluster or pad standing down while the helper reads every keyboard (pad) on this computer. */
  helperOwned?: boolean;
  /** Its Identify button is down now (P1-C14: holding it shows the controls card on the seat's tile). */
  identifyHeld: boolean;
  /** The controls this seat has used since it joined (P1-C14): the lobby's controls card folds away once all six are. */
  used: string[];
  /** A wheel's profile: its name, whether it's confirmed on a device, and the live mapping (−1..1 steer, 0..1 pedals). */
  wheel?: { profile: string; verified: boolean; steer: number; throttle: number; brake: number };
  /** A non-standard device that needs mapping before it can play (P1-C05.2). */
  needsMapping?: boolean;
  /** Calibrating: the step and its prompt. */
  calibrating?: { step: string; prompt: string };
}

const AXIS_MAX = 32767;
const clusters = map.clusters as Cluster[];

/** Quantises −1..1 the way the wire does (`jj_types::axis`). */
const q = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * AXIS_MAX);

interface Source {
  view: LocalSourceView;
  axes: Axes;
  buttons: number;
  seq: number;
  /** When Identify + READY started being held together (ms), for Leave. */
  holdSince: number | null;
  /** Let go since leaving (so the next press is a new player). */
  released: boolean;
  /** A pad's Gamepad id (wheel profiles are per device). */
  padId?: string;
  cal?: Calibration;
  /** Just calibrated: the press that finished it isn't a join; everything must be let go first. */
  awaitRelease?: boolean;
  /** When the left stick was last pulled all the way back (ms), for the launch: pull back, hold, snap forward. */
  pulledAt?: number;
  pullReleasedAt?: number;
}

/** Whether the host's keyboard plays (the drawer's toggle): remembered per host browser, on by default. */
const KEYS_KEY = 'jj.hostKeyboardPlayers';
const readKeysOn = (): boolean => {
  try {
    return localStorage.getItem(KEYS_KEY) !== 'off';
  } catch {
    return true;
  }
};

/** A stick past the radial deadzone, rescaled so the edge of the deadzone reads 0. */
function deadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

export class LocalInput {
  private sources = new Map<number, Source>();
  private keys = new Set<string>();
  /** A Lobby Ready event has already sent its toggle; held keys must not toggle again during Preparing. */
  private readyEvents = new Set<number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  /** Profiles saved by calibration (read once, written on save). */
  private saved: Record<string, WheelProfile> = savedProfiles();
  private keysOn = readKeysOn();
  private lobbyPicks = new Map<number, { seat: number; vehicle: string; confirmed: boolean; readyHeld: boolean; suppressReady: boolean; direction: number }>();
  private readonly clusterKeys = new Set(
    clusters.flatMap((c) => [...Object.values(c.drive), ...Object.values(c.action), c.identify, c.ready]),
  );

  /** The native input helper (P1-C12.1). `?helperPort=` points it at another port (tests). */
  readonly helper: HelperClient;

  constructor(
    private readonly client: SimClient,
    private readonly win: Window = window,
  ) {
    for (const c of clusters) this.add(c.id, 'keys', c.label);
    this.helper = new HelperClient(Number(new URLSearchParams(win.location?.search ?? '').get('helperPort')) || undefined);
    this.helper.onKeys = (id, down, before) => this.onHelperKeys(id, down, before);
  }

  /** The cluster a keys source plays: its own, or Keys A for a helper keyboard. */
  clusterOf(source: number): Cluster | undefined {
    return clusters.find((c) => c.id === source) ?? (this.sources.get(source)?.view.helper ? clusters[0] : undefined);
  }

  /** The input drawer's list: every known source, connected or not. */
  list(): LocalSourceView[] {
    return [...this.sources.values()].map((s) => ({ ...s.view }));
  }

  clusters(): Cluster[] {
    return clusters;
  }

  vehicleChoices(): Array<{ source: number; seat: number; vehicle: string; confirmed: boolean; readyHeld: boolean; suppressReady: boolean; direction: number }> {
    return [...this.lobbyPicks].map(([source, pick]) => ({ source, ...pick }));
  }

  /** Whether the host's keyboard plays (P1-C14). Off ignores every cluster key and lets them through to the host UI. */
  keyboardPlayers(): boolean {
    return this.keysOn;
  }

  setKeyboardPlayers(on: boolean): void {
    this.keysOn = on;
    this.keys.clear();
    try {
      localStorage.setItem(KEYS_KEY, on ? 'on' : 'off');
    } catch {
      // Storage blocked: the toggle still works for this page.
    }
  }

  /** The drawer's Add (P1-C14): a key cluster claims its seat (or a left one a new seat) with no key pressed. */
  join(source: number): void {
    const s = this.sources.get(source);
    if (!s || s.view.kind !== 'keys' || !s.view.connected || !this.keysOn) return;
    if (s.view.claimed && !s.view.left) return;
    Object.assign(s.view, { claimed: true, left: false, sittingOut: false, used: [] });
    s.released = false;
    this.client.input({ type: 'ui', ui: `join-local:${source}` });
  }

  /** An explicit lobby choice. The same Pick reducer serves host sources and phones. */
  choose(source: number, vehicle: string, open = true): void {
    const pick = this.lobbyPicks.get(source);
    if (!pick || !roster.cars.some((c) => c.id === vehicle)) return;
    pick.vehicle = vehicle;
    pick.confirmed = !open;
    pick.suppressReady = !open && pick.readyHeld;
    this.client.input({ type: 'ui', ui: `pick-local:${source}:${vehicle}`, on: open });
    try { localStorage.setItem(this.vehicleKey(source), vehicle); } catch { /* This visit only. */ }
  }

  ready(source: number): void {
    const pick = this.lobbyPicks.get(source);
    const s = this.sources.get(source);
    if (pick?.confirmed && s?.view.claimed && !s.view.left) this.client.input({ type: 'ui', ui: `ready-local:${source}` });
  }

  private vehicleKey(source: number): string {
    return `jj.hostVehicle.${this.sources.get(source)?.padId ?? source}`;
  }

  private lobbyChoice(s: Source, axes: Axes, ready: boolean): boolean {
    if (this.client.room?.phase !== 'Lobby') return ready && !this.readyEvents.has(s.view.source);
    const seat = this.client.room.seats.find((st) => st.localSource === s.view.source && st.presence !== 'Left');
    if (!seat) return false; // The joining press is never Ready as well.
    let pick = this.lobbyPicks.get(s.view.source);
    if (!pick || pick.seat !== seat.seat) {
      let saved = '';
      try { saved = localStorage.getItem(this.vehicleKey(s.view.source)) ?? ''; } catch { /* This visit only. */ }
      pick = { seat: seat.seat, vehicle: roster.cars.find((c) => c.id === saved)?.id ?? roster.cars[0]!.id, confirmed: false, readyHeld: ready, suppressReady: ready, direction: 0 };
      this.lobbyPicks.set(s.view.source, pick);
      this.choose(s.view.source, pick.vehicle);
    }
    const pressed = ready && !pick.readyHeld;
    pick.readyHeld = ready;
    if (!ready) pick.suppressReady = false;
    if (!pick.confirmed) {
      const direction = Math.abs(axes[2]) > .6 ? Math.sign(axes[2]) : 0;
      if (direction && direction !== pick.direction) {
        const i = roster.cars.findIndex((c) => c.id === pick!.vehicle);
        this.choose(s.view.source, roster.cars[(i + direction + roster.cars.length) % roster.cars.length]!.id);
      }
      pick.direction = direction;
      if (pressed) this.choose(s.view.source, pick.vehicle, false);
      return false;
    }
    // Keyboard Ready is delivered from its key event, so a short press survives a long renderer frame.
    return s.view.kind !== 'keys' && ready && !pick.suppressReady;
  }

  /** The drawer's Remove (P1-C14): an unplugged pad or wheel's held seat leaves for good, its car with it. */
  remove(source: number): void {
    const s = this.sources.get(source);
    if (!s?.view.claimed || s.view.left || s.view.connected) return;
    Object.assign(s.view, { left: true, sittingOut: false, identifyHeld: false });
    s.released = true;
    this.client.input({ type: 'ui', ui: `leave-local:${source}` });
  }

  /** The drawer's Sit out / Return for a seated source. */
  toggleSitOut(source: number): void {
    const s = this.sources.get(source);
    if (!s?.view.claimed || s.view.left) return;
    s.view.sittingOut = !s.view.sittingOut;
    this.client.input({ type: 'ui', ui: `sit-out-local:${source}`, on: s.view.sittingOut });
  }

  /** The drawer's "Map as a wheel" / "Calibrate": walk the prompts with this device; its seat gets neutral input. */
  calibrate(source: number): void {
    const s = this.sources.get(source);
    if (!s?.padId || !s.view.connected) return;
    s.cal = new Calibration({ id: s.padId });
  }

  /** The calibration prompt's Skip (button steps) and Cancel. */
  skipStep(source: number): void {
    this.sources.get(source)?.cal?.skip();
  }

  cancelCalibration(source: number): void {
    const s = this.sources.get(source);
    if (s) s.cal = undefined;
  }

  /** "Looks right" on a shipped profile: saved as confirmed for this device. */
  confirmWheel(source: number): void {
    const s = this.sources.get(source);
    const pad = s?.padId ? this.pads().find((p) => p.id === s.padId) : undefined;
    const prof = pad && profileFor(pad, this.saved);
    if (!s?.padId || !prof) return;
    this.keep(s.padId, { ...prof, verified: true, note: `${prof.note ?? ''} Confirmed on this device.`.trim() });
  }

  private keep(padId: string, p: WheelProfile): void {
    this.saved = { ...this.saved, [padId]: p };
    saveProfile(padId, p);
  }

  private pads(): PadLike[] {
    return [...(this.win.navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p?.connected);
  }

  /** The drawer's Leave for a seated source. */
  leave(source: number): void {
    const s = this.sources.get(source);
    if (!s?.view.claimed || s.view.left) return;
    Object.assign(s.view, { left: true, sittingOut: false });
    s.released = false;
    this.client.input({ type: 'ui', ui: `leave-local:${source}` });
  }

  start(pollMs = 16): void {
    const w = this.win;
    w.addEventListener('keydown', this.onKey);
    w.addEventListener('keyup', this.onKey);
    w.addEventListener('blur', this.onBlur);
    w.addEventListener('gamepadconnected', this.onPad as EventListener);
    w.addEventListener('gamepaddisconnected', this.onPad as EventListener);
    this.last = performance.now();
    this.timer = setInterval(() => this.poll(), pollMs);
  }

  stop(): void {
    const w = this.win;
    w.removeEventListener('keydown', this.onKey);
    w.removeEventListener('keyup', this.onKey);
    w.removeEventListener('blur', this.onBlur);
    w.removeEventListener('gamepadconnected', this.onPad as EventListener);
    w.removeEventListener('gamepaddisconnected', this.onPad as EventListener);
    clearInterval(this.timer);
  }

  private add(source: number, kind: LocalSourceView['kind'], label: string): Source {
    const s: Source = {
      view: { source, kind, label, connected: true, claimed: false, left: false, sittingOut: false, identifyHeld: false, used: [] },
      axes: [0, 0, 0, 0],
      buttons: 0,
      seq: 0,
      holdSince: null,
      released: false,
    };
    this.sources.set(source, s);
    return s;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.keysOn || e.ctrlKey || e.metaKey || e.altKey || !this.clusterKeys.has(e.code)) return;
    e.preventDefault();
    // The helper reads this keyboard by device: the browser's copy of the same keys must not drive a cluster too.
    if (this.helper.owns('keyboard')) return void this.keys.clear();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
    // Preserve the Identify edge even when a busy renderer queues down and up before the next polling timer.
    // Periodic samples still refresh held controls; the discrete press and release are sent when they arrive.
    const identifyCluster = clusters.find(c => c.identify === e.code);
    if (identifyCluster && !e.repeat) this.sampleCluster(identifyCluster, 0, performance.now());
    const cluster = clusters.find(c => c.ready === e.code);
    if (cluster && e.type === 'keyup') this.readyEvents.delete(cluster.id);
    if (cluster && this.client.room?.phase === 'Lobby' && !e.repeat) {
      const confirmed = this.lobbyPicks.get(cluster.id)?.confirmed === true;
      if (e.type === 'keydown' && confirmed) this.readyEvents.add(cluster.id);
      // Sample the press/release immediately for joining and confirmation; Ready itself takes the reliable UI lane.
      this.sampleCluster(cluster, 0, performance.now());
      if (e.type === 'keydown' && confirmed) this.ready(cluster.id);
    }
  };

  /** A window that loses focus never sees the key-ups: release everything. */
  private readonly onBlur = (): void => { this.keys.clear(); this.readyEvents.clear(); };

  private readonly onPad = (e: GamepadEvent): void => {
    const source = map.padSourceBase + e.gamepad.index;
    const s = this.sources.get(source) ?? this.add(source, 'pad', `Pad ${e.gamepad.index + 1}`);
    if (e.type === 'gamepadconnected') {
      s.view.connected = true;
      s.view.label = `Pad ${e.gamepad.index + 1}`;
      return;
    }
    s.view.connected = false;
    if (s.view.claimed) this.send(s, [0, 0, 0, 0], LOCAL_UNAVAILABLE);
  };

  /** One sampling pass: every connected source's sticks and buttons. */
  poll(now = performance.now()): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const helperKeys = this.helper.owns('keyboard');
    const helperPads = this.helper.owns('pad');
    for (const c of clusters) {
      const s = this.sources.get(c.id);
      if (s) s.view.helperOwned = helperKeys || undefined;
      if (!helperKeys) this.sampleCluster(c, dt, now);
    }
    this.pollHelper(dt, now);
    const pads = this.win.navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad?.connected) continue;
      const source = map.padSourceBase + pad.index;
      const s = this.sources.get(source) ?? this.add(source, 'pad', `Pad ${pad.index + 1}`);
      if (!s.view.connected) continue;
      s.view.helperOwned = helperPads || undefined;
      if (helperPads) continue;
      s.padId = pad.id;
      if (s.cal) {
        const step = s.cal.sample(pad.axes, pad.buttons, now);
        s.view.calibrating = { step, prompt: CAL_PROMPTS[step] };
        if (step === 'done') {
          if (s.cal.profile) this.keep(pad.id, s.cal.profile);
          s.cal = undefined;
          s.view.calibrating = undefined;
          s.awaitRelease = true;
        }
        if (s.view.claimed) this.update(s, [0, 0, 0, 0], false, false, now);
        continue;
      }
      const prof = profileFor(pad, this.saved);
      if (prof) {
        const w = wheelSample(pad, prof);
        if (s.awaitRelease) {
          if (w.axes.some((v) => v !== 0) || w.identify || w.ready) continue;
          s.awaitRelease = false;
        }
        s.view.kind = 'wheel';
        s.view.label = `${prof.label} (wheel ${pad.index + 1})`;
        s.view.needsMapping = false;
        s.view.wheel = {
          profile: prof.label,
          verified: prof.verified,
          steer: w.axes[2],
          throttle: pedal(pad.axes[prof.throttle.axis], prof.throttle),
          brake: pedal(pad.axes[prof.brake.axis], prof.brake),
        };
        this.update(s, w.axes, w.identify, w.ready, now);
        continue;
      }
      // An unmapped non-standard device resting off centre (pedals at +1 or −1) waits for mapping.
      if (pad.mapping !== 'standard' && !s.view.claimed && pad.axes.some((v) => Math.abs(v) > 0.5)) {
        s.view.needsMapping = true;
        continue;
      }
      s.view.needsMapping = false;
      const [dx, dy] = deadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), map.padDeadzone);
      const [ax, ay] = deadzone(pad.axes[2] ?? 0, -(pad.axes[3] ?? 0), map.padDeadzone);
      const identify = pad.buttons[8]?.pressed ?? false;
      const ready = pad.buttons[9]?.pressed ?? false;
      this.update(s, [dx, dy, ax, ay], identify, ready, now);
    }
  }

  /** The helper's devices (P1-C12.1): keyboards through Keys A's layout, pads like the browser's standard pads. */
  private pollHelper(dt: number, now: number): void {
    const devices = this.helper.capturing() ? this.helper.devices() : [];
    const live = new Set<number>();
    let keyboards = 0;
    let padsSeen = 0;
    for (const d of devices) {
      const source = helperSourceBase + d.id;
      live.add(source);
      const label = d.kind === 'keyboard' ? `Keyboard ${++keyboards}` : `Pad ${++padsSeen}`;
      const s = this.sources.get(source) ?? this.add(source, d.kind === 'keyboard' ? 'keys' : 'pad', label);
      s.view.helper = true;
      s.view.label = `${label} · ${d.name}`;
      if (!d.connected) {
        this.unplug(s);
        continue;
      }
      s.view.connected = true;
      this.sampleHelper(s, d, dt, now);
    }
    for (const s of this.sources.values()) if (s.view.helper && !live.has(s.view.source)) this.unplug(s);
  }

  private sampleHelper(s: Source, d: HelperDevice, dt: number, now: number): void {
    if (d.kind === 'keyboard') {
      if (this.keysOn) this.sampleKeys(s, clusters[0]!, this.helper.heldKeys(d.id), dt, now);
      return;
    }
    const p = this.helper.pad(d.id);
    if (!p) return;
    const [dx, dy] = deadzone(p.axes[0], -p.axes[1], map.padDeadzone);
    const [ax, ay] = deadzone(p.axes[2], -p.axes[3], map.padDeadzone);
    this.update(s, [dx, dy, ax, ay], (p.buttons & (1 << 8)) !== 0, (p.buttons & (1 << 9)) !== 0, now);
  }

  /** A source that went away: neutral at once and its car to the autopilot after the dropout time (as a pad unplug). */
  private unplug(s: Source): void {
    if (!s.view.connected) return;
    s.view.connected = false;
    if (s.view.claimed) this.send(s, [0, 0, 0, 0], LOCAL_UNAVAILABLE);
  }

  /** A helper keyboard's Ready key in the Lobby goes out on its edge (as the browser cluster's keydown does). */
  private onHelperKeys(id: number, down: Set<string>, before: Set<string>): void {
    const source = helperSourceBase + id;
    const c = clusters[0]!;
    const s = this.sources.get(source);
    const was = before.has(c.ready);
    const is = down.has(c.ready);
    if (was && !is) this.readyEvents.delete(source);
    if (!s || !this.keysOn || was === is || this.client.room?.phase !== 'Lobby') return;
    const confirmed = this.lobbyPicks.get(source)?.confirmed === true;
    if (is && confirmed) this.readyEvents.add(source);
    this.sampleKeys(s, c, down, 0, performance.now());
    if (is && confirmed) this.ready(source);
  }

  private sampleCluster(c: Cluster, dt: number, now: number): void {
    const s = this.sources.get(c.id);
    if (!s) return;
    this.sampleKeys(s, c, this.keys, dt, now);
  }

  private sampleKeys(s: Source, c: Cluster, keys: Set<string>, dt: number, now: number): void {
    const k = (code: string) => (keys.has(code) ? 1 : 0);
    // R116 (P1-C11): the cluster's "drive" keys are throttle and brake (up, down) and STEER (left, right, on the right stick's x
    // axis); its "action" keys are the forward and back flick (up,
    // down, on the right stick's y axis); the left stick's x axis is nothing (R128, no drift). Steering is rate-shaped: the axis ramps toward the keys, full lock in
    // 1/steerRatePerS s. Launch: hold the brake key, then release it as the throttle key goes down (a snap from -1 to +1).
    const target = k(c.drive.right) - k(c.drive.left);
    const step = map.steerRatePerS * dt;
    const steer = s.axes[2] + Math.max(-step, Math.min(step, target - s.axes[2]));
    const y = k(c.drive.up) - k(c.drive.down);
    const flick = k(c.action.up) - k(c.action.down);
    this.update(s, [0, y, steer, flick], keys.has(c.identify), keys.has(c.ready), now);
  }

  private update(s: Source, axes: Axes, identify: boolean, ready: boolean, now: number): void {
    s.axes = axes;
    const lobbyReady = this.lobbyChoice(s, axes, ready);
    let buttons = (identify ? LOCAL_IDENTIFY : 0) | (lobbyReady ? LOCAL_READY : 0);
    // Identify + READY held together for leaveHoldMs: Leave.
    if (identify && ready) {
      s.holdSince ??= now;
      if (now - s.holdSince >= map.leaveHoldMs) buttons |= LOCAL_LEAVE;
    } else {
      s.holdSince = null;
    }
    const identifyChanged = s.view.identifyHeld !== identify;
    s.view.identifyHeld = identify;
    if (identifyChanged) window.dispatchEvent(new Event('jj-local-controls'));
    this.trackUse(s, axes, now);
    const pressed = axes.some((v) => Math.abs(v) > 0.001) || buttons !== 0 || ready;
    if (!s.view.claimed && !pressed) return;
    s.view.claimed = true;
    // After leaving: letting go, then pressing again, is a new player (the worker gives it a new seat).
    if (s.view.left) {
      if (!pressed) s.released = true;
      else if (s.released) Object.assign(s.view, { left: false, sittingOut: false, used: [] }), (s.released = false);
    }
    if (buttons & LOCAL_LEAVE) Object.assign(s.view, { left: true, sittingOut: false }), (s.released = false);
    this.send(s, axes, buttons);
  }

  /** Which of the six controls this source has used (steer, go, brake, launch, OI!, cone): the card folds at all of them. */
  private trackUse(s: Source, axes: Axes, now: number): void {
    if (!s.view.claimed || s.view.left) return;
    const used = s.view.used;
    const mark = (id: string) => used.includes(id) || used.push(id);
    const [, y, steer, flick] = axes;
    if (Math.abs(steer) > 0.7) mark('steer');
    if (y > 0.7) mark('go');
    if (y < -0.7) mark('brake');
    if (flick > 0.7) mark('oi');
    if (flick < -0.7) mark('cone');
    if (y < -0.9) {
      s.pulledAt ??= now;
      s.pullReleasedAt = undefined;
    }
    else {
      if (s.pulledAt !== undefined) s.pullReleasedAt ??= now;
      if (s.pulledAt !== undefined && now - s.pulledAt >= 350 && y > 0.7) mark('launch');
      // Keyboard axes ramp through neutral on their way from brake to throttle. Keep the pull through
      // that transition; otherwise it is forgotten before the forward sample can tick off Launch.
      if (y > 0.7 || (s.pullReleasedAt !== undefined && now - s.pullReleasedAt > 600)) {
        s.pulledAt = undefined;
        s.pullReleasedAt = undefined;
      }
    }
  }

  private send(s: Source, axes: Axes, buttons: number): void {
    s.seq = (s.seq + 1) & 0xffff;
    this.client.input({
      type: 'local',
      source: s.view.source,
      axes: [q(axes[0]), q(axes[1]), q(axes[2]), q(axes[3])],
      buttons,
      seq: s.seq,
      sampledAt: performance.timeOrigin + performance.now(),
    });
  }
}
