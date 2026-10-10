// Engine audio in the game (P1-A05, R103): one synth voice per car (web/shared/audio/engine-synth), driven by the snapshot:
// ground speed and the applied throttle give rpm and gear through the package's drivetrain, the boost meter, the drift flag,
// the ground class under the car and the count of loose or missing parts give the rest. A car's engine starts when it goes
// on (the round's countdown, a respawn's end of hold) and stops when it goes off (a wreck, the round's end): the A04c
// start and stop play out by themselves. The Cruz Missile's profile has no `boost` section, so it makes no turbo sound while
// a profile with one does (the synth never builds the layer).
//
// The mix favours the most active cars and every local player's own car, within a voice budget set by measured cost: the
// synth's graphs are built and driven on the main thread, so the budget follows how long a frame's update takes. It is a
// presentation budget (a car beyond it is just not voiced, and shows `voiced: false`), never a gameplay limit.
//
// With audio blocked or muted the same state is computed and logged (`engines()`), so a scripted round is checkable without
// sound; the voices only exist while the context runs.
import { assertProfile, create, createDrivetrain, type Drivetrain, type EngineProfile, type EngineVoice, type Surface } from '../../../shared/audio/engine-synth';
import type { Mix } from './mix';
import { MOTION } from './motion';

const profileFiles = import.meta.glob('../../../../assets/audio/engine/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const PROFILES: Record<string, EngineProfile> = {};
for (const [path, json] of Object.entries(profileFiles)) {
  if (path.endsWith('manifest.json')) continue;
  const p = assertProfile(json);
  PROFILES[p.id] = p;
}
export const DEFAULT_PROFILE = 'cruz-missile';

export interface CarFact {
  car: number;
  speed: number;
  throttle: number;
  boosting: boolean;
  boost: number;
  drifting: boolean;
  surface: number;
  /** Loose plus detached parts as a fraction of the ten. */
  damage: number;
  held: boolean;
  /** Derived on the host from the car record (br-0uqj); absent in scripted facts that predate them. */
  slip?: number;
  airborne?: boolean;
  airS?: number;
  height?: number;
}

interface Slot {
  car: number;
  profile: EngineProfile;
  drive: Drivetrain;
  voice: EngineVoice | null;
  on: boolean;
  rpm: number;
  gear: number;
  fact: CarFact;
  score: number;
}

// Ground class 3 (off-track) has the dirt voice here; the motion layer (motion.ts) gives it its own rumble.
const SURFACES: Surface[] = ['tarmac', 'dirt', 'gravel', 'dirt'];
/** The voices the budget never goes below, and the most it grows to, however the cost reads. */
const MIN_VOICES = 4;
/** Update cost (ms per snapshot) the budget aims to stay under. */
const COST_TARGET_MS = 0.8;

export class EngineBank {
  private slots = new Map<number, Slot>();
  /** Which profile a car uses (a vehicle's data; every car is the Cruz Missile today). */
  profileOf: (car: number) => string = () => DEFAULT_PROFILE;
  /** Cars whose engine is wanted on, by the director (the round's phases). */
  wantOn: (car: number) => boolean = () => true;
  /** Cars that are a local player's own (always voiced). */
  own: () => ReadonlySet<number> = () => new Set();
  budget = 16;
  /** Steady cost of one snapshot's engine update, ms (EMA), and what building one voice's graph cost last time. */
  costMs = 0;
  buildMs = 0;
  private lastT = 0;

  constructor(private mix: Mix) {}

  /** One snapshot's worth of car facts. */
  update(facts: CarFact[], nowMs = performance.now()): void {
    const t0 = performance.now();
    const dt = this.lastT ? Math.min(0.25, Math.max(0.001, (nowMs - this.lastT) / 1000)) : 1 / 60;
    this.lastT = nowMs;
    const seen = new Set<number>();
    const own = this.own();
    for (const f of facts) {
      seen.add(f.car);
      let s = this.slots.get(f.car);
      const id = this.profileOf(f.car);
      const profile = PROFILES[id] ?? PROFILES[DEFAULT_PROFILE]!;
      if (!s || s.profile !== profile) {
        s?.voice?.dispose();
        s = { car: f.car, profile, drive: createDrivetrain(profile), voice: null, on: false, rpm: profile.engine.idleRpm, gear: 1, fact: f, score: 0 };
        this.slots.set(f.car, s);
        this.mix.note('engine', { car: f.car, profile: profile.id, boostLayer: Boolean(profile.boost), reason: 'car-seen' });
      }
      s.fact = f;
      const want = this.wantOn(f.car) && !f.held;
      if (want !== s.on) {
        s.on = want;
        this.mix.note('engine', { car: f.car, ignition: want, reason: want ? 'engine-on' : f.held ? 'wrecked-or-held' : 'engine-off' });
        s.voice?.set({ ignition: want });
      }
      const out = s.drive.step(dt, f.speed, f.throttle);
      s.rpm = out.rpm;
      s.gear = out.gear;
      s.score = f.speed + (own.has(f.car) ? 1000 : 0) + (s.on ? 5 : 0);
    }
    for (const [car, s] of this.slots) {
      if (!seen.has(car)) {
        s.voice?.dispose();
        this.slots.delete(car);
        this.mix.note('engine', { car, reason: 'car-gone' });
      }
    }
    const built = this.voice();
    // The budget follows the measured cost: over target it sheds voices (never below the floor and the own cars), well under
    // it grows back.
    // A frame that built a voice graph (a one-off, a few ms each) is counted apart: the steady per-snapshot cost is what the
    // budget follows.
    const cost = performance.now() - t0;
    if (built > 0) this.buildMs = cost / built;
    else this.costMs = this.costMs ? this.costMs * 0.9 + cost * 0.1 : cost;
    if (this.costMs > COST_TARGET_MS && this.budget > MIN_VOICES) this.budget--;
    else if (this.costMs < COST_TARGET_MS * 0.4 && this.budget < 64) this.budget++;
  }

  /** Builds voices for the top cars within the budget (when the context runs), drops the rest, and drives each. */
  private voice(): number {
    let created = 0;
    const ctx = this.mix.ctx;
    const bus = this.mix.bus('engine');
    const ranked = [...this.slots.values()].sort((a, b) => b.score - a.score || a.car - b.car);
    const own = this.own();
    let voiced = 0;
    for (const s of ranked) {
      const allowed = this.mix.live && ctx && bus && (own.has(s.car) || voiced < this.budget);
      if (!allowed) {
        if (s.voice) {
          s.voice.dispose();
          s.voice = null;
          this.mix.note('engine', { car: s.car, reason: 'culled' });
        }
        continue;
      }
      voiced++;
      if (!s.voice) {
        try {
          s.voice = create(ctx, s.profile, { destination: bus, seed: s.car + 1, initial: { ignition: s.on } });
          created++;
        } catch {
          continue;
        }
      }
      const f = s.fact;
      s.voice.set({
        rpm: s.rpm,
        // Wheels off the ground, the engine unloads (throttle falls away). Tyre squeal is the motion layer's (it follows slip).
        throttle: f.airborne ? f.throttle * MOTION.airThrottle : f.throttle,
        boost: f.boosting ? 1 : 0,
        drift: 0,
        surface: SURFACES[f.surface] ?? 'tarmac',
        damage: f.damage,
        gear: s.gear,
        speed: f.speed,
        ignition: s.on,
      });
    }
    return created;
  }

  /** True when the car's engine voice exists (the motion layers share its budget). */
  isVoiced(car: number): boolean {
    return this.slots.get(car)?.voice != null;
  }

  /** The engines now, for the introspection surface and the scripted-round tests. */
  engines() {
    return [...this.slots.values()].map((s) => ({
      car: s.car,
      profile: s.profile.id,
      ignition: s.on,
      phase: s.voice?.ignition().phase ?? (s.on ? 'running' : 'off'),
      rpm: Math.round(s.rpm),
      gear: s.gear,
      throttle: +s.fact.throttle.toFixed(2),
      speed: +s.fact.speed.toFixed(1),
      boosting: s.fact.boosting,
      surface: SURFACES[s.fact.surface] ?? 'tarmac',
      damage: +s.fact.damage.toFixed(2),
      voiced: s.voice !== null,
      boostLayerBuilt: Boolean(s.profile.boost),
      boostLevel: s.voice ? +s.voice.levels().boost.toFixed(3) : 0,
    }));
  }

  dispose(): void {
    for (const s of this.slots.values()) s.voice?.dispose();
    this.slots.clear();
  }
}

/** Renders `voices` engines offline for `seconds` of audio, scripted through a lap-like speed ramp: how many times faster than
 *  real time the audio graph runs (the CPU the mix costs; > 1 is within budget), for the cost receipts. */
export async function benchEngines(voices: number, seconds: number, profileId = DEFAULT_PROFILE): Promise<{ voices: number; seconds: number; wallMs: number; realtimeFactor: number }> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(rate * seconds), rate);
  const profile = PROFILES[profileId]!;
  const vs = Array.from({ length: voices }, (_, i) => ({ v: create(ctx, profile, { destination: ctx.destination, seed: i + 1 }), d: createDrivetrain(profile) }));
  for (let t = 0; t < seconds; t += 0.05) {
    for (const [i, x] of vs.entries()) {
      const speed = 8 + 25 * Math.abs(Math.sin(t * 0.4 + i));
      const th = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.9 + i));
      const o = x.d.step(0.05, speed, th);
      // Offline contexts take scheduled changes by time: suspend/resume would be exact; setting at t = 0 and letting each
      // layer glide is enough for a cost number.
      if (t === 0) x.v.set({ rpm: o.rpm, throttle: th, gear: o.gear, speed });
    }
  }
  const t0 = performance.now();
  await ctx.startRendering();
  const wallMs = performance.now() - t0;
  vs.forEach((x) => x.v.dispose());
  return { voices, seconds, wallMs: Math.round(wallMs), realtimeFactor: +((seconds * 1000) / wallMs).toFixed(1) };
}
