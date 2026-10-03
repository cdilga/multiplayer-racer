// The sim worker's loop (P1-S02), shared by the shipped worker (sim.worker.ts) and the test chunk's
// (../testing/testing.worker.ts), which runs the `testing` build of jj-wasm-host and plugs its extra messages in.
// - The worker owns the 120 Hz clock: a short timer loop hands `performance.now()` to the sim, which steps whole ticks
//   from its own accumulator. Rendering never changes the simulation.
// - Snapshots go out in pooled transferable buffers. With no free buffer it skips the publish: physics never blocks,
//   and events (sent separately) are never dropped.
// - A panic or unrecoverable WASM error is the `fault` pause reason: the loop stops and main is told.
// Worker-scope code, typechecked by ./tsconfig.json once scripts/build-host-wasm.sh has built the pkg.
import { PAUSE_BITS, type FromWorker, type InitOptions, type InputStat, type SimInput, type ToWorker } from './messages';

/** How many recent input ages a local source keeps. */
const AGES_KEPT = 2048;
/** Now on the clock main and the worker share (their `performance.now()` origins differ). */
const shared = () => performance.timeOrigin + performance.now();

/** The sim object both jj-wasm-host builds export (the testing build's has more methods). */
export interface Sim {
  handle(msg: Uint8Array): void;
  advance(nowMs: number): number;
  next_message(): Uint8Array | undefined;
  snapshot_size(): number;
  write_snapshot(buf: Uint8Array): number;
  tick(): number;
  pause_mask(): number;
  countdown_ms(): number;
  state_hash(): string;
}

/** The module a jj-wasm-host build's wasm-bindgen output exports. */
export interface WasmHost<S extends Sim> {
  default(): Promise<unknown>;
  HostSim: new (init: Uint8Array) => S;
  canonical_map(json: string): Uint8Array;
  encode_init(mapBytes: Uint8Array, seed: number): Uint8Array;
  encode_lifecycle(visible: boolean, renderOk: boolean): Uint8Array;
  encode_local_source(source: number, dx: number, dy: number, ax: number, ay: number, buttons: number, seq: number): Uint8Array;
  encode_net_bytes(endpoint: string, state: boolean, bytes: Uint8Array): Uint8Array;
  encode_ui(command: number, ui: string, on: boolean): Uint8Array;
}

/** What the test chunk's worker adds. */
export interface Extension<S extends Sim> {
  /** Encodes an input the shipped worker doesn't know (test-side controller frames). */
  encode?(input: unknown): Uint8Array | undefined;
  /** Describes drained messages as text, when `describe` is on. */
  describe?(bytes: Uint8Array): string[];
  /** Runs once the sim exists, with the whole init message (test options included). */
  init?(worker: SimWorker<S>, init: Record<string, unknown>): void;
  /** Handles a message the shipped worker doesn't know; returns whether it did. */
  message?(worker: SimWorker<S>, msg: { kind: string } & Record<string, unknown>): boolean;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const LOOP_MS = 2;

export class SimWorker<S extends Sim> {
  sim: S | null = null;
  faulted = false;
  describe = false;
  published = 0;
  skipped = 0;
  lastTick = 0;
  private started = false;
  private pool: ArrayBuffer[] = [];
  private uiCommand = 1;
  private lastPause = '';
  /** Local sources' latest unapplied sample time, and their recent host-applied input ages (P1-C05). */
  private pending = new Map<number, number>();
  private ages = new Map<number, number[]>();
  /** Per local source: samples and encoded bytes (the `LocalSource` message each sample becomes, P1-C05.2). */
  private wire = new Map<number, { samples: number; bytes: number }>();

  constructor(
    readonly wasm: WasmHost<S>,
    readonly ext: Extension<S> = {},
  ) {
    scope.onmessage = (e: MessageEvent<ToWorker | ({ kind: string } & Record<string, unknown>)>) => void this.receive(e.data);
  }

  post(msg: FromWorker | ({ kind: string } & Record<string, unknown>), transfer: Transferable[] = []): void {
    scope.postMessage(msg, transfer);
  }

  encode(input: SimInput): Uint8Array {
    const w = this.wasm;
    switch (input.type) {
      case 'local': {
        const [dx, dy, ax, ay] = input.axes;
        return w.encode_local_source(input.source, dx, dy, ax, ay, input.buttons ?? 0, input.seq ?? 0);
      }
      case 'net':
        return w.encode_net_bytes(input.endpoint, input.channel === 'state', input.bytes);
      case 'ui':
        return w.encode_ui(this.uiCommand++, input.ui, input.on ?? false);
      default: {
        const bytes = this.ext.encode?.(input);
        if (!bytes) throw new Error(`unknown input type ${(input as { type: string }).type}`);
        return bytes;
      }
    }
  }

  fault(e: unknown): void {
    this.faulted = true;
    this.post({ kind: 'fault', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    this.post({ kind: 'pause', mask: PAUSE_BITS.fault, countdownMs: 0 });
  }

  /** Runs `f` against the sim; a throw (a Rust panic surfaces as a RuntimeError) is a fault. */
  guard(f: (s: S) => void): void {
    if (!this.sim || this.faulted) return;
    try {
      f(this.sim);
    } catch (e) {
      this.fault(e);
    }
  }

  private drain(s: S): void {
    const list: Uint8Array[] = [];
    for (let m = s.next_message(); m !== undefined; m = s.next_message()) list.push(m);
    if (!list.length) return;
    const lines = this.describe && this.ext.describe ? list.flatMap((m) => this.ext.describe!(m)) : undefined;
    this.post({ kind: 'messages', list, lines }, list.map((b) => b.buffer as ArrayBuffer));
  }

  private publish(s: S): void {
    const need = s.snapshot_size();
    if (this.pool.length === 0) {
      this.skipped++;
      return;
    }
    let i = this.pool.findIndex((b) => b.byteLength >= need);
    if (i < 0) {
      // Every free buffer is too small (more cars or debris than before): grow one, keep the pool size.
      this.pool.shift();
      this.pool.push(new ArrayBuffer(need * 2));
      i = this.pool.length - 1;
    }
    const buf = this.pool.splice(i, 1)[0]!;
    const bytes = s.write_snapshot(new Uint8Array(buf));
    this.published++;
    this.post({ kind: 'snapshot', buf, bytes, tick: s.tick() }, [buf]);
  }

  /** Tells main when the pause mask or the countdown's whole second changes: no snapshots flow while paused. */
  private pauseState(s: S): void {
    const mask = s.pause_mask();
    const countdownMs = s.countdown_ms();
    const key = `${mask}:${Math.ceil(countdownMs / 1000)}`;
    if (key === this.lastPause) return;
    this.lastPause = key;
    this.post({ kind: 'pause', mask, countdownMs });
  }

  /** The tick boundary just applied every pending local sample: record how old each was. */
  private applied(): void {
    if (this.pending.size === 0) return;
    const now = shared();
    for (const [source, at] of this.pending) {
      const list = this.ages.get(source) ?? [];
      list.push(now - at);
      if (list.length > AGES_KEPT) list.shift();
      this.ages.set(source, list);
    }
    this.pending.clear();
  }

  private inputStats(): InputStat[] {
    return [...this.ages].map(([source, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      const w = this.wire.get(source);
      return { source, samples: list.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), lastMs: list.at(-1) ?? 0, sent: w?.samples ?? 0, bytesPerSample: w ? w.bytes / w.samples : 0 };
    });
  }

  /** After the sim moved outside the clock (the test surface's step): drain and publish now, so main sees it. */
  flush(stepped: boolean): void {
    this.guard((s) => {
      this.lastTick = s.tick();
      this.drain(s);
      this.pauseState(s);
      if (stepped) {
        this.applied();
        this.publish(s);
      }
    });
  }

  private loop(): void {
    this.guard((s) => {
      const stepped = s.advance(performance.now());
      this.lastTick = s.tick();
      this.drain(s);
      this.pauseState(s);
      if (stepped > 0) {
        this.applied();
        this.publish(s);
      }
    });
    if (!this.faulted) setTimeout(() => this.loop(), LOOP_MS);
  }

  private async receive(msg: ToWorker | ({ kind: string } & Record<string, unknown>)): Promise<void> {
    switch (msg.kind) {
      case 'init': {
        const init = msg as { kind: 'init' } & InitOptions & Record<string, unknown>;
        await this.wasm.default();
        try {
          const map = init.mapBytes ?? this.wasm.canonical_map(init.mapJson ?? '');
          this.sim = new this.wasm.HostSim(this.wasm.encode_init(map, init.seed));
          this.ext.init?.(this, init);
        } catch (err) {
          this.fault(err);
          return;
        }
        const size = Math.max(64 * 1024, this.sim.snapshot_size() * 2);
        for (let k = 0; k < (init.poolSize ?? 3); k++) this.pool.push(new ArrayBuffer(size));
        this.post({ kind: 'ready' });
        if (!this.started) {
          this.started = true;
          this.loop();
        }
        return;
      }
      case 'input': {
        const { input } = msg as { input: SimInput };
        if (input.type === 'local' && input.sampledAt !== undefined) this.pending.set(input.source, input.sampledAt);
        this.guard((s) => {
          const bytes = this.encode(input);
          if (input.type === 'local') {
            const w = this.wire.get(input.source) ?? { samples: 0, bytes: 0 };
            w.samples += 1;
            w.bytes += bytes.length;
            this.wire.set(input.source, w);
          }
          s.handle(bytes);
        });
        return;
      }
      case 'inputStats':
        this.post({ kind: 'inputStats', id: (msg as { id: number }).id, sources: this.inputStats() });
        return;
      case 'lifecycle': {
        const { visible, renderOk } = msg as { visible: boolean; renderOk: boolean };
        this.guard((s) => s.handle(this.wasm.encode_lifecycle(visible, renderOk)));
        return;
      }
      case 'return':
        this.pool.push((msg as { buf: ArrayBuffer }).buf);
        return;
      default:
        this.ext.message?.(this, msg);
    }
  }
}
