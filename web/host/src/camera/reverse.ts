// The reversing camera's state machine (br-dim.4). Pure data in, data out, no three.js: a fixture steps it with explicit
// dt and signed speeds and gets the same numbers every run (R90). The rig feeds it the car's signed longitudinal speed
// (m/s along the car's own forward; negative is backwards) and applies `yawRad` to the chase heading.
//
// Hysteresis, all from camera.json `reverse`: the swing starts only after the car has moved backwards faster than
// `enterMps` for `enterHoldS` (a brief tap on reverse never starts it; a slower or shorter dip resets the timer), and
// ends only after it has gone forward faster than `exitMps` for `exitHoldS`. The swing itself is a smoothstep over
// `blendS` seconds (zero slope at both ends, so it neither snaps nor whips), and reverses part-way if the decision flips.

export interface ReverseConfig {
  enterMps: number;
  enterHoldS: number;
  exitMps: number;
  exitHoldS: number;
  blendS: number;
}

export interface ReverseState {
  /** The camera is (or is swinging to be) behind the car, looking the way it travels. */
  reversing: boolean;
  /** 0 = chase from behind, 1 = swung right round: linear progress; the eased amount is `ease(t)`. */
  t: number;
  /** Seconds the pending enter/exit condition has held. */
  hold: number;
}

export const newReverse = (): ReverseState => ({ reversing: false, t: 0, hold: 0 });

export const ease = (t: number): number => t * t * (3 - 2 * t);

/** Advances the machine by `dt` seconds with the car's current signed speed. Mutates and returns `s`. */
export function stepReverse(s: ReverseState, signedMps: number, dt: number, cfg: ReverseConfig): ReverseState {
  if (!(dt > 0)) return s;
  if (!s.reversing) {
    s.hold = signedMps < -cfg.enterMps ? s.hold + dt : 0;
    if (s.hold >= cfg.enterHoldS) {
      s.reversing = true;
      s.hold = 0;
    }
  } else {
    s.hold = signedMps > cfg.exitMps ? s.hold + dt : 0;
    if (s.hold >= cfg.exitHoldS) {
      s.reversing = false;
      s.hold = 0;
    }
  }
  const dir = s.reversing ? 1 : -1;
  s.t = Math.min(1, Math.max(0, s.t + (dir * dt) / cfg.blendS));
  return s;
}

/** The yaw (radians) the chase adds to its heading: 0 behind the car, π looking the way a reversing car travels. */
export const reverseYaw = (s: ReverseState): number => Math.PI * ease(s.t);
