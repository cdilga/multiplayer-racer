// Host pads and keyboard clusters as players (P1-C05). Each is a local source the worker interprets with the same
// jj-input path as a phone (source-blind DriveIntent): this module only samples sticks and buttons and sends
// `LocalSource{source, axes, buttons, seq}` (plan §4.4).
// - Claim-by-press: a source sends nothing until its first press, so a plugged-in pad or an idle keyboard never
//   makes a phantom seat. From then on it sends every poll while connected.
// - Pads use the standard mapping: left stick DRIVE, right stick ACTION, View/Select = Identify, Start = READY.
//   Key clusters come from `clusters.json` (data). Holding Identify + READY for `leaveHoldMs` leaves the seat.
// - Digital steering is rate-shaped (keys ramp the DRIVE x axis); everything else is immediate.
// - An unplugged pad sends one `LOCAL_UNAVAILABLE` sample and goes quiet: neutral at once, its car to the autopilot
//   after the worker's dropout time, and back when it's plugged in and pressed again.
import map from './clusters.json';
import type { SimClient } from '../worker/client';
import { LOCAL_IDENTIFY, LOCAL_LEAVE, LOCAL_READY, LOCAL_UNAVAILABLE } from '../worker/messages';

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
  kind: 'pad' | 'keys';
  label: string;
  connected: boolean;
  /** Pressed at least once: it has (or had) a seat. */
  claimed: boolean;
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

  private add(source: number, kind: 'pad' | 'keys', label: string): Source {
    const s: Source = {
      view: { source, kind, label, connected: true, claimed: false },
      axes: [0, 0, 0, 0],
      buttons: 0,
      seq: 0,
      holdSince: null,
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
    const target = k(c.drive.right) - k(c.drive.left);
    // Rate-shaped steering: the DRIVE x axis ramps toward the keys, full lock in 1/steerRatePerS s.
    const step = map.steerRatePerS * dt;
    const x = s.axes[0] + Math.max(-step, Math.min(step, target - s.axes[0]));
    const y = k(c.drive.up) - k(c.drive.down);
    const ax = k(c.action.right) - k(c.action.left);
    const ay = k(c.action.up) - k(c.action.down);
    this.update(s, [x, y, ax, ay], this.keys.has(c.identify), this.keys.has(c.ready), now);
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
