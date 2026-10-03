// Seeded noise (P1-A04). Voices read looping buffers generated once per audio context from fixed seeds, so
// the same input always renders the same samples (the offline lap render is bit-identical run to run) and
// 32 voices share three buffers instead of owning 96.

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix two seeds into one (order matters). */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export interface NoiseBank {
  /** Loop length in seconds (same for all three buffers). */
  seconds: number;
  /** Flat spectrum hiss: intake, exhaust, squeal, rattle and pops are filtered from this. */
  white: AudioBuffer;
  /** Random-walk rumble for the road. */
  brown: AudioBuffer;
  /** Sparse stone-and-clod impacts for dirt and gravel. */
  crackle: AudioBuffer;
}

const BANK_SECONDS = 4;
const BANK_SEED = 0x4a4a0001;
const banks = new WeakMap<BaseAudioContext, NoiseBank>();

function makeBank(ctx: BaseAudioContext): NoiseBank {
  const len = Math.round(ctx.sampleRate * BANK_SECONDS);
  const mk = (): [AudioBuffer, Float32Array] => {
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    return [buf, buf.getChannelData(0)];
  };

  const [white, w] = mk();
  const rw = mulberry32(BANK_SEED);
  for (let i = 0; i < len; i++) w[i] = rw() * 2 - 1;

  // Brown: leaky integration of white noise, normalised.
  const [brown, b] = mk();
  const rb = mulberry32(BANK_SEED ^ 0x1111);
  let acc = 0;
  let peak = 1e-9;
  for (let i = 0; i < len; i++) {
    acc = acc * 0.985 + (rb() * 2 - 1) * 0.1;
    b[i] = acc;
    peak = Math.max(peak, Math.abs(acc));
  }
  // Take out a straight ramp so the last sample meets the first: no click at the loop point.
  const jump = (b[len - 1] ?? 0) - (b[0] ?? 0);
  for (let i = 0; i < len; i++) b[i] = (b[i] ?? 0) - (jump * i) / len;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(b[i] ?? 0));
  for (let i = 0; i < len; i++) b[i] = (b[i] ?? 0) / peak;

  // Crackle: ~55 impacts a second, each a few ms of decaying noise at a random strength.
  const [crackle, c] = mk();
  const rc = mulberry32(BANK_SEED ^ 0x2222);
  const impacts = Math.round(BANK_SECONDS * 55);
  for (let n = 0; n < impacts; n++) {
    const at = Math.floor(rc() * (len - 1024));
    const amp = 0.25 + 0.75 * rc() * rc();
    const decay = 0.0012 + 0.004 * rc();
    const span = Math.min(1024, Math.round(decay * ctx.sampleRate * 6));
    for (let i = 0; i < span; i++) c[at + i] = (c[at + i] ?? 0) + (rc() * 2 - 1) * amp * Math.exp(-i / (decay * ctx.sampleRate));
  }
  let cp = 1e-9;
  for (let i = 0; i < len; i++) cp = Math.max(cp, Math.abs(c[i] ?? 0));
  for (let i = 0; i < len; i++) c[i] = (c[i] ?? 0) / cp;

  return { seconds: BANK_SECONDS, white, brown, crackle };
}

/** The shared noise buffers of a context (built on first use, then cached for the context's life). */
export function noiseBank(ctx: BaseAudioContext): NoiseBank {
  let bank = banks.get(ctx);
  if (!bank) {
    bank = makeBank(ctx);
    banks.set(ctx, bank);
  }
  return bank;
}
