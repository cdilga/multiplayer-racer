// The host main thread's side of the sim worker (P1-S02): starts it, forwards inputs and lifecycle, hands each
// snapshot to the renderer and returns its buffer to the pool when the renderer is done, and composes the pause
// reasons the host UI shows (a worker fault included).
import {
  pauseReasons,
  type FromWorker,
  type InitOptions,
  type InputStat,
  type PauseReason,
  type SimInput,
  type ToWorker,
} from './messages';

export interface Snapshot {
  tick: number;
  view: DataView;
  buf: ArrayBuffer;
}

export class SimClient {
  readonly worker: Worker;
  private fault: string | null = null;
  private mask = 0;
  private statsWaiters = new Map<number, (s: InputStat[]) => void>();
  private nextStats = 1;
  /** Milliseconds left on the resume countdown when it last changed second (0: none). */
  countdownMs = 0;
  /** Called with each snapshot; the renderer must call `release(snapshot)` when done with it. */
  onSnapshot: (s: Snapshot) => void = (s) => this.release(s);
  /** Encoded `SimToMain` events and outbound controller bytes, in order (`lines`: as text, from a describing worker). */
  onMessages: (list: Uint8Array[], lines?: string[]) => void = () => {};
  /** Bytes for one controller endpoint (the network bridge sends them on that peer's channel). */
  onOutbound: (endpoint: string, channel: 'state' | 'cmd', bytes: Uint8Array) => void = () => {};
  onPause: (reasons: PauseReason[], countdownMs: number) => void = () => {};
  onFault: (message: string) => void = () => {};
  /** Messages only the test chunk's worker sends (web/host/src/testing/). */
  onOther: (msg: { kind: string } & Record<string, unknown>) => void = () => {};

  /** `worker`: the shipped sim worker unless given one (the test chunk passes its own). */
  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.receive({ kind: 'fault', message: e.message });
  }

  send(msg: ToWorker | ({ kind: string } & Record<string, unknown>), transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private receive(msg: FromWorker | ({ kind: string } & Record<string, unknown>)): void {
    const m = msg as FromWorker;
    switch (m.kind) {
      case 'snapshot':
        this.onSnapshot({ tick: m.tick, view: new DataView(m.buf, 0, m.bytes), buf: m.buf });
        return;
      case 'messages':
        this.onMessages(m.list, m.lines);
        return;
      case 'outbound':
        this.onOutbound(m.endpoint, m.channel, m.bytes);
        return;
      case 'pause':
        this.mask = m.mask;
        this.countdownMs = m.countdownMs;
        this.onPause(this.pauseReasons(), m.countdownMs);
        return;
      case 'fault':
        this.fault = m.message;
        this.onFault(m.message);
        return;
      case 'inputStats':
        this.statsWaiters.get(m.id)?.(m.sources);
        this.statsWaiters.delete(m.id);
        return;
      case 'ready':
        return;
      default:
        this.onOther(msg as { kind: string } & Record<string, unknown>);
    }
  }

  /** Starts the sim on a map (canonical bytes, or `jj.map.v1` JSON) with a seed. Resolves when the worker is ready.
   *  `extra`: init options only the test chunk's worker reads. */
  start(opts: InitOptions, extra: Record<string, unknown> = {}): Promise<void> {
    return new Promise((resolve) => {
      const prev = this.worker.onmessage;
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.kind === 'ready') {
          this.worker.onmessage = prev;
          resolve();
        } else this.receive(e.data);
      };
      this.send({ ...extra, kind: 'init', ...opts });
    });
  }

  input(input: SimInput): void {
    this.send({ kind: 'input', input });
  }

  /** Visibility and renderer health; the host wires `visibilitychange` and context loss to this. */
  lifecycle(visible: boolean, renderOk = true): void {
    this.send({ kind: 'lifecycle', visible, renderOk });
  }

  /** Follows the page's visibility (hidden → the `host-hidden` pause). */
  followVisibility(doc: Document = document): void {
    doc.addEventListener('visibilitychange', () => this.lifecycle(doc.visibilityState === 'visible'));
  }

  /** Gives a snapshot's buffer back to the worker's pool. */
  release(s: Snapshot): void {
    this.send({ kind: 'return', buf: s.buf }, [s.buf]);
  }

  /** Each local source's host-applied input age so far (P1-C05; the receipt row and the input drawer read it). */
  inputStats(): Promise<InputStat[]> {
    const id = this.nextStats++;
    return new Promise((resolve) => {
      this.statsWaiters.set(id, resolve);
      this.send({ kind: 'inputStats', id });
    });
  }

  /** The pause reasons the host shows, plus `fault` if the worker broke. */
  pauseReasons(): PauseReason[] {
    const reasons = pauseReasons(this.mask);
    if (this.fault && !reasons.includes('fault')) reasons.push('fault');
    return reasons;
  }
}
