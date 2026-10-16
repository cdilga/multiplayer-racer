// The controller preference record as pure data (P1-C07, C07.2): types, defaults, the response presets and the sanitiser
// that turns anything stored into a valid record, field by field. No DOM, no wasm: settings.ts builds the sheet on top, and
// tests import this directly.
export type Layout = 'floating' | 'fixed';
export type Steering = 'gentle' | 'direct';
/** The stick layout: R116 two sticks (default), the old one-stick layout (steer on the left stick, the right stick's
 *  sectors) or R130's Buttons (a steer stick and on-screen buttons, [`ButtonsLayout`]). */
export type Controls = 'dual' | 'classic' | 'buttons';
/** The inputs the Buttons layout can give a button (R130): Gas, Brake/Reverse, Boost, Fire (forward) and Drop (back). */
export type ButtonInput = 'gas' | 'brake' | 'boost' | 'fire' | 'drop';
export const BUTTON_INPUTS: readonly ButtonInput[] = ['gas', 'brake', 'boost', 'fire', 'drop'];
/** A slot on the six-slot pad (0..5, row-major from the top, inside to outside), or no button for that input. */
export type ButtonSlot = number | null;
/** A player's Buttons layout: the steer stick's side and where each input's button sits. */
export interface ButtonsLayout {
  steer: 'left' | 'right';
  slots: Record<ButtonInput, ButtonSlot>;
}
export const DEFAULT_BUTTONS: ButtonsLayout = {
  steer: 'left',
  slots: { gas: 5, brake: 4, boost: 2, fire: 1, drop: 0 },
};
/** Learner assist (R125): Off, Some (steering and brake help) or Lots (auto-throttle too). */
export type Assist = 'off' | 'some' | 'lots';
export type CameraDistance = 'near' | 'host' | 'far';
export type TiltDeadzone = 'small' | 'medium' | 'large';
export type TiltSensitivity = 'gentle' | 'normal' | 'sharp';

export interface ControllerPreferences {
  v: 1;
  layout: Layout;
  controls: Controls;
  /** The Buttons layout's arrangement (used when `controls` is `buttons`). */
  buttons: ButtonsLayout;
  steering: Steering;
  cameraDistance: CameraDistance;
  assist: Assist;
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
  buttons: DEFAULT_BUTTONS,
  steering: 'gentle',
  cameraDistance: 'host',
  assist: 'off',
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
    controls: oneOf(r.controls, ['dual', 'classic', 'buttons'], DEFAULTS.controls),
    buttons: sanitiseButtons(r.buttons),
    steering: oneOf(r.steering, ['gentle', 'direct'], DEFAULTS.steering),
    cameraDistance: oneOf(r.cameraDistance, ['near', 'host', 'far'], DEFAULTS.cameraDistance),
    assist: oneOf(r.assist, ['off', 'some', 'lots'], DEFAULTS.assist),
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


/** A stored Buttons layout read back: the side, and each input's slot (0..5, each slot used once; a clash keeps the first
 *  input in `BUTTON_INPUTS` order and leaves the other without a button). No stored slots: the default. */
export function sanitiseButtons(raw: unknown): ButtonsLayout {
  const r = raw && typeof raw === 'object' ? (raw as { steer?: unknown; slots?: unknown }) : null;
  if (!r || !r.slots || typeof r.slots !== 'object') return structuredClone(DEFAULT_BUTTONS);
  const stored = r.slots as Record<string, unknown>;
  const used = new Set<number>();
  const slots = {} as Record<ButtonInput, ButtonSlot>;
  for (const k of BUTTON_INPUTS) {
    const v = stored[k];
    const ok = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 6 && !used.has(v);
    slots[k] = ok ? v : null;
    if (ok) used.add(v);
  }
  return { steer: r.steer === 'right' ? 'right' : 'left', slots };
}
