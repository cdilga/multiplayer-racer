// Scripted-lap playback shared by the gallery page (real time) and the checks (offline render): the same
// fixed 20 ms steps drive the drivetrain and the voice either way, so what the owner hears on the page is
// what the committed WAV and the determinism test render.
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

/** Lap time -> voice state. Steps the drivetrain in fixed STEP_S increments so playback is deterministic. */
export function createLapRunner(profile, lap) {
  const drivetrain = createDrivetrain(profile);
  const s = lap.series;
  let simT = -STEP_S;
  let last = null;
  const at = (t) => {
    const speed = sampleSeries(s.speedMps, lap.rateHz, t);
    const throttle = sampleSeries(s.throttle, lap.rateHz, t);
    const out = drivetrain.step(STEP_S, speed, throttle);
    return {
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
  };
  return {
    reset() {
      drivetrain.reset();
      simT = -STEP_S;
      last = null;
    },
    /** State at lap time t; advances the drivetrain through every whole step up to t. */
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
 * Options: sampleRate, seed (voice 0's seed; voice i uses seed + i), tailS, layers (only these layers stay on),
 * timing: true returns { samples, wallMs, callbackMs, steps } (wall time of startRendering and of the main-thread set()
 * callbacks inside it) instead of the bare samples.
 */
export async function renderLapOffline(synth, profile, lap, opts = {}) {
  const { sampleRate = 48000, seed = 0, voices = 1, tailS = 0.5, layers = null, durationS = lap.durationS, stepS = STEP_S, timing = false } = opts;
  const frames = Math.ceil((durationS + tailS) * sampleRate);
  const ctx = new OfflineAudioContext(1, frames, sampleRate);
  const created = [];
  for (let i = 0; i < voices; i++) {
    const v = synth.create(ctx, profile, { destination: ctx.destination, seed: seed + i });
    if (layers) for (const l of synth.LAYERS) v.setLayerEnabled(l, layers.includes(l));
    created.push(v);
  }
  const runner = createLapRunner(profile, lap);
  let callbackMs = 0;
  let steps = 0;
  const apply = () => {
    const t0 = timing ? performance.now() : 0;
    const st = runner.stateAt(Math.min(ctx.currentTime, lap.durationS));
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
