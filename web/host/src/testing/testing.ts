// The host's browser test surface (P1-F05b, R90, plan §13a). A separate chunk the host page imports only with `?test`
// in its URL, and that a `production` realm server never serves (its path is under `test/`). It brings its own worker
// (the `testing` build of jj-wasm-host), starts held (frame-stepped), and puts `window.__jjTest` on the page that loaded
// it, and nowhere else: controllers have no path to it.
//
// The commands are `jj sim`'s (jj-fixture JSON shapes), run in the host's own worker; the helpers on top are blocking
// steps that wait on their own fact (`until`), fake controllers that join through the real controller path, a debug
// overlay and capture metadata.
import type { LocalInput } from '../input/local';
import { SimClient, type Snapshot } from '../worker/client';
import type { TestFromWorker, TestInput, TestToWorker, WorkerStatus } from './messages';

/** The bundle check (scripts/ci/bundle-check.mjs) fails a build where this appears outside the `test/` output. */
export const TEST_SURFACE_MARKER = 'jj-test-surface:v1';

/** The build's commit (vite `define`, from git at build time). */
declare const __JJ_COMMIT__: string;

/** Creates the testing worker (the host uses it instead of the shipped one when this chunk loaded). */
export function createWorker(): Worker {
  return new Worker(new URL('./testing.worker.ts', import.meta.url), { type: 'module', name: 'jj-testing-worker' });
}

type Json = Record<string, unknown>;
// The observed state, as `jj sim` reports it plus the host's own seats (`observe`).
export interface Observed {
  tick: number;
  cars: Array<Json & { car: number; position: [number, number, number]; speed: number; wheels: Json[] }>;
  debris: Json[];
  session?: Json;
  host: { seats: Array<Json & { endpoint: string; source: number; car: number | null }>; pauseMask: number; held: boolean };
}

/** The main-thread side of the testing worker's extra messages. */
export class TestClient {
  private waiting = new Map<number, (m: TestFromWorker) => void>();
  private nextId = 1;

  constructor(readonly client: SimClient) {
    client.onOther = (m) => {
      const msg = m as unknown as TestFromWorker;
      this.waiting.get(msg.id)?.(msg);
      this.waiting.delete(msg.id);
    };
  }

  private send(msg: TestToWorker): void {
    this.client.send(msg);
  }

  private ask(make: (id: number) => TestToWorker): Promise<TestFromWorker> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.send(make(id));
    });
  }

  /** One test-surface command (see `jj_wasm_host::host::testing`); rejects with the surface's reason. */
  async command<T = Json>(command: Json): Promise<T> {
    const r = await this.ask((id) => ({ kind: 'test', id, command }));
    if (r.kind !== 'testResult') throw new Error('unexpected reply');
    if (!r.ok) throw new Error(`${String(command.cmd)}: ${r.error}`);
    return r.value as T;
  }

  async status(): Promise<WorkerStatus> {
    const r = await this.ask((id) => ({ kind: 'status', id }));
    if (r.kind !== 'status') throw new Error('unexpected reply');
    return r.status;
  }

  input(input: TestInput): void {
    this.client.send({ kind: 'input', input });
  }

  schedule(tick: number, input: TestInput): void {
    this.send({ kind: 'schedule', tick, input });
  }

  stopAt(tick: number): void {
    this.send({ kind: 'stopAt', tick });
  }

  panic(): void {
    this.send({ kind: 'panic' });
  }
}

interface FakeController {
  endpoint: string;
  source: number;
  seq: number;
  drive: [number, number] | null;
}

/** The debug overlay: a top-down plot of the route and cars, and per-car wheel compression, slip and contact. */
class Overlay {
  private root = document.createElement('section');
  private canvas = document.createElement('canvas');
  private table = document.createElement('pre');
  private route: Array<[number, number]>;

  constructor(mapJson: string) {
    const map = JSON.parse(mapJson) as { route: { points: Array<{ x: number; z: number }> } };
    this.route = map.route.points.map((p) => [p.x / 1000, p.z / 1000]);
    this.root.dataset.jjOverlay = '';
    this.root.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:9;background:#15203Ae6;color:#fff;font:12px/1.35 ui-monospace,monospace;padding:8px;border-radius:6px;max-width:46vw';
    this.canvas.width = 320;
    this.canvas.height = 220;
    this.root.append(this.canvas, this.table);
  }

  show(on: boolean): void {
    if (on) document.body.append(this.root);
    else this.root.remove();
  }

  get shown(): boolean {
    return this.root.isConnected;
  }

  draw(state: Observed): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const pts = [...this.route, ...state.cars.map((c) => [c.position[0], c.position[2]] as [number, number])];
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const k = Math.min((this.canvas.width - 20) / Math.max(1, x1 - x0), (this.canvas.height - 20) / Math.max(1, z1 - z0));
    const at = (x: number, z: number): [number, number] => [10 + (x - x0) * k, 10 + (z - z0) * k];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = '#C8622E';
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.route.forEach(([x, z], i) => (i ? ctx.lineTo(...at(x, z)) : ctx.moveTo(...at(x, z))));
    ctx.closePath();
    ctx.stroke();
    for (const c of state.cars) {
      const [x, y] = at(c.position[0], c.position[2]);
      ctx.fillStyle = '#FFD23F';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(c.car), x + 6, y - 4);
    }
    const rows = state.cars.map((c) => {
      const wheels = c.wheels
        .map((w) => `${w.contact ? '●' : '○'}${Number(w.suspensionLength).toFixed(2)}/${Number(w.slipDeg).toFixed(1)}°`)
        .join(' ');
      return `car ${c.car} ${c.speed.toFixed(1).padStart(5)} m/s  ${wheels}`;
    });
    this.table.textContent = [
      `tick ${state.tick}${state.host.held ? ' (held)' : ''}  cars ${state.cars.length}  debris ${state.debris.length}`,
      'wheel: contact, suspension length m / slip',
      ...rows,
      'damage episodes, part states: none yet (S04)',
    ].join('\n');
  }
}

/** Puts the surface on `window.__jjTest` for the page that loaded this chunk. */
export function attach(client: SimClient, ctx: { mapJson: string; seed: number; input?: LocalInput }) {
  const test = new TestClient(client);
  const overlay = new Overlay(ctx.mapJson);
  const fakes = new Map<string, FakeController>();
  const lines: string[] = [];
  let latest: Snapshot | null = null;
  client.onMessages = (_list, l) => lines.push(...(l ?? []));
  client.onSnapshot = (s) => {
    if (latest) client.release(latest);
    latest = s;
  };

  const observe = async (): Promise<Observed> => {
    const state = await test.command<Observed>({ cmd: 'observe' });
    if (overlay.shown) overlay.draw(state);
    return state;
  };
  const step = (ticks: number) => test.command<{ tick: number }>({ cmd: 'step', ticks });

  const surface = {
    marker: TEST_SURFACE_MARKER,
    /** Raw test-surface command. */
    command: (command: Json) => test.command(command),
    hold: (on: boolean) => test.command({ cmd: 'hold', on }),
    load: (fixture: Json, mapJson?: string) => test.command({ cmd: 'load', fixture, mapJson }),
    spawn: (cars: Json[]) => test.command<{ cars: number[] }>({ cmd: 'spawn', cars }),
    inputs: (spans: Json[]) => test.command({ cmd: 'inputs', spans }),
    step,
    until: (until: Json, maxTicks: number) => test.command({ cmd: 'until', until, maxTicks }),
    observe,
    hash: () => test.command<{ tick: number; stateHash: string }>({ cmd: 'hash' }),
    outcome: () => test.command({ cmd: 'outcome' }),
    status: () => test.status(),
    lines: () => lines.slice(),
    pauseReasons: () => client.pauseReasons(),
    /** Host pads and key clusters (P1-C05): the drawer's list and each source's host-applied input age. */
    localSources: () => ctx.input?.list() ?? [],
    inputStats: () => client.inputStats(),

    /** A fake controller joins through the real controller path (Hello + Claim as cmd-channel bytes) and gets a seat. */
    async join(name: string) {
      const endpoint = `fake-${fakes.size}`;
      test.input({ type: 'controller', endpoint, frame: { hello: true } });
      test.input({ type: 'controller', endpoint, frame: { claim: name } });
      await step(1);
      const seat = (await observe()).host.seats.find((s) => s.endpoint === endpoint);
      if (!seat || seat.car === null) throw new Error(`${name} didn't get a seat and car`);
      fakes.set(endpoint, { endpoint, source: seat.source, seq: 0, drive: null });
      return { endpoint, seat: seat.seat as number, source: seat.source, car: seat.car };
    },

    /** Holds a fake controller's drive stick at [x, y] (−32767..32767), or lets go (`null`). */
    drive(endpoint: string, drive: [number, number] | null) {
      const f = fakes.get(endpoint);
      if (!f) throw new Error(`no fake controller ${endpoint}`);
      f.drive = drive;
    },

    /** Steps `every` ticks at a time, re-sending every held stick first (as a phone would), until `predicate` holds
     *  on the observed state or `maxTicks` pass. Resolves with whether it held. */
    async untilFact(predicate: (s: Observed) => boolean, opts: { maxTicks?: number; every?: number } = {}) {
      const maxTicks = opts.maxTicks ?? 1200;
      const every = opts.every ?? 6;
      let state = await observe();
      const start = state.tick;
      while (!predicate(state) && state.tick - start < maxTicks) {
        for (const f of fakes.values()) {
          if (!f.drive) continue;
          f.seq = (f.seq + 1) & 0xffff;
          test.input({ type: 'controller', endpoint: f.endpoint, frame: { state: { source: f.source, seq: f.seq, drive: f.drive } } });
        }
        await step(every);
        state = await observe();
      }
      return { held: predicate(state), tick: state.tick, ticks: state.tick - start, state };
    },

    /** Shows or hides the debug overlay (captures switch it on). */
    async overlay(on: boolean) {
      overlay.show(on);
      if (on) await observe();
    },

    /** What a capture records alongside its pixels. The caller takes the screenshot. */
    async captureMeta(name: string) {
      const [meta, hash] = await Promise.all([
        test.command<{ mapHash: string; seed: number; scenario: string | null }>({ cmd: 'meta' }),
        test.command<{ tick: number; stateHash: string }>({ cmd: 'hash' }),
      ]);
      return {
        name,
        commit: __JJ_COMMIT__,
        url: location.href,
        map: { hash: meta.mapHash },
        assets: { note: 'the host loads no vehicle assets until the renderer lands (R01)' },
        fixture: meta.scenario,
        seed: meta.seed,
        tick: hash.tick,
        stateHash: hash.stateHash,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        browser: navigator.userAgent,
        backend: 'none: the host has no renderer until R01',
        overlay: overlay.shown,
        takenAt: new Date().toISOString(),
      };
    },
  };
  (window as unknown as { __jjTest: typeof surface }).__jjTest = surface;
  return surface;
}

export type Surface = ReturnType<typeof attach>;
