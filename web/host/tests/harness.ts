// P1-S02 harness: one sim worker run at a time, driven by web/host/tests/worker.test.mjs through `window.__jj`.
// The "renderer" here holds each snapshot until its next frame at `renderHz` (with `renderWorkMs` of main-thread work
// per frame), or never gives buffers back (`starve`), so the tests can show the sim doesn't care. It runs the test
// chunk's worker live (on its own clock) for the exact-tick scheduling, status and panic hooks.
import greybox from '../../../maps/greybox-loop.json?raw';
import { SimClient, type Snapshot } from '../src/worker/client';
import { TestClient, createWorker } from '../src/testing/testing';
import type { TestInput } from '../src/testing/messages';

interface RunOptions {
  seed?: number;
  poolSize?: number;
  renderHz?: number;
  renderWorkMs?: number;
  starve?: boolean;
  script?: { tick: number; input: TestInput }[];
  stopAt?: number;
}

class Run {
  readonly client = new SimClient(createWorker());
  readonly test = new TestClient(this.client);
  readonly lines: string[] = [];
  readonly faults: string[] = [];
  held: Snapshot[] = [];
  frames = 0;
  snapshots = 0;
  lastSnapshotTick = 0;
  private render: ReturnType<typeof setInterval> | undefined;
  private pad: ReturnType<typeof setInterval> | undefined;

  constructor(readonly opts: RunOptions) {
    this.client.onSnapshot = (s) => {
      this.snapshots++;
      this.lastSnapshotTick = s.tick;
      this.held.push(s);
    };
    this.client.onMessages = (_list, lines) => this.lines.push(...(lines ?? []));
    this.client.onFault = (m) => this.faults.push(m);
    this.client.followVisibility();
  }

  async start(): Promise<void> {
    const o = this.opts;
    await this.client.start({ mapJson: greybox, seed: o.seed ?? 3, poolSize: o.poolSize ?? 3 }, { describe: true, live: true });
    // Claimed seats drive at once (G04's free drive, as the host page's `?test` does; the real Lobby holds cars, R110).
    this.client.input({ type: 'ui', ui: 'free-drive', on: true });
    for (const { tick, input } of o.script ?? []) this.test.schedule(tick, input);
    if (o.stopAt !== undefined) this.test.stopAt(o.stopAt);
    const hz = o.renderHz ?? 60;
    this.render = setInterval(() => this.frame(), 1000 / hz);
  }

  /** A render frame: read the newest snapshot's cars, burn `renderWorkMs`, then give every buffer back. */
  private frame(): void {
    this.frames++;
    const newest = this.held.at(-1);
    if (newest) {
      const cars = newest.view.getUint32(28, true);
      let sum = 0;
      for (let c = 0; c < cars; c++) sum += newest.view.getFloat32(40 + c * 64 + 8, true);
      (globalThis as { __jjSink?: number }).__jjSink = sum;
    }
    const until = performance.now() + (this.opts.renderWorkMs ?? 0);
    while (performance.now() < until) {
      // A heavy frame on main: the worker's clock mustn't notice.
    }
    if (this.opts.starve) return;
    for (const s of this.held) this.client.release(s);
    this.held = [];
  }

  /** A host pad held at `axes`, re-sent every `everyMs` (a pad's own sampling). */
  hold(source: number, axes: [number, number, number, number], everyMs = 30): void {
    this.unhold();
    this.pad = setInterval(() => this.client.input({ type: 'local', source, axes }), everyMs);
  }

  unhold(): void {
    clearInterval(this.pad);
  }

  stop(): void {
    clearInterval(this.render);
    this.unhold();
    this.client.worker.terminate();
  }
}

/** Emulates the page being hidden or shown (headless Chromium never hides a page): the real `visibilitychange` path. */
function setVisible(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true });
  Object.defineProperty(document, 'hidden', { value: !visible, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

let run: Run | null = null;

function current(): Run {
  if (!run) throw new Error('no run: call __jj.start first');
  return run;
}

const api = {
  async start(opts: RunOptions = {}) {
    run?.stop();
    setVisible(true);
    run = new Run(opts);
    await run.start();
  },
  status: () => current().test.status(),
  schedule: (tick: number, input: TestInput) => current().test.schedule(tick, input),
  stopAt: (tick: number) => current().test.stopAt(tick),
  input: (input: TestInput) => current().test.input(input),
  hold: (source: number, axes: [number, number, number, number], everyMs?: number) => current().hold(source, axes, everyMs),
  unhold: () => current().unhold(),
  hide: () => setVisible(false),
  show: () => setVisible(true),
  panic: () => current().test.panic(),
  pauseReasons: () => current().client.pauseReasons(),
  countdownMs: () => current().client.countdownMs,
  lines: () => current().lines.slice(),
  faults: () => current().faults.slice(),
  render: () => ({ frames: current().frames, snapshots: current().snapshots, held: current().held.length, lastSnapshotTick: current().lastSnapshotTick }),
};

declare global {
  interface Window {
    __jj: typeof api;
  }
}

window.__jj = api;
document.getElementById('status')!.textContent = 'ready';
