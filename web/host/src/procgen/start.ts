// Wires round preparation into the host page (P1-M08a): the procgen worker, the preparer, the dev-map import and the
// R90 readout on `window.__jjPrepare`. Loaded lazily by main.ts, only on the real room path (not `?drive`, not plain `?test`).
import type { World } from '../render/world';
import type { SimClient } from '../worker/client';
import { ProcgenClient } from './client';
import { mountFailureScreen } from './failure';
import { RoundPreparer } from './prepare';

/** One-line banner for a map the host refused (a broken dev map, or a failed preparation). */
function banner(text: string): void {
  let el = document.querySelector<HTMLElement>('.jj-prepare-error');
  if (!el) {
    el = document.createElement('div');
    el.className = 'jj-prepare-error';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9;padding:10px 14px;background:#7a1010;color:#fff;font:14px/1.3 system-ui,sans-serif;white-space:pre-wrap;border-radius:6px';
    document.body.append(el);
  }
  el.textContent = text;
}

export async function startPreparation(client: SimClient, world: World, params: URLSearchParams): Promise<RoundPreparer> {
  const procgen = new ProcgenClient();
  // The dev map import: only in test-enabled builds (`?test&map=<name>`), maps/<name>.json from the build.
  let devMap: (() => Promise<string>) | undefined;
  const name = params.get('map');
  if (params.has('test') && name && /^[\w.-]+$/.test(name)) {
    const { loadDevMap } = await import('./devmaps');
    devMap = () => loadDevMap(name);
  }
  const failure = mountFailureScreen(client);
  const preparer = new RoundPreparer({
    host: client,
    presenter: world,
    procgen,
    recipe: params.get('recipe') ?? undefined,
    devMap,
    // One frame between building a map and offering it, so the main thread is idle for the sim's commit.
    afterStage: () => new Promise((r) => requestAnimationFrame(() => r())),
    // A dev map's refusal is a developer's message (the banner); a player-facing failure is the Retry / Lobby screen.
    onError: devMap ? (m) => banner(`Map refused: ${m}`) : undefined,
    onFailed: (m) => failure.show(m),
  });
  preparer.attach();
  // A dev map is judged now, not at the first round, so a broken one is named while the host is still in the Lobby.
  if (devMap) {
    void devMap()
      .then((json) => procgen.validate(json))
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        preparer.stats.lastError = message;
        banner(`Map ${name} refused: ${message}`);
        console.error(`jj: dev map ${name} refused:\n${message}`);
      });
  }
  (window as unknown as { __jjPrepare: unknown }).__jjPrepare = {
    stats: () => ({ ...preparer.stats }),
    seeds: () => preparer.seeds.map((s) => ({ ...s })),
    room: () => client.room?.preparation ?? null,
    /** The shown map's segments, route (x, z, y in metres), features and the town pieces the captures aim at, so a capture can
     *  step the cars to a biome and to what it shows. */
    mapInfo: () => {
      const m = preparer.committed as unknown as {
        route: { points: { x: number; y: number; z: number }[]; segments?: { name: string; span: { from: number; to: number } }[] };
        features: { kind: string; pose: { x: number; z: number } }[];
        dressing: { kitPiece: string; pose: { x: number; z: number } }[];
      } | null;
      const aimed = new Set(['town/house', 'town/shopfront', 'town/side-street', 'town/power-pole', 'town/water-tower', 'signs/junction']);
      return m
        ? {
            segments: (m.route.segments ?? []).map((s) => ({ name: s.name, from: s.span.from, to: s.span.to })),
            route: m.route.points.map((q) => [q.x / 1000, q.z / 1000, q.y / 1000]),
            features: m.features.map((f) => ({ kind: f.kind, x: f.pose.x / 1000, z: f.pose.z / 1000 })),
            pieces: m.dressing.filter((d) => aimed.has(d.kitPiece)).map((d) => ({ id: d.kitPiece, x: d.pose.x / 1000, z: d.pose.z / 1000 })),
          }
        : null;
    },
    reroll: () => preparer.reroll(),
    /** The owner tuning menu's Regenerate (br-2sdu.3): the current seed again with a tuned `jj.generator` document. */
    regenerate: (generator?: string) => preparer.regenerate(generator),
    failure: () => ({ visible: failure.visible }),
  };
  return preparer;
}
