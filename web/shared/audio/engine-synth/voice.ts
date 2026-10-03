// One car's engine voice (P1-A04): a small Web Audio graph whose every layer follows state.
//
//   firing  : two band-limited pulse waves at rpm/60 x cylinders/2 (+ harmonics) -> body low-pass -> half-order lope
//   intake  : white noise -> band-pass that rises with revs, level from throttle
//   exhaust : white noise -> low-pass, chopped at the firing rate (the chuff of each pulse)
//   boost   : sine whine that sweeps with boost and revs + a band-passed whoosh
//   squeal  : two high-Q band-passes on white noise with a slow wobble (drift)
//   surface : brown rumble + crackle through a low-pass chosen per surface (tarmac, dirt, gravel)
//   rattle  : metallic band-passes on noise, chopped at a rate that follows revs (loose parts)
//   pops    : short noise bursts when the throttle is lifted at revs (the Cruz's cheeky exhaust)
//   dip     : the gear-change dip on the engine layers (and a pop on a hard upshift)
//
// Cost control: a layer with nothing to say is disconnected from the graph (the graph is pull-based, so a
// disconnected branch is not rendered) and reconnected when its state asks for it; filter and oscillator
// params run k-rate and are only re-aimed when they move by more than a small dead band. Everything random
// is seeded: the same sequence of `set` calls on a fresh context renders the same samples.
import { DEFAULT_STATE, clamp01, computeTargets, lerp, mergeState } from './mapping';
import { mixSeed, mulberry32, noiseBank } from './noise';
import { assertProfile } from './profile';
import { LAYERS } from './types';
import type { EngineProfile, EngineVoice, LayerLevels, LayerName, VoiceOptions, VoiceState } from './types';

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

function periodicWave(ctx: BaseAudioContext, phase: 'sine' | 'cosine', harmonics: number[]): PeriodicWave {
  let cache = waveCache.get(ctx);
  if (!cache) waveCache.set(ctx, (cache = new Map()));
  const key = `${phase}:${harmonics.join(',')}`;
  let w = cache.get(key);
  if (!w) {
    const coeff = new Float32Array(harmonics.length + 1);
    harmonics.forEach((h, i) => (coeff[i + 1] = h));
    const zero = new Float32Array(coeff.length);
    w = phase === 'sine' ? ctx.createPeriodicWave(zero, coeff) : ctx.createPeriodicWave(coeff, zero);
    cache.set(key, w);
  }
  return w;
}

function kRate(p: AudioParam): void {
  try {
    p.automationRate = 'k-rate';
  } catch {
    /* an engine without k-rate params just runs them a-rate */
  }
}

/** An AudioParam we drive: changes inside a small dead band schedule nothing, so steady state is free. */
class Driven {
  private last: number;
  constructor(
    private readonly param: AudioParam,
    init: number,
    private readonly rel = 0.01,
    private readonly abs = 1e-5,
  ) {
    param.value = init;
    this.last = init;
  }
  to(v: number, now: number, tau: number): void {
    if (Math.abs(v - this.last) <= this.abs + this.rel * Math.abs(v)) return;
    this.last = v;
    this.param.setTargetAtTime(v, now, tau);
  }
}

/** A connection that exists only while its layer has something to say. */
interface Gate {
  from: AudioNode;
  to: AudioNode | AudioParam;
  on: boolean;
  activeAt: number;
}

/** How long a layer stays connected after its target hits zero (covers the gain's glide to silence). */
const SETTLE_S = 0.4;
const POP_DECAY_TAU = 0.03;
/** Pitch-critical params get a tighter dead band (0.2% is about 3.5 cents). */
const PITCH_REL = 0.002;

export function create(ctx: BaseAudioContext, profileIn: EngineProfile, options: VoiceOptions = {}): EngineVoice {
  const profile = assertProfile(profileIn);
  const seed = mixSeed(profile.output.noiseSeed, options.seed ?? 0);
  const rng = mulberry32(seed);
  const bank = noiseBank(ctx);
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const tau = profile.output.controlTauS;

  const gainNode = (v: number, k = true): GainNode => {
    const g = ctx.createGain();
    nodes.push(g);
    g.gain.value = v;
    if (k) kRate(g.gain);
    return g;
  };
  const filter = (type: BiquadFilterType, hz: number, q: number): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    nodes.push(f);
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    kRate(f.frequency);
    kRate(f.Q);
    return f;
  };
  const osc = (w: PeriodicWave | null, hz: number): OscillatorNode => {
    const o = ctx.createOscillator();
    nodes.push(o);
    if (w) o.setPeriodicWave(w);
    else o.type = 'sine';
    o.frequency.value = hz;
    kRate(o.frequency);
    sources.push(o);
    return o;
  };
  const noise = (buffer: AudioBuffer): AudioBufferSourceNode => {
    const s = ctx.createBufferSource();
    nodes.push(s);
    s.buffer = buffer;
    s.loop = true;
    sources.push(s);
    return s;
  };
  const chain = (...n: AudioNode[]): void => {
    for (let i = 0; i < n.length - 1; i++) n[i]?.connect(n[i + 1] as AudioNode);
  };
  const gate = (from: AudioNode, to: AudioNode | AudioParam, on: boolean): Gate => {
    const g: Gate = { from, to, on: false, activeAt: -Infinity };
    if (on) wire(g, true, 0);
    return g;
  };
  const wire = (g: Gate, connect: boolean, now: number): void => {
    if (connect) {
      g.activeAt = now;
      if (g.on) return;
      if (g.to instanceof AudioParam) g.from.connect(g.to);
      else g.from.connect(g.to);
      g.on = true;
    } else if (g.on && now - g.activeAt > SETTLE_S) {
      if (g.to instanceof AudioParam) g.from.disconnect(g.to);
      else g.from.disconnect(g.to);
      g.on = false;
    }
  };

  // ---- state -----------------------------------------------------------------------------------
  let st: VoiceState = mergeState(profile, { ...DEFAULT_STATE }, options.initial ?? {});
  const enabled = Object.fromEntries(LAYERS.map((l) => [l, true])) as Record<LayerName, boolean>;
  let disposed = false;
  const first = computeTargets(profile, st);
  const E = 1e-4;

  // ---- output spine ------------------------------------------------------------------------------
  const out = gainNode(profile.output.level);
  const dip = gainNode(1);
  const engineBus = gainNode(1);
  chain(engineBus, dip, out);
  if (options.destination) out.connect(options.destination);

  // ---- noise sources: one of each per voice, started at seeded offsets so voices don't share phase ----
  const srcWhite = noise(bank.white);
  const srcBrown = noise(bank.brown);
  const srcCrackle = noise(bank.crackle);

  // ---- firing ------------------------------------------------------------------------------------
  const f = profile.firing;
  const f0 = Math.max(first.firing.f0, 1);
  const oscM = osc(periodicWave(ctx, f.mellow.phase, f.mellow.harmonics), f0);
  const oscB = osc(periodicWave(ctx, f.bright.phase, f.bright.harmonics), f0);
  const gM = gainNode(first.firing.mellowGain);
  const gB = gainNode(first.firing.brightGain);
  const body = filter('lowpass', first.firing.bodyHz, f.bodyFilter.q);
  const lopeAmp = gainNode(1 - first.firing.lopeDepth / 2, false); // a-rate: the lope LFO modulates it
  const oscL = osc(null, Math.max(first.firing.lopeHz, 0.5));
  const lopeDepth = gainNode(first.firing.lopeDepth / 2);
  oscM.connect(gM);
  oscB.connect(gB);
  gM.connect(body);
  chain(body, lopeAmp, engineBus);
  oscL.connect(lopeDepth);
  const brightGate = gate(gB, body, first.firing.brightGain > E);
  const lopeGate = gate(lopeDepth, lopeAmp.gain, first.firing.lopeDepth > 0.004);

  // ---- exhaust -----------------------------------------------------------------------------------
  const exhLP = filter('lowpass', first.exhaust.hz, profile.exhaust.q);
  const exhAM = gainNode(first.exhaust.gain * (1 - first.exhaust.amDepth / 2), false);
  const oscAM = osc(periodicWave(ctx, 'cosine', profile.exhaust.pulseHarmonics), Math.max(first.exhaust.amHz, 1));
  const exhDepth = gainNode((first.exhaust.gain * first.exhaust.amDepth) / 2);
  chain(srcWhite, exhLP, exhAM, engineBus);
  chain(oscAM, exhDepth);
  exhDepth.connect(exhAM.gain);

  // ---- intake ------------------------------------------------------------------------------------
  const intakeBP = filter('bandpass', first.intake.hz, profile.intake.q);
  const intakeGain = gainNode(first.intake.gain);
  chain(srcWhite, intakeBP, intakeGain, engineBus);

  // ---- boost: whine + whoosh -----------------------------------------------------------------------
  const boostOut = gainNode(1);
  const oscW = osc(null, first.boost.whineHz);
  const whineGain = gainNode(first.boost.whineGain);
  const whooshBP = filter('bandpass', first.boost.whooshHz, 0.9);
  const whooshGain = gainNode(first.boost.whooshGain);
  chain(oscW, whineGain, boostOut);
  chain(srcWhite, whooshBP, whooshGain, boostOut);
  const boostGate = gate(boostOut, engineBus, first.boost.whineGain + first.boost.whooshGain > E);

  // ---- squeal: two resonances with a shared slow wobble ------------------------------------------------
  const sq = profile.squeal;
  const squealOut = gainNode(1);
  const sqBP1 = filter('bandpass', first.squeal.hz1, sq.q);
  const sqBP2 = filter('bandpass', first.squeal.hz2, sq.q);
  const sqMix2 = gainNode(0.6);
  const sqGainN = gainNode(first.squeal.gain);
  const oscSq = osc(null, sq.wobbleHz);
  const sqD1 = gainNode(first.squeal.hz1 * sq.wobbleDepth);
  const sqD2 = gainNode(first.squeal.hz2 * sq.wobbleDepth);
  chain(srcWhite, sqBP1, sqGainN);
  chain(srcWhite, sqBP2, sqMix2, sqGainN);
  chain(sqGainN, squealOut);
  oscSq.connect(sqD1);
  oscSq.connect(sqD2);
  sqD1.connect(sqBP1.frequency);
  sqD2.connect(sqBP2.frequency);
  const squealGate = gate(squealOut, out, first.squeal.gain > E);

  // ---- surface: rumble + crackle through a per-surface low-pass ---------------------------------------
  const surfaceOut = gainNode(1);
  const surfLP = filter('lowpass', first.surface.cutoffHz, first.surface.q);
  const brownG = gainNode(first.surface.brownGain);
  const crackG = gainNode(first.surface.crackleGain);
  chain(srcBrown, brownG, surfLP, surfaceOut);
  chain(srcCrackle, crackG, surfLP);
  const surfaceGate = gate(surfaceOut, out, first.surface.brownGain + first.surface.crackleGain > E);

  // ---- rattle: metal bands on noise, chopped by a rev-following pulse -------------------------------------
  const rt = profile.rattle;
  const rattleOut = gainNode(1);
  const rtAM = gainNode(0, false);
  const oscRt = osc(periodicWave(ctx, 'cosine', rt.pulseHarmonics), first.rattle.rateHz);
  const rtGain = gainNode(first.rattle.gain);
  for (const hz of rt.bandsHz) chain(srcWhite, filter('bandpass', hz, rt.q), rtAM);
  chain(rtAM, rtGain, rattleOut);
  oscRt.connect(rtAM.gain);
  const rattleGate = gate(rattleOut, out, first.rattle.gain > E);

  // ---- pops: a noise crack with a low thump (brown noise is already low), one gate per burst -----------------
  const pp = profile.pops;
  const popsOut = gainNode(1);
  const popBP = filter('bandpass', pp.bandHz, pp.q);
  const popGain = gainNode(0, false);
  chain(srcWhite, popBP, popGain);
  chain(srcBrown, popGain);
  chain(popGain, popsOut);
  const popsGate = gate(popsOut, out, false);

  // ---- start every source ----------------------------------------------------------------------------
  for (const s of sources) {
    if (s === srcWhite || s === srcBrown || s === srcCrackle) (s as AudioBufferSourceNode).start(0, rng() * bank.seconds);
    else s.start(0);
  }

  // ---- the driven params -----------------------------------------------------------------------------
  const pitch = (p: AudioParam) => new Driven(p, p.value, PITCH_REL, 0.01);
  const D = {
    f0M: pitch(oscM.frequency),
    f0B: pitch(oscB.frequency),
    lopeHz: pitch(oscL.frequency),
    amHz: pitch(oscAM.frequency),
    gM: new Driven(gM.gain, first.firing.mellowGain),
    gB: new Driven(gB.gain, first.firing.brightGain),
    bodyHz: new Driven(body.frequency, first.firing.bodyHz),
    lopeBase: new Driven(lopeAmp.gain, lopeAmp.gain.value),
    lopeDepth: new Driven(lopeDepth.gain, lopeDepth.gain.value),
    exhHz: new Driven(exhLP.frequency, first.exhaust.hz),
    exhBase: new Driven(exhAM.gain, exhAM.gain.value),
    exhDepth: new Driven(exhDepth.gain, exhDepth.gain.value),
    intakeHz: new Driven(intakeBP.frequency, first.intake.hz),
    intakeGain: new Driven(intakeGain.gain, first.intake.gain),
    whineHz: pitch(oscW.frequency),
    whineGain: new Driven(whineGain.gain, first.boost.whineGain),
    whooshHz: new Driven(whooshBP.frequency, first.boost.whooshHz),
    whooshGain: new Driven(whooshGain.gain, first.boost.whooshGain),
    sqHz1: new Driven(sqBP1.frequency, first.squeal.hz1),
    sqHz2: new Driven(sqBP2.frequency, first.squeal.hz2),
    sqD1: new Driven(sqD1.gain, sqD1.gain.value),
    sqD2: new Driven(sqD2.gain, sqD2.gain.value),
    sqGain: new Driven(sqGainN.gain, first.squeal.gain),
    brown: new Driven(brownG.gain, first.surface.brownGain),
    crackle: new Driven(crackG.gain, first.surface.crackleGain),
    surfHz: new Driven(surfLP.frequency, first.surface.cutoffHz),
    surfQ: new Driven(surfLP.Q, first.surface.q),
    rtHz: new Driven(oscRt.frequency, first.rattle.rateHz),
    rtGain: new Driven(rtGain.gain, first.rattle.gain),
  };

  // ---- gear dip and pops (event layers) ----------------------------------------------------------------
  const dipCfg = profile.gearDip;
  let dipAt = -Infinity;
  let dipFrom = 0; // depth already in the dip when it was retriggered
  const dipDepthAt = (t: number): number => {
    const u = t - dipAt;
    if (u < 0) return 0;
    if (u < dipCfg.rampS) return lerp(dipFrom, dipCfg.depth, u / dipCfg.rampS);
    const v = u - dipCfg.rampS - dipCfg.holdS;
    return v <= 0 ? dipCfg.depth : dipCfg.depth * Math.exp(-v / dipCfg.recoverTauS);
  };
  let armed = st.throttle >= pp.armThrottle;
  let popUntil = -Infinity;
  const pops: { t: number; peak: number }[] = []; // scheduled pops still audible or yet to sound

  const startDip = (now: number): void => {
    dipFrom = dipDepthAt(now);
    dipAt = now;
    const p = dip.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(1 - dipFrom, now);
    p.linearRampToValueAtTime(1 - dipCfg.depth, now + dipCfg.rampS);
    p.setValueAtTime(1 - dipCfg.depth, now + dipCfg.rampS + dipCfg.holdS);
    p.setTargetAtTime(1, now + dipCfg.rampS + dipCfg.holdS, dipCfg.recoverTauS);
  };

  const schedulePops = (now: number, count: number, strength: number): void => {
    while (pops.length > 0 && now - (pops[0]?.t ?? now) > POP_DECAY_TAU * 8) pops.shift();
    let t = Math.max(now + 0.02, popUntil - 0.15);
    for (let i = 0; i < count; i++) {
      if (i > 0) t += lerp(pp.gapMinS, pp.gapMaxS, rng());
      const peak = pp.level * strength * (0.45 + 0.55 * rng());
      popBP.frequency.setValueAtTime(pp.bandHz * (0.75 + 0.5 * rng()), t);
      popGain.gain.setValueAtTime(0, t);
      popGain.gain.linearRampToValueAtTime(peak, t + 0.003);
      popGain.gain.setTargetAtTime(0, t + 0.003, POP_DECAY_TAU);
      pops.push({ t, peak });
      popUntil = t + POP_DECAY_TAU * 8;
    }
    wire(popsGate, true, now);
  };

  // ---- apply -------------------------------------------------------------------------------------------
  const apply = (now: number): void => {
    const t = computeTargets(profile, st);
    const on = (l: LayerName): number => (enabled[l] ? 1 : 0);
    const hz = Math.max(t.firing.f0, 1);

    D.f0M.to(hz, now, tau);
    D.f0B.to(hz, now, tau);
    D.lopeHz.to(Math.max(t.firing.lopeHz, 0.5), now, tau);
    D.amHz.to(hz, now, tau);
    const gMt = t.firing.mellowGain * on('firing');
    const gBt = t.firing.brightGain * on('firing');
    D.gM.to(gMt, now, tau);
    D.gB.to(gBt, now, tau);
    wire(brightGate, gBt > E, now);
    D.bodyHz.to(t.firing.bodyHz, now, tau);
    D.lopeBase.to(1 - t.firing.lopeDepth / 2, now, tau);
    D.lopeDepth.to(t.firing.lopeDepth / 2, now, tau);
    wire(lopeGate, t.firing.lopeDepth * on('firing') > 0.004, now);

    const exG = t.exhaust.gain * on('exhaust');
    D.exhHz.to(t.exhaust.hz, now, tau);
    D.exhBase.to(exG * (1 - t.exhaust.amDepth / 2), now, tau);
    D.exhDepth.to((exG * t.exhaust.amDepth) / 2, now, tau);
    D.intakeHz.to(t.intake.hz, now, tau);
    D.intakeGain.to(t.intake.gain * on('intake'), now, tau);

    const whine = t.boost.whineGain * on('boost');
    const whoosh = t.boost.whooshGain * on('boost');
    D.whineHz.to(t.boost.whineHz, now, tau);
    D.whineGain.to(whine, now, tau);
    D.whooshHz.to(t.boost.whooshHz, now, tau);
    D.whooshGain.to(whoosh, now, tau);
    wire(boostGate, whine + whoosh > E, now);

    const sqG = t.squeal.gain * on('squeal');
    D.sqHz1.to(t.squeal.hz1, now, tau);
    D.sqHz2.to(t.squeal.hz2, now, tau);
    D.sqD1.to(t.squeal.hz1 * sq.wobbleDepth, now, tau);
    D.sqD2.to(t.squeal.hz2 * sq.wobbleDepth, now, tau);
    D.sqGain.to(sqG, now, tau);
    wire(squealGate, sqG > E, now);

    const sfB = t.surface.brownGain * on('surface');
    const sfC = t.surface.crackleGain * on('surface');
    D.brown.to(sfB, now, tau * 2);
    D.crackle.to(sfC, now, tau * 2);
    D.surfHz.to(t.surface.cutoffHz, now, tau * 2);
    D.surfQ.to(t.surface.q, now, tau * 2);
    wire(surfaceGate, sfB + sfC > E, now);

    const rtG = t.rattle.gain * on('rattle');
    D.rtHz.to(t.rattle.rateHz, now, tau);
    D.rtGain.to(rtG, now, tau);
    wire(rattleGate, rtG > E, now);

    // pops: arm on throttle, fire on the lift
    if (st.throttle >= pp.armThrottle) armed = true;
    if (armed && st.throttle <= pp.fireThrottle && t.rpmN >= pp.minRpmN) {
      armed = false;
      if (enabled.pops) schedulePops(now, pp.burstMin + Math.floor(rng() * (pp.burstMax - pp.burstMin + 1)), 0.4 + 0.6 * t.rpmN);
    }
    wire(popsGate, now < popUntil, now);
  };

  // ---- the voice ---------------------------------------------------------------------------------------
  return {
    output: out,
    profile,
    set(next) {
      if (disposed) return;
      const now = ctx.currentTime;
      const prevGear = st.gear;
      st = mergeState(profile, st, next);
      if (st.gear !== prevGear) {
        startDip(now);
        const rpmN = computeTargets(profile, st).rpmN;
        if (st.gear > prevGear && rpmN >= pp.minRpmN && st.throttle >= pp.fireThrottle && enabled.pops) {
          schedulePops(now, 1, pp.upshiftShare * (0.4 + 0.6 * rpmN));
        }
      }
      apply(now);
    },
    levels(): LayerLevels {
      const t = computeTargets(profile, st);
      const now = ctx.currentTime;
      const keep = 1 - dipDepthAt(now);
      while (pops.length > 0 && now - (pops[0]?.t ?? now) > POP_DECAY_TAU * 8) pops.shift();
      let popEnv = 0;
      for (const p of pops) if (now >= p.t) popEnv = Math.max(popEnv, (p.peak / Math.max(pp.level, 1e-6)) * Math.exp(-(now - p.t) / POP_DECAY_TAU));
      popEnv = clamp01(popEnv);
      const l = t.levels;
      const e = (name: LayerName, v: number): number => (enabled[name] ? v : 0);
      return {
        firing: e('firing', l.firing * keep),
        intake: e('intake', l.intake * keep),
        exhaust: e('exhaust', l.exhaust * keep),
        boost: e('boost', l.boost * keep),
        squeal: e('squeal', l.squeal),
        surface: e('surface', l.surface),
        rattle: e('rattle', l.rattle),
        pops: e('pops', popEnv),
      };
    },
    state: () => ({ ...st }),
    setLayerEnabled(layer, isOn) {
      if (disposed) return;
      enabled[layer] = isOn;
      apply(ctx.currentTime);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of nodes) n.disconnect();
    },
  };
}
