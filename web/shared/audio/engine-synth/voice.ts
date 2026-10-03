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
//   starter : the starter motor's whine, sagging at each compression stroke while it cranks (P1-A04c)
//   ignition: start (crank, catch and flare, settle to idle) and stop (fuel cut, spool down) as scheduled
//             automation: a gain on the engine layers and a detune on every pitched oscillator, so the sequence
//             plays out without further `set` calls (P1-A04c)
//
// Cost control: a layer with nothing to say is disconnected from the graph (the graph is pull-based, so a
// disconnected branch is not rendered) and reconnected when its state asks for it; filter and oscillator
// params run k-rate and are only re-aimed when they move by more than a small dead band. Everything random
// is seeded: the same sequence of `set` calls on a fresh context renders the same samples.
import { DEFAULT_STATE, clamp01, computeTargets, firingHz, lerp, mergeState } from './mapping';
import { mixSeed, mulberry32, noiseBank } from './noise';
import { assertProfile } from './profile';
import { LAYERS } from './types';
import type { EnginePhase, EngineProfile, EngineVoice, IgnitionStatus, LayerLevels, LayerName, VoiceOptions, VoiceState } from './types';

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

/** Crossfade length when a live profile swap rebuilds the graph (P1-A04b). */
const SWAP_S = 0.03;

// Start and stop shape (P1-A04c). The timings that differ per car live in the profile's `ignition` section.
/** The starter engages and the engine's chug fades in over this. */
const ENGAGE_S = 0.06;
/** The starter lets go after the catch over this. */
const STARTER_RELEASE_S = 0.08;
/** The fuel cut: the engine layers drop to CUT_SHARE over this, then fade to silence by `stopS`. */
const CUT_S = 0.08;
const CUT_SHARE = 0.45;
/** Time constants of the post-cut fade per `stopS` (e^-7 is about -61 dB, so the final step to 0 is inaudible). */
const STOP_TAUS = 7;
/** The spool-down ends at this fraction of the crank speed. */
const STOP_END_OF_CRANK = 0.5;
/** Starter whine: a buzzy motor wave, a deep sag in level and a pitch dip at every compression stroke. */
const STARTER_HARMONICS = [1, 0.75, 0.55, 0.4, 0.3, 0.2, 0.14, 0.1];
const STARTER_CHUG_DEPTH = 0.7;
const STARTER_SAG_CENTS = 60;
/** The catch fires one cough through the pops layer, at this share of a full crack. */
const CATCH_COUGH = 0.5;

const cents = (ratio: number): number => 1200 * Math.log2(Math.max(ratio, 1e-6));

/**
 * Builds one internal graph hanging off `tail` (the voice's persistent output hub). `fadeInAt`
 * is the context time to fade in from (a swap), or −1 to start at full level (a fresh voice).
 */
type InnerVoice = Pick<EngineVoice, 'set' | 'levels' | 'state' | 'ignition' | 'setLayerEnabled' | 'dispose'> & {
  output: GainNode;
  profile: EngineProfile;
  fadeOutAt(now: number): void;
  layerEnabled(layer: LayerName): boolean;
};

function buildGraph(
  ctx: BaseAudioContext,
  tail: GainNode,
  profileIn: EngineProfile,
  options: VoiceOptions,
  fadeInAt: number,
): InnerVoice {
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
  const E = 1e-4;

  // ---- ignition (P1-A04c) ----------------------------------------------------------------------------------
  // `seq` is the last start or stop: when it began and the levels it began from. The phase, the scheduled detune
  // and gains, and the sounding rpm are pure functions of `seq` and the time that mirror what scheduleStart and
  // scheduleStop wrote, so an interrupted sequence carries on from where it audibly is. A voice created running
  // (or off) has a sequence that finished long ago.
  const ig = profile.ignition;
  const idle = profile.engine.idleRpm;
  interface Seq {
    kind: 'start' | 'stop';
    at: number;
    /** The rpm the pitched oscillators' frequency sits on while the detune moves (cents are relative to it). */
    base: number;
    fromIgn: number;
    fromCents: number;
    fromStarter: number;
  }
  let seq: Seq = { kind: st.ignition ? 'start' : 'stop', at: -Infinity, base: idle, fromIgn: st.ignition ? 1 : 0, fromCents: 0, fromStarter: 0 };
  const startEnds = [ig.crankS, ig.crankS + ig.catchS, ig.crankS + ig.catchS + 3 * ig.settleTauS] as const;
  const cutS = Math.min(CUT_S, ig.stopS / 4);
  const stopTau = (ig.stopS - cutS) / STOP_TAUS;
  const phaseAt = (t: number): EnginePhase => {
    const u = t - seq.at;
    if (seq.kind === 'stop') return u < ig.stopS ? 'stopping' : 'off';
    return u < startEnds[0] ? 'cranking' : u < startEnds[1] ? 'catching' : u < startEnds[2] ? 'settling' : 'running';
  };
  /** Detune (cents) on the pitched oscillators, engine-layer gain and starter gain as scheduled, at time t. */
  const envAt = (t: number): { cents: number; ign: number; starter: number } => {
    const u = t - seq.at;
    if (seq.kind === 'start') {
      const cCrank = cents(ig.crankRpm / seq.base);
      const cFlare = cents(ig.flareRpm / seq.base);
      const starter =
        u < ig.crankS ? lerp(seq.fromStarter, ig.starterLevel, clamp01(u / (ENGAGE_S / 2))) : ig.starterLevel * clamp01(1 - (u - ig.crankS) / STARTER_RELEASE_S);
      if (u < startEnds[0]) return { cents: cCrank, ign: lerp(seq.fromIgn, ig.crankShare, clamp01(u / ENGAGE_S)), starter };
      if (u < startEnds[1]) {
        const x = (u - startEnds[0]) / ig.catchS;
        return { cents: lerp(cCrank, cFlare, x), ign: lerp(ig.crankShare, 1, x), starter };
      }
      return { cents: cFlare * Math.exp(-(u - startEnds[1]) / ig.settleTauS), ign: 1, starter };
    }
    const cEnd = cents((ig.crankRpm * STOP_END_OF_CRANK) / seq.base);
    const starter = lerp(seq.fromStarter, 0, clamp01(u / 0.05));
    if (u >= ig.stopS) return { cents: cEnd, ign: 0, starter };
    const ign = u < cutS ? lerp(seq.fromIgn, seq.fromIgn * CUT_SHARE, u / cutS) : seq.fromIgn * CUT_SHARE * Math.exp(-(u - cutS) / stopTau);
    return { cents: lerp(seq.fromCents, cEnd, u / ig.stopS), ign, starter };
  };
  /**
   * The state the layers follow: the voice's own rpm, throttle and boost while it starts or stops. Road speed is
   * only derived from rpm and gear while the engine runs under its own power; otherwise it is the caller's speed or
   * 0 (a spooling-down or cranking engine is not driving the wheels), so the road layers don't hang on its rpm.
   */
  const effective = (t: number): VoiceState => {
    const ph = phaseAt(t);
    if (ph === 'running') return st;
    const speed = st.speed ?? 0;
    if (ph === 'off') return { ...st, rpm: 0, throttle: 0, boost: 0, speed };
    if (ph === 'stopping') return { ...st, rpm: seq.base, throttle: 0, boost: 0, speed };
    return { ...st, rpm: Math.max(st.rpm, idle), throttle: ph === 'cranking' ? 0 : st.throttle, boost: 0, speed };
  };
  const first = computeTargets(profile, effective(ctx.currentTime));
  /** The rpm the pitched oscillators were last aimed at (the base the detune is relative to). */
  let lastBase = effective(ctx.currentTime).rpm;

  // ---- output spine ------------------------------------------------------------------------------
  const out = gainNode(fadeInAt < 0 ? profile.output.level : 0);
  const dip = gainNode(1);
  const ign = gainNode(envAt(ctx.currentTime).ign); // the engine layers' start/stop envelope (scheduled)
  const engineBus = gainNode(1);
  chain(engineBus, ign, dip, out);
  out.connect(tail);
  if (fadeInAt >= 0) out.gain.linearRampToValueAtTime(profile.output.level, fadeInAt + SWAP_S);

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

  // ---- boost: whine + whoosh, built only for a car with a turbo (the profile's boost section, P1-A04c) ----------
  const boost = profile.boost
    ? (() => {
        const boostOut = gainNode(1);
        const oscW = osc(null, first.boost.whineHz);
        const whineGain = gainNode(first.boost.whineGain);
        const whooshBP = filter('bandpass', first.boost.whooshHz, 0.9);
        const whooshGain = gainNode(first.boost.whooshGain);
        chain(oscW, whineGain, boostOut);
        chain(srcWhite, whooshBP, whooshGain, boostOut);
        return {
          gate: gate(boostOut, engineBus, first.boost.whineGain + first.boost.whooshGain > E),
          whineHz: new Driven(oscW.frequency, oscW.frequency.value, PITCH_REL, 0.01),
          whineGain: new Driven(whineGain.gain, first.boost.whineGain),
          whooshHz: new Driven(whooshBP.frequency, first.boost.whooshHz),
          whooshGain: new Driven(whooshGain.gain, first.boost.whooshGain),
        };
      })()
    : null;

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

  // ---- starter: motor whine whose level and pitch sag at every compression stroke (P1-A04c) ----------------------
  const oscSt = osc(periodicWave(ctx, 'sine', STARTER_HARMONICS), ig.starterHz);
  const stAM = gainNode(1 - STARTER_CHUG_DEPTH / 2, false);
  const oscChug = osc(periodicWave(ctx, 'cosine', [1, 0.35]), firingHz(profile.engine.cylinders, ig.crankRpm));
  const chugDepth = gainNode(STARTER_CHUG_DEPTH / 2);
  const chugSag = gainNode(STARTER_SAG_CENTS);
  const stGain = gainNode(0);
  const stMute = gainNode(1);
  chain(oscSt, stAM, stGain, stMute);
  oscChug.connect(chugDepth);
  chugDepth.connect(stAM.gain);
  oscChug.connect(chugSag);
  chugSag.connect(oscSt.detune);
  const starterGate = gate(stMute, out, false);

  // The start/stop pitch rides on detune, so the callers' rpm (frequency) and the sequence never fight.
  const pitchParams = [oscM.detune, oscB.detune, oscL.detune, oscAM.detune];
  for (const p of pitchParams) {
    kRate(p);
    p.value = envAt(ctx.currentTime).cents;
  }

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
    stMute: new Driven(stMute.gain, 1),
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

  const schedulePops = (now: number, count: number, strength: number, from = now + 0.02): void => {
    while (pops.length > 0 && now - (pops[0]?.t ?? now) > POP_DECAY_TAU * 8) pops.shift();
    let t = Math.max(from, popUntil - 0.15);
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

  // ---- start and stop (P1-A04c) -------------------------------------------------------------------------
  const scheduleStart = (now: number): void => {
    const from = envAt(now);
    seq = { kind: 'start', at: now, base: Math.max(st.rpm, idle), fromIgn: from.ign, fromCents: from.cents, fromStarter: from.starter };
    const cCrank = cents(ig.crankRpm / seq.base);
    const cFlare = cents(ig.flareRpm / seq.base);
    const tc = now + ig.crankS;
    const tf = tc + ig.catchS;
    for (const p of pitchParams) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(cCrank, now);
      p.setValueAtTime(cCrank, tc);
      p.linearRampToValueAtTime(cFlare, tf);
      p.setTargetAtTime(0, tf, ig.settleTauS);
    }
    const g = ign.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(from.ign, now);
    g.linearRampToValueAtTime(ig.crankShare, now + ENGAGE_S);
    g.setValueAtTime(ig.crankShare, tc);
    g.linearRampToValueAtTime(1, tf);
    const sg = stGain.gain;
    sg.cancelScheduledValues(now);
    sg.setValueAtTime(from.starter, now);
    sg.linearRampToValueAtTime(ig.starterLevel, now + ENGAGE_S / 2);
    sg.setValueAtTime(ig.starterLevel, tc);
    sg.linearRampToValueAtTime(0, tc + STARTER_RELEASE_S);
    wire(starterGate, true, now);
    // It catches with a cough through the exhaust.
    if (enabled.pops) schedulePops(now, 1, CATCH_COUGH, tc);
  };

  const scheduleStop = (now: number): void => {
    const from = envAt(now);
    seq = { kind: 'stop', at: now, base: lastBase, fromIgn: from.ign, fromCents: from.cents, fromStarter: from.starter };
    const cEnd = cents((ig.crankRpm * STOP_END_OF_CRANK) / seq.base);
    for (const p of pitchParams) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(from.cents, now);
      p.linearRampToValueAtTime(cEnd, now + ig.stopS);
    }
    const g = ign.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(from.ign, now);
    g.linearRampToValueAtTime(from.ign * CUT_SHARE, now + cutS);
    g.setTargetAtTime(0, now + cutS, stopTau);
    g.setValueAtTime(0, now + ig.stopS);
    const sg = stGain.gain;
    sg.cancelScheduledValues(now);
    sg.setValueAtTime(from.starter, now);
    sg.linearRampToValueAtTime(0, now + 0.05);
    // A stop cancels a cough still waiting for its catch.
    popGain.gain.cancelScheduledValues(now);
    while (pops.length > 0 && (pops.at(-1)?.t ?? 0) >= now) pops.pop();
    popUntil = Math.min(popUntil, now + POP_DECAY_TAU * 8);
  };

  // ---- apply -------------------------------------------------------------------------------------------
  const apply = (now: number): void => {
    const phase = phaseAt(now);
    const es = effective(now);
    lastBase = es.rpm;
    const t = computeTargets(profile, es);
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

    if (boost) {
      const whine = t.boost.whineGain * on('boost');
      const whoosh = t.boost.whooshGain * on('boost');
      boost.whineHz.to(t.boost.whineHz, now, tau);
      boost.whineGain.to(whine, now, tau);
      boost.whooshHz.to(t.boost.whooshHz, now, tau);
      boost.whooshGain.to(whoosh, now, tau);
      wire(boost.gate, whine + whoosh > E, now);
    }

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

    // Once the engine is dying or dead, loose parts only answer the road.
    const rattle = phase === 'stopping' || phase === 'off' ? computeTargets(profile, { ...es, rpm: 0 }).rattle : t.rattle;
    const rtG = rattle.gain * on('rattle');
    D.rtHz.to(rattle.rateHz, now, tau);
    D.rtGain.to(rtG, now, tau);
    wire(rattleGate, rtG > E, now);

    // pops: arm on throttle, fire on the lift (only with the engine running under its own power)
    if (phase === 'running' || phase === 'settling') {
      if (es.throttle >= pp.armThrottle) armed = true;
      if (armed && es.throttle <= pp.fireThrottle && t.rpmN >= pp.minRpmN) {
        armed = false;
        if (enabled.pops) schedulePops(now, pp.burstMin + Math.floor(rng() * (pp.burstMax - pp.burstMin + 1)), 0.4 + 0.6 * t.rpmN);
      }
    } else armed = false;
    wire(popsGate, now < popUntil, now);

    D.stMute.to(on('starter'), now, tau);
    wire(starterGate, phase === 'cranking' || phase === 'catching', now);
  };

  // ---- the voice ---------------------------------------------------------------------------------------
  return {
    output: out,
    profile,
    /** Begins the fade that retires this graph behind a replacement (P1-A04b live swaps). */
    fadeOutAt(now: number): void {
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + SWAP_S);
    },
    layerEnabled: (layer: LayerName): boolean => enabled[layer],
    set(next) {
      if (disposed) return;
      const now = ctx.currentTime;
      const prevGear = st.gear;
      const prevIgnition = st.ignition;
      st = mergeState(profile, st, next);
      if (st.ignition !== prevIgnition) {
        if (st.ignition) scheduleStart(now);
        else scheduleStop(now);
      }
      if (st.gear !== prevGear) {
        startDip(now);
        const rpmN = computeTargets(profile, st).rpmN;
        if (st.gear > prevGear && phaseAt(now) === 'running' && rpmN >= pp.minRpmN && st.throttle >= pp.fireThrottle && enabled.pops) {
          schedulePops(now, 1, pp.upshiftShare * (0.4 + 0.6 * rpmN));
        }
      }
      apply(now);
    },
    levels(): LayerLevels {
      const now = ctx.currentTime;
      const phase = phaseAt(now);
      const es = effective(now);
      const env = envAt(now);
      const t = computeTargets(profile, es);
      const rattle = phase === 'stopping' || phase === 'off' ? computeTargets(profile, { ...es, rpm: 0 }).levels.rattle : t.levels.rattle;
      const keep = (1 - dipDepthAt(now)) * env.ign;
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
        rattle: e('rattle', rattle),
        pops: e('pops', popEnv),
        starter: e('starter', clamp01(env.starter / Math.max(ig.starterLevel, 1e-6))),
      };
    },
    state: () => ({ ...st }),
    ignition(): IgnitionStatus {
      const now = ctx.currentTime;
      const phase = phaseAt(now);
      const ends: Record<EnginePhase, number> = {
        cranking: seq.at + startEnds[0],
        catching: seq.at + startEnds[1],
        settling: seq.at + startEnds[2],
        running: Infinity,
        stopping: seq.at + ig.stopS,
        off: Infinity,
      };
      const rpm = phase === 'running' ? st.rpm : phase === 'off' ? 0 : lastBase * Math.pow(2, envAt(now).cents / 1200);
      return { phase, rpm, endsAt: ends[phase] };
    },
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

/**
 * Creates a car's engine voice. `output` is one persistent GainNode: a live profile swap
 * (`setProfile`, P1-A04b) rebuilds the graph behind it with a ${SWAP_S * 1000} ms equal crossfade,
 * carrying the current state and layer enables, so playback never stops (event layers — an
 * in-flight gear dip or pop — restart with the new graph).
 */
export function create(ctx: BaseAudioContext, profileIn: EngineProfile, options: VoiceOptions = {}): EngineVoice {
  const hub = ctx.createGain();
  hub.gain.value = 1;
  if (options.destination) hub.connect(options.destination);
  let inner = buildGraph(ctx, hub, profileIn, options, -1);
  let disposed = false;
  return {
    get output(): GainNode {
      return hub;
    },
    get profile(): Readonly<EngineProfile> {
      return inner.profile;
    },
    set(state: Partial<VoiceState>): void {
      inner.set(state);
    },
    levels(): LayerLevels {
      return inner.levels();
    },
    state(): VoiceState {
      return inner.state();
    },
    ignition(): IgnitionStatus {
      return inner.ignition();
    },
    setLayerEnabled(layer: LayerName, enabled: boolean): void {
      inner.setLayerEnabled(layer, enabled);
    },
    setProfile(next: EngineProfile): void {
      if (disposed) return;
      const now = ctx.currentTime;
      inner.fadeOutAt(now);
      // The new graph starts in the current state (running or off), so a swap never replays a start.
      const replacement = buildGraph(ctx, hub, next, { ...options, initial: inner.state() }, now);
      for (const l of LAYERS) replacement.setLayerEnabled(l, inner.layerEnabled(l));
      replacement.set(inner.state());
      const old = inner;
      inner = replacement;
      setTimeout(() => old.dispose(), Math.ceil((SWAP_S + SETTLE_S) * 1000) + 100);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      inner.dispose();
      hub.disconnect();
    },
  };
}
