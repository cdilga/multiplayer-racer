// Motion sound (br-0uqj, R125): what the tyres, the air and the ground say, separate from the engine synth. Three layers per
// voiced car, all procedural Web Audio (R89: nothing generated lands in the repo for these):
//   squeal  band-passed noise whose level and pitch follow the slip angle (heading against velocity) and speed, quieter and
//           lower on loose ground (a skid in grit hisses, it does not squeal);
//   roll    rolling noise per surface: tarmac hum, dirt and gravel crunch (sparse grit clicks), off-track rumble; it
//           crossfades when the ground changes and falls away in the air;
//   wind    arrives once a jump has been airborne 0.3 s and rises with the height above the take-off point.
// The numbers that shape them live in MOTION (data, for the owner tuning menu br-2sdu). `MotionTracker` derives the facts the
// snapshot does not carry (slip, airborne, air time, height) from the car record: the sim exposes no such fields, and this
// stays on the host side. State is computed and kept whether or not a context runs, so `levels()` is checkable muted.
import { mulberry32 } from '../../../shared/audio/engine-synth';
import type { Mix } from './mix';

export const SURFACE_NAMES = ['tarmac', 'dirt', 'gravel', 'off-track'] as const;
export type SurfaceName = (typeof SURFACE_NAMES)[number];

export const MOTION = {
  /** Slip angle (rad) where squeal starts and where it is full. */
  slipMin: 0.12,
  slipFull: 0.6,
  /** Ground speed (m/s) where tyre noise starts and is full. */
  squealSpeedMin: 4,
  squealSpeedFull: 14,
  squealGain: 0.5,
  /** Squeal level when sliding without the drift flag (a scrub), against a flagged drift. */
  scrubShare: 0.6,
  squealHz: { min: 900, max: 2600 },
  /** Per surface: squeal share and pitch share, rolling layers (hum / rumble / crunch gains, rumble low-pass Hz, crunch band Hz). */
  surface: {
    tarmac: { squeal: 1, pitch: 1, hum: 0.5, rumble: 0.25, crunch: 0, lp: 450, band: 1800 },
    dirt: { squeal: 0.45, pitch: 0.65, hum: 0, rumble: 0.35, crunch: 0.3, lp: 700, band: 1800 },
    gravel: { squeal: 0.35, pitch: 0.6, hum: 0, rumble: 0.25, crunch: 0.6, lp: 1100, band: 3000 },
    'off-track': { squeal: 0.3, pitch: 0.5, hum: 0, rumble: 0.6, crunch: 0.2, lp: 260, band: 1200 },
  } as Record<SurfaceName, { squeal: number; pitch: number; hum: number; rumble: number; crunch: number; lp: number; band: number }>,
  rollGain: 0.5,
  rollSpeedFull: 30,
  /** Freefall detection: vertical acceleration below this (m/s²) for this long (s) is a take-off. */
  freefallAy: -6,
  takeoffAfterS: 0.1,
  /** Air time before the wind comes in (s), time over which it reaches full, and the height (m) that counts as high. */
  windAfterS: 0.3,
  windRampS: 1.2,
  windHighM: 6,
  windGain: 0.55,
  windHz: { min: 350, max: 2200 },
  /** The exit boost belongs to a drift that ended this recently (s); its size grows with the drift held, to this many s. */
  exitWindowS: 0.6,
  exitFullHeldS: 3,
  /** The engine's throttle share while the wheels are off the ground (it unloads). */
  airThrottle: 0.15,
} as const;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface MotionFact {
  /** Angle between where the car points and where it travels (rad, 0..pi/2); 0 below walking pace. */
  slip: number;
  airborne: boolean;
  /** Seconds since take-off (0 on the ground). */
  airS: number;
  /** Metres above the take-off point (0 on the ground). */
  height: number;
  /** True on the snapshot a take-off was confirmed / a landing happened, with the fall speed at landing. */
  tookOff: boolean;
  landed: boolean;
  fallMps: number;
}

interface TrackState {
  vy: number;
  lowS: number;
  airborne: boolean;
  airS: number;
  y0: number;
}

/** Derives slip, airborne state, air time and height from successive car records. Pure: no audio, no clock. */
export class MotionTracker {
  private cars = new Map<number, TrackState>();

  forget(car: number): void {
    this.cars.delete(car);
  }

  /** `dtS` is the sim time since the car's previous record (> 0); `rot` is the quaternion (x, y, z, w), forward is +z. */
  step(car: number, dtS: number, y: number, rot: readonly [number, number, number, number], vel: readonly [number, number, number]): MotionFact {
    let s = this.cars.get(car);
    if (!s) {
      s = { vy: vel[1], lowS: 0, airborne: false, airS: 0, y0: y };
      this.cars.set(car, s);
    }
    const [qx, qy, qz, qw] = rot;
    // The forward axis (0,0,1) rotated by q, flattened to the ground plane.
    const fx = 2 * (qx * qz + qw * qy);
    const fz = 1 - 2 * (qx * qx + qy * qy);
    const fl = Math.hypot(fx, fz) || 1;
    const sp = Math.hypot(vel[0], vel[2]);
    let slip = 0;
    if (sp > 2) slip = Math.acos(Math.min(1, Math.abs(fx * vel[0] + fz * vel[2]) / (fl * sp)));
    const out: MotionFact = { slip, airborne: s.airborne, airS: 0, height: 0, tookOff: false, landed: false, fallMps: 0 };
    if (dtS > 0) {
      const ay = (vel[1] - s.vy) / dtS;
      if (!s.airborne) {
        s.lowS = ay < MOTION.freefallAy ? s.lowS + dtS : 0;
        if (s.lowS >= MOTION.takeoffAfterS) {
          s.airborne = true;
          s.airS = s.lowS;
          s.y0 = y - vel[1] * s.lowS; // back to where the freefall began, near enough
          out.tookOff = true;
        }
      } else {
        s.airS += dtS;
        if (ay > MOTION.freefallAy + 2) {
          s.airborne = false;
          s.lowS = 0;
          out.landed = true;
          out.fallMps = Math.max(0, -s.vy);
        }
      }
      s.vy = vel[1];
    }
    out.airborne = s.airborne;
    if (s.airborne) {
      out.airS = s.airS;
      out.height = Math.max(0, y - s.y0);
    }
    return out;
  }
}

/** The facts a motion layer reads, per car (the engine bank's CarFact plus what the tracker derived). */
export interface MotionCar {
  car: number;
  speed: number;
  drifting: boolean;
  surface: number;
  slip: number;
  airborne: boolean;
  airS: number;
  height: number;
  held: boolean;
}

export interface MotionLevels {
  car: number;
  surface: SurfaceName;
  slip: number;
  squeal: number;
  squealHz: number;
  roll: number;
  wind: number;
  windHz: number;
  airborne: boolean;
  voiced: boolean;
}

/** The levels the mapping gives for one car's facts (pure; the voice follows these, the probe reads them). */
export function motionLevels(f: MotionCar): Omit<MotionLevels, 'voiced'> {
  const surface = SURFACE_NAMES[f.surface] ?? 'tarmac';
  const sp = MOTION.surface[surface];
  const grounded = !f.airborne && !f.held;
  const speedN = smooth(MOTION.squealSpeedMin, MOTION.squealSpeedFull, f.speed);
  const slipN = smooth(MOTION.slipMin, MOTION.slipFull, f.slip);
  const share = f.drifting ? 1 : MOTION.scrubShare;
  const squeal = grounded ? MOTION.squealGain * Math.pow(slipN, 1.2) * speedN * share * sp.squeal : 0;
  const squealHz = MOTION.squealHz.min + (MOTION.squealHz.max - MOTION.squealHz.min) * (0.6 * slipN + 0.4 * speedN) * sp.pitch;
  const roll = grounded ? MOTION.rollGain * Math.pow(Math.min(1, f.speed / MOTION.rollSpeedFull), 0.8) : 0;
  const heightN = Math.min(1, f.height / MOTION.windHighM);
  const wind = f.airborne && !f.held ? MOTION.windGain * smooth(MOTION.windAfterS, MOTION.windAfterS + MOTION.windRampS, f.airS) * (0.4 + 0.6 * heightN) : 0;
  const windHz = MOTION.windHz.min + (MOTION.windHz.max - MOTION.windHz.min) * Math.min(1, 0.7 * heightN + 0.3 * Math.min(1, f.speed / 30));
  return { car: f.car, surface, slip: f.slip, squeal, squealHz, roll, wind, windHz, airborne: f.airborne };
}

const noiseBufs = new WeakMap<BaseAudioContext, { white: AudioBuffer; grit: AudioBuffer }>();
function buffers(ctx: BaseAudioContext) {
  let b = noiseBufs.get(ctx);
  if (!b) {
    const n = Math.floor(ctx.sampleRate * 2);
    const rnd = mulberry32(0x7a3);
    const white = ctx.createBuffer(1, n, ctx.sampleRate);
    const grit = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = white.getChannelData(0);
    const g = grit.getChannelData(0);
    for (let i = 0; i < n; i++) {
      w[i] = rnd() * 2 - 1;
      // Sparse clicks: grit under a tyre (a handful per 100 samples' worth of milliseconds).
      g[i] = rnd() < 0.004 ? (rnd() * 2 - 1) * 1.5 : 0;
    }
    b = { white, grit };
    noiseBufs.set(ctx, b);
  }
  return b;
}

class MotionVoice {
  private nodes: Array<AudioScheduledSourceNode> = [];
  private sq: GainNode;
  private sqF1: BiquadFilterNode;
  private sqF2: BiquadFilterNode;
  private hum: GainNode;
  private humOsc: OscillatorNode;
  private rumble: GainNode;
  private rumbleLp: BiquadFilterNode;
  private crunch: GainNode;
  private crunchBp: BiquadFilterNode;
  private wind: GainNode;
  private windBp: BiquadFilterNode;
  private out: GainNode;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    const { white, grit } = buffers(ctx);
    const src = (buf: AudioBuffer, offset: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, offset);
      this.nodes.push(s);
      return s;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const bp = (hz: number, q: number) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    this.out = gain(1);
    this.out.connect(dest);
    // squeal: two narrow bands, the second at a fixed ratio above the first
    this.sq = gain();
    this.sqF1 = bp(1500, 10);
    this.sqF2 = bp(2300, 14);
    const sqSrc = src(white, 0.11);
    sqSrc.connect(this.sqF1).connect(this.sq);
    sqSrc.connect(this.sqF2).connect(this.sq);
    this.sq.connect(this.out);
    // roll: hum + low-passed rumble + grit crunch
    this.hum = gain();
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sine';
    this.humOsc.frequency.value = 80;
    this.humOsc.start();
    this.nodes.push(this.humOsc);
    this.humOsc.connect(this.hum).connect(this.out);
    this.rumble = gain();
    this.rumbleLp = ctx.createBiquadFilter();
    this.rumbleLp.type = 'lowpass';
    this.rumbleLp.frequency.value = 450;
    src(white, 0.53).connect(this.rumbleLp).connect(this.rumble).connect(this.out);
    this.crunch = gain();
    this.crunchBp = bp(1800, 0.9);
    src(grit, 0.2).connect(this.crunchBp).connect(this.crunch).connect(this.out);
    // wind
    this.wind = gain();
    this.windBp = bp(500, 0.7);
    src(white, 1.07).connect(this.windBp).connect(this.wind).connect(this.out);
  }

  set(f: MotionCar, l: Omit<MotionLevels, 'voiced'>): void {
    const t = this.ctx.currentTime;
    const sp = MOTION.surface[l.surface];
    const to = (p: AudioParam, v: number, tc = 0.05) => p.setTargetAtTime(v, t, tc);
    to(this.sq.gain, l.squeal, 0.04);
    to(this.sqF1.frequency, l.squealHz, 0.06);
    to(this.sqF2.frequency, l.squealHz * 1.5, 0.06);
    to(this.hum.gain, l.roll * sp.hum, 0.08);
    to(this.humOsc.frequency, 60 + f.speed * 3, 0.1);
    to(this.rumble.gain, l.roll * sp.rumble, 0.08);
    to(this.rumbleLp.frequency, sp.lp, 0.08);
    to(this.crunch.gain, l.roll * sp.crunch * 1.6, 0.08);
    to(this.crunchBp.frequency, sp.band, 0.08);
    to(this.wind.gain, l.wind, 0.12);
    to(this.windBp.frequency, l.windHz, 0.1);
  }

  dispose(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.out.disconnect();
  }
}

export class MotionBank {
  private slots = new Map<number, { voice: MotionVoice | null; last: MotionLevels }>();
  /** Which cars the engine bank voices; the motion layers follow it so one budget covers a car's sound. */
  voiced: (car: number) => boolean = () => true;

  constructor(private mix: Mix) {}

  update(cars: MotionCar[]): void {
    const ctx = this.mix.ctx;
    const bus = this.mix.bus('engine');
    const seen = new Set<number>();
    for (const f of cars) {
      seen.add(f.car);
      const lv = motionLevels(f);
      let s = this.slots.get(f.car);
      if (!s) {
        s = { voice: null, last: { ...lv, voiced: false } };
        this.slots.set(f.car, s);
      }
      const want = Boolean(this.mix.live && ctx && bus && this.voiced(f.car));
      if (want && !s.voice) {
        try {
          s.voice = new MotionVoice(ctx!, bus!);
        } catch {
          s.voice = null;
        }
      } else if (!want && s.voice) {
        s.voice.dispose();
        s.voice = null;
      }
      s.voice?.set(f, lv);
      s.last = { ...lv, voiced: s.voice !== null };
    }
    for (const [car, s] of this.slots) {
      if (!seen.has(car)) {
        s.voice?.dispose();
        this.slots.delete(car);
      }
    }
  }

  /** The levels now, per car, for the introspection surface and the scripted probes. */
  levels(): MotionLevels[] {
    return [...this.slots.values()].map((s) => ({ ...s.last }));
  }

  dispose(): void {
    for (const s of this.slots.values()) s.voice?.dispose();
    this.slots.clear();
  }
}
