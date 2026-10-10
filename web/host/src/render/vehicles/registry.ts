// The host's vehicle registry (R123): the roster is data (web/shared/src/roster.json), and every roster row is a drivable
// vehicle with a profile (assets/profiles/<id>.json) and a bake (art/vehicles/<id>/<id>.asset.json + .lod0-2.glb). Adding
// a vehicle adds those files and a roster row; nothing here names one. The sidecars and profiles are small JSON, bundled;
// the GLBs are only URLs here, fetched by the renderer when a car of that vehicle first appears (controllers never
// import this file, so a phone never downloads a world asset).
import roster from '../../../../shared/src/roster.json' with { type: 'json' };

/** The parts of a baked vehicle (`jj.vehicle.v1`) the renderer reads. */
export interface Sidecar {
  parts: Record<string, { pivot: number[]; hinge: { axis: number[] } | null }>;
  interiors?: Record<string, { exposedBy: string[] }>;
}

/** One vehicle as the renderer sees it. */
export interface VehicleSource {
  id: string;
  sidecar: Sidecar;
  /** The URLs of LOD0, LOD1 and LOD2. */
  lods: string[];
}

const sidecars = import.meta.glob(['../../../../../art/vehicles/*/*.asset.json', '!../../../../../art/vehicles/*/*_*'], { eager: true, import: 'default' }) as Record<string, Sidecar>;
const glbs = import.meta.glob(['../../../../../art/vehicles/*/*.lod?.glb', '!../../../../../art/vehicles/*/*_*'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const profiles = import.meta.glob('../../../../../assets/profiles/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const dir = '../../../../../';

/** The roster's vehicle ids, in roster order (a snapshot car's vehicle indexes this). */
export const VEHICLE_IDS: string[] = (roster.cars as Array<{ id: string }>).map((c) => c.id);

/** Roster vehicle `id` from the bundled data. Throws a plain message when a roster row lacks its files. */
export function vehicleSource(id: string): VehicleSource {
  const sidecar = sidecars[`${dir}art/vehicles/${id}/${id}.asset.json`];
  const lods = [0, 1, 2].map((k) => glbs[`${dir}art/vehicles/${id}/${id}.lod${k}.glb`]);
  if (!sidecar || lods.some((u) => !u)) throw new Error(`roster vehicle ${id} has no bake in art/vehicles/${id}/`);
  return { id, sidecar, lods: lods as string[] };
}

/** Every roster vehicle, in roster order. */
export function rosterSources(): VehicleSource[] {
  return VEHICLE_IDS.map(vehicleSource);
}

/** `[id, profile JSON text]` for every roster vehicle, in roster order: what the sim worker builds its cars from. */
export function rosterProfiles(): Array<[string, string]> {
  return VEHICLE_IDS.map((id) => {
    const json = profiles[`${dir}assets/profiles/${id}.json`];
    if (!json) throw new Error(`roster vehicle ${id} has no assets/profiles/${id}.json`);
    return [id, json];
  });
}
