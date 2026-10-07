// The dev map import (owner, 2026-10-03): `?test&map=<name>` loads `maps/<name>.json` from the build. Only the test-enabled
// host imports this module, so a production build ships none of the maps. An authored map goes through the same validator
// as a generated one (`jj-wasm-procgen`'s `validateMap`, then the sim's own check at `MapReady`).
const maps = import.meta.glob('../../../../maps/*.json', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export async function loadDevMap(name: string): Promise<string> {
  const key = Object.keys(maps).find((k) => k.endsWith(`/maps/${name}.json`));
  if (!key) throw new Error(`no map named ${name} in maps/ (have: ${Object.keys(maps).map((k) => k.split('/').pop()!.replace('.json', '')).join(', ')})`);
  return maps[key]!();
}
