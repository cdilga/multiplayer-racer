// Public types of the engine synth (P1-A04). Framework-free: no imports beyond the DOM Web Audio types.

/** The surfaces the rumble layer knows. Data lives in the profile; this list is the schema's enum. */
export const SURFACES = ['tarmac', 'dirt', 'gravel'] as const;
export type Surface = (typeof SURFACES)[number];

/** Every audible layer of a voice, in mix order. Each is driven by state (see mapping.ts). */
export const LAYERS = ['firing', 'intake', 'exhaust', 'boost', 'squeal', 'surface', 'rattle', 'pops'] as const;
export type LayerName = (typeof LAYERS)[number];

/** The state a car's audio is a pure function of. All numbers are plain JS numbers; nothing else is read. */
export interface VoiceState {
  /** Engine speed in revolutions per minute. Clamped to [0, limiterRpm]. */
  rpm: number;
  /** Accelerator position, 0 (off) to 1 (floored). */
  throttle: number;
  /** Boost pressure, 0 (none) to 1 (full). */
  boost: number;
  /** Tyre slip, 0 (gripping) to 1 (full slide). Drives the squeal. */
  drift: number;
  /** What the tyres roll on. */
  surface: Surface;
  /** Loose-part fraction, 0 (intact) to 1 (everything hanging off). Drives the rattle. */
  damage: number;
  /** Current gear, 0 for neutral. A change triggers the gear-change dip. */
  gear: number;
  /**
   * Ground speed in metres per second. Optional: with none given it is derived from rpm and gear through the
   * profile's gearbox, so a caller that only knows the engine still gets a sensible rumble. `set` merges, so a
   * speed you gave stays until you pass `speed: undefined` explicitly.
   */
  speed?: number;
}

/** A 0..1 magnitude per layer after the profile's mapping (before mute and master level). */
export type LayerLevels = Record<LayerName, number>;

export interface SurfaceProfile {
  /** Low rumble (brown noise) share, 0..1. */
  brown: number;
  /** Stone-and-clod crackle share, 0..1. */
  crackle: number;
  /** Low-pass cutoff of the rumble, Hz. */
  cutoffHz: number;
  /** Low-pass resonance. */
  q: number;
  /** Layer level multiplier for this surface (0..1). */
  level: number;
}

export interface EngineProfile {
  format: 'jj-engine-profile';
  version: 1;
  id: string;
  name: string;
  description: string;
  engine: {
    cylinders: number;
    idleRpm: number;
    redlineRpm: number;
    /** Hard limit; rpm is clamped here. */
    limiterRpm: number;
  };
  gearbox: {
    /** Overall ratios, first gear first. */
    ratios: number[];
    finalDrive: number;
    wheelRadiusM: number;
    upshiftRpm: number;
    downshiftRpm: number;
    shiftTimeS: number;
    /** Slipping-clutch rpm at full throttle from a standstill. */
    launchRpm: number;
    rpmRiseTauS: number;
    rpmFallTauS: number;
  };
  output: {
    /** Linear gain of the voice's output node. */
    level: number;
    /** Time constant (s) used when a layer follows its target. */
    controlTauS: number;
    /** Seed of the profile's noise; voices add their own seed on top. */
    noiseSeed: number;
  };
  firing: {
    level: number;
    /** Level at zero throttle as a fraction of `level`. */
    offThrottleLevel: number;
    mellow: { phase: 'sine' | 'cosine'; harmonics: number[] };
    bright: { phase: 'sine' | 'cosine'; harmonics: number[] };
    /** Share of the bright wave at full throttle and redline. */
    brightMax: number;
    bodyFilter: { minHz: number; maxHz: number; q: number; throttleOpen: number };
    /** Lumpy half-order idle burble: amplitude modulation at half the firing rate. */
    lope: { depth: number; fadeOutRpmN: number };
  };
  intake: { level: number; minHz: number; maxHz: number; q: number };
  exhaust: {
    level: number;
    minHz: number;
    maxHz: number;
    q: number;
    /** Depth of the amplitude modulation at the firing rate, 0..1. */
    pulseDepth: number;
    pulseHarmonics: number[];
  };
  boost: {
    level: number;
    whineBaseHz: number;
    whineSweepHz: number;
    whineRpmHz: number;
    whooshLevel: number;
    whooshHz: number;
    whooshSweepHz: number;
  };
  squeal: {
    level: number;
    centerMinHz: number;
    centerMaxHz: number;
    q: number;
    /** Second resonance as a ratio of the first. */
    secondRatio: number;
    wobbleHz: number;
    wobbleDepth: number;
    minSpeedMps: number;
    fullSpeedMps: number;
  };
  surface: {
    level: number;
    fullSpeedMps: number;
    speedExponent: number;
    tarmac: SurfaceProfile;
    dirt: SurfaceProfile;
    gravel: SurfaceProfile;
  };
  rattle: {
    level: number;
    baseRateHz: number;
    rpmRateScale: number;
    /** Share of the rattle that is present at idle (it grows with revs and speed). */
    idleShare: number;
    bandsHz: number[];
    q: number;
    /** Cosine harmonics of the chop wave: fewer harmonics = wider, softer clatter pulses. */
    pulseHarmonics: number[];
  };
  pops: {
    level: number;
    /** The throttle must have been above this (armed) ... */
    armThrottle: number;
    /** ... and then drop below this to fire. */
    fireThrottle: number;
    minRpmN: number;
    burstMin: number;
    burstMax: number;
    gapMinS: number;
    gapMaxS: number;
    bandHz: number;
    q: number;
    /** Single pop on a gear change at high revs, as a fraction of `level`. */
    upshiftShare: number;
  };
  gearDip: {
    /** Fraction of engine level removed at the bottom of the dip. */
    depth: number;
    rampS: number;
    holdS: number;
    recoverTauS: number;
  };
}

export interface VoiceOptions {
  /** Where the voice's output connects. Omit to leave it unconnected (use `voice.output`). */
  destination?: AudioNode;
  /** Decorrelates this voice's noise from other voices. Same seed in a fresh context gives identical audio. */
  seed?: number;
  /** State the voice starts in (applied at once, with no gear dip and no glide from silence). */
  initial?: Partial<VoiceState>;
}

export interface EngineVoice {
  /** The voice's single output node. Connect it where you like. */
  readonly output: GainNode;
  /** The profile this voice was built from. */
  readonly profile: Readonly<EngineProfile>;
  /** Merge in new state (partial allowed) and move every layer towards it. Call it as often as the state changes. */
  set(state: Partial<VoiceState>): void;
  /** The 0..1 magnitude of each layer right now (state mapping plus the gear dip), for meters and tests. */
  levels(): LayerLevels;
  /** The full state the voice currently holds. */
  state(): VoiceState;
  /** Silence one layer (design-review solo/mute and tests). */
  setLayerEnabled(layer: LayerName, enabled: boolean): void;
  /** Stop all sources and disconnect every node. The voice is unusable afterwards. */
  dispose(): void;
}
