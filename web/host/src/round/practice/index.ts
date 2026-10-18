// The practice courses (P1-C10, master §4.3). A newcomer who picks Practice drives their own small world in the host
// worker (`jj_wasm_host::host::practice`): its car comes in the snapshot as a car record flagged SNAP_PRACTICE and placed on
// a course drawn here, far from the round's map in the same scene (one renderer, one scene; each practising seat's course
// sits in its own slot, 3 km from the next and 20 km from the round, past every tile camera's 2 km far plane, so a tile
// sees only its own course). Each course is the room's start map (the greybox loop) with its props from the snapshot's
// practice trailer, a plain under it like the round's, and its ground and obstacles handed to the chase cameras.
import { Mesh, MeshLambertMaterial, PlaneGeometry, Vector3, type Scene } from 'three';
import type { Obstacle } from '../../camera/rig';
import { MapRenderer, PropRenderer, SURFACE_COLOURS, type MapJson } from '../../render/map/map';
import { practiceOffset, type Frame } from '../../render/snapshot';

interface Course {
  slot: number;
  off: Vector3;
  map: MapRenderer;
  props: PropRenderer;
  ground: Mesh;
  obstacles: Obstacle[];
  /** The course's ground box in the scene (m): minX, maxX, minZ, maxZ, with a margin for the chase camera. */
  box: [number, number, number, number];
}

/** What the camera rig and the tile need from the courses (World.practice). */
export class PracticeCourses {
  private readonly courses = new Map<number, Course>();
  /** Built per course, for the receipts (R90): how many courses are drawn now and how many were ever built. */
  built = 0;

  constructor(
    private readonly scene: Scene,
    private readonly mapJson: MapJson,
    /** The courses came or went: the world refreshes the chase cameras' obstacles. */
    private readonly onChange: () => void = () => {},
  ) {}

  /** Draws the snapshot's practice worlds: a course per slot in use, its props where the worker says they lie. */
  update(f: Frame | null): void {
    const worlds = f?.practice ?? [];
    let changed = false;
    const live = new Set(worlds.map((w) => w.slot));
    for (const [slot, c] of this.courses) {
      if (live.has(slot)) continue;
      this.dispose(c);
      this.courses.delete(slot);
      changed = true;
    }
    for (const w of worlds) {
      let c = this.courses.get(w.slot);
      if (!c) {
        c = this.build(w.slot);
        this.courses.set(w.slot, c);
        changed = true;
      }
      c.props.update({ debris: w.debris, debrisPos: w.debrisPos, debrisRot: w.debrisRot, debrisKind: w.debrisKind } as Frame);
    }
    if (changed) this.onChange();
  }

  /** The ground height under (x, z) on a practice course, or null off every course (the round map answers then). */
  groundAt(x: number, z: number): number | null {
    for (const c of this.courses.values()) {
      const [x0, x1, z0, z1] = c.box;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return c.map.groundAt(x - c.off.x, z - c.off.z) + c.off.y;
    }
    return null;
  }

  obstacles(): Obstacle[] {
    return [...this.courses.values()].flatMap((c) => c.obstacles);
  }

  /** Slots drawn now (R90 readout). */
  slots(): number[] {
    return [...this.courses.keys()];
  }

  private build(slot: number): Course {
    const off = new Vector3(...practiceOffset(slot));
    const map = new MapRenderer(this.mapJson).addTo(this.scene);
    map.group.position.copy(off);
    map.group.name = `practice-map-${slot}`;
    map.group.updateMatrixWorld(true);
    // The props are drawn from the snapshot, already on the course (the worker moved them there).
    const props = new PropRenderer(this.scene, this.mapJson);
    const t = this.mapJson.terrain;
    let lo = Infinity;
    for (const h of t.heights) lo = Math.min(lo, h / 100);
    const ground = new Mesh(new PlaneGeometry(1000, 1000), new MeshLambertMaterial({ color: SURFACE_COLOURS['off-track']!, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = `practice-ground-${slot}`;
    const [minX, maxX] = [t.originX / 1000, (t.originX + (t.cols - 1) * t.spacing) / 1000];
    const [minZ, maxZ] = [t.originZ / 1000, (t.originZ + (t.rows - 1) * t.spacing) / 1000];
    ground.position.set(off.x + (minX + maxX) / 2, off.y + Math.min(0, lo) - 0.05, off.z + (minZ + maxZ) / 2);
    this.scene.add(ground);
    const obstacles = map.obstacles().map((o) => ({ ...o, centre: o.centre.clone().add(off) }));
    const margin = 500;
    this.built++;
    return { slot, off, map, props, ground, obstacles, box: [off.x + minX - margin, off.x + maxX + margin, off.z + minZ - margin, off.z + maxZ + margin] };
  }

  private dispose(c: Course): void {
    c.map.group.removeFromParent();
    c.map.dispose();
    c.props.dispose();
    c.ground.removeFromParent();
    c.ground.geometry.dispose();
    (c.ground.material as MeshLambertMaterial).dispose();
  }
}
