// State -> layer targets (P1-A04). A pure function of the profile and the state: no audio, no time, no
// randomness, so tests and the gallery's meters read exactly what the voice is told to do.
import { SURFACES } from './types';
import type { EngineProfile, LayerLevels, Surface, VoiceState } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Geometric interpolation: equal steps in t are equal musical intervals. */
export const elerp = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);
export const smoothstep = (lo: number, hi: number, v: number): number => {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

export const DEFAULT_STATE: Readonly<VoiceState> = Object.freeze({
  rpm: 0,
  throttle: 0,
  boost: 0,
  drift: 0,
  surface: 'tarmac' as Surface,
  damage: 0,
  gear: 0,
  ignition: true,
});

/** Ground speed implied by engine speed in a gear (0 in neutral). */
export function speedFromRpm(profile: EngineProfile, rpm: number, gear: number): number {
  const ratios = profile.gearbox.ratios;
  if (gear < 1 || ratios.length === 0) return 0;
  const ratio = ratios[Math.min(gear, ratios.length) - 1] ?? 1;
  return (rpm / 60 / (ratio * profile.gearbox.finalDrive)) * 2 * Math.PI * profile.gearbox.wheelRadiusM;
}

/** Engine speed implied by ground speed in a gear (the inverse of speedFromRpm). */
export function rpmFromSpeed(profile: EngineProfile, speedMps: number, gear: number): number {
  const ratios = profile.gearbox.ratios;
  if (gear < 1 || ratios.length === 0) return 0;
  const ratio = ratios[Math.min(gear, ratios.length) - 1] ?? 1;
  return (speedMps / (2 * Math.PI * profile.gearbox.wheelRadiusM)) * ratio * profile.gearbox.finalDrive * 60;
}

/** Merge a partial update into a state, clamping every field and ignoring anything non-finite or unknown. */
export function mergeState(profile: EngineProfile, prev: VoiceState, next: Partial<VoiceState>): VoiceState {
  const out: VoiceState = { ...prev };
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (fin(next.rpm)) out.rpm = clamp(next.rpm, 0, profile.engine.limiterRpm);
  if (fin(next.throttle)) out.throttle = clamp01(next.throttle);
  if (fin(next.boost)) out.boost = clamp01(next.boost);
  if (fin(next.drift)) out.drift = clamp01(next.drift);
  if (fin(next.damage)) out.damage = clamp01(next.damage);
  if (fin(next.gear)) out.gear = clamp(Math.round(next.gear), 0, profile.gearbox.ratios.length);
  if (typeof next.surface === 'string' && (SURFACES as readonly string[]).includes(next.surface)) out.surface = next.surface;
  if (typeof next.ignition === 'boolean') out.ignition = next.ignition;
  if ('speed' in next) {
    if (fin(next.speed)) out.speed = Math.max(0, next.speed);
    else delete out.speed;
  }
  return out;
}

export interface Targets {
  /** 0 with the engine stopped, 1 once it is turning over at idle: fades the engine layers in and out. */
  run: number;
  rpmN: number;
  speed: number;
  speedN: number;
  /** Firing frequency, Hz: rpm / 60 x cylinders / 2. */
  f0: number;
  /** 0..1 activity of each layer (pops and starter are 0 here: they are events, the voice reports them). */
  levels: LayerLevels;
  firing: { f0: number; lopeHz: number; lopeDepth: number; mellowGain: number; brightGain: number; bodyHz: number };
  intake: { gain: number; hz: number };
  exhaust: { gain: number; hz: number; amHz: number; amDepth: number };
  boost: { whineHz: number; whineGain: number; whooshGain: number; whooshHz: number };
  squeal: { gain: number; hz1: number; hz2: number };
  surface: { brownGain: number; crackleGain: number; cutoffHz: number; q: number };
  rattle: { gain: number; rateHz: number };
}

/** Firing frequency in Hz for an engine speed (4-stroke: every cylinder fires once per two revolutions). */
export const firingHz = (cylinders: number, rpm: number): number => (rpm / 60) * (cylinders / 2);

export function computeTargets(p: EngineProfile, s: VoiceState): Targets {
  const e = p.engine;
  const rpmN = clamp01((s.rpm - e.idleRpm) / (e.redlineRpm - e.idleRpm));
  const run = smoothstep(0, e.idleRpm * 0.7, s.rpm);
  const speed = s.speed ?? speedFromRpm(p, s.rpm, s.gear);
  const speedN = clamp01(speed / p.surface.fullSpeedMps);
  const f0 = firingHz(e.cylinders, s.rpm);

  // Firing: pitch from rpm, brightness and body level from throttle load, lumpy burble near idle.
  const f = p.firing;
  const loadGain = lerp(f.offThrottleLevel, 1, s.throttle) * run;
  const brightMix = f.brightMax * s.throttle * (0.3 + 0.7 * rpmN);
  const open = lerp(1 - f.bodyFilter.throttleOpen, 1, s.throttle);
  const bodyHz = elerp(f.bodyFilter.minHz, f.bodyFilter.maxHz, rpmN) * open;
  const lopeFade = clamp01(1 - rpmN / f.lope.fadeOutRpmN);
  const firing = {
    f0,
    lopeHz: f0 / 2,
    lopeDepth: f.lope.depth * lopeFade * lopeFade,
    mellowGain: f.level * loadGain * (1 - brightMix * 0.6),
    brightGain: f.level * loadGain * brightMix,
    bodyHz,
  };

  const intakeAct = Math.pow(s.throttle, 1.5) * (0.3 + 0.7 * rpmN) * run;
  const exhaustAct = lerp(0.45, 1, s.throttle) * (0.4 + 0.6 * rpmN) * run;
  // No boost section: the car has no turbo, so the layer has nothing to say whatever the boost input (P1-A04c).
  const b = p.boost;
  const boostAct = b ? Math.pow(s.boost, 1.4) * run : 0;
  const speedSqueal = smoothstep(p.squeal.minSpeedMps, p.squeal.fullSpeedMps, speed);
  const squealAct = Math.pow(s.drift, 1.3) * speedSqueal;
  const surf = p.surface[s.surface];
  const surfaceAct = Math.pow(speedN, p.surface.speedExponent) * surf.level;
  // The idle share needs the engine turning: a parked car with the engine off does not rattle.
  const rattleShare = p.rattle.idleShare * run + (1 - p.rattle.idleShare) * Math.max(rpmN, 0.7 * speedN);
  const rattleAct = Math.pow(s.damage, 1.2) * rattleShare;

  const squealHz = elerp(p.squeal.centerMinHz, p.squeal.centerMaxHz, clamp01(0.6 * s.drift + 0.4 * speedN));

  return {
    run,
    rpmN,
    speed,
    speedN,
    f0,
    levels: {
      firing: loadGain,
      intake: intakeAct,
      exhaust: exhaustAct,
      boost: boostAct,
      squeal: squealAct,
      surface: surfaceAct,
      rattle: rattleAct,
      pops: 0,
      starter: 0,
    },
    firing,
    intake: { gain: p.intake.level * intakeAct, hz: elerp(p.intake.minHz, p.intake.maxHz, rpmN) },
    exhaust: {
      gain: p.exhaust.level * exhaustAct,
      hz: elerp(p.exhaust.minHz, p.exhaust.maxHz, clamp01(0.6 * rpmN + 0.4 * s.throttle)),
      amHz: f0,
      amDepth: p.exhaust.pulseDepth,
    },
    boost: b
      ? {
          whineHz: b.whineBaseHz + b.whineSweepHz * s.boost + b.whineRpmHz * rpmN,
          whineGain: b.level * boostAct * (0.35 + 0.65 * rpmN),
          whooshGain: b.level * b.whooshLevel * Math.pow(s.boost, 1.2),
          whooshHz: b.whooshHz + b.whooshSweepHz * s.boost,
        }
      : { whineHz: 0, whineGain: 0, whooshGain: 0, whooshHz: 0 },
    squeal: { gain: p.squeal.level * squealAct, hz1: squealHz, hz2: squealHz * p.squeal.secondRatio },
    surface: {
      brownGain: p.surface.level * surfaceAct * surf.brown,
      crackleGain: p.surface.level * surfaceAct * surf.crackle,
      cutoffHz: surf.cutoffHz,
      q: surf.q,
    },
    rattle: { gain: p.rattle.level * rattleAct, rateHz: p.rattle.baseRateHz + (s.rpm / 60) * p.rattle.rpmRateScale },
  };
}
