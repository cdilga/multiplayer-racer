// The test chunk's extra worker messages (P1-F05b, plan §4.4 "exist only in test-enabled hosts"). Only the testing
// worker (testing.worker.ts) understands them; the shipped worker ignores unknown kinds.
import type { SimInput } from '../worker/messages';

/** Test-side controller frames, encoded in the testing worker (a real controller encodes them in `jj-wasm-input`). */
export type ControllerFrame =
  | { hello: true }
  | { claim: string }
  | { ready: boolean }
  | { identify: true }
  | { leave: true }
  | { sitOut: true }
  | { state: { source: number; seq: number; drive: [number, number] } };
export type TestInput = SimInput | { type: 'controller'; endpoint: string; frame: ControllerFrame };

/** Extra `init` options the testing worker reads. */
export interface TestInit {
  /** Each `messages` post also carries the messages as text, one line per event or outbound. */
  describe?: boolean;
  /** Run on the worker's clock instead of starting held (frame-stepped). */
  live?: boolean;
  /** Ticks the journal stream waits between polls (default 12; a test host that steps by single ticks wants 1). */
  clipEveryTicks?: number;
  /** Ticks between checkpoint hashes in the journal stream (default 600). */
  clipHashEvery?: number;
}

export type TestToWorker =
  | { kind: 'test'; id: number; command: Record<string, unknown> }
  | { kind: 'schedule'; tick: number; input: TestInput }
  | { kind: 'stopAt'; tick: number }
  | { kind: 'status'; id: number }
  | { kind: 'tapStats'; id: number }
  | { kind: 'panic' }
  /** Poll the journal now (bug clips, P1-F07), with a state hash; answered with `journalAck` after the `journal` message. */
  | { kind: 'journalPoll'; id: number; hash: boolean };

export interface WorkerStatus {
  tick: number;
  hash: string;
  pauseMask: number;
  countdownMs: number;
  published: number;
  skipped: number;
  appliedThrottle: number[];
}

export type TestFromWorker =
  | { kind: 'testResult'; id: number; ok: boolean; value?: unknown; error?: string }
  | { kind: 'status'; id: number; status: WorkerStatus }
  | { kind: 'journalAck'; id: number }
  /** The journal stream's cost so far (`jj-test` surface `clipTapStats`). */
  | { kind: 'tapStats'; id: number; stats: import('../clips/tap').TapStats };
