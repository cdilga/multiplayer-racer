// Presentation history only. Eviction never changes simulation, scores, seats or live debris.
import defaults from './profile.json' with { type: 'json' };
import { PRACTICE_CAR_BASE, isPractice, type Frame } from '../render/snapshot';
import { packFrame, packedFrameBytes } from './frame';

export type ReplayProfile = typeof defaults;
export interface Identity { seat: number; car: number; number: number; name: string; rgb: [number, number, number] }
export interface Highlight { tick: number; kind: 'detach' | 'wreck' | 'air' | 'finish' | 'close-finish'; actors: Identity[] }
export interface StoredFrame { tick: number; bytes: ArrayBuffer }
export interface Clip { start: number; end: number; frames: StoredFrame[]; events: Highlight[] }
const textBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** A practice car's id (P1-C10): its seat's own practice world, never part of the round. */
const practiceCar = (car: number) => car >= PRACTICE_CAR_BASE;

/** The round's own cars only (P1-C10): a newcomer's practice car and course never reach the round's highlights or replay
 *  frames. Returns `f` itself when nobody practises. */
export function roundOnly(f: Frame): Frame {
  let keep = 0;
  for (let i = 0; i < f.cars; i++) if (!isPractice(f.flags[i]!)) keep++;
  if (keep === f.cars && !f.practice?.length) return f;
  const out: Frame = { ...f, cars: keep, practice: [], id: new Uint32Array(keep), life: new Uint32Array(keep), flags: new Uint32Array(keep),
    pos: new Float32Array(keep * 3), vel: new Float32Array(keep * 3), boost: new Float32Array(keep), throttle: new Float32Array(keep),
    rot: new Float32Array(keep * 4), steer: new Float32Array(keep) };
  for (let i = 0, k = 0; i < f.cars; i++) {
    if (isPractice(f.flags[i]!)) continue;
    out.id[k] = f.id[i]!; out.life[k] = f.life[i]!; out.flags[k] = f.flags[i]!;
    out.boost[k] = f.boost[i]!; out.throttle[k] = f.throttle[i]!; out.steer[k] = f.steer[i]!;
    out.pos.set(f.pos.subarray(i * 3, i * 3 + 3), k * 3); out.vel.set(f.vel.subarray(i * 3, i * 3 + 3), k * 3);
    out.rot.set(f.rot.subarray(i * 4, i * 4 + 4), k * 4);
    k++;
  }
  return out;
}

export class HighlightRecorder {
  readonly profile: ReplayProfile;
  private ring: StoredFrame[] = [];
  private clips: Clip[] = [];
  private context = new Uint8Array();
  private latest = -Infinity;
  private sampled = -Infinity;
  private air = new Map<number, { life: number; start: number; emitted: boolean }>();
  private identities = new Map<number, Identity>();
  private lastFinish: Highlight | null = null;
  private rejected = 0;
  private evicted = 0;
  private highWater = 0;
  private captureTotalMs = 0;
  private captureMaxMs = 0;
  private captureSamples = 0;

  constructor(profile: Partial<ReplayProfile> = {}) { this.profile = { ...defaults, ...profile }; }

  /** Own the map/version baseline once for this round. It remains independent of a next-round map swap. */
  reset(context: unknown): void {
    this.ring = []; this.clips = []; this.air.clear(); this.identities.clear(); this.lastFinish = null;
    this.latest = this.sampled = -Infinity; this.rejected = this.evicted = this.highWater = 0;
    this.captureTotalMs = this.captureMaxMs = this.captureSamples = 0;
    const bytes = new TextEncoder().encode(JSON.stringify(context));
    this.context = bytes.byteLength + 64 <= this.profile.budgetBytes ? bytes : new Uint8Array();
    this.account();
  }

  baseline<T>(): T { return JSON.parse(new TextDecoder().decode(this.context)) as T; }

  actors(): Identity[] { return structuredClone([...this.identities.values()]); }

  capture(f: Frame, identities: Identity[]): void {
    const start = performance.now();
    try { this.record(f, identities); }
    finally {
      const ms = performance.now() - start;
      this.captureTotalMs += ms; this.captureMaxMs = Math.max(this.captureMaxMs,ms); this.captureSamples++;
    }
  }

  private record(raw: Frame, all: Identity[]): void {
    if (!this.context.byteLength || raw.pauseMask || raw.tick <= this.latest) return;
    const f = roundOnly(raw);
    const identities = all.filter(id => !practiceCar(id.car));
    const p = this.profile;
    if (Number.isFinite(this.latest) && f.tick - this.latest > p.maxGapSeconds * p.tickHz) this.gap(f.tick);
    this.latest = f.tick;
    // Preflight before any actor bookkeeping, not merely before allocating the compressed output.
    if (packedFrameBytes(f) + this.context.byteLength + 128 > p.budgetBytes) { this.gap(f.tick); return; }
    for (const id of identities) {
      const old = this.identities.get(id.car);
      if (!old || JSON.stringify(old) !== JSON.stringify(id)) this.identities.set(id.car, structuredClone(id));
    }
    // Bit 8 is the actual suspension contact readout, not height above terrain (bridges and ramps are ground too).
    const present = new Set<number>();
    for (let i = 0; i < f.cars; i++) {
      const car = f.id[i]!; present.add(car);
      if (!(f.flags[i]! & 256)) { this.air.delete(car); continue; }
      let a = this.air.get(car);
      if (!a || a.life !== f.life[i]) { a = { life: f.life[i]!, start: f.tick, emitted: false }; this.air.set(car, a); }
      if (!a.emitted && f.tick - a.start > p.airSeconds * p.tickHz) {
        a.emitted = true;
        this.event({ tick: f.tick, kind: 'air', actors: identities.filter(id => id.car === car) });
      }
    }
    for (const car of this.air.keys()) if (!present.has(car)) this.air.delete(car);
    if (f.tick - this.sampled < p.tickHz / p.captureHz) { this.trim(); return; }
    // Preflight avoids allocating oversized footage. No actor array is truncated.
    let bytes: ArrayBuffer;
    try { bytes = packFrame(f); } catch { this.gap(f.tick); return; }
    const entry = { tick: f.tick, bytes };
    this.ring.push(entry); this.sampled = f.tick;
    for (const c of this.clips) if (f.tick >= c.start && f.tick <= c.end) c.frames.push(entry);
    this.ring = this.ring.filter(x => x.tick >= f.tick - p.ringSeconds * p.tickHz);
    this.trim();
  }

  event(e: Highlight): void {
    // Names/paint are copied at the event, so a late leave/rename can't relabel past footage. Practice cars are never actors.
    e = { ...structuredClone(e), actors: e.actors.filter(a => !practiceCar(a.car)) };
    if (!this.context.byteLength || !e.actors.length) return;
    const p = this.profile;
    if (e.kind === 'finish') {
      if (this.lastFinish && Math.abs(e.tick - this.lastFinish.tick) <= p.closeFinishSeconds * p.tickHz) {
        e.kind = 'close-finish';
        e.actors.push(...this.lastFinish.actors.filter(id => !e.actors.some(a => a.seat === id.seat)));
      }
      this.lastFinish = structuredClone(e);
    }
    const start = Math.max(this.ring[0]?.tick ?? e.tick, e.tick - p.preSeconds * p.tickHz);
    const end = e.tick + p.postSeconds * p.tickHz;
    const overlaps = this.clips.filter(c => c.start <= end && c.end >= start);
    const merged: Clip = {
      start: Math.min(start, ...overlaps.map(c => c.start)), end: Math.max(end, ...overlaps.map(c => c.end)),
      frames: [...new Set([...overlaps.flatMap(c => c.frames), ...this.ring.filter(f => f.tick >= start && f.tick <= end)])].sort((a,b) => a.tick - b.tick),
      events: [...overlaps.flatMap(c => c.events), e],
    };
    this.clips = this.clips.filter(c => !overlaps.includes(c)); this.clips.push(merged);
    this.trim();
  }

  /** A missing interval cannot be smoothed into invented causality. Drop affected footage; live play carries on. */
  private gap(tick: number): void {
    this.rejected++; this.ring = []; this.air.clear();
    this.clips = this.clips.filter(c => c.end < this.latest || c.start > tick);
  }

  /** Unique buffers counted once, reference/record bookkeeping charged conservatively, UTF-8 event/context bytes exact.
   * Browser object/allocator overhead is not measurable universally; the charge is an accounted store budget, not free RAM. */
  private bytes(): number {
    const unique = new Set([...this.ring, ...this.clips.flatMap(c => c.frames)]);
    return this.context.byteLength + 64 + [...unique].reduce((n, f) => n + f.bytes.byteLength + 64, 0)
      + (this.ring.length + this.clips.reduce((n,c) => n + c.frames.length, 0)) * 8
      + this.clips.reduce((n,c) => n + 96 + textBytes(c.events) * 2, 0) + this.air.size * 64
      + (this.lastFinish ? textBytes(this.lastFinish) * 2 + 64 : 0)
      + [...this.identities.values()].reduce((n,a)=>n+textBytes(a)*2+64,0);
  }

  private trim(): void {
    while (this.bytes() > this.profile.budgetBytes) {
      // Old rolling history is less valuable than retained causality. Then choose the lowest value per owned byte.
      if (this.ring.length) { this.ring.shift(); continue; }
      if (!this.clips.length) { this.air.clear(); this.identities.clear(); this.lastFinish = null; break; }
      const value = (c: Clip) => {
        const others = this.clips.filter(other=>other!==c).flatMap(other=>other.events);
        const represented = new Set(others.flatMap(e=>e.actors.map(a=>a.seat)));
        const common = new Set(others.map(e=>e.kind));
        const coverage = new Set(c.events.flatMap(e=>e.actors.map(a=>a.seat)).filter(id=>!represented.has(id))).size;
        const rarity = new Set(c.events.map(e=>e.kind).filter(kind=>!common.has(kind))).size;
        return this.valueOf(c) + coverage*this.profile.coverageWeight + rarity*this.profile.rarityWeight;
      };
      this.clips.sort((a,b) => value(a) / this.clipBytes(a) - value(b) / this.clipBytes(b));
      this.clips.shift(); this.evicted++;
    }
    this.account();
  }

  private clipBytes(c: Clip): number { return 96 + textBytes(c.events) * 2 + c.frames.reduce((n,f) => n + f.bytes.byteLength + 72, 0); }
  private valueOf(c: Clip): number { return c.events.reduce((n,e)=>n+this.profile.eventWeights[e.kind],0); }
  private account(): void { this.highWater = Math.max(this.highWater, this.bytes()); }

  /** Greedy marginal value/byte selection adds coverage for identities not yet shown, then plays in event order. */
  select(): Clip[] {
    const shown = new Set<number>(); const selected: Clip[] = [];
    const remaining = this.clips.filter(c => c.frames.length > 1 && c.events.every(e => e.tick <= c.frames.at(-1)!.tick)).map(c => {
      const limit = this.profile.reelSeconds*this.profile.tickHz;
      if (c.frames.at(-1)!.tick-c.frames[0]!.tick <= limit) return c;
      // A continuous chain of overlapping events may span a whole race. Choose a self-contained window,
      // never delay the next round to show the entire retained chain.
      const event = [...c.events].sort((a,b)=>this.profile.eventWeights[b.kind]-this.profile.eventWeights[a.kind])[0]!;
      const start = Math.max(c.frames[0]!.tick, Math.min(event.tick-this.profile.preSeconds*this.profile.tickHz,c.frames.at(-1)!.tick-limit));
      const frames = c.frames.filter(f=>f.tick>=start&&f.tick<=start+limit);
      const events = c.events.filter(e=>e.tick>=frames[0]!.tick&&e.tick<=frames.at(-1)!.tick);
      return {start:frames[0]!.tick,end:frames.at(-1)!.tick,frames,events};
    }).filter(c=>c.events.length>0);
    let seconds = 0;
    while (remaining.length && seconds < this.profile.reelSeconds) {
      const score = (c: Clip) => (this.valueOf(c) + new Set(c.events.flatMap(e => e.actors.map(a => a.seat)).filter(id => !shown.has(id))).size * this.profile.coverageWeight) / this.clipBytes(c);
      remaining.sort((a,b) => score(b) - score(a));
      const c = remaining.shift()!;
      const duration = (c.frames.at(-1)!.tick - c.frames[0]!.tick) / this.profile.tickHz;
      if (seconds + duration > this.profile.reelSeconds && selected.length) continue;
      selected.push(c); seconds += duration;
      for (const e of c.events) for (const a of e.actors) shown.add(a.seat);
    }
    return selected.sort((a,b) => a.start - b.start);
  }

  inspect() { return { ownedBytes: this.bytes(), highWaterBytes: this.highWater, budgetBytes: this.profile.budgetBytes,
    ringFrames: this.ring.length, oldestRingTick: this.ring[0]?.tick ?? null, retainedClips: this.clips.length,
    rejectedIntervals: this.rejected, evictedClips: this.evicted, latestTick: Number.isFinite(this.latest) ? this.latest : null,
    captureSamples:this.captureSamples, captureMeanMs:this.captureSamples ? this.captureTotalMs/this.captureSamples : 0, captureMaxMs:this.captureMaxMs,
    clips: this.select().map(c => ({ start: c.frames[0]!.tick, end: c.frames.at(-1)!.tick, events: structuredClone(c.events) })) }; }
}
