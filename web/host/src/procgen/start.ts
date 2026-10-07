// Wires round preparation into the host page (P1-M08a): the procgen worker, the preparer, the dev-map import and the
// R90 readout on `window.__jjPrepare`. Loaded lazily by main.ts, only on the real room path (not `?drive`, not plain `?test`).
import type { World } from '../render/world';
import type { SimClient } from '../worker/client';
import { ProcgenClient } from './client';
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
  const preparer = new RoundPreparer({
    host: client,
    presenter: world,
    procgen,
    recipe: params.get('recipe') ?? undefined,
    devMap,
    // One frame between building a map and offering it, so the main thread is idle for the sim's commit.
    afterStage: () => new Promise((r) => requestAnimationFrame(() => r())),
    onError: (m) => banner(`Map refused: ${m}`),
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
    reroll: () => preparer.reroll(),
  };
  return preparer;
}
