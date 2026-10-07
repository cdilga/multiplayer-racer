// Bug clips on the host's main thread (P1-F07, plan §13b.6). The sim worker streams its applied-input journal to main
// as it runs (`journal` messages, see tap.ts); this keeps every piece, so a clip can be saved at any moment, including
// after the worker has faulted. Saving is main-thread work on data already held (one JSON stringify and a Blob): it
// never asks the worker to stop, and the frame meter records what it cost the page.
//
// A clip is `jj_fixture::clip::Bundle` JSON (`*.jjclip`): build id, the world's map bytes and hash, seed, roster, the
// journal in postcard chunks, checkpoint hashes, and the marked moment. `jj sim --replay` re-simulates it.
import type { RoomView, SimClient, SimEventJson } from '../worker/client';
import type { SimInput } from '../worker/messages';
import { CLIP_FORMAT, SESSION_FORMAT, type ClipBundle, type ClipFault, type ClipWorld, type JournalMessage } from './types';

/** The build's commit (vite `define`, from git at build time). */
declare const __JJ_COMMIT__: string;
export const buildId = (): string => (typeof __JJ_COMMIT__ === 'string' ? __JJ_COMMIT__ : 'unknown');

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Frame pacing from `requestAnimationFrame`: the last `kept` frame gaps, plus totals. Costs one callback per frame. */
export class FrameMeter {
  private ring: Float64Array;
  private n = 0;
  private last = 0;
  private id = 0;
  total = 0;
  over33 = 0;
  over100 = 0;
  max = 0;
  /** The largest gap per frame end time, for "what did this window cost". */
  private recent: Array<[number, number]> = [];

  constructor(private kept = 4096) {
    this.ring = new Float64Array(kept);
  }

  start(): void {
    if (this.id) return;
    const tick = (now: number): void => {
      if (this.last) this.record(now - this.last, now);
      this.last = now;
      this.id = requestAnimationFrame(tick);
    };
    this.id = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.id);
    this.id = 0;
    this.last = 0;
  }

  record(dt: number, now: number): void {
    this.ring[this.n++ % this.kept] = dt;
    this.total++;
    if (dt > 33.4) this.over33++;
    if (dt > 100) this.over100++;
    this.max = Math.max(this.max, dt);
    this.recent.push([now, dt]);
    if (this.recent.length > 600) this.recent.shift();
  }

  /** The largest frame gap that ended since `since` (a `performance.now()` time). */
  maxSince(since: number): number {
    let m = 0;
    for (const [t, dt] of this.recent) if (t >= since) m = Math.max(m, dt);
    return m;
  }

  /** Percentiles over the kept gaps. */
  pacing() {
    const len = Math.min(this.n, this.kept);
    const sorted = Array.from(this.ring.subarray(0, len)).sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(len - 1, Math.floor(p * len))] ?? 0;
    const mean = len ? sorted.reduce((a, b) => a + b, 0) / len : 0;
    return { frames: this.total, kept: len, meanMs: mean, p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: this.max, over33ms: this.over33, over100ms: this.over100 };
  }
}

export interface SavedClip {
  bundle: ClipBundle;
  json: string;
  bytes: number;
  filename: string;
  /** What saving cost the page: main-thread time, and the longest frame gap while it ran (null without a frame meter). */
  saveMs: number;
  maxFrameMs: number | null;
}

export interface RecorderStats {
  /** Journal messages received, and the time main spent taking them in. */
  messages: number;
  mainMs: number;
  mainMaxMs: number;
  /** What the worker's polls cost (summed from the messages). */
  workerMs: number;
  workerMaxMs: number;
  chunkChars: number;
}

export type RosterSeat = { seat: number; number: number; name: string; colourIndex: number; presence: string; local: boolean };

export class ClipRecorder {
  /** Every world the host simulated this session, as far as it was streamed. */
  worlds: ClipWorld[] = [];
  fault: ClipFault | null = null;
  room: RoomView | null = null;
  readonly meter = new FrameMeter();
  readonly stats: RecorderStats = { messages: 0, mainMs: 0, mainMaxMs: 0, workerMs: 0, workerMaxMs: 0, chunkChars: 0 };
  /** Every `PrepareRequested` seen (the track seed of preparation n is the session seed + n). */
  readonly preparations: Array<{ preparation: number; seed: number }> = [];
  /** Listeners for the session recorder: each journal message after it was kept, and a fault. */
  onJournal: Array<(m: JournalMessage, w: ClipWorld) => void> = [];
  onFault: Array<(f: ClipFault) => void> = [];
  private client: SimClient | null = null;
  private mapReady = new Map<string, number>();
  private acks = new Map<number, () => void>();
  private nextAck = 1;

  /** Starts keeping the journal of `client`'s worker. Call right after the client is made (and its TestClient, if any). */
  attach(client: SimClient): this {
    this.client = client;
    const prev = client.onOther;
    client.onOther = (m) => {
      if (m.kind === 'journal') this.take(m as unknown as JournalMessage);
      else if (m.kind === 'journalAck') {
        const id = (m as unknown as { id: number }).id;
        this.acks.get(id)?.();
        this.acks.delete(id);
      } else prev(m);
    };
    client.watchRoom((room) => (this.room = room));
    client.watchEvents((events: SimEventJson[]) => {
      for (const e of events) {
        const r = e.PrepareRequested as { preparation: number; seed: number } | undefined;
        if (r) this.preparations.push({ preparation: Number(r.preparation), seed: Number(r.seed) });
      }
    });
    // Which preparation each prepared map was: the bytes main hands the sim are the bytes its worlds start from.
    const send = client.input.bind(client);
    client.input = (input: SimInput) => {
      if (input.type === 'map-ready' && input.bytes.length) this.mapReady.set(toBase64(input.bytes), input.preparation);
      send(input);
    };
    // A fault is told to whoever set `onFault` too (the host's "Something broke" screen sets it after us).
    let user = client.onFault;
    const ours = (message: string): void => {
      this.noteFault(message);
      user(message);
    };
    Object.defineProperty(client, 'onFault', { configurable: true, get: () => ours, set: (f: (m: string) => void) => (user = f) });
    return this;
  }

  private take(m: JournalMessage): void {
    const t0 = performance.now();
    if (m.start) {
      this.worlds.push({
        index: m.world,
        label: '',
        round: null,
        sessionSeed: m.start.seed,
        trackSeed: null,
        preparation: null,
        mapHash: m.start.mapHash,
        map: m.start.map,
        chunks: [],
        endTick: 0,
        checkpoints: [],
      });
    }
    const w = this.worlds.at(-1);
    if (!w) return;
    if (m.chunk) w.chunks.push(m.chunk);
    w.endTick = m.tick;
    if (m.hash) w.checkpoints.push({ tick: m.tick, hash: m.hash, setup: m.setup });
    w.round = m.round ?? w.round;
    w.label = m.round !== null ? `round ${m.round}` : m.freeDrive ? 'free drive' : m.phase.toLowerCase();
    if (w.trackSeed === null) {
      const preparation = this.mapReady.get(w.map);
      if (preparation !== undefined) {
        w.preparation = preparation;
        w.trackSeed = this.preparations.find((p) => p.preparation === preparation)?.seed ?? null;
      }
    }
    const s = this.stats;
    s.messages++;
    s.workerMs += m.ms;
    s.workerMaxMs = Math.max(s.workerMaxMs, m.ms);
    s.chunkChars += m.chunk?.length ?? 0;
    for (const f of this.onJournal) f(m, w);
    const ms = performance.now() - t0;
    s.mainMs += ms;
    s.mainMaxMs = Math.max(s.mainMaxMs, ms);
  }

  private noteFault(message: string): void {
    const w = this.worlds.at(-1);
    this.fault = { world: w?.index ?? 0, tick: w?.endTick ?? 0, message };
    for (const f of this.onFault) f(this.fault);
  }

  get faulted(): boolean {
    return this.fault !== null || (this.client?.pauseReasons().includes('fault') ?? false);
  }

  /** Asks a live worker for the journal up to now with a state hash, and waits for it (a fault or `timeoutMs` ends the wait). */
  async checkpoint(timeoutMs = 750): Promise<boolean> {
    if (!this.client || this.faulted) return false;
    const id = this.nextAck++;
    const done = new Promise<boolean>((resolve) => {
      this.acks.set(id, () => resolve(true));
      setTimeout(() => {
        if (this.acks.delete(id)) resolve(false);
      }, timeoutMs);
    });
    this.client.send({ kind: 'journalPoll', id, hash: true });
    return done;
  }

  /** The file's content: the current world (a clip) or every world (`all`), with the moment marked at what's kept so far. */
  bundle(format: ClipBundle['format'], opts: { note?: string; all?: boolean; summary?: unknown } = {}): ClipBundle {
    const last = this.worlds.at(-1);
    const worlds = opts.all ? this.worlds : last ? [last] : [];
    const seats = (this.room?.seats ?? []).map((s): RosterSeat => ({ seat: s.seat, number: s.number, name: s.name, colourIndex: s.colourIndex, presence: s.presence, local: s.local }));
    return {
      format,
      build: buildId(),
      savedAt: new Date().toISOString(),
      mark: last ? { world: last.index, tick: this.fault && this.fault.world === last.index ? this.fault.tick : last.endTick, note: opts.note ?? '' } : null,
      roster: seats,
      fault: this.fault,
      summary: opts.summary ?? null,
      notes: {
        url: location.href,
        userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        phase: this.room?.phase ?? null,
        preparations: this.preparations,
        // Track seeds name their track: the session seed plus the preparation id (plan §4.4).
        trackSeeds: this.worlds.filter((w) => w.trackSeed !== null).map((w) => ({ world: w.index, preparation: w.preparation, seed: w.trackSeed })),
      },
      worlds,
    };
  }

  /** Saves a bug clip: from the held journal, with the moment marked. `download` also hands the browser the file. */
  async save(opts: { note?: string; download?: boolean; all?: boolean } = {}): Promise<SavedClip> {
    const t0 = performance.now();
    await this.checkpoint();
    const bundle = this.bundle(CLIP_FORMAT, opts);
    const t1 = performance.now();
    const w = bundle.worlds.at(-1);
    const filename = `jj-clip-${bundle.build}-w${w?.index ?? 0}-t${bundle.mark?.tick ?? 0}.jjclip`;
    const json = JSON.stringify(bundle);
    const bytes = new Blob([json]).size;
    if (opts.download) download(filename, json);
    const saveMs = performance.now() - t1;
    // Frame gaps that ended while saving (the checkpoint wait is the worker's, the page keeps drawing through it).
    const maxFrameMs = this.meter.total > 0 ? this.meter.maxSince(t0) : null;
    return { bundle, json, bytes, filename, saveMs, maxFrameMs };
  }
}

/** Hands the browser a file to save. */
export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Ctrl/⌘+Shift+B (no key cluster uses a modifier chord, §15 C05) saves a clip; returns the uninstall. */
export function installHotkey(rec: ClipRecorder, onSaved: (c: SavedClip) => void = () => {}): () => void {
  rec.meter.start();
  const on = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.code !== 'KeyB') return;
    e.preventDefault();
    if (e.repeat) return;
    void rec.save({ download: true, note: 'hotkey' }).then(onSaved);
  };
  window.addEventListener('keydown', on);
  return () => window.removeEventListener('keydown', on);
}

/** A "Save bug clip" button (the diagnostics panel and the fault screen). */
export function clipButton(rec: ClipRecorder, label = 'Save bug clip', onSaved: (c: SavedClip) => void = () => {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.jjClipSave = '';
  b.addEventListener('click', () => void rec.save({ download: true, note: 'button' }).then(onSaved));
  return b;
}

export { SESSION_FORMAT };
