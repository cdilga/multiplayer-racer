// The procgen Web Worker (P1-M08a): runs `jj-wasm-procgen` off the main thread. It produces data only: the canonical
// bytes (what the sim validates and races), the map JSON (what the renderer builds from) and the fallback ladder's log.
// The sim worker owns colliders and main owns the GPU upload (master §11.2a).
import type { FromProcgen, ToProcgen } from './messages';
import init, { defaultRecipe, prepare, validateMap } from './pkg/jj_wasm_procgen';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const ready = init();

scope.onmessage = async (e: MessageEvent<ToProcgen>) => {
  await ready;
  const msg = e.data;
  try {
    if (msg.kind === 'prepare') {
      const t = performance.now();
      const p = prepare(msg.seed, msg.recipe ?? defaultRecipe());
      const out: FromProcgen = { kind: 'prepared', job: msg.job, seed: msg.seed, canonical: p.canonical, mapJson: p.mapJson, log: p.log, plan: p.plan, valid: p.valid, ms: performance.now() - t };
      p.free();
      scope.postMessage(out, [out.canonical.buffer]);
    } else {
      const canonical = validateMap(msg.json);
      scope.postMessage({ kind: 'validated', job: msg.job, canonical, mapJson: msg.json } satisfies FromProcgen, [canonical.buffer]);
    }
  } catch (err) {
    scope.postMessage({ kind: 'failed', job: msg.job, message: err instanceof Error ? err.message : String(err) } satisfies FromProcgen);
  }
};
