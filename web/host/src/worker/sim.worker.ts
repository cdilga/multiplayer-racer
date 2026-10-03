// The host's sim worker (P1-S02): `jj-wasm-host` (jj-session + jj-input + jj-sim) behind the worker ABI.
// - It owns the 120 Hz clock: a short timer loop hands `performance.now()` to the sim, which steps whole ticks
//   from its own accumulator. Rendering never changes the simulation.
// - Snapshots go out in pooled transferable buffers. With no free buffer it skips the publish: physics never blocks,
//   and events (sent separately) are never dropped.
// - A panic or unrecoverable WASM error is the `fault` pause reason: the loop stops and main is told.
// Typechecked by its own tsconfig (WebWorker lib, and the generated pkg/ only exists after scripts/build-host-wasm.sh).
import init, {
  HostSim,
  canonical_map,
  controller_claim,
  controller_hello,
  controller_state,
  describe_message,
  encode_init,
  encode_lifecycle,
  encode_local_source,
  encode_net_bytes,
  encode_ui,
} from './pkg/jj_wasm_host.js';
import { PAUSE_BITS, type FromWorker, type SimInput, type ToWorker } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const LOOP_MS = 2;
let sim: HostSim | null = null;
let faulted = false;
let started = false;
let describe = false;
const pool: ArrayBuffer[] = [];
let published = 0;
let skipped = 0;
let uiCommand = 1;
let lastPause = '';
let lastTick = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

function encode(input: SimInput): Uint8Array {
  switch (input.type) {
    case 'local': {
      const [dx, dy, ax, ay] = input.axes;
      return encode_local_source(input.source, dx, dy, ax, ay, input.buttons ?? 0, input.seq ?? 0);
    }
    case 'net':
      return encode_net_bytes(input.endpoint, input.channel === 'state', input.bytes);
    case 'ui':
      return encode_ui(uiCommand++, input.ui, input.on ?? false);
    case 'controller': {
      const f = input.frame;
      if ('hello' in f) return encode_net_bytes(input.endpoint, false, controller_hello(input.endpoint));
      if ('claim' in f) return encode_net_bytes(input.endpoint, false, controller_claim(f.claim));
      const s = f.state;
      return encode_net_bytes(input.endpoint, true, controller_state(s.source, s.seq, s.drive[0], s.drive[1]));
    }
  }
}

function fault(e: unknown): void {
  faulted = true;
  post({ kind: 'fault', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  post({ kind: 'pause', mask: PAUSE_BITS.fault, countdownMs: 0 });
}

/** Runs `f` against the sim; a throw (a Rust panic surfaces as a RuntimeError) is a fault. */
function guard(f: (s: HostSim) => void): void {
  if (!sim || faulted) return;
  try {
    f(sim);
  } catch (e) {
    fault(e);
  }
}

function drain(s: HostSim): void {
  const list: Uint8Array[] = [];
  for (let m = s.next_message(); m !== undefined; m = s.next_message()) list.push(m);
  if (!list.length) return;
  const lines = describe ? list.flatMap((m) => describe_message(m)) : undefined;
  post({ kind: 'messages', list, lines }, list.map((b) => b.buffer as ArrayBuffer));
}

function publish(s: HostSim): void {
  const need = s.snapshot_size();
  if (pool.length === 0) {
    skipped++;
    return;
  }
  let i = pool.findIndex((b) => b.byteLength >= need);
  if (i < 0) {
    // Every free buffer is too small (more cars or debris than before): grow one, keep the pool size.
    pool.shift();
    pool.push(new ArrayBuffer(need * 2));
    i = pool.length - 1;
  }
  const buf = pool.splice(i, 1)[0]!;
  const bytes = s.write_snapshot(new Uint8Array(buf));
  published++;
  post({ kind: 'snapshot', buf, bytes, tick: s.tick() }, [buf]);
}

/** Tells main when the pause mask or the countdown's whole second changes: no snapshots flow while paused. */
function pauseState(s: HostSim): void {
  const mask = s.pause_mask();
  const countdownMs = s.countdown_ms();
  const key = `${mask}:${Math.ceil(countdownMs / 1000)}`;
  if (key === lastPause) return;
  lastPause = key;
  post({ kind: 'pause', mask, countdownMs });
}

function loop(): void {
  guard((s) => {
    const stepped = s.advance(performance.now());
    lastTick = s.tick();
    drain(s);
    pauseState(s);
    if (stepped > 0) publish(s);
  });
  if (!faulted) setTimeout(loop, LOOP_MS);
}

scope.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.kind) {
    case 'init': {
      await init();
      describe = msg.describe ?? false;
      try {
        const map = msg.mapBytes ?? canonical_map(msg.mapJson ?? '');
        sim = new HostSim(encode_init(map, msg.seed));
      } catch (err) {
        fault(err);
        return;
      }
      for (let k = 0; k < (msg.poolSize ?? 3); k++) pool.push(new ArrayBuffer(Math.max(64 * 1024, sim.snapshot_size() * 2)));
      post({ kind: 'ready' });
      if (!started) {
        started = true;
        loop();
      }
      return;
    }
    case 'input':
      guard((s) => s.handle(encode(msg.input)));
      return;
    case 'schedule':
      guard((s) => s.schedule(msg.tick, encode(msg.input)));
      return;
    case 'lifecycle':
      guard((s) => s.handle(encode_lifecycle(msg.visible, msg.renderOk)));
      return;
    case 'return':
      pool.push(msg.buf);
      return;
    case 'stopAt':
      guard((s) => s.stop_at(msg.tick));
      return;
    case 'panic':
      guard((s) => s.debug_panic());
      return;
    case 'status': {
      const base = { tick: lastTick, hash: '', pauseMask: PAUSE_BITS.fault, countdownMs: 0, published, skipped, appliedThrottle: [] as number[] };
      if (sim && !faulted) {
        try {
          const s = sim;
          Object.assign(base, {
            tick: s.tick(),
            hash: s.state_hash(),
            pauseMask: s.pause_mask(),
            countdownMs: s.countdown_ms(),
            appliedThrottle: [0, 1, 2, 3].map((c) => s.applied_throttle(c)),
          });
        } catch (err) {
          fault(err);
        }
      }
      post({ kind: 'status', id: msg.id, status: base });
      return;
    }
  }
};
