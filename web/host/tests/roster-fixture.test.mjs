// br-bwju.7 (R123): adding a vehicle is data only. A fixture vehicle added to the roster data shows in the phone's picker, is
// built by the host's renderer from nothing but its sidecar and geometry, and (crates/jj-sim/tests/roster.rs) is built and
// driven by the sim from its profile file. Also: every real roster row has a profile, a bake and an engine voice.
// Runs the real TypeScript through Vite's SSR loader, so no browser is needed:
//   node --test web/host/tests/roster-fixture.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { BoxGeometry, MeshStandardMaterial, Scene } from 'three';

const web = resolve(import.meta.dirname, '../..');
const repo = resolve(web, '..');
let vite;
let load;

before(async () => {
  const { createServer } = await import(join(web, 'node_modules/vite/dist/node/index.js'));
  vite = await createServer({ root: web, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
  load = (path) => vite.ssrLoadModule(path);
});
after(async () => {
  await vite?.close();
});

const json = (path) => JSON.parse(readFileSync(join(repo, path), 'utf8'));
const VEHICLE_FIELD = 16; // a snapshot car's vehicle is its flags' bits 16-31

test('every roster vehicle has a profile, a bake and an engine voice, in roster order', async () => {
  const reg = await load('/host/src/render/vehicles/registry.ts');
  const roster = json('web/shared/src/roster.json').cars.map((c) => c.id);
  assert.deepEqual(reg.VEHICLE_IDS, roster);
  assert.deepEqual(reg.rosterProfiles().map(([id]) => id), roster);
  assert.deepEqual(reg.rosterSources().map((s) => s.id), roster);
  for (const [id, text] of reg.rosterProfiles()) assert.equal(JSON.parse(text).vehicle, id, `${id}'s profile names itself`);
  const manifest = json('assets/audio/engine/manifest.json').files.map((f) => f.replace(/\.json$/, ''));
  for (const id of roster) assert.ok(manifest.includes(id), `${id} has an engine profile in the manifest`);
});

test('a fixture vehicle added as data is in the picker and drawn by the renderer', async () => {
  const sheet = await load('/controller/src/app/carsheet.ts');
  const { VehicleModel } = await load('/host/src/render/vehicles/vehicles.ts');
  // The data: a roster row, and a bake (here the ute's sidecar under a new id, with box geometry for every part).
  const row = { id: 'fixture-van', name: 'Fixture Van', cls: 'Test', blurb: 'Data only.', shape: 'wagon', stats: [1, 1, 1, 1] };
  const picker = sheet.rosterOf(0, [...sheet.ROSTER, row]);
  assert.deepEqual(
    picker.map((c) => c.id),
    [...sheet.ROSTER.map((c) => c.id), 'fixture-van'],
    'the picker offers the new row',
  );

  const sidecar = json('art/vehicles/tradie-ute/tradie-ute.asset.json');
  const material = new MeshStandardMaterial();
  const lod = () => {
    const parts = new Map();
    for (const id of Object.keys(sidecar.parts)) parts.set(id, new BoxGeometry(1, 1, 1));
    for (const id of Object.keys(sidecar.interiors ?? {})) parts.set(`interior_${id}`, new BoxGeometry(1, 1, 1));
    parts.material = material;
    return parts;
  };
  const scene = new Scene();
  const model = new VehicleModel(scene, { id: 'fixture-van', sidecar, lods: [] }, [lod(), lod(), lod()], 2);
  assert.equal(model.id, 'fixture-van');
  assert.deepEqual(model.partIds, Object.keys(sidecar.parts), "the part order is the sidecar's");
  assert.ok(model.types.length > 0 && model.hulls.length === model.types.length * 3);

  // Two cars of the vehicle: the model draws both, every slot placed.
  const vehicle = 2 * 2 ** VEHICLE_FIELD;
  const s = { id: Uint32Array.of(1, 2), flags: Uint32Array.of(vehicle, vehicle), pos: Float32Array.of(0, 0, 0, 5, 0, 0), rot: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1), steer: Float32Array.of(0, 0) };
  model.place({ s, f: null, cars: [0, 1], pieces: [], byCar: new Map(), paintOf: () => '#ff0000', spin: () => 0 });
  assert.equal(model.drawn, 2);
  for (const t of model.types) assert.equal(t.meshes[0].count, 2 * t.slots.length);
  const core = model.types.find((t) => t.id === 'core');
  assert.equal(core.matrix.array[12 + 16 * 1], 5, 'the second car sits at x = 5');
  // With no cars of it on the field the model draws nothing.
  model.place({ s, f: null, cars: [], pieces: [], byCar: new Map(), paintOf: () => '#fff', spin: () => 0 });
  assert.ok(model.types.every((t) => t.meshes.every((m) => m.count === 0 && !m.visible)));
});
