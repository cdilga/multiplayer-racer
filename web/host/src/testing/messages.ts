// The test chunk's extra worker messages (P1-F05b, plan §4.4 "exist only in test-enabled hosts"). Only the testing
// worker (testing.worker.ts) understands them; the shipped worker ignores unknown kinds.
import type { SimInput } from '../worker/messages';

/** Test-side controller frames, encoded in the testing worker (a real controller encodes them in `jj-wasm-input`). */
export type ControllerFrame = { hello: true } | { claim: string } | { state: { source: number; seq: number; drive: [number, number] } };
export type TestInput = SimInput | { type: 'controller'; endpoint: string; frame: ControllerFrame };

/** Extra `init` options the testing worker reads. */
export interface TestInit {
  /** Each `messages` post also carries the messages as text, one line per event or outbound. */
  describe?: boolean;
  /** Run on the worker's clock instead of starting held (frame-stepped). */
  live?: boolean;
}

export type TestToWorker =
  | { kind: 'test'; id: number; command: Record<string, unknown> }
  | { kind: 'schedule'; tick: number; input: TestInput }
  | { kind: 'stopAt'; tick: number }
  | { kind: 'status'; id: number }
  | { kind: 'panic' };

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
  | { kind: 'status'; id: number; status: WorkerStatus };
