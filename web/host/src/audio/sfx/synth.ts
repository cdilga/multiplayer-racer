// Procedural sound effects (P1-A07, R89: no generated files in this repo's sessions, so every effect is a Web Audio recipe).
// Each recipe builds a short graph of oscillators and filtered noise into `dest` starting at `when`, with an `intensity`
// 0..1 (a light knock to a big crunch). Recipes are deterministic (a seeded noise bank), so a trigger always sounds the same
// at the same intensity. `renderSfx` renders one offline (no context or gesture needed) for the receipts: length, peak, RMS.
import { mulberry32 } from '../../../../shared/audio/engine-synth';

export const SFX_KINDS = [
  'impact', // a car hits a car or the scenery: knock (light) to crunch (heavy), by impulse
  'debris-rattle', // a car hits a debris body or a part
  'part-rattle', // a part goes loose
  'part-clunk', // a part comes off
  'wreck-crunch',
  'landing-thud',
  'boost-whoosh',
  'oi-honk',
  'cone-thunk',
  'join-chime',
  'identify-ping',
  'countdown-beep',
  'countdown-go',
  'ready-tick',
  'results-sting',
] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    const rnd = mulberry32(0x5f3);
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

type G = { ctx: BaseAudioContext; dest: AudioNode; t: number; k: number };

function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function burst({ ctx, dest, t }: G, o: { type?: BiquadFilterType; hz: number; q?: number; peak: number; attack?: number; decay: number; sweepTo?: number }): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.hz, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.attack ?? 0.003) + o.decay);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  env(g, t, o.peak, o.attack ?? 0.003, o.decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, 0);
  src.stop(t + (o.attack ?? 0.003) + o.decay + 0.05);
}

function tone({ ctx, dest, t }: G, o: { type?: OscillatorType; hz: number; to?: number; peak: number; attack?: number; decay: number }): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.hz, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0.003) + o.decay);
  const g = ctx.createGain();
  env(g, t, o.peak, o.attack ?? 0.003, o.decay);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.003) + o.decay + 0.05);
}

const RECIPES: Record<SfxKind, (g: G) => void> = {
  impact(g) {
    const k = g.k;
    tone(g, { hz: 140 - 70 * k, to: 38, peak: 0.35 + 0.55 * k, decay: 0.14 + 0.25 * k });
    burst(g, { hz: 900 - 500 * k, q: 0.8, peak: 0.25 + 0.5 * k, decay: 0.07 + 0.2 * k });
    if (k > 0.45) burst(g, { type: 'highpass', hz: 2400, peak: 0.12 * k, decay: 0.25 + 0.2 * k });
    if (k > 0.35) tone(g, { type: 'square', hz: 330, to: 210, peak: 0.07 * k, decay: 0.12 });
  },
  'debris-rattle'(g) {
    for (let i = 0; i < 4 + Math.round(g.k * 5); i++) burst({ ...g, t: g.t + i * (0.035 + 0.01 * (i % 3)) }, { hz: 1500 + 700 * (i % 4), q: 4, peak: 0.4 * (1 - i * 0.07), decay: 0.05 });
  },
  'part-rattle'(g) {
    for (let i = 0; i < 3; i++) burst({ ...g, t: g.t + i * 0.05 }, { hz: 2200 + 600 * i, q: 6, peak: 0.3, decay: 0.06 });
  },
  'part-clunk'(g) {
    tone(g, { hz: 190, to: 70, peak: 0.55, decay: 0.2 });
    tone(g, { type: 'triangle', hz: 740, to: 520, peak: 0.2, decay: 0.3 });
    burst(g, { hz: 1800, q: 5, peak: 0.25, decay: 0.12 });
  },
  'wreck-crunch'(g) {
    tone(g, { hz: 90, to: 30, peak: 0.9, decay: 0.7 });
    burst(g, { hz: 700, q: 0.7, peak: 0.7, decay: 0.35, sweepTo: 200 });
    burst({ ...g, t: g.t + 0.05 }, { type: 'highpass', hz: 2600, peak: 0.3, decay: 0.5 });
    for (let i = 0; i < 6; i++) burst({ ...g, t: g.t + 0.18 + i * 0.07 }, { hz: 1400 + 400 * (i % 3), q: 5, peak: 0.16 - i * 0.02, decay: 0.05 });
  },
  'landing-thud'(g) {
    tone(g, { hz: 85 - 25 * g.k, to: 32, peak: 0.4 + 0.5 * g.k, decay: 0.18 + 0.15 * g.k });
    burst(g, { type: 'lowpass', hz: 500, peak: 0.25 * (0.5 + g.k), decay: 0.12 });
  },
  'boost-whoosh'(g) {
    burst(g, { hz: 400, q: 1.2, peak: 0.5, attack: 0.18, decay: 0.55, sweepTo: 3200 });
  },
  'oi-honk'(g) {
    const t = g.t;
    for (const [hz, dt] of [[392, 0], [330, 0.16]] as const) {
      tone({ ...g, t: t + dt }, { type: 'sawtooth', hz, peak: 0.28, attack: 0.01, decay: 0.2 });
      tone({ ...g, t: t + dt }, { type: 'square', hz: hz * 1.5, peak: 0.1, attack: 0.01, decay: 0.18 });
    }
  },
  'cone-thunk'(g) {
    tone(g, { hz: 260, to: 110, peak: 0.5, decay: 0.12 });
    burst(g, { hz: 1100, q: 2, peak: 0.25, decay: 0.07 });
  },
  'join-chime'(g) {
    tone(g, { hz: 659, peak: 0.22, attack: 0.006, decay: 0.35 });
    tone({ ...g, t: g.t + 0.09 }, { hz: 988, peak: 0.22, attack: 0.006, decay: 0.5 });
  },
  'identify-ping'(g) {
    tone(g, { hz: 1320, peak: 0.3, attack: 0.004, decay: 0.5 });
    tone({ ...g, t: g.t + 0.14 }, { hz: 1320, peak: 0.22, attack: 0.004, decay: 0.45 });
  },
  'countdown-beep'(g) {
    tone(g, { type: 'square', hz: 660, peak: 0.2, attack: 0.004, decay: 0.16 });
  },
  'countdown-go'(g) {
    tone(g, { type: 'square', hz: 1320, peak: 0.24, attack: 0.004, decay: 0.45 });
    tone(g, { type: 'sawtooth', hz: 660, peak: 0.12, attack: 0.004, decay: 0.45 });
  },
  'ready-tick'(g) {
    tone(g, { type: 'triangle', hz: 880, peak: 0.16, attack: 0.002, decay: 0.07 });
  },
  'results-sting'(g) {
    [523, 659, 784, 1047].forEach((hz, i) => tone({ ...g, t: g.t + i * 0.11 }, { type: 'triangle', hz, peak: 0.24, attack: 0.008, decay: 0.55 }));
  },
};

/** Builds `kind` into `dest` starting at context time `when`. */
export function playSfx(ctx: BaseAudioContext, dest: AudioNode, kind: SfxKind, intensity: number, when = ctx.currentTime): void {
  RECIPES[kind]({ ctx, dest, t: when, k: Math.min(1, Math.max(0, intensity)) });
}

/** Renders `kind` offline (1.6 s, 44.1 kHz mono): its peak and RMS, for the receipts that say it isn't silent. */
export async function renderSfx(kind: SfxKind, intensity = 0.7): Promise<{ kind: SfxKind; intensity: number; peak: number; rms: number; tailMs: number }> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, Math.floor(rate * 1.6), rate);
  playSfx(ctx, ctx.destination, kind, intensity, 0);
  const d = (await ctx.startRendering()).getChannelData(0);
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]!);
    peak = Math.max(peak, a);
    sum += a * a;
    if (a > 0.005) last = i;
  }
  return { kind, intensity, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), tailMs: Math.round((last / rate) * 1000) };
}
