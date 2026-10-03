// The host renderer's foundation (P1-R01): one canvas at the display's native pixel resolution (R111), the world scene,
// interpolated from snapshots (the sim worker's or the synthetic source's), and one overview camera. Cars are
// placeholder blocks until the instanced vehicle renderer (P1-R02); the map is a ground plane until P1-R03; the grid
// of player tiles is P1-R04 and the cameras P1-R05. Instance buffers grow with the field: there is no car or debris cap.
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { Snapshot } from '../worker/client';
import type { Backend } from './backend';
import { Interpolator, type Sampled } from './interp';
import { decodeSnapshot } from './snapshot';
import type { SnapshotSource } from './synthetic';

/** The host's Render resolution setting (R111): Native by default; the host may choose less. */
export type ResolutionMode = 'native' | 'user' | 'auto';

const PAINT = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389', '#ff7a2e', '#9b7bff', '#ff3b3b', '#3bd6c6'];

/** An InstancedMesh that grows (doubling) when the field outgrows it. */
class Growable {
  mesh: InstancedMesh;
  constructor(
    private scene: Scene,
    private geometry: BufferGeometry,
    private material: MeshLambertMaterial,
    capacity = 16,
  ) {
    this.mesh = this.make(capacity);
  }
  private make(capacity: number): InstancedMesh {
    const m = new InstancedMesh(this.geometry, this.material, capacity);
    m.frustumCulled = false;
    m.castShadow = true;
    m.count = 0;
    this.scene.add(m);
    return m;
  }
  ensure(n: number): InstancedMesh {
    if (n > this.mesh.instanceMatrix.count) {
      let cap = this.mesh.instanceMatrix.count;
      while (cap < n) cap *= 2;
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.make(cap);
    }
    this.mesh.count = n;
    return this.mesh;
  }
}

export interface WorldStats {
  backend: string;
  /** Backing store in device pixels, and the CSS size it covers. */
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  scale: number;
  resolution: ResolutionMode;
  /** Set when the browser's limit (max canvas/texture size) stopped native resolution. */
  limitedBy: string | null;
  frames: number;
  tick: number;
  cars: number;
  debris: number;
  snapped: number;
  drawCalls: number;
}

export class World {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.5, 2000);
  readonly interp = new Interpolator();
  private cars: Growable;
  private debris: Growable;
  private sample: Sampled | undefined;
  private raf = 0;
  private observer: ResizeObserver;
  private devicePx: [number, number] | null = null;
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3(1, 1, 1);
  private c = new Color();
  private target = new Vector3();
  private half: [number, number] = [25, 25];
  readonly stats: WorldStats;
  /** Called after each drawn frame. */
  onFrame: (stats: WorldStats) => void = () => {};

  constructor(
    readonly backend: Backend,
    readonly canvas: HTMLCanvasElement,
    /** The Render resolution setting: 1 is native; lower steps are the host's choice (R111). */
    readonly scale = 1,
  ) {
    this.stats = {
      backend: backend.label,
      width: 0,
      height: 0,
      cssWidth: 0,
      cssHeight: 0,
      dpr: 1,
      scale,
      resolution: scale === 1 ? 'native' : 'user',
      limitedBy: null,
      frames: 0,
      tick: 0,
      cars: 0,
      debris: 0,
      snapped: 0,
      drawCalls: 0,
    };
    const r = backend.renderer;
    r.setPixelRatio(1); // sizes below are device pixels already
    r.shadowMap.enabled = true;
    this.scene.background = new Color('#9fc6d8');
    this.scene.add(new HemisphereLight('#ffffff', '#8a7a60', 1.6));
    const sun = new DirectionalLight('#fff4e0', 2.2);
    sun.position.set(60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 400 });
    this.scene.add(sun, sun.target);
    const ground = new Mesh(new PlaneGeometry(1000, 1000), new MeshLambertMaterial({ color: '#b59f82', polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // A 5 m grid, so an empty field still reads as ground with scale and depth (P1-R03 brings the map).
    const grid = new GridHelper(1000, 200, '#8f7b62', '#a48e72');
    grid.position.y = 0.01;
    this.scene.add(ground, grid);
    this.cars = new Growable(this.scene, new BoxGeometry(1.8, 1.1, 4.2).translate(0, 0.05, 0), new MeshLambertMaterial({ color: '#ffffff' }));
    this.debris = new Growable(this.scene, new ConeGeometry(0.3, 0.7, 8), new MeshLambertMaterial({ color: '#ff7a2e' }), 64);
    this.observer = new ResizeObserver((entries) => {
      const e = entries[0];
      const box = e?.devicePixelContentBoxSize?.[0];
      this.devicePx = box ? [box.inlineSize, box.blockSize] : null;
    });
    try {
      this.observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.observer.observe(canvas);
    }
  }

  /** Feeds a source's snapshots into the interpolator (decoded copies), then passes each on to the handler the source
   *  already had (by default it returns the buffer to the pool; the test chunk holds the latest). */
  attach(source: SnapshotSource): void {
    const next = source.onSnapshot;
    source.onSnapshot = (s: Snapshot) => {
      this.interp.push(decodeSnapshot(s.view));
      next(s);
    };
  }

  start(): void {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
  }

  /** Matches the backing store to the canvas's on-screen size in device pixels (R111), times the setting. */
  private resize(): void {
    const css = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // The observer's device-pixel box is exact where CSS × DPR is fractional; it is used only when it agrees with CSS × DPR
    // to rounding (emulated DPRs, as in Playwright, report it at 1×).
    let [dw, dh] = [Math.round(css.width * dpr), Math.round(css.height * dpr)];
    if (this.devicePx && Math.abs(this.devicePx[0] - dw) <= 2 && Math.abs(this.devicePx[1] - dh) <= 2) [dw, dh] = this.devicePx;
    let w = Math.max(1, Math.round(dw * this.scale));
    let h = Math.max(1, Math.round(dh * this.scale));
    const max = this.backend.maxSize;
    let limitedBy: string | null = null;
    if (w > max || h > max) {
      const k = max / Math.max(w, h);
      w = Math.floor(w * k);
      h = Math.floor(h * k);
      limitedBy = `browser max size ${max}px`;
    }
    const st = this.stats;
    if (w !== st.width || h !== st.height) {
      this.backend.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    Object.assign(st, { width: w, height: h, cssWidth: Math.round(css.width), cssHeight: Math.round(css.height), dpr, limitedBy });
  }

  /** Draws one frame at the interpolator's render tick. */
  frame(): void {
    this.resize();
    const t = this.interp.renderTick();
    const s = (this.sample = this.interp.sample(t, this.sample));
    this.place(s);
    this.backend.renderer.info.autoReset = true;
    this.backend.render(this.scene, this.camera);
    const st = this.stats;
    st.frames++;
    st.tick = t;
    st.cars = s.cars;
    st.debris = s.frame?.debris ?? 0;
    st.snapped = s.snapped;
    st.drawCalls = this.backend.drawCalls();
    this.onFrame(st);
  }

  private place(s: Sampled): void {
    const cars = this.cars.ensure(s.cars);
    const box = [Infinity, -Infinity, Infinity, -Infinity]; // minX, maxX, minZ, maxZ of everything drawn
    const grow = (x: number, z: number) => {
      box[0] = Math.min(box[0]!, x);
      box[1] = Math.max(box[1]!, x);
      box[2] = Math.min(box[2]!, z);
      box[3] = Math.max(box[3]!, z);
    };
    for (let i = 0; i < s.cars; i++) {
      this.v.fromArray(s.pos, i * 3);
      this.q.fromArray(s.rot, i * 4);
      cars.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
      cars.setColorAt(i, this.c.set(PAINT[(s.id[i]! - 1) % PAINT.length]!));
      grow(this.v.x, this.v.z);
    }
    cars.instanceMatrix.needsUpdate = true;
    if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    const f = s.frame;
    const debris = this.debris.ensure(f?.debris ?? 0);
    for (let i = 0; f && i < f.debris; i++) {
      this.v.fromArray(f.debrisPos, i * 3);
      this.q.fromArray(f.debrisRot, i * 4);
      debris.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
      grow(this.v.x, this.v.z);
    }
    debris.instanceMatrix.needsUpdate = true;
    // The overview camera frames everything on the field (P1-R05 brings the real cameras): looking down at 50 degrees,
    // it starts close and backs off until the field's four corners all project inside the frame.
    if (box[0]! <= box[1]!) {
      this.target.set((box[0]! + box[1]!) / 2, 0, (box[2]! + box[3]!) / 2);
      this.half = [Math.max(12, (box[1]! - box[0]!) / 2 + 4), Math.max(12, (box[3]! - box[2]!) / 2 + 4)];
    }
    const tilt = (50 * Math.PI) / 180;
    const cam = this.camera;
    const [hx, hz] = this.half;
    let dist = Math.max(hx, hz);
    for (let k = 0; k < 40; k++, dist *= 1.08) {
      cam.position.set(this.target.x, dist * Math.sin(tilt), this.target.z - dist * Math.cos(tilt));
      cam.near = Math.max(0.5, dist * 0.02); // depth precision for the grid at overview distances
      cam.far = dist * 4;
      cam.updateProjectionMatrix();
      cam.lookAt(this.target);
      cam.updateMatrixWorld();
      let fits = true;
      for (const [dx, dz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]] as const) {
        this.v.set(this.target.x + dx, 0, this.target.z + dz).project(cam);
        if (Math.abs(this.v.x) > 0.94 || Math.abs(this.v.y) > 0.9 || this.v.z > 1) fits = false;
      }
      if (fits) break;
    }
  }
}
