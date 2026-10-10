// The instanced vehicle renderer (P1-R02). Every car, loose part and detached part draws through ONE InstancedMesh per
// part type and LOD class, so draws per tile stay constant in the number of cars (plan §6.1; Spike J's reference row:
// 24 cars × 24 tiles, 9 draws a tile with the ground).
//
// - Part types come from the baked vehicle (P1-V02, jj.vehicle.v1): one per part node, except that the four wheels
//   share one type (the right wheels are the left geometry turned half a turn about +y, as in Spike J).
// - Every roster vehicle is its own `VehicleModel` with its own instanced meshes, built from roster data (registry.ts,
//   R123) the first time a car of that vehicle appears in a snapshot (the car's vehicle is its flags' top 16 bits);
//   draws per tile are constant in the number of cars and grow with the number of vehicle kinds on the field.
// - Each part type has ONE instance-matrix buffer and ONE colour buffer, shared by its three LOD meshes; a tile picks
//   its LOD class with camera layers (useLod), so tiles at different LOD classes cost no extra uploads.
// - Paint key: atlas texels that are pure white take the car's identity colour (instanceColor); glass, lamps and
//   livery keep theirs. One material for every car.
// - Part states from the snapshot (R86: intact -> loose -> detached): a loose part turns about its hinge at its pivot by
//   the snapshot's angle; a detached part draws at its world pose, still in its owner's paint, and the core's dark bay
//   shows where it was. Detached parts are debris: they stay for the round.
// - Interior blocks (P1-V03: engine, seats, boot contents) draw only for cars where a part that exposes them isn't
//   intact: one InstancedMesh per block and LOD class, holding just those cars, hidden when none.
// - Buffers grow (doubling) with the field: no car or part cap (R66).
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Fx } from '../fx';
import type { Sampled } from '../interp';
import { followSun, InkHull, toon } from '../look';
import { PART_DETACHED, PART_LOOSE, PIECE_HUSK, type Frame } from '../snapshot';
import type { VehicleSource } from './registry';

export const LOD_CLASSES = 3;
/** Camera layer of LOD class k (layer 0 is the rest of the world). */
export const lodLayer = (lod: number) => 1 + lod;

/** The LOD class for a tile of this height in device pixels (§6.1 DEFAULT: ≥ 540 LOD0, ≥ 200 LOD1, else LOD2). */
export function lodForTileHeight(px: number): number {
  return px >= 540 ? 0 : px >= 200 ? 1 : 2;
}

/** Shows only LOD class `lod` (plus the world) to this camera. */
export function useLod(camera: Camera, lod: number): void {
  camera.layers.set(0);
  camera.layers.enable(lodLayer(lod));
}

const MAX_STEER = (25 * Math.PI) / 180;

interface Slot {
  part: number; // index in the vehicle's part ids (sidecar order)
  pivot: Vector3;
  hinge: Vector3 | null;
  /** Turned half a turn about +y (right-hand wheels drawn with the left geometry). */
  mirror: boolean;
  wheel: boolean;
  front: boolean;
}

interface InteriorType {
  id: string;
  /** Indices in the part ids of the parts whose loss (or swing) exposes the block. */
  exposedBy: number[];
  meshes: InstancedMesh[];
  matrix: InstancedBufferAttribute;
  color: InstancedBufferAttribute;
}

interface PartType {
  id: string;
  slots: Slot[];
  meshes: InstancedMesh[]; // one per LOD class
  matrix: InstancedBufferAttribute;
  color: InstancedBufferAttribute;
}

/** The paint-key material (V02's viewer recipe, with the tint from instanceColor). */
function paintKey(src: MeshStandardMaterial): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: src.map,
    emissiveMap: src.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: src.emissiveMap ? 1.2 : 0,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        float paintMask = step( 0.985, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );
        diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, paintMask );
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'jj-paint-key';
  // The toon ramp on the sun (P1-R10); no halftone or grit on a car, so the identity paint stays true (POC2-13, R108).
  return toon(m);
}

async function loadLods(urls: string[]): Promise<(Map<string, BufferGeometry> & { material?: Material })[]> {
  const loader = new GLTFLoader();
  const out: (Map<string, BufferGeometry> & { material?: Material })[] = [];
  for (const url of urls) {
    const gltf = await loader.loadAsync(url);
    const parts = new Map<string, BufferGeometry>() as Map<string, BufferGeometry> & { material?: Material };
    let material: Material | null = null;
    gltf.scene.traverse((o: Object3D) => {
      const mesh = o as Partial<InstancedMesh> & Object3D;
      if (!mesh.isMesh || o.name.startsWith('collider_') || !mesh.geometry) return;
      parts.set(o.name, mesh.geometry);
      material ??= mesh.material as Material;
    });
    parts.material = material ?? undefined;
    out.push(parts);
  }
  return out;
}

/** What one update hands a model: the cars and pieces (indices into the sample) of its vehicle, and the shared per-frame data. */
interface Placement {
  s: Sampled;
  f: Frame | null;
  cars: number[];
  pieces: number[];
  byCar: Map<number, Map<number, PartState>>;
  paintOf: (car: number) => string;
  spin: (id: number, x: number, z: number, rot: Float32Array, i: number, radius: number) => number;
}

/** One roster vehicle's instanced meshes (R123): its part types, interior blocks and ink hulls, built from its bake. */
export class VehicleModel {
  readonly id: string;
  /** The vehicle's parts in sidecar order: a snapshot part record's `part` is an index into this. */
  readonly partIds: string[];
  readonly types: PartType[] = [];
  readonly interiors: InteriorType[] = [];
  readonly hulls: InkHull[] = [];
  readonly material: MeshStandardMaterial;
  /** Wheel radius in metres, from the wheel mesh (the roll of the tyres follows it). */
  readonly wheelRadius: number;
  /** Instances the buffers hold room for (grows by doubling). */
  capacity = 0;
  /** Cars and pieces drawn at the last update. */
  drawn = 0;
  private readonly corePart: number;
  private m = new Matrix4();
  private car = new Matrix4();
  private local = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private one = new Vector3(1, 1, 1);
  private c = new Color();
  private flip = new Matrix4().makeRotationY(Math.PI);
  private steerRot = new Matrix4();
  private spinRot = new Matrix4();

  constructor(
    private scene: Scene,
    src: VehicleSource,
    lods: (Map<string, BufferGeometry> & { material?: Material })[],
    capacity: number,
  ) {
    this.id = src.id;
    const sidecar = src.sidecar;
    this.partIds = Object.keys(sidecar.parts);
    this.corePart = this.partIds.indexOf('core');
    this.material = paintKey(lods[0]!.material as MeshStandardMaterial);
    const byType = new Map<string, Slot[]>();
    this.partIds.forEach((id, part) => {
      const spec = sidecar.parts[id]!;
      const wheel = id.startsWith('wheel_');
      const type = wheel ? 'wheel' : id;
      const slot: Slot = {
        part,
        pivot: new Vector3().fromArray(spec.pivot),
        hinge: spec.hinge ? new Vector3().fromArray(spec.hinge.axis).normalize() : null,
        mirror: wheel && id.endsWith('R'),
        wheel,
        front: wheel && id.includes('_F'),
      };
      (byType.get(type) ?? byType.set(type, []).get(type)!).push(slot);
    });
    let wheelRadius = 0.4;
    for (const [id, slots] of byType) {
      // A shared type draws the geometry of its first unmirrored part.
      const source = this.partIds[slots.find((s) => !s.mirror)!.part]!;
      const meshes = lods.map((parts, lod) => {
        const g = parts.get(source);
        if (!g) throw new Error(`${src.id} LOD${lod} has no ${source}`);
        const im = new InstancedMesh(g, this.material, 1);
        im.name = `${src.id}.${id}.lod${lod}`;
        im.frustumCulled = false;
        im.castShadow = true;
        im.receiveShadow = true;
        im.layers.set(lodLayer(lod));
        scene.add(im);
        const hull = new InkHull(im);
        this.hulls.push(hull);
        scene.add(hull.mesh);
        return im;
      });
      if (id === 'wheel') {
        const g = meshes[0]!.geometry;
        g.computeBoundingBox();
        if (g.boundingBox) wheelRadius = (g.boundingBox.max.y - g.boundingBox.min.y) / 2;
      }
      this.types.push({ id, slots, meshes, matrix: meshes[0]!.instanceMatrix, color: new InstancedBufferAttribute(new Float32Array(3), 3) });
    }
    this.wheelRadius = wheelRadius;
    const declared = sidecar.interiors ?? {};
    for (const [id, b] of Object.entries(declared)) {
      const meshes = lods.map((parts, lod) => {
        const g = parts.get(`interior_${id}`);
        if (!g) throw new Error(`${src.id} LOD${lod} has no interior_${id}`);
        const im = new InstancedMesh(g, this.material, 1);
        im.name = `${src.id}.interior_${id}.lod${lod}`;
        im.frustumCulled = false;
        im.receiveShadow = true;
        im.visible = false;
        im.layers.set(lodLayer(lod));
        scene.add(im);
        return im;
      });
      const exposedBy = b.exposedBy.map((p) => this.partIds.indexOf(p)).filter((k) => k >= 0);
      this.interiors.push({ id, exposedBy, meshes, matrix: meshes[0]!.instanceMatrix, color: new InstancedBufferAttribute(new Float32Array(3), 3) });
    }
    this.grow(capacity);
  }

  private grow(cars: number): void {
    if (cars <= this.capacity) return;
    let cap = Math.max(1, this.capacity);
    while (cap < cars) cap *= 2;
    for (const t of this.types) {
      const n = cap * t.slots.length;
      // One buffer per part type, shared by its LOD meshes (uploaded once per frame whatever the tiles' LODs).
      t.matrix = new InstancedBufferAttribute(new Float32Array(n * 16), 16);
      t.color = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
      for (const im of t.meshes) {
        im.instanceMatrix = t.matrix;
        im.instanceColor = t.color;
      }
    }
    for (const t of this.interiors) {
      t.matrix = new InstancedBufferAttribute(new Float32Array(cap * 16), 16);
      t.color = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      for (const im of t.meshes) {
        im.instanceMatrix = t.matrix;
        im.instanceColor = t.color;
      }
    }
    this.capacity = cap;
  }

  /** Places this vehicle's cars and pieces (husks, orphaned parts); an empty placement hides it. */
  place(p: Placement): void {
    const { s, f, cars, pieces, byCar } = p;
    this.grow(cars.length + pieces.length);
    this.drawn = cars.length + pieces.length;
    const exposed = this.interiors.map(() => 0);
    cars.forEach((i, n) => {
      const id = s.id[i]!;
      this.car.compose(this.v.fromArray(s.pos, i * 3), this.q.fromArray(s.rot, i * 4), this.one);
      const wheelAngle = p.spin(id, s.pos[i * 3]!, s.pos[i * 3 + 2]!, s.rot, i, this.wheelRadius);
      const steer = s.steer[i]!;
      const states = byCar.get(id);
      this.c.set(p.paintOf(id));
      for (const t of this.types) {
        t.slots.forEach((slot, k) => {
          const at = n * t.slots.length + k;
          const st = states?.get(slot.part);
          if (st && st.state === PART_DETACHED) {
            // A detached part is debris at its own world pose, still in its owner's paint.
            this.m.compose(this.v.fromArray(st.pos), this.q.fromArray(st.rot), this.one);
          } else {
            this.local.makeTranslation(slot.pivot.x, slot.pivot.y, slot.pivot.z);
            if (st && st.state === PART_LOOSE && slot.hinge) this.local.multiply(this.m.makeRotationAxis(slot.hinge, st.angle));
            if (slot.wheel) {
              if (slot.front) this.local.multiply(this.steerRot.makeRotationY(steer * MAX_STEER));
              this.local.multiply(this.spinRot.makeRotationX(wheelAngle));
            }
            this.m.multiplyMatrices(this.car, this.local);
          }
          if (slot.mirror) this.m.multiply(this.flip);
          this.m.toArray(t.matrix.array, at * 16);
          this.c.toArray(t.color.array, at * 3);
        });
      }
      // Interior blocks sit in vehicle space: the car's own matrix, only where a part that exposes them isn't intact.
      if (states) {
        this.interiors.forEach((t, k) => {
          if (!t.exposedBy.some((part) => states.has(part))) return;
          this.car.toArray(t.matrix.array, exposed[k]! * 16);
          this.c.toArray(t.color.array, exposed[k]! * 3);
          exposed[k]!++;
        });
      }
    });
    // Husks and orphaned parts (P1-S04c) draw as extra "cars" after the real ones: a husk is the core hull and, with every
    // part gone, the dark bays of all the interior blocks; a part is its own slot at its pivot frame's pose. Every other
    // slot of such an instance is scaled to nothing. They stay for the round, in their owner's paint.
    pieces.forEach((k, j) => {
      const i = cars.length + j;
      const part = f!.piecePart[k]!;
      this.car.compose(this.v.fromArray(f!.piecePos, k * 3), this.q.fromArray(f!.pieceRot, k * 4), this.one);
      this.c.set(p.paintOf(f!.pieceCar[k]!));
      for (const t of this.types) {
        t.slots.forEach((slot, n) => {
          const at = i * t.slots.length + n;
          const shown = part === PIECE_HUSK ? slot.part === this.corePart : slot.part === part;
          if (shown) {
            this.m.copy(this.car);
            if (slot.mirror) this.m.multiply(this.flip);
          } else {
            this.m.makeScale(0, 0, 0);
          }
          this.m.toArray(t.matrix.array, at * 16);
          this.c.toArray(t.color.array, at * 3);
        });
      }
      if (part === PIECE_HUSK) {
        this.interiors.forEach((t, n) => {
          this.car.toArray(t.matrix.array, exposed[n]! * 16);
          this.c.toArray(t.color.array, exposed[n]! * 3);
          exposed[n]!++;
        });
      }
    });
    this.interiors.forEach((t, k) => {
      t.matrix.needsUpdate = true;
      t.color.needsUpdate = true;
      for (const im of t.meshes) {
        im.count = exposed[k]!;
        im.visible = exposed[k]! > 0;
      }
    });
    const shown = this.drawn > 0;
    for (const t of this.types) {
      t.matrix.needsUpdate = true;
      t.color.needsUpdate = true;
      for (const im of t.meshes) {
        im.count = this.drawn * t.slots.length;
        im.visible = shown;
      }
    }
    for (const h of this.hulls) {
      h.mesh.visible = shown;
      if (shown) h.sync();
    }
  }

  dispose(): void {
    for (const t of [...this.types, ...this.interiors]) for (const im of t.meshes) this.scene.remove(im);
    for (const h of this.hulls) this.scene.remove(h.mesh);
  }
}

/**
 * The vehicle renderer: every roster vehicle's model, built lazily from roster data (R123). The first vehicle loads with
 * the renderer; any other loads the first time a car of it is in a snapshot (or `ensure` is called, as the lobby does for
 * the cars the seats picked), and its cars draw from the frame after it is ready.
 */
export class VehicleRenderer {
  /** Loaded models by roster index (a snapshot car's vehicle). */
  readonly models: (VehicleModel | undefined)[] = [];
  /** Driving, contact and damage effects and the lamps' glow (P1-R12), fed from the same samples. */
  readonly fx: Fx;
  /** The identity colour of a car (P1-R06 and the session set it; until then a palette by car id). */
  paintOf: (car: number) => string = (car) => PALETTE[(car - 1) % PALETTE.length]!;
  cars = 0;
  /** Called when a vehicle's model has loaded (the world redraws, so its cars appear without waiting for a snapshot). */
  onLoaded?: (id: string) => void;
  private spin = new Map<number, { x: number; z: number; angle: number }>();
  private loading = new Map<number, Promise<void>>();
  private groups: { cars: number[]; pieces: number[] }[] = [];
  private carVehicle = new Map<number, number>();
  /** The vehicle of each car in the last sample, by its index there. */
  private vehicleOfIndex: number[] = [];

  /** `sources`: the vehicles in roster order (`rosterSources()` from registry.ts; a test passes its own). */
  static async load(scene: Scene, sources: VehicleSource[], capacity = 16): Promise<VehicleRenderer> {
    const r = new VehicleRenderer(scene, sources, capacity);
    await r.ensure(0);
    return r;
  }

  private constructor(
    private scene: Scene,
    private sources: VehicleSource[],
    private capacity: number,
  ) {
    this.fx = new Fx(scene);
  }

  /** Adds a vehicle to the end of the roster (a vehicle that arrives as data after the page started). */
  register(src: VehicleSource): number {
    this.sources.push(src);
    return this.sources.length - 1;
  }

  /** Loads vehicle `index`'s bake if it is not loaded yet (resolves when its cars can draw). */
  ensure(index: number): Promise<void> {
    const src = this.sources[index];
    if (!src || this.models[index]) return Promise.resolve();
    let p = this.loading.get(index);
    if (!p) {
      p = loadLods(src.lods).then((lods) => {
        this.models[index] = new VehicleModel(this.scene, src, lods, this.capacity);
        this.onLoaded?.(src.id);
      });
      this.loading.set(index, p);
    }
    return p;
  }

  /** Loads the vehicle with roster id `id` (the lobby calls this for each seat's pick). */
  ensureId(id: string): Promise<void> {
    const k = this.sources.findIndex((s) => s.id === id);
    return k < 0 ? Promise.resolve() : this.ensure(k);
  }

  /** The loaded models, in roster order. */
  get loaded(): VehicleModel[] {
    return this.models.filter((m): m is VehicleModel => !!m);
  }

  /** Part types of every loaded vehicle. */
  get types(): PartType[] {
    return this.loaded.flatMap((m) => m.types);
  }

  get interiors(): InteriorType[] {
    return this.loaded.flatMap((m) => m.interiors);
  }

  get hulls(): InkHull[] {
    return this.loaded.flatMap((m) => m.hulls);
  }

  get material(): MeshStandardMaterial {
    return this.loaded[0]!.material;
  }

  /** Cars the first model holds room for (grows by doubling). */
  get capacityOf(): number {
    return Math.max(0, ...this.loaded.map((m) => m.capacity));
  }

  /** Draw calls one tile costs: one per part type of each vehicle that has a car on the field. */
  get drawsPerTile(): number {
    return this.loaded.reduce((a, m) => a + (m.drawn > 0 ? m.types.length : 0), 0);
  }

  /** Places every car and part from an interpolated sample (its frame carries the part records). */
  update(s: Sampled): void {
    const f = s.frame;
    const pieceCount = f?.pieces ?? 0;
    this.cars = s.cars;
    this.centre(s);
    const byCar = partStates(f);
    const last = this.sources.length - 1;
    const groupOf = (v: number) => (this.groups[v] ??= { cars: [], pieces: [] });
    for (const g of this.groups) if (g) (g.cars.length = 0), (g.pieces.length = 0);
    this.carVehicle.clear();
    for (let i = 0; i < s.cars; i++) {
      // An index past the roster draws as the first vehicle (a host newer than its renderer).
      const v = Math.min(s.flags[i]! >>> 16, last);
      this.carVehicle.set(s.id[i]!, v);
      this.vehicleOfIndex[i] = v;
      groupOf(v).cars.push(i);
    }
    for (let k = 0; k < pieceCount; k++) groupOf(this.carVehicle.get(f!.pieceCar[k]!) ?? 0).pieces.push(k);
    const place: Placement = { s, f, cars: [], pieces: [], byCar, paintOf: this.paintOf, spin: (...a) => this.wheelSpin(...a) };
    this.models.forEach((m, v) => {
      if (!m) return;
      const g = this.groups[v];
      m.place({ ...place, cars: g?.cars ?? [], pieces: g?.pieces ?? [] });
    });
    // A vehicle with cars but no model yet starts loading; its cars draw once it is ready.
    this.groups.forEach((g, v) => {
      if (g && (g.cars.length || g.pieces.length) && !this.models[v]) void this.ensure(v);
    });
    this.fx.update(s);
  }

  /** The sun's shadow box follows the cars' centre. */
  private centre(s: Sampled): void {
    if (!s.cars) return;
    let [x, z] = [0, 0];
    for (let i = 0; i < s.cars; i++) {
      x += s.pos[i * 3]!;
      z += s.pos[i * 3 + 2]!;
    }
    followSun(x / s.cars, z / s.cars);
  }

  /** Wheel roll from how far the car moved along its own forward axis since the last update. */
  private wheelSpin(id: number, x: number, z: number, rot: Float32Array, i: number, radius: number): number {
    const w = this.spin.get(id) ?? { x, z, angle: 0 };
    const qy = rot[i * 4 + 1]!;
    const qw = rot[i * 4 + 3]!;
    // Forward (+z) turned by the car's rotation, flattened: enough for roll direction on a mostly level car.
    const fx = 2 * (rot[i * 4]! * rot[i * 4 + 2]! + qw * qy);
    const fz = 1 - 2 * (rot[i * 4]! ** 2 + qy ** 2);
    const d = (x - w.x) * fx + (z - w.z) * fz;
    // A respawn jump isn't a roll.
    if (Math.abs(d) < 5) w.angle = (w.angle + d / radius) % (Math.PI * 2);
    w.x = x;
    w.z = z;
    this.spin.set(id, w);
    return w.angle;
  }

  /** Introspection (R90): buffers, sharing and capacity per part type, and where one car's parts are drawn. */
  inspect(car?: number) {
    const types = this.loaded.flatMap((m) =>
      m.types.map((t) => ({
        vehicle: m.id,
        id: t.id,
        slotsPerCar: t.slots.length,
        instances: t.meshes[0]!.count,
        capacity: t.matrix.count,
        /** All LOD meshes of the type draw from the same matrix and colour buffers. */
        shared: t.meshes.every((mesh) => mesh.instanceMatrix === t.matrix && mesh.instanceColor === t.color),
        layers: t.meshes.map((mesh) => mesh.layers.mask),
      })),
    );
    // Where one car's parts are drawn: the car's rank among its vehicle's cars this update says which instances are its.
    let parts: unknown;
    if (car !== undefined) {
      const v = this.vehicleOfIndex[car] ?? 0;
      const m = this.models[v];
      const rank = m ? (this.groups[v]?.cars ?? []).findIndex((i) => i === car) : -1;
      parts =
        m && rank >= 0
          ? m.types.flatMap((t) =>
              t.slots.map((slot, k) => {
                const at = (rank * t.slots.length + k) * 16;
                const c = (rank * t.slots.length + k) * 3;
                const mat = new Matrix4().fromArray(t.matrix.array, at);
                const p = new Vector3().setFromMatrixPosition(mat);
                return {
                  part: m.partIds[slot.part],
                  type: t.id,
                  vehicle: m.id,
                  position: [p.x, p.y, p.z].map((x) => +x.toFixed(3)),
                  colour: '#' + new Color().fromArray(t.color.array, c).getHexString(),
                };
              }),
            )
          : [];
    }
    const interiors = Object.fromEntries(this.loaded.flatMap((m) => m.interiors.map((t) => [`${m.id}.${t.id}`, t.meshes[0]!.count])));
    return {
      capacity: this.capacityOf,
      cars: this.cars,
      drawsPerTile: this.drawsPerTile,
      hulls: this.hulls.length,
      fx: this.fx.inspect(),
      types,
      parts,
      interiors,
      /** Per roster vehicle: loaded, and cars drawn at the last update. */
      vehicles: this.sources.map((src, v) => ({ id: src.id, loaded: !!this.models[v], cars: this.models[v]?.drawn ?? 0 })),
    };
  }

  dispose(): void {
    for (const m of this.loaded) m.dispose();
    this.fx.dispose();
  }
}

const PALETTE = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389', '#ff7a2e', '#9b7bff', '#ff3b3b', '#3bd6c6'];

interface PartState {
  state: number;
  angle: number;
  pos: number[];
  rot: number[];
}

/** The newer frame's part records, by car id then part index (intact parts have no record). */
function partStates(f: Frame | null): Map<number, Map<number, PartState>> {
  const out = new Map<number, Map<number, PartState>>();
  if (!f) return out;
  for (let i = 0; i < f.parts; i++) {
    const car = f.partCar[i]!;
    const m = out.get(car) ?? out.set(car, new Map()).get(car)!;
    m.set(f.partIndex[i]!, {
      state: f.partState[i]!,
      angle: f.partAngle[i]!,
      pos: Array.from(f.partPos.subarray(i * 3, i * 3 + 3)),
      rot: Array.from(f.partRot.subarray(i * 4, i * 4 + 4)),
    });
  }
  return out;
}
