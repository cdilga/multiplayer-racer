// The controller preference record as pure data (P1-C07, C07.2): types, defaults, the response presets and the sanitiser
// that turns anything stored into a valid record, field by field. No DOM, no wasm: settings.ts builds the sheet on top, and
// tests import this directly.
export type Layout = 'floating' | 'fixed';
export type Steering = 'gentle' | 'direct';
/** The stick layout: R116 two sticks (default) or the old one-stick layout (steer on the left stick, the right stick's sectors). */
export type Controls = 'dual' | 'classic';
export type CameraDistance = 'near' | 'host' | 'far';
export type TiltDeadzone = 'small' | 'medium' | 'large';
export type TiltSensitivity = 'gentle' | 'normal' | 'sharp';

export interface ControllerPreferences {
  v: 1;
  layout: Layout;
  controls: Controls;
  steering: Steering;
  cameraDistance: CameraDistance;
  vibration: boolean;
  reducedMotion: boolean;
  /** Full screen and a screen wake lock where the phone allows it (R101). */
  keepAwake: boolean;
  remember: boolean;
  /** Tilt steering (R109): off by default, opt-in; replaces only the DRIVE steer axis. */
  tilt: boolean;
  tiltDeadzone: TiltDeadzone;
  tiltSensitivity: TiltSensitivity;
  /** The roll (degrees, clockwise) that means straight ahead on this device. */
  tiltNeutral: number;
}

export const DEFAULTS: ControllerPreferences = {
  v: 1,
  layout: 'floating',
  controls: 'dual',
  steering: 'gentle',
  cameraDistance: 'host',
  vibration: true,
  reducedMotion: false,
  keepAwake: true,
  remember: true,
  tilt: false,
  tiltDeadzone: 'medium',
  tiltSensitivity: 'normal',
  tiltNeutral: 0,
};

/** The approved response presets: dead zone and exponent for `apply_curve`. Both are monotonic and reach 1 at full deflection. */
export const PRESETS: Record<Steering, { deadzone: number; gamma: number }> = {
  gentle: { deadzone: 0.06, gamma: 1.5 },
  direct: { deadzone: 0.03, gamma: 1 },
};

const oneOf = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** A stored (or any) value read back into a valid record: each unknown or invalid field takes its default. */
export function sanitise(raw: unknown): ControllerPreferences {
  const r = raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 1 ? (raw as Record<string, unknown>) : {};
  return {
    v: 1,
    layout: oneOf(r.layout, ['floating', 'fixed'], DEFAULTS.layout),
    controls: oneOf(r.controls, ['dual', 'classic'], DEFAULTS.controls),
    steering: oneOf(r.steering, ['gentle', 'direct'], DEFAULTS.steering),
    cameraDistance: oneOf(r.cameraDistance, ['near', 'host', 'far'], DEFAULTS.cameraDistance),
    vibration: bool(r.vibration, DEFAULTS.vibration),
    reducedMotion: bool(r.reducedMotion, DEFAULTS.reducedMotion),
    keepAwake: bool(r.keepAwake, DEFAULTS.keepAwake),
    remember: bool(r.remember, DEFAULTS.remember),
    tilt: bool(r.tilt, DEFAULTS.tilt),
    tiltDeadzone: oneOf(r.tiltDeadzone, ['small', 'medium', 'large'], DEFAULTS.tiltDeadzone),
    tiltSensitivity: oneOf(r.tiltSensitivity, ['gentle', 'normal', 'sharp'], DEFAULTS.tiltSensitivity),
    tiltNeutral: typeof r.tiltNeutral === 'number' && Number.isFinite(r.tiltNeutral) && Math.abs(r.tiltNeutral) <= 180 ? r.tiltNeutral : DEFAULTS.tiltNeutral,
  };
}

