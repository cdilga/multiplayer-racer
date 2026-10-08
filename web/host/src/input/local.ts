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
import map from './clusters.json';
import type { SimClient } from '../worker/client';
import { LOCAL_IDENTIFY, LOCAL_LEAVE, LOCAL_READY, LOCAL_SIT_OUT, LOCAL_UNAVAILABLE } from '../worker/messages';
import { CAL_PROMPTS, Calibration, type PadLike, type WheelProfile, pedal, profileFor, saveProfile, savedProfiles, wheelSample } from './wheel';

type Axes = [number, number, number, number];
type Stick = { up: string; down: string; left: string; right: string };
export interface Cluster {
  id: number;
  label: string;
  drive: Stick;
  action: Stick;
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
  /** Drawer requests riding on the next sample (Sit out, Leave). */
  once: number;
  /** Let go since leaving (so the next press is a new player). */
  released: boolean;
  /** A pad's Gamepad id (wheel profiles are per device). */
  padId?: string;
  cal?: Calibration;
  /** Just calibrated: the press that finished it isn't a join; everything must be let go first. */
  awaitRelease?: boolean;
}

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
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  /** Profiles saved by calibration (read once, written on save). */
  private saved: Record<string, WheelProfile> = savedProfiles();
  private readonly clusterKeys = new Set(
    clusters.flatMap((c) => [...Object.values(c.drive), ...Object.values(c.action), c.identify, c.ready]),
  );

  constructor(
    private readonly client: SimClient,
    private readonly win: Window = window,
  ) {
    for (const c of clusters) this.add(c.id, 'keys', c.label);
  }

  /** The input drawer's list: every known source, connected or not. */
  list(): LocalSourceView[] {
    return [...this.sources.values()].map((s) => ({ ...s.view }));
  }

  clusters(): Cluster[] {
    return clusters;
  }

  /** The drawer's Sit out / Return for a seated source. */
  toggleSitOut(source: number): void {
    const s = this.sources.get(source);
    if (!s?.view.claimed || s.view.left) return;
    s.once |= LOCAL_SIT_OUT;
    s.view.sittingOut = !s.view.sittingOut;
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
    s.once |= LOCAL_LEAVE;
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
      view: { source, kind, label, connected: true, claimed: false, left: false, sittingOut: false },
      axes: [0, 0, 0, 0],
      buttons: 0,
      seq: 0,
      holdSince: null,
      once: 0,
      released: false,
    };
    this.sources.set(source, s);
    return s;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || !this.clusterKeys.has(e.code)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  /** A window that loses focus never sees the key-ups: release everything. */
  private readonly onBlur = (): void => this.keys.clear();

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
    for (const c of clusters) this.sampleCluster(c, dt, now);
    const pads = this.win.navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad?.connected) continue;
      const source = map.padSourceBase + pad.index;
      const s = this.sources.get(source) ?? this.add(source, 'pad', `Pad ${pad.index + 1}`);
      if (!s.view.connected) continue;
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

  private sampleCluster(c: Cluster, dt: number, now: number): void {
    const s = this.sources.get(c.id);
    if (!s) return;
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    // R116 (P1-C11): the cluster's "drive" keys are throttle and brake (up, down) and STEER (left, right, on the right stick's x
    // axis); its "action" keys are the drift (left, right, on the left stick's x axis) and the forward and back flick (up,
    // down, on the right stick's y axis). Steering is rate-shaped: the axis ramps toward the keys, full lock in
    // 1/steerRatePerS s. Launch: hold the brake key, then release it as the throttle key goes down (a snap from -1 to +1).
    const target = k(c.drive.right) - k(c.drive.left);
    const step = map.steerRatePerS * dt;
    const steer = s.axes[2] + Math.max(-step, Math.min(step, target - s.axes[2]));
    const y = k(c.drive.up) - k(c.drive.down);
    const drift = k(c.action.right) - k(c.action.left);
    const flick = k(c.action.up) - k(c.action.down);
    this.update(s, [drift, y, steer, flick], this.keys.has(c.identify), this.keys.has(c.ready), now);
  }

  private update(s: Source, axes: Axes, identify: boolean, ready: boolean, now: number): void {
    s.axes = axes;
    let buttons = (identify ? LOCAL_IDENTIFY : 0) | (ready ? LOCAL_READY : 0);
    // Identify + READY held together for leaveHoldMs: Leave.
    if (identify && ready) {
      s.holdSince ??= now;
      if (now - s.holdSince >= map.leaveHoldMs) buttons |= LOCAL_LEAVE;
    } else {
      s.holdSince = null;
    }
    const pressed = axes.some((v) => Math.abs(v) > 0.001) || buttons !== 0;
    if (!s.view.claimed && !pressed) return;
    s.view.claimed = true;
    // After leaving: letting go, then pressing again, is a new player (the worker gives it a new seat).
    if (s.view.left) {
      if (!pressed) s.released = true;
      else if (s.released) Object.assign(s.view, { left: false, sittingOut: false }), (s.released = false);
    }
    buttons |= s.once;
    s.once = 0;
    if (buttons & LOCAL_LEAVE) Object.assign(s.view, { left: true, sittingOut: false }), (s.released = false);
    this.send(s, axes, buttons);
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
