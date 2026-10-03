// Messages between the host's main thread and its sim worker (P1-S02). The logical ABI is `jj_protocol::abi`
// (MainToSim / SimToMain, postcard); over postMessage, main sends these structured messages and the worker encodes
// them into MainToSim with `jj-wasm-host`'s codec, so main never loads the sim. Snapshot buffers travel as
// transferables in both directions (the ABI's `ReturnBuffer` is a transfer, not a copy).
// The test chunk's worker understands more (web/host/src/testing/messages.ts); the shipped worker ignores those.

export type PauseReason = 'manual' | 'host-hidden' | 'renderer-unavailable' | 'performance-stall' | 'fault';

/** The bits in a snapshot's pause mask (`jj_wasm_host::host::Pause`). */
export const PAUSE_BITS: Record<PauseReason, number> = {
  manual: 1,
  'host-hidden': 2,
  'renderer-unavailable': 4,
  'performance-stall': 8,
  fault: 16,
};

export function pauseReasons(mask: number): PauseReason[] {
  return (Object.keys(PAUSE_BITS) as PauseReason[]).filter((r) => (mask & PAUSE_BITS[r]) !== 0);
}

/** Something to apply at a tick boundary: host pads/keys, controller bytes from the transport, or a host UI command. */
export type SimInput =
  | { type: 'local'; source: number; axes: [number, number, number, number]; buttons?: number; seq?: number }
  | { type: 'net'; endpoint: string; channel: 'state' | 'cmd'; bytes: Uint8Array }
  | { type: 'ui'; ui: 'start' | 'end' | 'pause'; on?: boolean };

export interface InitOptions {
  mapJson?: string;
  mapBytes?: Uint8Array;
  seed: number;
  poolSize?: number;
}

export type ToWorker =
  | ({ kind: 'init' } & InitOptions)
  | { kind: 'input'; input: SimInput }
  | { kind: 'lifecycle'; visible: boolean; renderOk: boolean }
  | { kind: 'return'; buf: ArrayBuffer };

export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'snapshot'; buf: ArrayBuffer; bytes: number; tick: number }
  /** Encoded `SimToMain` messages (events, outbound controller bytes), in the order the sim produced them. */
  | { kind: 'messages'; list: Uint8Array[]; lines?: string[] }
  /** The pause mask or the resume countdown's whole second changed (sent while no snapshots flow). */
  | { kind: 'pause'; mask: number; countdownMs: number }
  | { kind: 'fault'; message: string };
