// The audio director (P1-A03/A05/A07): turns the round's facts into sound. It listens to three feeds the host already has:
//   room views  (client.onRoom: phase, seats, laps, results)   -> music, countdown, phase cues, UI sounds
//   sim events  (client.onEvents: JSON SimEvents)              -> announcer moments, impacts, detaches, wrecks, utilities
//   snapshots   (the car records and part records)             -> engines, boost whoosh, landings
// and decides, per fact, which announcer moment (A00's sheet names the trigger), which effect and which engine change. All of
// it is presentation: nothing here changes what the sim or the round does, a blocked or muted context only silences it, and
// each trigger is logged (`window.__jjAudio.log()`) whether or not it could be heard.
import type { RoomView, SimEventJson } from '../worker/client';
import { SNAPSHOT_CAR, SNAPSHOT_DEBRIS, SNAPSHOT_HEADER } from '../render/snapshot';
import { Announcer } from './announcer';
import { DEFAULT_PROFILE, EngineBank, type CarFact } from './engine';
import type { Mix } from './mix';
import { MOTION, MotionBank, MotionTracker, SURFACE_NAMES, type MotionCar } from './motion';
import { Music, type MusicCue } from './music';
import type { Sfx } from './sfx';

type Phase = RoomView['phase'];
const FLAG_HELD = 8;
const FLAG_BOOSTING = 16;
const FLAG_DRIFTING = 32;
/** Two finishes this close are a photo finish, ms. */
const PHOTO_FINISH_MS = 500;
/** A leader change needs the new leader to hold it this long to be called, ms. */
const LEAD_HOLD_MS = 1500;

/** Which announcer moment a detached part's index belongs to (the vehicle contract's part order). */
export function detachMoment(part: number): string {
  if (part >= 7) return 'wheel-off';
  if (part >= 3) return 'door-off';
  return 'bodywork-off';
}

/** The impact intensity 0..1 for an episode's impulse (N·s): a nudge past the 4 m/s threshold is ~1 kN·s, a crash 15+ kN·s. */
export function impactIntensity(impulseNs: number): number {
  return Math.min(1, Math.max(0.08, Math.log10(Math.max(1, impulseNs) / 400) / Math.log10(30)));
}

export class AudioDirector {
  readonly engines: EngineBank;
  room: RoomView | null = null;
  private phase: Phase | null = null;
  private roundKey: number | null = null;
  private flags = { welcome: false, allReady: false, finalLap: false, firstFinish: 0, winner: false, timeUp: false, nextRound: false };
  private leader: { seat: number | null; candidate: number | null; since: number } = { seat: null, candidate: null, since: 0 };
  private wrecked = new Set<number>(); // cars in their wreck hold
  private lastBeep = -1;
  private vy = new Map<number, number>();
  private boosting = new Set<number>();
  /** Slip, take-off and landing derived from the car records (br-0uqj), and the layers that follow them. */
  readonly tracker = new MotionTracker();
  readonly motion: MotionBank;
  private lastTick = new Map<number, number>();
  private mstate = new Map<number, { drifting: boolean; driftAt: number; driftEndAt: number; heldS: number; surface: number | undefined; air: boolean; wind: boolean }>();

  constructor(
    private mix: Mix,
    private announcer: Announcer,
    private music: Music,
    private sfx: Sfx,
    engines?: EngineBank,
  ) {
    this.engines = engines ?? new EngineBank(mix);
    this.engines.own = () => new Set(this.room?.seats.filter((s) => s.local && s.car !== null).map((s) => s.car as number) ?? []);
    this.engines.wantOn = (car) => this.engineWanted(car);
    // Each car's engine is its roster vehicle's profile (R123): the snapshot says which vehicle, the room names them.
    this.engines.profileOf = (car) => this.vehicleIds[this.vehicleByCar.get(car) ?? 0] ?? DEFAULT_PROFILE;
    this.motion = new MotionBank(mix);
    this.motion.voiced = (car) => this.engines.isVoiced(car);
  }

  private carOf(seat: number): number | null {
    return this.room?.seats.find((s) => s.seat === seat)?.car ?? null;
  }

  private engineWanted(car: number): boolean {
    if (this.wrecked.has(car)) return false;
    const r = this.room;
    if (!r) return true;
    if (r.freeDrive) return true;
    return r.phase === 'Countdown' || r.phase === 'Running' || r.phase === 'Finalising';
  }

  // --- room views -----------------------------------------------------------------------------------------------------

  /** The roster's vehicle ids in the host's table order (from the room view), and each car's vehicle index (from the snapshot). */
  private vehicleIds: string[] = [];
  private vehicleByCar = new Map<number, number>();

  onRoom(room: RoomView, nowMs = performance.now()): void {
    const prev = this.phase;
    this.room = room;
    if (room.vehicles) this.vehicleIds = room.vehicles;
    this.phase = room.phase;
    if (!this.flags.welcome) {
      this.flags.welcome = true;
      this.announcer.say('welcome', 'room.opened', nowMs);
    }
    if (room.round !== this.roundKey) {
      this.roundKey = room.round;
      this.flags = { ...this.flags, finalLap: false, firstFinish: 0, winner: false, timeUp: false, nextRound: false };
      this.leader = { seat: null, candidate: null, since: 0 };
      this.wrecked.clear();
    }
    if (room.phase !== prev) this.onPhase(room, prev, nowMs);
    if (room.phase === 'Lobby') {
      const ready = room.seats.length > 0 && room.seats.every((s) => s.ready);
      if (ready && !this.flags.allReady) this.announcer.say('all-ready', 'lobby.all_ready', nowMs);
      this.flags.allReady = ready;
    }
    if (room.phase === 'Countdown' && room.remainingMs !== null) this.beep(room.remainingMs);
    if (room.phase === 'Running') this.watchLeader(room, nowMs);
  }

  private onPhase(room: RoomView, prev: Phase | null, nowMs: number): void {
    const why = `phase ${prev ?? '-'}→${room.phase}`;
    const cue = (c: MusicCue) => this.music.set(c, why);
    switch (room.phase) {
      case 'Lobby':
        cue('lobby');
        break;
      case 'Preparing':
        break;
      case 'Countdown':
        this.lastBeep = -1;
        cue('none');
        this.announcer.say('countdown', 'phase.countdown', nowMs);
        break;
      case 'Running':
        cue('race');
        this.sfx.trigger('countdown-go', 1, 'phase.running');
        break;
      case 'Finalising':
        if (!this.flags.timeUp && room.seats.some((s) => !s.finished)) {
          this.flags.timeUp = true;
          this.announcer.say('time-up', 'race.time_up', nowMs);
        }
        break;
      case 'Intermission':
        cue('results');
        this.result(nowMs, 'phase.intermission');
        break;
      default:
        cue('none');
    }
  }

  /** The round's results are in: the winner cue and the sting, once per round. */
  private result(nowMs: number, reason: string): void {
    if (this.flags.winner) return;
    this.flags.winner = true;
    this.announcer.say('winner', 'round.results', nowMs);
    this.sfx.trigger('results-sting', 0.8, reason);
  }

  private beep(remainingMs: number): void {
    const n = Math.ceil(remainingMs / 1000);
    if (n >= 1 && n <= 3 && n !== this.lastBeep) {
      this.lastBeep = n;
      this.sfx.trigger('countdown-beep', 0.6, 'phase.countdown', { count: n });
    }
  }

  private watchLeader(room: RoomView, nowMs: number): void {
    const lead = room.seats.find((s) => s.position === 1)?.seat ?? null;
    if (lead === null) return;
    const l = this.leader;
    if (l.seat === null) {
      l.seat = lead;
      return;
    }
    if (lead === l.seat) {
      l.candidate = null;
      return;
    }
    if (l.candidate !== lead) {
      l.candidate = lead;
      l.since = nowMs;
    } else if (nowMs - l.since >= LEAD_HOLD_MS) {
      l.seat = lead;
      l.candidate = null;
      this.announcer.say('lead-change', 'race.lead_change', nowMs);
    }
  }

  // --- sim events -----------------------------------------------------------------------------------------------------

  onEvents(events: SimEventJson[], nowMs = performance.now()): void {
    for (const e of events) this.onEvent(e, nowMs);
  }

  private onEvent(e: SimEventJson, nowMs: number): void {
    const say = (m: string, why: string) => this.announcer.say(m, why, nowMs);
    for (const [kind, v] of Object.entries(e)) {
      const seat = Number(v.seat);
      switch (kind) {
        case 'SeatJoined':
          this.sfx.trigger('join-chime', 0.7, 'seat.joined', { seat });
          if (this.phase === 'Running') say('late-joiner', 'seat.late_join');
          break;
        case 'Identify':
          this.sfx.trigger('identify-ping', 0.8, 'seat.identify', { seat }, String(seat));
          break;
        case 'Lap': {
          const lap = Number(v.lap);
          const laps = this.room?.laps ?? 0;
          if (laps > 1 && lap === laps - 1 && !this.flags.finalLap) {
            this.flags.finalLap = true;
            say('final-lap', 'race.final_lap');
          }
          break;
        }
        case 'Finished': {
          const n = ++this.flags.firstFinish;
          const ms = Number(v.time_ms);
          if (n === 1) {
            this.firstFinishMs = ms;
            say('first-finisher', 'race.first_finish');
          } else if (n === 2 && Math.abs(ms - this.firstFinishMs) <= PHOTO_FINISH_MS) say('photo-finish', 'race.photo_finish');
          break;
        }
        case 'Results':
          this.result(nowMs, 'event.results');
          break;
        case 'PrepareRequested':
          if (this.phase === 'Intermission' && !this.flags.nextRound) {
            this.flags.nextRound = true;
            say('next-round', 'intermission.next_ready');
          }
          break;
        case 'Oi':
          this.sfx.trigger('oi-honk', 0.8, 'utility.oi', { seat }, String(seat));
          break;
        case 'ConeDropped':
          this.sfx.trigger('cone-thunk', 0.7, 'utility.cone', { seat }, String(seat));
          break;
        case 'PartLoose':
          this.sfx.trigger('part-rattle', 0.5, 'part.loose', { seat, part: v.part }, `${seat}:${v.part}`);
          break;
        case 'PartDetached':
          this.sfx.trigger('part-clunk', 0.8, 'part.detached', { seat, part: v.part, cause: v.cause }, `${seat}:${v.part}`);
          say(detachMoment(Number(v.part)), `part.detached.${detachMoment(Number(v.part)).replace('-off', '')}`);
          break;
        case 'Wrecked': {
          const car = this.carOf(seat);
          if (car !== null) this.wrecked.add(car);
          this.sfx.trigger('wreck-crunch', 1, 'car.wrecked', { seat, cause: v.cause }, String(seat));
          say(v.cause === 'OutOfBounds' ? 'off-course' : 'wreck', v.cause === 'OutOfBounds' ? 'car.out_of_bounds' : 'car.wrecked');
          break;
        }
        case 'Episode': {
          const r = v.record as { seat: number; other: unknown; impulse_ns: number; closing_mm_s: number; part: number };
          const k = impactIntensity(Number(r.impulse_ns));
          const debris = typeof r.other === 'object' && r.other !== null && 'Debris' in (r.other as object);
          if (debris) this.sfx.trigger('debris-rattle', k, 'episode.debris', { seat: r.seat, impulse: r.impulse_ns }, `${r.seat}:d`);
          else this.sfx.trigger('impact', k, 'episode.contact', { seat: r.seat, part: r.part, impulse: r.impulse_ns, closingMps: +(r.closing_mm_s / 1000).toFixed(1) }, `${r.seat}:${r.part}`);
          break;
        }
        default:
      }
    }
  }
  private firstFinishMs = 0;

  // --- snapshots ------------------------------------------------------------------------------------------------------

  /** Reads the car and part records of a snapshot (before the renderer releases its buffer). */
  onSnapshot(view: DataView, nowMs = performance.now()): void {
    try {
      const cars = view.getUint32(28, true);
      const debris = view.getUint32(32, true);
      const parts = view.getUint32(36, true);
      const loose = new Map<number, number>();
      const partAt = SNAPSHOT_HEADER + SNAPSHOT_CAR * cars + SNAPSHOT_DEBRIS * debris;
      for (let i = 0; i < parts; i++) {
        const at = partAt + i * 40;
        if (at + 40 > view.byteLength) break;
        const state = view.getUint16(at + 6, true);
        if (state === 1 || state === 2) loose.set(view.getUint32(at, true), (loose.get(view.getUint32(at, true)) ?? 0) + 1);
      }
      const tick = Number(view.getBigUint64(8, true));
      const facts: CarFact[] = [];
      const motion: MotionCar[] = [];
      for (let i = 0; i < cars; i++) {
        const at = SNAPSHOT_HEADER + i * SNAPSHOT_CAR;
        const car = view.getUint32(at, true);
        const vx = view.getFloat32(at + 36, true);
        const vy = view.getFloat32(at + 40, true);
        const vz = view.getFloat32(at + 44, true);
        const flags = view.getUint32(at + 52, true);
        const fact: CarFact = {
          car,
          speed: Math.hypot(vx, vy, vz),
          throttle: view.getFloat32(at + 60, true),
          boosting: (flags & FLAG_BOOSTING) !== 0,
          boost: view.getFloat32(at + 56, true),
          drifting: (flags & FLAG_DRIFTING) !== 0,
          surface: (flags >> 6) & 3,
          damage: Math.min(1, (loose.get(car) ?? 0) / 10),
          held: (flags & FLAG_HELD) !== 0,
          vehicle: flags >>> 16,
        };
        this.vehicleByCar.set(car, fact.vehicle!);
        // What the record implies and the sim does not say: slip against the heading, take-off, air time, height.
        const prevTick = this.lastTick.get(car);
        this.lastTick.set(car, tick);
        const m = this.tracker.step(car, prevTick === undefined || tick <= prevTick ? 0 : (tick - prevTick) / 120, view.getFloat32(at + 12, true), [view.getFloat32(at + 20, true), view.getFloat32(at + 24, true), view.getFloat32(at + 28, true), view.getFloat32(at + 32, true)], [vx, vy, vz]);
        fact.slip = m.slip;
        fact.airborne = m.airborne;
        fact.airS = m.airS;
        fact.height = m.height;
        facts.push(fact);
        this.carFacts(fact, vy, nowMs);
        motion.push(this.motionCar(fact));
      }
      this.engines.update(facts, nowMs);
      this.motion.update(motion);
    } catch {
      /* a malformed snapshot is the renderer's to report; audio carries on */
    }
  }

  motionCar(f: CarFact): MotionCar {
    return { car: f.car, speed: f.speed, drifting: f.drifting, surface: f.surface, slip: f.slip ?? 0, airborne: f.airborne ?? false, airS: f.airS ?? 0, height: f.height ?? 0, held: f.held };
  }

  /** One car's snapshot facts: drift, boost, take-off, landing and surface triggers (public so scripted rounds can feed facts the sim hasn't made). */
  carFacts(f: CarFact, vy: number, nowMs = performance.now()): void {
    // A wreck hold ends when the car is let go again: the engine may start.
    if (!f.held && this.wrecked.has(f.car)) this.wrecked.delete(f.car);
    const id = String(f.car);
    let m = this.mstate.get(f.car);
    if (!m) {
      m = { drifting: false, driftAt: 0, driftEndAt: -1e9, heldS: 0, surface: undefined, air: false, wind: false };
      this.mstate.set(f.car, m);
    }
    const air = f.airborne === true;
    // Drift: the slide begins (a chirp, the squeal layer takes over) and ends (the held time is what the exit boost scales by).
    if (f.drifting && !m.drifting) {
      m.drifting = true;
      m.driftAt = nowMs;
      this.sfx.trigger('drift-start', Math.min(1, 0.35 + f.speed / 40 + (f.slip ?? 0) * 0.5), 'car.drift_start', { car: f.car, slip: +(f.slip ?? 0).toFixed(2), speed: +f.speed.toFixed(1) }, id, nowMs);
    } else if (!f.drifting && m.drifting) {
      m.drifting = false;
      m.driftEndAt = nowMs;
      m.heldS = (nowMs - m.driftAt) / 1000;
      this.mix.note('motion', { event: 'drift-end', car: f.car, heldS: +m.heldS.toFixed(2) });
    }
    // Boost: straightening out of a held drift is R120's exit boost (its own sound, sized by the drift held); any other boost is the whoosh.
    if (f.boosting && !this.boosting.has(f.car)) {
      this.boosting.add(f.car);
      const fromDrift = m.drifting || nowMs - m.driftEndAt <= MOTION.exitWindowS * 1000;
      if (fromDrift) {
        const heldS = m.drifting ? (nowMs - m.driftAt) / 1000 : m.heldS;
        this.sfx.trigger('drift-exit-boost', Math.min(1, Math.max(0.25, heldS / MOTION.exitFullHeldS)), 'car.drift_exit_boost', { car: f.car, heldS: +heldS.toFixed(2) }, id, nowMs);
      } else this.sfx.trigger('boost-whoosh', 0.7, 'car.boost', { car: f.car }, id, nowMs);
    } else if (!f.boosting) this.boosting.delete(f.car);
    // Take-off and the wind that follows once the jump is long enough.
    if (air && !m.air) this.sfx.trigger('takeoff-whoosh', Math.min(1, 0.3 + f.speed / 30), 'car.takeoff', { car: f.car, speed: +f.speed.toFixed(1), vy: +vy.toFixed(1) }, id, nowMs);
    if (air && !m.wind && (f.airS ?? 0) >= MOTION.windAfterS) {
      m.wind = true;
      this.mix.note('motion', { event: 'wind-on', car: f.car, airS: +(f.airS ?? 0).toFixed(2) });
    }
    if (!air && m.wind) {
      m.wind = false;
      this.mix.note('motion', { event: 'wind-off', car: f.car });
    }
    m.air = air;
    // A landing: a fast fall that stops within a snapshot or two (the vertical speed jumps up by 3 m/s or more).
    const prev = this.vy.get(f.car);
    if (prev !== undefined && prev < -3 && vy - prev > 3) this.sfx.trigger('landing-thud', Math.min(1, -prev / 12), 'car.landing', { car: f.car, fallMps: +(-prev).toFixed(1) }, id, nowMs);
    this.vy.set(f.car, vy);
    // The ground under the car changed: a transient in the new surface's voice (the rolling layer crossfades by itself).
    if (m.surface !== undefined && m.surface !== f.surface && !air && !f.held) {
      const to = SURFACE_NAMES[f.surface] ?? 'tarmac';
      this.sfx.trigger(`surface-${to}` as 'surface-tarmac', Math.min(1, 0.25 + f.speed / 30), 'car.surface_change', { car: f.car, from: SURFACE_NAMES[m.surface] ?? 'tarmac', to, speed: +f.speed.toFixed(1) }, id, nowMs);
    }
    m.surface = f.surface;
  }
}
