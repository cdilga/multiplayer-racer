// P1-M08a harness: the real RoundPreparer over the real procgen worker and the test chunk's sim worker (live clock),
// with a counting presenter (meshes are built for real, nothing is drawn). Driven by prepare.test.mjs through `window.__prep`.
import greybox from '../../../maps/greybox-loop.json?raw';
import { MapRenderer, type MapJson } from '../src/render/map/map';
import { ProcgenClient, type PreparedMap, type Procgen } from '../src/procgen/client';
import { RoundPreparer } from '../src/procgen/prepare';
import { TestClient, createWorker } from '../src/testing/testing';
import { SimClient } from '../src/worker/client';

interface StartOptions {
  seed?: number;
  /** An authored map for every preparation (the dev map import). */
  devMap?: string;
  /** Milliseconds each `prepare` takes to answer, by call number (1-based): a slow job the test supersedes. */
  delay?: Record<number, number>;
  /** Calls whose map comes back with the ladder exhausted (`valid: false`), by recipe: 'all' or 'full' (every recipe but the conservative one). */
  fail?: 'all' | 'full';
}

const presented = { staged: 0, committed: 0, disposed: 0, commitMaps: [] as string[] };
let client: SimClient;
let test: TestClient;
let preparer: RoundPreparer;
let calls = 0;
const refused: string[] = [];

/** The real procgen client, with the test's delays and failures on top. */
function procgenFor(o: StartOptions): Procgen {
  const real = new ProcgenClient();
  return {
    validate: (json) => real.validate(json),
    async prepare(seed, recipe): Promise<PreparedMap> {
      const n = ++calls;
      const p = await real.prepare(seed, recipe);
      const wait = o.delay?.[n] ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (o.fail === 'all' || (o.fail === 'full' && recipe !== 'greybox')) return { ...p, valid: false };
      return p;
    },
  };
}

const api = {
  async start(o: StartOptions = {}) {
    client = new SimClient(createWorker());
    test = new TestClient(client);
    await client.start({ mapJson: greybox, seed: o.seed ?? 3 }, { describe: false, live: true });
    preparer = new RoundPreparer({
      host: client,
      procgen: procgenFor(o),
      devMap: o.devMap === undefined ? undefined : async () => o.devMap!,
      onError: (m) => refused.push(m),
      presenter: {
        stageMap(map: MapJson) {
          presented.staged++;
          const renderer = new MapRenderer(map);
          const dispose = renderer.dispose.bind(renderer);
          renderer.dispose = () => {
            presented.disposed++;
            dispose();
          };
          return { map, renderer };
        },
        commitMap(staged) {
          presented.committed++;
          // The map's header names the seed it was generated for: what the clip would say.
          presented.commitMaps.push(String((staged.map as unknown as { header: { seed: number } }).header.seed));
        },
      },
    });
    preparer.attach();
    // One seat joins through the real controller path.
    test.input({ type: 'controller', endpoint: 'p1', frame: { hello: true } });
    test.input({ type: 'controller', endpoint: 'p1', frame: { claim: 'Ava' } });
  },
  startRound: () => client.input({ type: 'ui', ui: 'start' }),
  reroll: () => preparer.reroll(),
  /** A `MapReady` for a preparation the director has moved past (what a late job would send). */
  sendStale: (preparation: number) => client.input({ type: 'map-ready', preparation, bytes: new Uint8Array([1, 2, 3]) }),
  room: () => client.room,
  stats: () => ({ ...preparer.stats }),
  seeds: () => preparer.seeds.map((s) => ({ ...s })),
  presented: () => ({ ...presented, commitMaps: [...presented.commitMaps] }),
  stagedFor: () => preparer.stagedFor,
  refused: () => [...refused],
};

declare global {
  interface Window {
    __prep: typeof api;
  }
}
window.__prep = api;
document.getElementById('status')!.textContent = 'ready';
