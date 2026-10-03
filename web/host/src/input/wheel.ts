// Steering wheels with pedals as host players (P1-C05.2, R109). A wheel is a Gamepad API device mapped by a profile
// (`wheels.json`, or one saved by calibration for that device) onto the same two sticks as a pad: DRIVE x is steering,
// DRIVE y is accelerator minus brake, and buttons make the ACTION stick (boost right, drift left, OI! up, cone down).
// So the worker, jj-input and the sim see a wheel exactly as they see a pad (source-blind, R80).
import data from './wheels.json';

export type Axes = [number, number, number, number];

export interface PedalSpec {
  axis: number;
  /** The axis value with the pedal released and fully pressed (−1..1). */
  rest: number;
  full: number;
}

export interface WheelProfile {
  id: string;
  label: string;
  /** Shipped profiles match USB ids; a calibrated one matches the exact Gamepad id string. */
  match: { vendor?: string; products?: string[]; id?: string };
  steer: { axis: number; invert?: boolean };
  throttle: PedalSpec;
  brake: PedalSpec;
  buttons: Partial<Record<WheelButton, number>>;
  /** Confirmed on a device (calibrated or checked); a shipped guess is false. */
  verified: boolean;
  note?: string;
}

export type WheelButton = 'boost' | 'drift' | 'oi' | 'cone' | 'identify' | 'ready';

/** The slice of a Gamepad this reads (so tests and traces can feed plain objects). */
export interface PadLike {
  id: string;
  index: number;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

export const STORE_KEY = 'jj.wheelProfiles.v1';
const shipped = data.profiles as WheelProfile[];

/** USB vendor and product ids from a Gamepad id: Chromium's "… (Vendor: 046d Product: c24f)" or Firefox's "046d-c24f-…". */
export function usbIds(id: string): { vendor: string; product: string } | null {
  const m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id) ?? /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id);
  return m?.[1] && m[2] ? { vendor: m[1].toLowerCase(), product: m[2].toLowerCase() } : null;
}

/** Profiles saved by calibration, by Gamepad id (empty when storage is blocked). */
export function savedProfiles(store: Storage | undefined = globalThis.localStorage): Record<string, WheelProfile> {
  try {
    return JSON.parse(store?.getItem(STORE_KEY) ?? '{}') as Record<string, WheelProfile>;
  } catch {
    return {};
  }
}

export function saveProfile(padId: string, p: WheelProfile, store: Storage | undefined = globalThis.localStorage): boolean {
  try {
    const all = savedProfiles(store);
    all[padId] = p;
    store?.setItem(STORE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** The profile for a device: one saved for it first, then a shipped one matching its USB ids, else none (a pad). */
export function profileFor(pad: PadLike, saved = savedProfiles()): WheelProfile | null {
  const mine = saved[pad.id];
  if (mine) return mine;
  const ids = usbIds(pad.id);
  if (!ids) return null;
  return shipped.find((p) => p.match.vendor === ids.vendor && p.match.products?.includes(ids.product)) ?? null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** An axis value, 0 if the device has no such axis. */
const ax = (a: readonly number[], i: number) => a[i] ?? 0;

/** A pedal's travel 0 (released) .. 1 (full), past the pedal deadzone. */
export function pedal(v: number | undefined, spec: PedalSpec, dz = data.pedalDeadzone): number {
  if (v === undefined || spec.full === spec.rest) return 0;
  const t = clamp01((v - spec.rest) / (spec.full - spec.rest));
  return t <= dz ? 0 : (t - dz) / (1 - dz);
}

/** One wheel sample as the two sticks (−1..1) plus Identify and READY. */
export function wheelSample(pad: PadLike, p: WheelProfile): { axes: Axes; identify: boolean; ready: boolean } {
  const raw = ax(pad.axes, p.steer.axis) * (p.steer.invert ? -1 : 1);
  const steer = Math.abs(raw) <= data.steerDeadzone ? 0 : Math.max(-1, Math.min(1, raw));
  const drive = pedal(pad.axes[p.throttle.axis], p.throttle) - pedal(pad.axes[p.brake.axis], p.brake);
  const b = (k: WheelButton) => {
    const i = p.buttons[k];
    return i !== undefined && (pad.buttons[i]?.pressed ?? false) ? 1 : 0;
  };
  return { axes: [steer, drive, b('boost') - b('drift'), b('oi') - b('cone')], identify: b('identify') === 1, ready: b('ready') === 1 };
}

// ---- calibration: maps an unknown wheel in a few prompts and saves the profile for that device ----

export type CalStep = 'centre' | 'left' | 'right' | 'throttle' | 'brake' | WheelButton | 'done';
export const CAL_STEPS: CalStep[] = ['centre', 'left', 'right', 'throttle', 'brake', 'boost', 'drift', 'oi', 'cone', 'identify', 'ready', 'done'];
export const CAL_PROMPTS: Record<CalStep, string> = {
  centre: 'Centre the wheel and let go of the pedals',
  left: 'Turn the wheel fully left',
  right: 'Turn the wheel fully right',
  throttle: 'Press the accelerator all the way',
  brake: 'Press the brake all the way',
  boost: 'Press the button for boost (or Skip)',
  drift: 'Press the button for drift (or Skip)',
  oi: 'Press the button for OI! (or Skip)',
  cone: 'Press the button for dropping a cone (or Skip)',
  identify: 'Press the button for Identify (or Skip)',
  ready: 'Press the button for READY (or Skip)',
  done: 'Mapped',
};
/** An axis step registers once one axis has moved this far from centre (of its −1..1 range) and held for HOLD_MS. */
const AXIS_MOVE = 0.6;
const HOLD_MS = 250;

/** Walks the prompts as the wheel moves; `profile` is set at 'done'. */
export class Calibration {
  step: CalStep = 'centre';
  profile: WheelProfile | null = null;
  private base: number[] = [];
  private since: number | null = null;
  private candidate = -1;
  private steer = { axis: -1, left: 0 };
  private pedals: Partial<Record<'throttle' | 'brake', PedalSpec>> = {};
  private buttons: Partial<Record<WheelButton, number>> = {};
  private held = new Set<number>();

  constructor(private readonly pad: { id: string }) {}

  /** Feeds one sample; returns the step it's on afterwards. */
  sample(axes: readonly number[], buttons: readonly { pressed: boolean }[], now: number): CalStep {
    const pressed = buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0);
    switch (this.step) {
      case 'centre':
        // Still for HOLD_MS: that's the rest pose every later step is measured from.
        if (this.since === null || axes.some((v, i) => Math.abs(v - (this.base[i] ?? v)) > 0.02)) {
          this.base = [...axes];
          this.since = now;
        } else if (now - this.since >= HOLD_MS) this.next();
        break;
      case 'left':
      case 'right':
      case 'throttle':
      case 'brake': {
        const taken = new Set([this.steer.axis, this.pedals.throttle?.axis, this.pedals.brake?.axis]);
        const free = this.step === 'right' ? [this.steer.axis] : axes.map((_, i) => i).filter((i) => !taken.has(i));
        const d = (i: number) => Math.abs(ax(axes, i) - ax(this.base, i));
        let best = -1;
        for (const i of free) if (i >= 0 && (best < 0 || d(i) > d(best))) best = i;
        const moved = best >= 0 && d(best) >= AXIS_MOVE;
        if (!moved || best !== this.candidate) {
          this.candidate = moved ? best : -1;
          this.since = moved ? now : null;
          break;
        }
        if (now - (this.since ?? now) < HOLD_MS) break;
        if (this.step === 'left') this.steer = { axis: best, left: ax(axes, best) };
        else if (this.step === 'right') {
          if (Math.sign(ax(axes, best) - ax(this.base, best)) === Math.sign(this.steer.left - ax(this.base, best))) break; // same way: not right
        } else this.pedals[this.step] = { axis: best, rest: round(ax(this.base, best)), full: round(ax(axes, best)) };
        this.next();
        break;
      }
      case 'done':
        break;
      default: {
        // A button step: a fresh press (not one still held from before) of a button not already used.
        const used = new Set(Object.values(this.buttons));
        const fresh = pressed.find((i) => !this.held.has(i) && !used.has(i));
        this.held = new Set(pressed);
        if (fresh !== undefined) {
          this.buttons[this.step] = fresh;
          this.next();
        }
      }
    }
    return this.step;
  }

  /** The prompt's Skip: a button step without a button. */
  skip(): void {
    if (CAL_STEPS.indexOf(this.step) >= CAL_STEPS.indexOf('boost') && this.step !== 'done') this.next();
  }

  private next(): void {
    this.step = CAL_STEPS[CAL_STEPS.indexOf(this.step) + 1] ?? 'done';
    this.since = null;
    this.candidate = -1;
    if (this.step === 'done') {
      const { throttle, brake } = this.pedals;
      if (!throttle || !brake || this.steer.axis < 0) return;
      this.profile = {
        id: 'calibrated',
        label: this.pad.id.replace(/\s*\(.*\)\s*$/, '').slice(0, 40) || 'Wheel',
        match: { id: this.pad.id },
        // Steering reads −1 at full left once mapped: invert if this axis went positive turning left.
        steer: { axis: this.steer.axis, invert: this.steer.left > (this.base[this.steer.axis] ?? 0) },
        throttle,
        brake,
        buttons: this.buttons,
        verified: true,
        note: 'Calibrated on this device.',
      };
    }
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
