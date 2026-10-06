// Scripted-lap playback shared by the gallery page (real time) and the checks (offline render): the same
// fixed 20 ms steps drive the drivetrain and the voice either way, so what the owner hears on the page is
// what the committed WAV and the determinism test render.
//
// The lap opens with an engine start and closes with a stop (P1-A04c): `preS` seconds parked at idle in
// neutral while the start plays (crank, catch, settle), then the lap, then the key goes off and the stop plays
// for the profile's `stopS`. Runner time is that whole timeline; lap time is runner time minus `preS`.
import { createDrivetrain } from './engine-synth.js';

export const STEP_S = 0.02;

/** Linear interpolation of a lap series at time t (seconds); `held` series (surface) take the previous sample. */
function sampleSeries(series, rateHz, t, held = false) {
  const x = Math.max(0, t) * rateHz;
  const i = Math.min(series.length - 1, Math.floor(x));
  if (held) return series[i];
  const j = Math.min(series.length - 1, i + 1);
  return series[i] + (series[j] - series[i]) * (x - i);
}

/** The start pre-roll and stop tail for a profile, in whole control steps. */
export function startStopTimes(profile) {
  const ig = profile.ignition;
  const steps = (s) => Math.ceil(s / STEP_S - 1e-9) * STEP_S;
  return { preS: steps(ig.crankS + ig.catchS + 3 * ig.settleTauS + 0.3), stopS: steps(ig.stopS) };
}

/** Runner time -> voice state. Steps the drivetrain in fixed STEP_S increments so playback is deterministic. */
export function createLapRunner(profile, lap) {
  const drivetrain = createDrivetrain(profile);
  const s = lap.series;
  const { preS, stopS } = startStopTimes(profile);
  const parked = {
    ignition: true,
    rpm: profile.engine.idleRpm,
    throttle: 0,
    boost: 0,
    drift: 0,
    surface: lap.surfaces[s.surface[0]] ?? 'tarmac',
    damage: s.damage[0],
    gear: 0,
    speed: 0,
    shifting: false,
  };
  let simT = -STEP_S;
  let last = null;
  let lastLap = null;
  const at = (runT) => {
    const t = runT - preS;
    if (t < 0) return parked;
    if (t >= lap.durationS) return { ...(lastLap ?? parked), ignition: false, throttle: 0, boost: 0 };
    const speed = sampleSeries(s.speedMps, lap.rateHz, t);
    const throttle = sampleSeries(s.throttle, lap.rateHz, t);
    const out = drivetrain.step(STEP_S, speed, throttle);
    lastLap = {
      ignition: true,
      rpm: out.rpm,
      throttle,
      boost: sampleSeries(s.boost, lap.rateHz, t),
      drift: sampleSeries(s.drift, lap.rateHz, t),
      surface: lap.surfaces[sampleSeries(s.surface, lap.rateHz, t, true)] ?? 'tarmac',
      damage: sampleSeries(s.damage, lap.rateHz, t),
      gear: out.gear,
      speed,
      shifting: out.shifting,
    };
    return lastLap;
  };
  return {
    preS,
    stopS,
    /** The whole timeline: start, lap, stop. */
    durationS: preS + lap.durationS + stopS,
    reset() {
      drivetrain.reset();
      simT = -STEP_S;
      last = null;
      lastLap = null;
    },
    /** State at runner time t; advances the drivetrain through every whole step up to t. */
    stateAt(t) {
      while (simT + STEP_S <= t + 1e-9 || last === null) {
        simT = last === null ? 0 : simT + STEP_S;
        last = at(simT);
      }
      return last;
    },
  };
}

/** Run `fn` at each time (seconds, quantised to render quanta) while an OfflineAudioContext renders. */
function atTimes(ctx, times, frames, fn) {
  const quantum = 128;
  const seen = new Set();
  for (const t of times) {
    const q = Math.round((t * ctx.sampleRate) / quantum) * quantum;
    if (q <= 0 || seen.has(q) || q >= frames) continue;
    seen.add(q);
    ctx.suspend(q / ctx.sampleRate).then(() => {
      fn(t);
      ctx.resume();
    });
  }
}

/**
 * Render a short script of state changes through one voice: script = [{ t, state }] (state is partial; the first
 * entry is the starting state, applied before playback). Returns mono samples. For tests of single layers.
 */
export async function renderScript(synth, profile, script, opts = {}) {
  const { sampleRate = 48000, seed = 0, durationS = 1, layers = null } = opts;
  const frames = Math.ceil(durationS * sampleRate);
  const ctx = new OfflineAudioContext(1, frames, sampleRate);
  const voice = synth.create(ctx, profile, { destination: ctx.destination, seed, initial: script[0].state });
  if (layers) for (const l of synth.LAYERS) voice.setLayerEnabled(l, layers.includes(l));
  atTimes(ctx, script.slice(1).map((s) => s.t), frames, (t) => voice.set(script.find((s) => s.t === t).state));
  const buffer = await ctx.startRendering();
  voice.dispose();
  return buffer.getChannelData(0).slice();
}

/**
 * Render the lap through `voices` engine voices into an OfflineAudioContext and return the mono samples.
 * Control steps run at suspend points (the voice sees the same sequence of set() calls as in real time).
 * The voices start parked with the engine off, so the render opens with the start and ends with the stop.
 * Options: sampleRate, seed (voice 0's seed; voice i uses seed + i), tailS (after the stop), durationS (runner time,
 * default the whole timeline), layers (only these layers stay on),
 * timing: true returns { samples, wallMs, callbackMs, steps } (wall time of startRendering and of the main-thread set()
 * callbacks inside it) instead of the bare samples.
 */
export async function renderLapOffline(synth, profile, lap, opts = {}) {
  const runner = createLapRunner(profile, lap);
  const { sampleRate = 48000, seed = 0, voices = 1, tailS = 0.5, layers = null, durationS = runner.durationS, stepS = STEP_S, timing = false } = opts;
  const frames = Math.ceil((durationS + tailS) * sampleRate);
  const ctx = new OfflineAudioContext(1, frames, sampleRate);
  const created = [];
  for (let i = 0; i < voices; i++) {
    const v = synth.create(ctx, profile, { destination: ctx.destination, seed: seed + i, initial: { ignition: false } });
    if (layers) for (const l of synth.LAYERS) v.setLayerEnabled(l, layers.includes(l));
    created.push(v);
  }
  let callbackMs = 0;
  let steps = 0;
  const apply = () => {
    const t0 = timing ? performance.now() : 0;
    const st = runner.stateAt(Math.min(ctx.currentTime, runner.durationS));
    for (const v of created) v.set(st);
    if (timing) {
      callbackMs += performance.now() - t0;
      steps += 1;
    }
  };
  apply();
  const times = [];
  for (let t = stepS; t < durationS; t += stepS) times.push(t);
  atTimes(ctx, times, frames, apply);
  const wall0 = performance.now();
  const buffer = await ctx.startRendering();
  const wallMs = performance.now() - wall0;
  for (const v of created) v.dispose();
  const samples = buffer.getChannelData(0).slice();
  return timing ? { samples, wallMs, callbackMs, steps } : samples;
}
