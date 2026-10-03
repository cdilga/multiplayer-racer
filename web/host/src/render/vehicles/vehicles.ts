// The instanced vehicle renderer (P1-R02). Every car, loose part and detached part draws through ONE InstancedMesh per
// part type and LOD class, so draws per tile stay constant in the number of cars (plan §6.1; Spike J's reference row:
// 24 cars × 24 tiles, 9 draws a tile with the ground).
//
// - Part types come from the baked vehicle (P1-V02, jj.vehicle.v1): one per part node, except that the four wheels
//   share one type (the right wheels are the left geometry turned half a turn about +y, as in Spike J).
// - Each part type has ONE instance-matrix buffer and ONE colour buffer, shared by its three LOD meshes; a tile picks
//   its LOD class with camera layers (useLod), so tiles at different LOD classes cost no extra uploads.
// - Paint key: atlas texels that are pure white take the car's identity colour (instanceColor); glass, lamps and
//   livery keep theirs. One material for every car.
// - Part states from the snapshot (R86: intact -> loose -> detached): a loose part turns about its hinge at its pivot by
//   the snapshot's angle; a detached part draws at its world pose, still in its owner's paint, and the core's dark bay
//   shows where it was. Detached parts are debris: they stay for the round.
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
import sidecar from '../../../../../art/vehicles/cruz-missile/cruz-missile.asset.json';
import lod0 from '../../../../../art/vehicles/cruz-missile/cruz-missile.lod0.glb?url';
import lod1 from '../../../../../art/vehicles/cruz-missile/cruz-missile.lod1.glb?url';
import lod2 from '../../../../../art/vehicles/cruz-missile/cruz-missile.lod2.glb?url';
import type { Sampled } from '../interp';
import { PART_DETACHED, PART_LOOSE, type Frame } from '../snapshot';

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

/** The vehicle's parts in sidecar order: a snapshot part record's `part` is an index into this. */
export const PART_IDS: string[] = Object.keys(sidecar.parts);
const MAX_STEER = (25 * Math.PI) / 180;
const WHEEL_RADIUS = 0.4;

interface Slot {
  part: number; // index in PART_IDS
  pivot: Vector3;
  hinge: Vector3 | null;
  /** Turned half a turn about +y (right-hand wheels drawn with the left geometry). */
  mirror: boolean;
  wheel: boolean;
  front: boolean;
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
    roughness: 0.55,
    metalness: 0.05,
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
  return m;
}

async function loadLods(): Promise<Map<string, BufferGeometry>[]> {
  const loader = new GLTFLoader();
  const out: Map<string, BufferGeometry>[] = [];
  for (const url of [lod0, lod1, lod2]) {
    const gltf = await loader.loadAsync(url);
    const parts = new Map<string, BufferGeometry>();
    let material: Material | null = null;
    gltf.scene.traverse((o: Object3D) => {
      const mesh = o as Partial<InstancedMesh> & Object3D;
      if (!mesh.isMesh || o.name.startsWith('collider_') || !mesh.geometry) return;
      parts.set(o.name, mesh.geometry);
      material ??= mesh.material as Material;
    });
    (parts as Map<string, BufferGeometry> & { material?: Material }).material = material ?? undefined;
    out.push(parts);
  }
  return out;
}

export class VehicleRenderer {
  readonly types: PartType[] = [];
  readonly material: MeshStandardMaterial;
  /** Cars the buffers hold room for (grows by doubling). */
  capacity = 0;
  cars = 0;
  /** The identity colour of a car (P1-R06 and the session set it; until then a palette by car id). */
  paintOf: (car: number) => string = (car) => PALETTE[(car - 1) % PALETTE.length]!;
  private spin = new Map<number, { x: number; z: number; angle: number }>();
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

  static async load(scene: Scene, capacity = 16): Promise<VehicleRenderer> {
    return new VehicleRenderer(scene, await loadLods(), capacity);
  }

  private constructor(
    private scene: Scene,
    lods: (Map<string, BufferGeometry> & { material?: Material })[],
    capacity: number,
  ) {
    this.material = paintKey(lods[0]!.material as MeshStandardMaterial);
    const byType = new Map<string, Slot[]>();
    PART_IDS.forEach((id, part) => {
      const spec = (sidecar.parts as Record<string, { pivot: number[]; hinge: { axis: number[] } | null }>)[id]!;
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
    for (const [id, slots] of byType) {
      // A shared type draws the geometry of its first unmirrored part.
      const source = PART_IDS[slots.find((s) => !s.mirror)!.part]!;
      const meshes = lods.map((parts, lod) => {
        const g = parts.get(source);
        if (!g) throw new Error(`LOD${lod} has no ${source}`);
        const im = new InstancedMesh(g, this.material, 1);
        im.name = `${id}.lod${lod}`;
        im.frustumCulled = false;
        im.castShadow = true;
        im.receiveShadow = true;
        im.layers.set(lodLayer(lod));
        scene.add(im);
        return im;
      });
      const t: PartType = { id, slots, meshes, matrix: meshes[0]!.instanceMatrix, color: new InstancedBufferAttribute(new Float32Array(3), 3) };
      this.types.push(t);
    }
    this.grow(capacity);
  }

  /** Draw calls one tile costs: one per part type (its LOD class's mesh). */
  get drawsPerTile(): number {
    return this.types.length;
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
    this.capacity = cap;
  }

  /** Places every car and part from an interpolated sample (its frame carries the part records). */
  update(s: Sampled): void {
    this.grow(s.cars);
    this.cars = s.cars;
    const f = s.frame;
    const byCar = partStates(f);
    for (let i = 0; i < s.cars; i++) {
      const id = s.id[i]!;
      this.car.compose(this.v.fromArray(s.pos, i * 3), this.q.fromArray(s.rot, i * 4), this.one);
      const wheelAngle = this.wheelSpin(id, s.pos[i * 3]!, s.pos[i * 3 + 2]!, s.rot, i);
      const steer = s.steer[i]!;
      const states = byCar.get(id);
      this.c.set(this.paintOf(id));
      for (const t of this.types) {
        t.slots.forEach((slot, k) => {
          const at = i * t.slots.length + k;
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
    }
    for (const t of this.types) {
      t.matrix.needsUpdate = true;
      t.color.needsUpdate = true;
      for (const im of t.meshes) im.count = s.cars * t.slots.length;
    }
  }

  /** Wheel roll from how far the car moved along its own forward axis since the last update. */
  private wheelSpin(id: number, x: number, z: number, rot: Float32Array, i: number): number {
    const w = this.spin.get(id) ?? { x, z, angle: 0 };
    const qy = rot[i * 4 + 1]!;
    const qw = rot[i * 4 + 3]!;
    // Forward (+z) turned by the car's rotation, flattened: enough for roll direction on a mostly level car.
    const fx = 2 * (rot[i * 4]! * rot[i * 4 + 2]! + qw * qy);
    const fz = 1 - 2 * (rot[i * 4]! ** 2 + qy ** 2);
    const d = (x - w.x) * fx + (z - w.z) * fz;
    // A respawn jump isn't a roll.
    if (Math.abs(d) < 5) w.angle = (w.angle + d / WHEEL_RADIUS) % (Math.PI * 2);
    w.x = x;
    w.z = z;
    this.spin.set(id, w);
    return w.angle;
  }

  /** Introspection (R90): buffers, sharing and capacity per part type, and where one car's parts are drawn. */
  inspect(car?: number) {
    const types = this.types.map((t) => ({
      id: t.id,
      slotsPerCar: t.slots.length,
      instances: t.meshes[0]!.count,
      capacity: t.matrix.count,
      /** All LOD meshes of the type draw from the same matrix and colour buffers. */
      shared: t.meshes.every((m) => m.instanceMatrix === t.matrix && m.instanceColor === t.color),
      layers: t.meshes.map((m) => m.layers.mask),
    }));
    const parts =
      car === undefined
        ? undefined
        : this.types.flatMap((t) =>
            t.slots.map((slot, k) => {
              const at = (car * t.slots.length + k) * 16;
              const c = (car * t.slots.length + k) * 3;
              const m = new Matrix4().fromArray(t.matrix.array, at);
              const p = new Vector3().setFromMatrixPosition(m);
              return {
                part: PART_IDS[slot.part],
                type: t.id,
                position: [p.x, p.y, p.z].map((x) => +x.toFixed(3)),
                colour: '#' + new Color().fromArray(t.color.array, c).getHexString(),
              };
            }),
          );
    return { capacity: this.capacity, cars: this.cars, drawsPerTile: this.drawsPerTile, types, parts };
  }

  dispose(): void {
    for (const t of this.types) for (const im of t.meshes) this.scene.remove(im);
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
