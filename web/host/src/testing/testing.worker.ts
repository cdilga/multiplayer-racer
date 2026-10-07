// The test chunk's sim worker (P1-F05b): the `testing` build of jj-wasm-host (the test surface, exact-tick scheduling,
// a deliberate panic, test-side controller encoders) behind the same loop as the shipped worker. It starts held
// (frame-stepped) unless its init says `live`.
import * as wasm from './pkg/jj_wasm_host_testing.js';
import { SimWorker, type Extension } from '../worker/core';
import { PAUSE_BITS } from '../worker/messages';
import type { TestInit, TestInput, TestToWorker, WorkerStatus } from './messages';

type Sim = wasm.HostSim;

/** Commands that move or rebuild the sim outside the clock: main gets a snapshot and the messages after them. */
const STEPPING = new Set(['step', 'until', 'load', 'spawn']);

function encode(input: unknown): Uint8Array | undefined {
  const i = input as TestInput;
  if (i.type !== 'controller') return undefined;
  const f = i.frame;
  if ('hello' in f) return wasm.encode_net_bytes(i.endpoint, false, wasm.controller_hello(i.endpoint));
  if ('claim' in f) return wasm.encode_net_bytes(i.endpoint, false, wasm.controller_claim(f.claim));
  if ('ready' in f) return wasm.encode_net_bytes(i.endpoint, false, wasm.controller_ready(f.ready));
  if ('identify' in f) return wasm.encode_net_bytes(i.endpoint, false, wasm.controller_identify());
  const s = f.state;
  return wasm.encode_net_bytes(i.endpoint, true, wasm.controller_state(s.source, s.seq, s.drive[0], s.drive[1]));
}

function status(w: SimWorker<Sim>): WorkerStatus {
  const base: WorkerStatus = {
    tick: w.lastTick,
    hash: '',
    pauseMask: PAUSE_BITS.fault,
    countdownMs: 0,
    published: w.published,
    skipped: w.skipped,
    appliedThrottle: [],
  };
  if (!w.sim || w.faulted) return base;
  try {
    const s = w.sim;
    return {
      ...base,
      tick: s.tick(),
      hash: s.state_hash(),
      pauseMask: s.pause_mask(),
      countdownMs: s.countdown_ms(),
      appliedThrottle: [0, 1, 2, 3].map((c) => s.applied_throttle(c)),
    };
  } catch (e) {
    w.fault(e);
    return base;
  }
}

const ext: Extension<Sim> = {
  encode,
  describe: (bytes) => wasm.describe_message(bytes),
  init(w, init) {
    const t = init as TestInit;
    w.describe = t.describe ?? false;
    if (!t.live) w.sim!.test('{"cmd":"hold","on":true}');
  },
  message(w, raw) {
    const msg = raw as TestToWorker;
    switch (msg.kind) {
      case 'test': {
        let reply: { ok: boolean; value?: unknown; error?: string } = { ok: false, error: 'the sim has faulted' };
        w.guard((s) => {
          try {
            reply = { ok: true, value: JSON.parse(s.test(JSON.stringify(msg.command))) };
          } catch (e) {
            // A Rust panic is a fault (rethrown to the guard); a refused command just answers why.
            if (e instanceof WebAssembly.RuntimeError) throw e;
            reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        });
        if (!w.faulted) w.flush(STEPPING.has(String(msg.command.cmd)));
        w.post({ kind: 'testResult', id: msg.id, ...reply });
        return true;
      }
      case 'schedule':
        w.guard((s) => s.schedule(msg.tick, w.encode(msg.input as never)));
        return true;
      case 'stopAt':
        w.guard((s) => s.stop_at(msg.tick));
        return true;
      case 'panic':
        w.guard((s) => s.debug_panic());
        return true;
      case 'status':
        w.post({ kind: 'status', id: msg.id, status: status(w) });
        return true;
      default:
        return false;
    }
  },
};

new SimWorker(wasm, ext);
