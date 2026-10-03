// The map renderer (P1-R03): draws a `jj.map.v1` map (plan §8.1; positions in mm, heights in cm) as the sim sees it.
// - Terrain: the heightfield, each heightfield cell split into four quarters at its edge midpoints, every quarter
//   painted by its nearest sample's surface: exactly the sim's surface lookup (jj-sim `surface_at`), so the colour
//   under a car is the grip it gets. One draw.
// - Route: the centerline ribbon at each point's width and surface, white edge lines and the start line. One draw.
// - Features: route-aligned ground markings (a jump's ramp footprint and landing envelope, kerbs) until the sim drives
//   them as shapes (P1-M03d). One draw.
// - Dressing: one InstancedMesh per kit-piece type (render/kit), so draws scale with types, not placements.
// Props are dynamic: PropRenderer draws them from the snapshot's debris records with the same kit modules.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { colliderSize, ENTRIES, MODULES, withDefaults } from '../kit/registry';
import type { Params } from '../kit/types';
import type { Frame } from '../snapshot';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}
export interface MapJson {
  terrain: { cols: number; rows: number; spacing: number; originX: number; originZ: number; heights: number[]; surfaces: string[] };
  route: {
    closed: boolean;
    start: { at: number };
    points: { x: number; y: number; z: number; width: number; surface: string }[];
  };
  features: { kind: string; pose: Pose; params: Params }[];
  dressing: { kitPiece: string; pose: Pose; params?: Params; collides?: boolean }[];
  props: { kitPiece: string; pose: Pose; params?: Params }[];
}

/** Surface colours: distinguishable at a glance (P1-R10 owns the final look). */
export const SURFACE_COLOURS: Record<string, string> = {
  tarmac: '#3f3f46',
  'packed-dirt': '#a8713f',
  gravel: '#a8a092',
  rock: '#7a5546',
  'off-track': '#cdb07a',
};

const mm = (v: number) => v / 1000;
const col = new Color();

/** A triangle soup with flat vertex colours, built quad by quad. */
class Soup {
  pos: number[] = [];
  colour: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], colour: string): void {
    col.set(colour);
    for (const v of [a, b, c, a, c, d]) {
      this.pos.push(v[0]!, v[1]!, v[2]!);
      this.colour.push(col.r, col.g, col.b);
    }
  }
  mesh(material: Material): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colour), 3));
    g.computeVertexNormals();
    const m = new Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

/** The sim's yaw: centidegrees, turned clockwise seen from above (jj-sim `yaw_rotation`). */
export const yawQuat = (yaw: number, q = new Quaternion()) => q.setFromAxisAngle(new Vector3(0, 1, 0), -((yaw / 100) * Math.PI) / 180);

export interface MapStats {
  terrainCells: number;
  routePoints: number;
  features: number;
  kitTypes: number;
  kitInstances: number;
  /** Draw calls the map adds to one view: terrain, route, features, one per kit-piece type in use. */
  draws: number;
}

export class MapRenderer {
  readonly group = new Group();
  readonly kit = new Map<string, InstancedMesh>();
  readonly stats: MapStats;
  private material = new MeshLambertMaterial({ vertexColors: true });

  /** `repeat`: draw the dressing this many times over (offset copies), to show draws don't grow with placements. */
  constructor(
    readonly map: MapJson,
    opts: { repeat?: number } = {},
  ) {
    this.group.name = 'map';
    this.group.add(this.terrain(), this.route(), this.features());
    const kitInstances = this.dressing(opts.repeat ?? 1);
    this.stats = {
      terrainCells: (map.terrain.cols - 1) * (map.terrain.rows - 1),
      routePoints: map.route.points.length,
      features: map.features.length,
      kitTypes: this.kit.size,
      kitInstances,
      draws: 3 + this.kit.size,
    };
  }

  addTo(scene: Scene): this {
    scene.add(this.group);
    return this;
  }

  private terrain(): Mesh {
    const t = this.map.terrain;
    const s = new Soup();
    const at = (i: number, j: number) => i * t.cols + j;
    const x = (j: number) => mm(t.originX + j * t.spacing);
    const z = (i: number) => mm(t.originZ + i * t.spacing);
    const h = (i: number, j: number) => t.heights[at(i, j)]! / 100;
    for (let i = 0; i + 1 < t.rows; i++) {
      for (let j = 0; j + 1 < t.cols; j++) {
        const [x0, x1, xm] = [x(j), x(j + 1), (x(j) + x(j + 1)) / 2];
        const [z0, z1, zm] = [z(i), z(i + 1), (z(i) + z(i + 1)) / 2];
        const [h00, h01, h10, h11] = [h(i, j), h(i, j + 1), h(i + 1, j), h(i + 1, j + 1)];
        const c = (h00 + h01 + h10 + h11) / 4;
        const e = { n: (h00 + h01) / 2, s: (h10 + h11) / 2, w: (h00 + h10) / 2, e: (h01 + h11) / 2 };
        const paint = (ii: number, jj: number) => SURFACE_COLOURS[t.surfaces[at(ii, jj)]!] ?? SURFACE_COLOURS['off-track']!;
        // Each quarter belongs to the sample at its corner (the sim's nearest-sample rule). Wound to face +y.
        s.quad([x0, h00, z0], [x0, e.w, zm], [xm, c, zm], [xm, e.n, z0], paint(i, j));
        s.quad([xm, e.n, z0], [xm, c, zm], [x1, e.e, zm], [x1, h01, z0], paint(i, j + 1));
        s.quad([x0, e.w, zm], [x0, h10, z1], [xm, e.s, z1], [xm, c, zm], paint(i + 1, j));
        s.quad([xm, c, zm], [xm, e.s, z1], [x1, h11, z1], [x1, e.e, zm], paint(i + 1, j + 1));
      }
    }
    const m = s.mesh(this.material);
    m.name = 'terrain';
    return m;
  }

  /** Left-pointing unit normal of the route at point k (from its neighbours). */
  private side(k: number): [number, number] {
    const p = this.map.route.points;
    const n = p.length;
    const closed = this.map.route.closed;
    const a = p[closed ? (k - 1 + n) % n : Math.max(0, k - 1)]!;
    const b = p[closed ? (k + 1) % n : Math.min(n - 1, k + 1)]!;
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return [tz / l, -tx / l];
  }

  private route(): Mesh {
    const r = this.map.route;
    const p = r.points;
    const s = new Soup();
    const lift = 0.03;
    const edge = 0.3;
    const segs = r.closed ? p.length : p.length - 1;
    const rail = (k: number, off: number, y: number) => {
      const q = p[k % p.length]!;
      const [nx, nz] = this.side(k % p.length);
      return [mm(q.x) + nx * off, mm(q.y) + y, mm(q.z) + nz * off];
    };
    for (let k = 0; k < segs; k++) {
      const a = p[k]!;
      const b = p[(k + 1) % p.length]!;
      const [wa, wb] = [mm(a.width) / 2, mm(b.width) / 2];
      const surface = SURFACE_COLOURS[a.surface] ?? SURFACE_COLOURS.tarmac!;
      // A band between two lateral offsets (right to left, so it faces +y).
      const band = (r0: number, r1: number, l0: number, l1: number, y: number, colour: string) =>
        s.quad(rail(k, r0, y), rail(k + 1, r1, y), rail(k + 1, l1, y), rail(k, l0, y), colour);
      band(-wa, -wb, wa, wb, lift, surface);
      band(wa - edge, wb - edge, wa, wb, lift + 0.005, '#f2efe6');
      band(-wa, -wb, -wa + edge, -wb + edge, lift + 0.005, '#f2efe6');
    }
    // The start line: a chequered band across the road at the start point.
    const k = r.start.at;
    const q = p[k]!;
    const [nx, nz] = this.side(k);
    const [tx, tz] = [-nz, nx];
    const w = mm(q.width) / 2;
    const cells = 12;
    for (let c = 0; c < cells; c++) {
      for (let row = 0; row < 2; row++) {
        const l0 = -w + (2 * w * c) / cells;
        const l1 = -w + (2 * w * (c + 1)) / cells;
        const f0 = row * 0.6 - 0.6;
        const f1 = f0 + 0.6;
        const pt = (l: number, f: number) => [mm(q.x) + nx * l + tx * f, mm(q.y) + lift + 0.01, mm(q.z) + nz * l + tz * f];
        s.quad(pt(l0, f0), pt(l0, f1), pt(l1, f1), pt(l1, f0), (c + row) % 2 ? '#f2efe6' : '#1d1c21');
      }
    }
    const m = s.mesh(this.material);
    m.name = 'route';
    return m;
  }

  /** The route point nearest (x, z) mm, with its forward and left directions. */
  private nearest(x: number, z: number) {
    const p = this.map.route.points;
    let best = 0;
    let d = Infinity;
    p.forEach((q, k) => {
      const dd = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (dd < d) [d, best] = [dd, k];
    });
    const [nx, nz] = this.side(best);
    return { point: p[best]!, left: [nx, nz] as const, fwd: [-nz, nx] as const };
  }

  private features(): Mesh {
    const s = new Soup();
    for (const f of this.map.features) {
      const near = this.nearest(f.pose.x, f.pose.z);
      const [fx, fz] = near.fwd;
      const [lx, lz] = near.left;
      const ox = mm(f.pose.x);
      const oz = mm(f.pose.z);
      const y = mm(f.pose.y) + 0.06;
      // A rectangle from `a` to `b` metres along the route and `half` metres either side of the feature's position.
      const rect = (a: number, b: number, half: number, colour: string, dy = 0) => {
        const pt = (f2: number, l: number) => [ox + fx * f2 + lx * l, y + dy, oz + fz * f2 + lz * l];
        s.quad(pt(a, -half), pt(b, -half), pt(b, half), pt(a, half), colour);
      };
      if (f.kind === 'jump') {
        const ramp = mm(f.params.rampLengthMm ?? 8000);
        const land = mm(f.params.landingLengthMm ?? 20000);
        rect(ramp, ramp + land, mm(f.params.landingWidthMm ?? 6000) / 2, '#e7d27a');
        // Hazard chevrons over the ramp's footprint: alternating yellow and black bands.
        const bands = 8;
        for (let b = 0; b < bands; b++) {
          rect((ramp * b) / bands, (ramp * (b + 1)) / bands, mm(f.params.rampWidthMm ?? 4500) / 2, b % 2 ? '#1d1c21' : '#f5c518', 0.01);
        }
      } else if (f.kind === 'kerb') {
        const depth = mm(f.params.depthMm ?? 400);
        for (let b = 0; b < 8; b++) rect(b * 0.75 - 3, (b + 1) * 0.75 - 3, depth / 2, b % 2 ? '#f2efe6' : '#d8432f');
      } else {
        rect(-2, 2, 2, '#9b7bff');
      }
    }
    const m = s.mesh(this.material);
    m.name = 'features';
    return m;
  }

  private dressing(repeat: number): number {
    const byType = new Map<string, { pose: Pose; params: Params }[]>();
    for (let r = 0; r < repeat; r++) {
      for (const d of this.map.dressing) {
        // Copies shift 3 m sideways per repeat: a draw-count probe, never a shipped placement.
        const pose = r === 0 ? d.pose : { ...d.pose, x: d.pose.x + r * 3000, z: d.pose.z + r * 3000 };
        (byType.get(d.kitPiece) ?? byType.set(d.kitPiece, []).get(d.kitPiece)!).push({ pose, params: d.params ?? {} });
      }
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    const sc = new Vector3();
    let total = 0;
    for (const [id, list] of byType) {
      const entry = ENTRIES[id];
      const mod = MODULES[id];
      if (!entry || !mod) throw new Error(`no kit module for ${id}`);
      const im = new InstancedMesh(mod.geometry(), this.material, list.length);
      im.name = id;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      list.forEach(({ pose, params }, i) => {
        const p = withDefaults(entry, params);
        im.setMatrixAt(i, m.compose(v.set(mm(pose.x), mm(pose.y), mm(pose.z)), yawQuat(pose.yaw, q), sc.fromArray(mod.scale(p))));
      });
      this.kit.set(id, im);
      this.group.add(im);
      total += list.length;
    }
    return total;
  }

  /** The terrain's height (m) at (x, z), bilinear over the heightfield like the ground the car drives on. */
  groundAt = (x: number, z: number): number => {
    const t = this.map.terrain;
    const c = Math.min(Math.max((x * 1000 - t.originX) / t.spacing, 0), t.cols - 1);
    const r = Math.min(Math.max((z * 1000 - t.originZ) / t.spacing, 0), t.rows - 1);
    const [c0, r0] = [Math.floor(c), Math.floor(r)];
    const [c1, r1] = [Math.min(c0 + 1, t.cols - 1), Math.min(r0 + 1, t.rows - 1)];
    const h = (cc: number, rr: number) => t.heights[rr * t.cols + cc]! / 100;
    const top = h(c0, r0) + (h(c1, r0) - h(c0, r0)) * (c - c0);
    const bot = h(c0, r1) + (h(c1, r1) - h(c0, r1)) * (c - c0);
    return top + (bot - top) * (r - r0);
  };

  /** The `collides` dressing as oriented boxes: what the chase cameras pull in front of (P1-R05). */
  obstacles(): { centre: Vector3; half: Vector3; inv: Quaternion }[] {
    return this.map.dressing
      .filter((d) => d.collides && ENTRIES[d.kitPiece])
      .map((d) => {
        const size = colliderSize(ENTRIES[d.kitPiece]!, d.params ?? {});
        return {
          centre: new Vector3(mm(d.pose.x), mm(d.pose.y) + size[1] / 2, mm(d.pose.z)),
          half: new Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
          inv: yawQuat(d.pose.yaw).invert(),
        };
      });
  }

  /** Each registry entry's collider extent next to its rendered bounds at the same params (sim and render agree). */
  static kitBounds(): { id: string; collider: number[]; rendered: number[] }[] {
    return Object.values(ENTRIES).map((entry) => {
      const mod = MODULES[entry.id];
      if (!mod) return { id: entry.id, collider: colliderSize(entry, {}), rendered: [] };
      const p = withDefaults(entry, {});
      const g = mod.geometry();
      g.computeBoundingBox();
      const b = g.boundingBox!;
      const [sx, sy, sz] = mod.scale(p);
      return {
        id: entry.id,
        collider: colliderSize(entry, p),
        rendered: [(b.max.x - b.min.x) * sx, b.max.y * sy, (b.max.z - b.min.z) * sz, b.min.y * sy],
      };
    });
  }
}

/** Draws the snapshot's dynamic props (map props, dropped cones, spawned debris) with the kit modules. */
export class PropRenderer {
  private meshes = new Map<string, InstancedMesh>();
  private material = new MeshLambertMaterial({ vertexColors: true });
  private m = new Matrix4();
  private local = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private one = new Vector3(1, 1, 1);
  /** The kit piece of each map prop the sim created, in its order (the sim skips a prop with no registry entry). */
  private mapProps: { id: string; params: Params }[];

  constructor(
    private scene: Scene,
    map: MapJson | null,
  ) {
    this.mapProps = (map?.props ?? []).filter((p) => ENTRIES[p.kitPiece]).map((p) => ({ id: p.kitPiece, params: p.params ?? {} }));
  }

  /** Debris i: a map prop while i is one of them (kind 0), a dropped cone (kind 1), else spawned debris. */
  private pieceOf(i: number, kind: number): { id: string; params: Params } {
    if (kind === 1) return { id: 'generic/cone', params: {} };
    return this.mapProps[i] ?? { id: 'debris', params: {} };
  }

  private mesh(id: string, n: number): InstancedMesh {
    let im = this.meshes.get(id);
    if (!im || im.instanceMatrix.count < n) {
      let cap = Math.max(8, im?.instanceMatrix.count ?? 8);
      while (cap < n) cap *= 2;
      if (im) this.scene.remove(im);
      const mod = MODULES[id];
      im = new InstancedMesh(mod ? mod.geometry() : debrisGeometry(), this.material, cap);
      im.name = `prop:${id}`;
      im.castShadow = true;
      im.frustumCulled = false;
      this.meshes.set(id, im);
      this.scene.add(im);
    }
    return im;
  }

  update(f: Frame | null): void {
    const groups = new Map<string, number[]>();
    for (let i = 0; f && i < f.debris; i++) {
      const { id } = this.pieceOf(i, f.debrisKind[i]!);
      (groups.get(id) ?? groups.set(id, []).get(id)!).push(i);
    }
    for (const [id, im] of this.meshes) if (!groups.has(id)) im.count = 0;
    for (const [id, list] of groups) {
      const im = this.mesh(id, list.length);
      const entry = ENTRIES[id];
      list.forEach((i, k) => {
        const piece = this.pieceOf(i, f!.debrisKind[i]!);
        // The sim's prop body sits at the middle of its proxy; kit geometry stands on its origin.
        const half = entry ? colliderSize(entry, piece.params)[1] / 2 : 0;
        const scale = MODULES[id]?.scale(entry ? withDefaults(entry, piece.params) : {}) ?? [1, 1, 1];
        this.m.compose(this.v.fromArray(f!.debrisPos, i * 3), this.q.fromArray(f!.debrisRot, i * 4), this.one);
        this.local.makeScale(scale[0], scale[1], scale[2]).setPosition(0, -half, 0);
        im.setMatrixAt(k, this.m.multiply(this.local));
      });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Instances drawn per prop type. */
  counts(): Record<string, number> {
    return Object.fromEntries([...this.meshes].map(([id, im]) => [id, im.count]));
  }
}

/** Spawned debris has no kit piece: a dark half-metre chunk. */
function debrisGeometry(): BufferGeometry {
  const s = new Soup();
  const h = 0.25;
  const faces: number[][][] = [
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
  ];
  for (const f of faces) s.quad(f[0]!, f[1]!, f[2]!, f[3]!, '#3b3a40');
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(s.colour), 3));
  g.computeVertexNormals();
  return g;
}
