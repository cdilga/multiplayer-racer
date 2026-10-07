// The kit-piece registry on the render side (P1-R03, plan §8.1): the registry entries are data
// (assets/kit/<family>/*.json, owned by M01 and the biome/sign tasks); each id has one code-built geometry module
// here. A biome adds pieces by adding entries and modules, nothing else.
import { barrier } from './generic/barrier';
import { bin } from './generic/bin';
import { boxBuilding } from './generic/box-building';
import { cone } from './generic/cone';
import { post } from './generic/post';
import { WAYFINDING_MODULES } from './wayfinding'; // P1-M03f/M08a stand-ins until P1-R10
import { SIGN_MODULES } from '../signs'; // P1-M09: one module per assets/kit/signs/data/*.json
import type { KitModule, Params } from './types';

type Size = number | { param: string; scale?: number };
export interface KitEntry {
  id: string;
  version: number;
  params: Record<string, { min: number; max: number; default: number }>;
  collider: { box: { x: Size; y: Size; z: Size } } | { cylinder: { radius: Size; height: Size } };
  lod?: { simplifyBeyondMm?: number; cullBeyondMm?: number };
}

const files = import.meta.glob<KitEntry>('../../../../../assets/kit/*/*.json', { eager: true, import: 'default' });
// The wayfinding family's registry entries are procgen's stand-ins until P1-R10's `assets/kit/wayfinding/` lands (an
// entry there with the same id wins).
const standIns = import.meta.glob<KitEntry>('../../../../../crates/jj-procgen/kit/*/*.json', { eager: true, import: 'default' });
export const ENTRIES: Record<string, KitEntry> = Object.fromEntries([...Object.values(standIns), ...Object.values(files)].map((e) => [e.id, e]));

export const MODULES: Record<string, KitModule> = {
  'generic/barrier': barrier,
  'generic/post': post,
  'generic/box-building': boxBuilding,
  'generic/cone': cone,
  'generic/bin': bin,
  ...SIGN_MODULES,
  ...WAYFINDING_MODULES,
};

/** A placement's params with the entry's defaults filled in. */
export function withDefaults(entry: KitEntry, params: Params = {}): Params {
  const out: Params = {};
  for (const [k, spec] of Object.entries(entry.params)) out[k] = params[k] ?? spec.default;
  return out;
}

const size = (s: Size, p: Params) => (typeof s === 'number' ? s : p[s.param]! * (s.scale ?? 1)) / 1000;

/** The collider proxy's full extent (x, y, z) in metres for these params: what the sim collides with. */
export function colliderSize(entry: KitEntry, params: Params): [number, number, number] {
  const p = withDefaults(entry, params);
  if ('box' in entry.collider) {
    const b = entry.collider.box;
    return [size(b.x, p), size(b.y, p), size(b.z, p)];
  }
  const c = entry.collider.cylinder;
  const d = 2 * size(c.radius, p);
  return [d, size(c.height, p), d];
}
