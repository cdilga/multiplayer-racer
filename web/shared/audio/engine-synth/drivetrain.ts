// A tiny deterministic drivetrain (P1-A04): ground speed + throttle -> engine rpm and gear. It exists so
// the scripted lap (which records speed and throttle, like the sim will) can drive the synth, and so
// P1-A05 has a ready mapping if the sim reports speed but no gearbox. Pure maths; no audio.
import { clamp, lerp, rpmFromSpeed } from './mapping';
import type { EngineProfile } from './types';

export interface DrivetrainOutput {
  rpm: number;
  gear: number;
  /** True while the clutch is out for a gear change. */
  shifting: boolean;
}

export interface Drivetrain {
  /** Advance by dt seconds with the car's current speed (m/s) and throttle (0..1). */
  step(dt: number, speedMps: number, throttle: number): DrivetrainOutput;
  reset(): void;
}

export function createDrivetrain(profile: EngineProfile): Drivetrain {
  const g = profile.gearbox;
  const e = profile.engine;
  const top = g.ratios.length;
  let gear = 1;
  let rpm = e.idleRpm;
  let shiftLeft = 0;

  return {
    reset() {
      gear = 1;
      rpm = e.idleRpm;
      shiftLeft = 0;
    },
    step(dt, speedMps, throttle) {
      const th = clamp(throttle, 0, 1);
      if (shiftLeft > 0) shiftLeft = Math.max(0, shiftLeft - dt);

      const wheelRpm = rpmFromSpeed(profile, Math.max(0, speedMps), gear);
      // Shift on engine speed, one gear per step, never mid-shift.
      if (shiftLeft === 0) {
        if (wheelRpm >= g.upshiftRpm && gear < top && th > 0.05) {
          gear += 1;
          shiftLeft = g.shiftTimeS;
        } else if (wheelRpm <= g.downshiftRpm && gear > 1) {
          gear -= 1;
          shiftLeft = g.shiftTimeS;
        }
      }

      // The engine follows the wheels, or the slipping clutch when pulling away, or the idle.
      const wheelTarget = rpmFromSpeed(profile, Math.max(0, speedMps), gear);
      const slip = lerp(e.idleRpm, g.launchRpm, th);
      const target = shiftLeft > 0 ? Math.max(e.idleRpm, wheelTarget) : Math.max(e.idleRpm, wheelTarget, gear === 1 ? slip : 0);
      const tau = target > rpm ? g.rpmRiseTauS : g.rpmFallTauS;
      rpm += (target - rpm) * (1 - Math.exp(-dt / tau));
      rpm = clamp(rpm, e.idleRpm, e.limiterRpm);
      return { rpm, gear, shifting: shiftLeft > 0 };
    },
  };
}
