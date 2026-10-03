// The host main thread's side of the sim worker (P1-S02): starts it, forwards inputs and lifecycle, hands each
// snapshot to the renderer and returns its buffer to the pool when the renderer is done, and composes the pause
// reasons the host UI shows (a worker fault included).
import { pauseReasons, type FromWorker, type PauseReason, type SimInput, type ToWorker, type WorkerStatus } from './messages';

export interface Snapshot {
  tick: number;
  view: DataView;
  buf: ArrayBuffer;
}

export class SimClient {
  readonly worker: Worker;
  private fault: string | null = null;
  private mask = 0;
  /** Milliseconds left on the resume countdown when it last changed second (0: none). */
  countdownMs = 0;
  private statusWaiters = new Map<number, (s: WorkerStatus) => void>();
  private nextStatus = 1;
  /** Called with each snapshot; the renderer must call `release(snapshot)` when done with it. */
  onSnapshot: (s: Snapshot) => void = (s) => this.release(s);
  /** Encoded `SimToMain` events and outbound controller bytes, in order (`lines`: as text, when started with `describe`). */
  onMessages: (list: Uint8Array[], lines?: string[]) => void = () => {};
  onPause: (reasons: PauseReason[], countdownMs: number) => void = () => {};
  onFault: (message: string) => void = () => {};

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.receive({ kind: 'fault', message: e.message });
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private receive(msg: FromWorker): void {
    switch (msg.kind) {
      case 'snapshot':
        this.onSnapshot({ tick: msg.tick, view: new DataView(msg.buf, 0, msg.bytes), buf: msg.buf });
        return;
      case 'messages':
        this.onMessages(msg.list, msg.lines);
        return;
      case 'pause':
        this.mask = msg.mask;
        this.countdownMs = msg.countdownMs;
        this.onPause(this.pauseReasons(), msg.countdownMs);
        return;
      case 'status':
        this.statusWaiters.get(msg.id)?.(msg.status);
        this.statusWaiters.delete(msg.id);
        return;
      case 'fault':
        this.fault = msg.message;
        this.onFault(msg.message);
        return;
      case 'ready':
        return;
    }
  }

  /** Starts the sim on a map (canonical bytes, or `jj.map.v1` JSON) with a seed. Resolves when the worker is ready. */
  start(opts: { mapJson?: string; mapBytes?: Uint8Array; seed: number; poolSize?: number; describe?: boolean }): Promise<void> {
    return new Promise((resolve) => {
      const prev = this.worker.onmessage;
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.kind === 'ready') {
          this.worker.onmessage = prev;
          resolve();
        } else this.receive(e.data);
      };
      this.send({ kind: 'init', ...opts });
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

  /** The pause reasons the host shows, plus `fault` if the worker broke. */
  pauseReasons(): PauseReason[] {
    const reasons = pauseReasons(this.mask);
    if (this.fault && !reasons.includes('fault')) reasons.push('fault');
    return reasons;
  }

  // Test and bot hooks (R90): exact-tick scheduling, a stop tick, status and a deliberate panic.
  schedule(tick: number, input: SimInput): void {
    this.send({ kind: 'schedule', tick, input });
  }

  stopAt(tick: number): void {
    this.send({ kind: 'stopAt', tick });
  }

  status(): Promise<WorkerStatus> {
    const id = this.nextStatus++;
    return new Promise((resolve) => {
      this.statusWaiters.set(id, resolve);
      this.send({ kind: 'status', id });
    });
  }

  panic(): void {
    this.send({ kind: 'panic' });
  }
}
