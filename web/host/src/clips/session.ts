// The session recorder for development (P1-F12, owner 2026-10-03): the host records the whole session in IndexedDB within
// a dev-storage budget: per-round journals (from the clip recorder's stream), seeds and map hashes, roster changes, events,
// connection paths, input-age summaries and frame pacing. It lives on the main thread, so it survives a worker fault; it
// never uploads (nothing here calls fetch, XHR, sockets or beacons); it downloads as `*.jjsession`, which
// `jj sim --replay` replays round by round.
//
// Cost: one callback per frame (the frame meter), a flush every `flushMs` that writes only what is new, and the stream the
// clip recorder already keeps. `cost()` reports what each took, so the receipt can say how small it is.
import type { SimClient } from '../worker/client';
import type { InputStat } from '../worker/messages';
import { download, type ClipRecorder } from './recorder';
import { MemoryStore, type SessionMeta, type SessionStore } from './store';
import { SESSION_FORMAT, type ClipBundle, type ClipWorld } from './types';

export interface SessionOptions {
  store?: SessionStore;
  /** Dev-storage budget in bytes across every kept session (default 64 MiB). Older sessions go first. */
  budgetBytes?: number;
  /** How often new records are written (default 2 s). */
  flushMs?: number;
  /** How often input ages are sampled from the worker (default 2 s). */
  inputAgeMs?: number;
}

export type RosterChange = { atMs: number; world: number; tick: number; kind: 'joined' | 'left' | 'presence' | 'renamed'; seat: number; number: number; name: string; presence: string };
export type ConnectionNote = { atMs: number; endpoint: string; path: string; detail?: Record<string, unknown> };

const EVENTS_KEPT = 2000;

export class SessionRecorder {
  readonly id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  readonly startedAt = new Date().toISOString();
  readonly rosterChanges: RosterChange[] = [];
  readonly connections: ConnectionNote[] = [];
  /** Event counts by kind, and the first `EVENTS_KEPT` events with their time. */
  readonly eventCounts: Record<string, number> = {};
  readonly events: Array<{ atMs: number; world: number; event: unknown }> = [];
  /** The worst and latest host-applied input age per local source (sampled), and per-source percentiles. */
  inputAges: InputStat[] = [];
  inputAgeWorst = new Map<number, { p95: number; p99: number }>();
  truncated = false;
  private store: SessionStore;
  private budget: number;
  private t0 = performance.now();
  private seats = new Map<number, { name: string; presence: string }>();
  private worldSent = new Map<number, { header: boolean; chunks: number }>();
  private bytes = 0;
  private timers: number[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private cost_ = { flushes: 0, flushMs: 0, flushMaxMs: 0, writes: 0 };

  constructor(
    readonly clips: ClipRecorder,
    opts: SessionOptions = {},
  ) {
    this.store = opts.store ?? new MemoryStore();
    this.budget = opts.budgetBytes ?? 64 * 1024 * 1024;
    this.opts = opts;
  }

  private opts: SessionOptions;
  private client: SimClient | null = null;

  /** Starts recording `client`'s session (attach the clip recorder to it first). */
  start(client: SimClient): this {
    this.client = client;
    this.clips.meter.start();
    client.watchRoom((room) => this.onRoom(room.seats));
    client.watchEvents((events) => {
      for (const e of events) {
        const kind = Object.keys(e)[0] ?? 'unknown';
        this.eventCounts[kind] = (this.eventCounts[kind] ?? 0) + 1;
        if (this.events.length < EVENTS_KEPT) this.events.push({ atMs: this.now(), world: this.clips.worlds.at(-1)?.index ?? 0, event: e });
      }
    });
    this.clips.onFault.push(() => void this.flush());
    this.timers.push(window.setInterval(() => void this.flush(), this.opts.flushMs ?? 2000));
    this.timers.push(window.setInterval(() => void this.sampleInputAges(), this.opts.inputAgeMs ?? 2000));
    window.addEventListener('pagehide', () => void this.flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void this.flush());
    return this;
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private now(): number {
    return Math.round(performance.now() - this.t0);
  }

  private onRoom(seats: Array<{ seat: number; number: number; name: string; presence: string }>): void {
    const w = this.clips.worlds.at(-1);
    const at = { atMs: this.now(), world: w?.index ?? 0, tick: w?.endTick ?? 0 };
    const present = new Set<number>();
    for (const s of seats) {
      present.add(s.seat);
      const before = this.seats.get(s.seat);
      const note = (kind: RosterChange['kind']): void => void this.rosterChanges.push({ ...at, kind, seat: s.seat, number: s.number, name: s.name, presence: s.presence });
      if (!before) note('joined');
      else if (before.presence !== s.presence) note('presence');
      else if (before.name !== s.name) note('renamed');
      this.seats.set(s.seat, { name: s.name, presence: s.presence });
    }
    // A seat that left is gone from the room view (no phantom seats): note it once.
    for (const [seat, was] of [...this.seats]) {
      if (present.has(seat)) continue;
      this.seats.delete(seat);
      this.rosterChanges.push({ ...at, kind: 'left', seat, number: 0, name: was.name, presence: 'Left' });
    }
  }

  /** The transport reports how an endpoint's data path is routed (`lan`, `relay`, `direct`…), when it changes. */
  noteConnection(endpoint: string, path: string, detail?: Record<string, unknown>): void {
    const last = [...this.connections].reverse().find((c) => c.endpoint === endpoint);
    if (last?.path === path) return;
    this.connections.push({ atMs: this.now(), endpoint, path, detail });
  }

  async sampleInputAges(): Promise<void> {
    if (!this.client || this.clips.faulted) return;
    const stats = await this.client.inputStats();
    this.inputAges = stats;
    for (const s of stats) {
      const w = this.inputAgeWorst.get(s.source) ?? { p95: 0, p99: 0 };
      this.inputAgeWorst.set(s.source, { p95: Math.max(w.p95, s.p95), p99: Math.max(w.p99, s.p99) });
    }
  }

  /** The JSON summary: rounds, roster changes, connection paths, input-age percentiles and frame pacing. */
  summary() {
    const clips = this.clips;
    return {
      session: this.id,
      startedAt: this.startedAt,
      durationMs: this.now(),
      rounds: clips.worlds.map((w) => ({
        world: w.index,
        label: w.label,
        round: w.round,
        sessionSeed: w.sessionSeed,
        trackSeed: w.trackSeed,
        preparation: w.preparation,
        mapHash: w.mapHash,
        ticks: w.endTick,
        checkpoints: w.checkpoints.length,
        journalChunks: w.chunks.length,
      })),
      rosterChanges: this.rosterChanges,
      connectionPaths: this.connections,
      inputAge: this.inputAges.map((s) => ({ source: s.source, samples: s.samples, p50Ms: s.p50, p95Ms: s.p95, p99Ms: s.p99, worstP95Ms: this.inputAgeWorst.get(s.source)?.p95 ?? s.p95, worstP99Ms: this.inputAgeWorst.get(s.source)?.p99 ?? s.p99 })),
      framePacing: clips.meter.pacing(),
      events: { counts: this.eventCounts, kept: this.events.length },
      recording: { uploaded: false, truncated: this.truncated, bytesStored: this.bytes, budgetBytes: this.budget, cost: this.cost() },
      fault: clips.fault,
    };
  }

  /** What recording costs: the worker's polls and main's intake per message, and the flushes. */
  cost() {
    const s = this.clips.stats;
    const n = Math.max(1, s.messages);
    return {
      journalMessages: s.messages,
      workerPollMeanMs: s.workerMs / n,
      workerPollMaxMs: s.workerMaxMs,
      mainIntakeMeanMs: s.mainMs / n,
      mainIntakeMaxMs: s.mainMaxMs,
      journalChars: s.chunkChars,
      flushes: this.cost_.flushes,
      flushMeanMs: this.cost_.flushMs / Math.max(1, this.cost_.flushes),
      flushMaxMs: this.cost_.flushMaxMs,
      records: this.cost_.writes,
    };
  }

  private doc(): Record<string, unknown> {
    return { summary: this.summary(), roster: this.clips.bundle(SESSION_FORMAT).roster, events: this.events, notes: this.clips.bundle(SESSION_FORMAT).notes, fault: this.clips.fault };
  }

  /** Writes what's new (and the summary) to the store; evicts older sessions when over budget. Serialised. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.flushNow()).catch(() => undefined);
    return this.flushing;
  }

  private async flushNow(): Promise<void> {
    const t0 = performance.now();
    const store = this.store;
    for (const w of this.clips.worlds) {
      const sent = this.worldSent.get(w.index) ?? { header: false, chunks: 0 };
      this.worldSent.set(w.index, sent);
      const { chunks, ...header } = w;
      const fresh = chunks.slice(sent.chunks);
      const size = fresh.reduce((a, c) => a + c.length, 0) + (sent.header ? 0 : w.map.length);
      if (size > 0 && !(await this.makeRoom(size))) {
        this.truncated = true;
        continue;
      }
      await store.putWorld(this.id, header);
      this.cost_.writes++;
      if (fresh.length) {
        await store.putChunks(this.id, w.index, sent.chunks, fresh);
        this.cost_.writes++;
        sent.chunks += fresh.length;
      }
      sent.header = true;
      this.bytes += size;
    }
    const meta: SessionMeta = { id: this.id, startedAt: this.startedAt, build: this.clips.bundle(SESSION_FORMAT).build, bytes: this.bytes, doc: this.doc(), truncated: this.truncated };
    await store.putMeta(meta);
    this.cost_.writes++;
    const ms = performance.now() - t0;
    this.cost_.flushes++;
    this.cost_.flushMs += ms;
    this.cost_.flushMaxMs = Math.max(this.cost_.flushMaxMs, ms);
  }

  /** Whether `need` more bytes fit the budget, dropping the oldest other sessions to make them fit. */
  private async makeRoom(need: number): Promise<boolean> {
    const others = (await this.store.sessions()).filter((s) => s.id !== this.id);
    let used = this.bytes + others.reduce((a, s) => a + s.bytes, 0);
    for (const s of others) {
      if (used + need <= this.budget) break;
      await this.store.remove(s.id);
      used -= s.bytes;
    }
    return used + need <= this.budget;
  }

  /** The whole session as a `*.jjsession` document (from memory: complete even when the store ran out of budget). */
  bundle(): ClipBundle {
    const b = this.clips.bundle(SESSION_FORMAT, { all: true, summary: this.summary(), note: 'session' });
    b.notes = { ...b.notes, events: this.events, eventCounts: this.eventCounts };
    return b;
  }

  async save(opts: { download?: boolean } = {}): Promise<{ bundle: ClipBundle; json: string; filename: string; bytes: number }> {
    await this.clips.checkpoint();
    const bundle = this.bundle();
    const json = JSON.stringify(bundle);
    const filename = `jj-session-${bundle.build}-${this.id}.jjsession`;
    if (opts.download) download(filename, json);
    return { bundle, json, filename, bytes: new Blob([json]).size };
  }

  /** Reads a stored session back (also a previous page load's), as a document. */
  async loadStored(id: string): Promise<ClipBundle | null> {
    const got = await this.store.load(id);
    if (!got) return null;
    const doc = got.meta.doc as { summary?: unknown; roster?: unknown; notes?: Record<string, unknown>; fault?: ClipBundle['fault'] };
    return { format: SESSION_FORMAT, build: got.meta.build, savedAt: got.meta.startedAt, mark: null, roster: doc.roster ?? [], fault: doc.fault ?? null, summary: doc.summary ?? null, notes: doc.notes ?? {}, worlds: got.worlds as ClipWorld[] };
  }

  storedSessions(): Promise<SessionMeta[]> {
    return this.store.sessions();
  }
}
