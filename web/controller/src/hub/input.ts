// Pad and key-cluster sampling for the hub (P1-C08). The mapping is the host's (P1-C05): standard pads (left stick DRIVE,
// right stick ACTION, View/Select = Identify, Start = READY) and the key clusters in the host's `clusters.json`
// (KeyboardEvent.code, so layouts don't matter). Output is the screen's convention the controller session takes: y is
// DOWN-positive. Pure and DOM-free so the journey and node tests can drive it.
import map from '../../../host/src/input/clusters.json';

export interface Axes2 {
  x: number;
  y: number;
}

export interface Sample {
  drive: Axes2;
  action: Axes2;
  identify: boolean;
  ready: boolean;
}

export const NEUTRAL: Sample = { drive: { x: 0, y: 0 }, action: { x: 0, y: 0 }, identify: false, ready: false };

interface Stick {
  up: string;
  down: string;
  left: string;
  right: string;
}
export interface Cluster {
  id: number;
  label: string;
  drive: Stick;
  action: Stick;
  identify: string;
  ready: string;
}

export const CLUSTERS = map.clusters as Cluster[];
export const LEAVE_HOLD_MS = map.leaveHoldMs;
const PAD_DEADZONE = map.padDeadzone;
const STEER_RATE = map.steerRatePerS;

/** A stick past the radial dead zone, rescaled so the edge of the dead zone reads 0. */
function deadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

export interface PadLike {
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value?: number }>;
  mapping?: string;
}

/** A standard-mapping pad's sample. Non-standard devices (wheels, odd HID) aren't hub sources: they're mapped on the host (C05.2). */
export function padSample(p: PadLike): Sample {
  const [dx, dy] = deadzone(p.axes[0] ?? 0, p.axes[1] ?? 0, PAD_DEADZONE);
  const [ax, ay] = deadzone(p.axes[2] ?? 0, p.axes[3] ?? 0, PAD_DEADZONE);
  return { drive: { x: dx, y: dy }, action: { x: ax, y: ay }, identify: p.buttons[8]?.pressed ?? false, ready: p.buttons[9]?.pressed ?? false };
}

/** Whether a sample is a deliberate press (a button, or a stick well past its dead zone): claim-by-press. */
export function isPress(s: Sample): boolean {
  return s.identify || s.ready || Math.hypot(s.drive.x, s.drive.y) > 0.5 || Math.hypot(s.action.x, s.action.y) > 0.5;
}

/** One key cluster: held keys in, a sample out. Digital steering ramps (keys can't hold half a stick). */
export class KeyCluster {
  private held = new Set<string>();
  private steer = 0;
  private last = 0;
  constructor(readonly cluster: Cluster) {}

  /** Whether `code` belongs to this cluster. */
  owns(code: string): boolean {
    const c = this.cluster;
    return [...Object.values(c.drive), ...Object.values(c.action), c.identify, c.ready].includes(code);
  }

  key(code: string, down: boolean): void {
    if (!this.owns(code)) return;
    if (down) this.held.add(code);
    else this.held.delete(code);
  }

  /** Nothing is held (a lost window focus lets go of every key). */
  releaseAll(): void {
    this.held.clear();
    this.steer = 0;
  }

  sample(nowMs: number): Sample {
    const c = this.cluster;
    const h = (k: string) => (this.held.has(k) ? 1 : 0);
    const dt = this.last ? Math.min(100, nowMs - this.last) / 1000 : 0;
    this.last = nowMs;
    const want = h(c.drive.right) - h(c.drive.left);
    const step = STEER_RATE * dt;
    this.steer = want === 0 ? 0 : Math.max(-1, Math.min(1, this.steer + Math.sign(want) * step));
    return {
      drive: { x: this.steer, y: h(c.drive.down) - h(c.drive.up) },
      action: { x: h(c.action.right) - h(c.action.left), y: h(c.action.down) - h(c.action.up) },
      identify: this.held.has(c.identify),
      ready: this.held.has(c.ready),
    };
  }
}
