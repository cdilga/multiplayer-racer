// Identity rings under each car in the Derby Overview (P1-R11, master §6.4): a flat ring on the ground in the seat's
// colour, ink-edged, one instanced draw for every car (no per-seat materials or draws, P1-R13). The ring grows with the
// framed ground so it keeps its size on the TV as the camera zooms out. Hidden outside the arena Overview.
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type Scene } from 'three';

const UP = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

export class OverviewRings {
  private fill: InstancedMesh;
  private edge: InstancedMesh;
  private m = new Matrix4();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  private q = new Quaternion();

  constructor(scene: Scene, capacity = 64) {
    this.fill = this.make(scene, new RingGeometry(0.78, 1, 40), capacity, 0);
    this.edge = this.make(scene, new RingGeometry(1, 1.12, 40), capacity, 1);
  }

  private make(scene: Scene, geo: RingGeometry, n: number, order: number): InstancedMesh {
    const mesh = new InstancedMesh(geo, new MeshBasicMaterial({ side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), n);
    mesh.name = order ? 'overview-rings-edge' : 'overview-rings';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1 + order;
    mesh.count = 0;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }

  private grow(n: number): void {
    // No count cap: the instanced meshes double when the field outgrows them.
    for (const key of ['fill', 'edge'] as const) {
      const old = this[key];
      if (old.instanceMatrix.count >= n) continue;
      const mesh = new InstancedMesh(old.geometry, old.material, Math.max(n, old.instanceMatrix.count * 2));
      Object.assign(mesh, { name: old.name, frustumCulled: false, renderOrder: old.renderOrder });
      old.parent?.add(mesh);
      old.removeFromParent();
      this[key] = mesh;
    }
  }

  /** Hides the rings (Grid, or a track map). */
  hide(): void {
    this.fill.visible = this.edge.visible = false;
  }

  /** One ring per car at `pos` (xyz per car), in the car's ground plane (`rot`, xyzw per car: on a bank it tilts with
   *  the car), radius `r` metres, in `paint(i)` (a CSS colour). */
  update(cars: number, pos: Float32Array, rot: Float32Array, r: number, paint: (i: number) => string): void {
    this.grow(cars);
    const { fill, edge } = this;
    fill.count = edge.count = cars;
    fill.visible = edge.visible = cars > 0;
    for (let i = 0; i < cars; i++) {
      this.p.set(pos[i * 3]!, pos[i * 3 + 1]! + 0.06, pos[i * 3 + 2]!);
      this.q.fromArray(rot, i * 4).multiply(UP);
      this.m.compose(this.p, this.q, this.s.set(r, r, r));
      fill.setMatrixAt(i, this.m);
      edge.setMatrixAt(i, this.m);
      fill.setColorAt(i, this.c.set(paint(i)));
      edge.setColorAt(i, this.c.set('#1d1a1f'));
    }
    fill.instanceMatrix.needsUpdate = edge.instanceMatrix.needsUpdate = true;
    if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
    if (edge.instanceColor) edge.instanceColor.needsUpdate = true;
  }
}
