// Tilt steering (P1-C07.2, R109): a personal, opt-in setting. Turn the phone like a wheel and the DRIVE stick's steer axis
// follows it; the two-stick layout stays, and tilt replaces ONLY that axis. R60 still stands: there is no accelerometer
// boost or flick anywhere (the ACTION stick, throttle and brake are never touched), and nothing here fires an action.
//
// The reading is the gravity vector from `devicemotion` (`accelerationIncludingGravity`), rotated into screen axes by
// `screen.orientation.angle`, so it works in landscape either way up. Android reports the reaction to gravity and iOS the
// opposite sign; the pose at calibration decides the sign, so both give "clockwise = steer right". The result goes
// through the normal compact input path (`Session.setSticks`), so it is quantised and sent like any stick.
export interface TiltSettings {
  /** Degrees of turn from neutral that read as nothing. */
  deadzoneDeg: number;
  /** Degrees of turn from neutral that read as full lock. */
  fullLockDeg: number;
}

export const DEADZONES = { small: 2, medium: 5, large: 10 } as const;
export const SENSITIVITIES = { gentle: 45, normal: 30, sharp: 20 } as const;

/** Device-frame gravity reading to screen-frame (x right, y up), for `screen.orientation.angle`. */
export function toScreen(gx: number, gy: number, angle: number): [number, number] {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return [-gy, gx];
    case 180:
      return [-gx, -gy];
    case 270:
      return [gy, -gx];
    default:
      return [gx, gy];
  }
}

/** Clockwise turn of the screen in degrees (−180..180), 0 when held upright. `sign` is +1 where "up" reads positive (Android) and −1 where it reads negative (iOS). */
export function rollDeg(gx: number, gy: number, angle: number, sign: 1 | -1): number {
  const [sx, sy] = toScreen(gx, gy, angle);
  return (Math.atan2(-sx * sign, sy * sign) * 180) / Math.PI;
}

/** The shortest signed difference of two angles in degrees. */
export const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Steer −1..1 from a roll, the neutral roll and the settings: dead zone first, then linear to full lock, clamped. */
export function steerFrom(roll: number, neutral: number, s: TiltSettings): number {
  const d = wrap(roll - neutral);
  const m = Math.abs(d);
  if (m <= s.deadzoneDeg) return 0;
  return Math.sign(d) * Math.min(1, (m - s.deadzoneDeg) / Math.max(1, s.fullLockDeg - s.deadzoneDeg));
}

/**
 * Tilt replaces the steering axis only (R116: the right stick's x; in the old one-stick layout the left stick's x): throttle,
 * brake, drift and the flicks pass through untouched.
 */
export function applyTilt<T extends { x: number; y: number; touch: boolean }>(drive: T, action: T, steer: number | null, classic = false): [T, T] {
  if (steer === null) return [drive, action];
  return classic ? [{ ...drive, x: steer }, action] : [drive, { ...action, x: steer }];
}

export type TiltState = 'off' | 'asking' | 'waiting' | 'live' | 'denied' | 'no-sensor';

interface MotionEventLike {
  accelerationIncludingGravity: { x: number | null; y: number | null } | null;
}

export class Tilt {
  state: TiltState = 'off';
  /** Current clockwise roll in degrees (null until a reading arrives). */
  roll: number | null = null;
  /** The roll that means "straight". */
  neutral = 0;
  /** +1 / −1: which way this platform reports gravity; learnt from the first reading (upright reads positive after normalising). */
  private sign: 1 | -1 = 1;
  private signed = false;
  onChange: () => void = () => {};
  private noSensorTimer: ReturnType<typeof setTimeout> | undefined;

  settings: TiltSettings;
  private readonly win: Window;

  constructor(settings: TiltSettings, win: Window = window) {
    this.settings = settings;
    this.win = win;
  }

  /** The latest steer −1..1, or null while off or without a reading. */
  get steer(): number | null {
    return this.state === 'live' && this.roll !== null ? steerFrom(this.roll, this.neutral, this.settings) : null;
  }

  private angle(): number {
    return this.win.screen?.orientation?.angle ?? 0;
  }

  private onMotion = (e: Event): void => {
    const g = (e as unknown as MotionEventLike).accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.x === undefined || g.y === undefined) return;
    if (!this.signed) {
      // Upright, the screen's "up" component of the reading is large: its sign says which convention this is.
      const [, sy] = toScreen(g.x, g.y, this.angle());
      if (Math.abs(sy) > 3) {
        this.sign = sy > 0 ? 1 : -1;
        this.signed = true;
      }
    }
    this.roll = rollDeg(g.x, g.y, this.angle(), this.sign);
    if (this.state === 'waiting') {
      clearTimeout(this.noSensorTimer);
      this.state = 'live';
    }
    this.onChange();
  };

  /** Starts listening. Call from a tap (iOS asks for motion permission only inside a user gesture). */
  async enable(): Promise<TiltState> {
    this.state = 'asking';
    const DME = (this.win as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DME) return (this.state = 'no-sensor');
    try {
      if (typeof DME.requestPermission === 'function' && (await DME.requestPermission()) !== 'granted') return (this.state = 'denied');
    } catch {
      return (this.state = 'denied');
    }
    this.win.addEventListener('devicemotion', this.onMotion);
    this.state = 'waiting';
    // A device with the API but no sensor (most laptops) never fires an event.
    this.noSensorTimer = setTimeout(() => {
      if (this.state === 'waiting') {
        this.state = 'no-sensor';
        this.win.removeEventListener('devicemotion', this.onMotion);
        this.onChange();
      }
    }, 1500);
    return this.state;
  }

  disable(): void {
    clearTimeout(this.noSensorTimer);
    this.win.removeEventListener('devicemotion', this.onMotion);
    this.state = 'off';
    this.roll = null;
    this.onChange();
  }

  /** "Set neutral": whatever the phone reads now is straight ahead. Returns the neutral roll, or null without a reading. */
  calibrate(): number | null {
    if (this.roll === null) return null;
    this.neutral = this.roll;
    this.onChange();
    return this.neutral;
  }
}
