// The owner tuning menu's generator side (br-2sdu.3): the shipped generator data and its validator come from the same
// jj-wasm-procgen module the procgen worker runs, so a value the panel accepts is a value the worker will build with.
import init, { generatorDefaults, generatorWith } from '../procgen/pkg/jj_wasm_procgen';
import type { GeneratorHooks } from './panel';

interface Preparation {
  seeds(): Array<{ preparation: number; seed: number; lengthM?: number; reliefM?: number }>;
  regenerate(generator?: string): void;
  loadScene(scene: { name: string; json: string } | null): void;
  scene(): string | null;
}

// The Feel Lab scenes' committed maps (`jj lab`, maps/lab/<scene>.json), loaded only when one is picked.
const SCENES = import.meta.glob('../../../../maps/lab/*.json', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const sceneName = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);

export async function generatorHooks(prep: Preparation): Promise<GeneratorHooks> {
  await init();
  return {
    defaults: async () => JSON.parse(generatorDefaults()),
    with: (set) => generatorWith(JSON.stringify(set)),
    regenerate: (doc) => prep.regenerate(doc),
    scenes: Object.keys(SCENES).map(sceneName).sort(),
    scene: () => prep.scene(),
    loadScene: async (name) => {
      const path = Object.keys(SCENES).find((k) => sceneName(k) === name);
      prep.loadScene(name && path ? { name, json: await SCENES[path]!() } : null);
    },
    built: () => {
      const b = prep.seeds().filter((s) => s.lengthM !== undefined).at(-1);
      return b ? { preparation: b.preparation, seed: b.seed, lengthM: b.lengthM, reliefM: b.reliefM } : null;
    },
  };
}
