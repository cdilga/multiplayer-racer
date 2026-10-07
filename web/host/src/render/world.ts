// The host renderer's foundation (P1-R01): one canvas at the display's native pixel resolution (R111), the world scene,
// interpolated from snapshots (the sim worker's or the synthetic source's), and one overview camera. Cars are the
// instanced vehicle renderer's (P1-R02) and the map and props the map renderer's (P1-R03); the grid of player tiles is P1-R04 and
// the cameras P1-R05 (`tiles` is a plain chase-camera view until then). Instance buffers grow with the field: there is
// no car or debris cap.
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { Snapshot } from '../worker/client';
import type { Backend } from './backend';
import { Interpolator, type Sampled } from './interp';
import { decodeSnapshot } from './snapshot';
import type { SnapshotSource } from './synthetic';
import { MapRenderer, PropRenderer, SURFACE_COLOURS, type MapJson } from './map/map';
import { lodForTileHeight, useLod, VehicleRenderer } from './vehicles/vehicles';
import { GridAnimator, type Layout } from '../layout/grid';
import { CameraRig, PROFILE as CAMERA, type CameraMode } from '../camera/rig';
import { FrameBudget, stepBelow, type AutoEvent, type Source } from './resolution';
import { IdentifyMarks } from './identify';

/** Spare cells and gutters: the painted paper backdrop, never black (tokens.json palette.paper). */
const PAPER = new Color('#FFF4DE');
const SKY = new Color('#9fc6d8');

/** The host's Render resolution setting (R111): Native by default; the host may choose less. */
export type ResolutionMode = Source;

/** The tiled view (P1-R04's grid; a plain chase camera per tile until the cameras, P1-R05). */
export interface TileView {
  /** Seats on screen; tile k is seat k + 1 in join order. */
  count: number;
  /** A LOD class per tile; otherwise from the tile's height (lodForTileHeight). */
  lods?: number[];
  /** The car (index in the snapshot) each tile follows; otherwise tile k follows car k. */
  follow?: number[];
  /** Degrees a tile's debug camera swings round its car from behind (captures of a car's side); a tile with an orbit
   *  bypasses its seat's camera. */
  orbit?: number[];
  /** Each seat's starting camera mode (the controller's SetCamera changes it). */
  modes?: CameraMode[];
  /** Free drive (P1-G04): one tile per car in the snapshot, growing and shrinking as seats join and leave. */
  auto?: boolean;
}

export interface WorldStats {
  backend: string;
  /** Backing store in device pixels, and the CSS size it covers. */
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  /** The scale actually drawn at (the choice, or lower after an automatic step). */
  scale: number;
  /** The host's chosen scale (1 = Native). */
  userScale: number;
  /** Where the resolution comes from: native, the host's choice (user), or an automatic measured last resort (auto). */
  resolution: ResolutionMode;
  /** The native size the canvas wanted (device pixels), before the setting or any browser limit. */
  nativeWidth: number;
  nativeHeight: number;
  /** Automatic lowerings so far (each after a measured frame-budget miss), and the last frame interval / p95 seen. */
  autoEvents: AutoEvent[];
  frameMs: number;
  p95Ms: number;
  budgetMs: number;
  /** Set when the browser's limit (max canvas/texture size) stopped native resolution. */
  limitedBy: string | null;
  frames: number;
  tick: number;
  cars: number;
  debris: number;
  snapped: number;
  drawCalls: number;
  /** The LOD class each tile drew (one entry for the overview camera). */
  lods: number[];
}

/** A map built but not yet shown (`World.stageMap`). */
export interface StagedMap {
  map: MapJson;
  renderer: MapRenderer;
}

export class World {
  readonly scene = new Scene();
  /** Identify's number over the car, in every view (P1-R06). */
  readonly identifyMarks = new IdentifyMarks(this.scene);
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.5, 2000);
  readonly interp = new Interpolator();
  vehicles: VehicleRenderer | null = null;
  /** Set for the plain multi-tile view; null draws the overview camera. */
  tiles: TileView | null = null;
  private tileCams: PerspectiveCamera[] = [];
  private tileGrid: GridAnimator | null = null;
  /** Per-seat race cameras (P1-R05). */
  readonly rig = new CameraRig();
  private mirrorCam = new PerspectiveCamera(46, 2, 0.3, 600);
  private lastFrame = 0;
  /** Called when the set of off-screen arrows changes: per tile, the rect (device px) and the arrow's angle. */
  onArrows: (arrows: { x: number; y: number; w: number; h: number; angle: number }[], dpr: number) => void = () => {};
  private arrowKey = '';
  /** Called with the grid's layout (device pixels) and the device pixel ratio when the tiles move. */
  onLayout: (layout: Layout | null, dpr: number) => void = () => {};
  map: MapRenderer | null = null;
  private props: PropRenderer;
  private ground: Mesh;
  private grid: GridHelper;
  /** Where the map lies (metres: minX, maxX, minZ, maxZ), framed when nothing is on the field. */
  private mapBox: [number, number, number, number] | null = null;
  private sample: Sampled | undefined;
  private raf = 0;
  private observer: ResizeObserver;
  private devicePx: [number, number] | null = null;
  private q = new Quaternion();
  private v = new Vector3();
  private target = new Vector3();
  private half: [number, number] = [25, 25];
  readonly stats: WorldStats;
  private userScale: number;
  /** Set only by a measured frame-budget miss; always below the user's choice; cleared only by choosing a setting. */
  private autoScale: number | null;
  /** The tile grid moved or animated last frame (one more layout callback once it settles). */
  private layoutMoving = false;
  readonly budget = new FrameBudget();
  /** Automatic lowering is a last resort; tests and `?res=` overrides switch it off. */
  autoLower = true;
  /** Test hook (`?autores=injected`): the budget sees only injected frame times, so tests are deterministic. */
  realFrameTimes = true;
  private lastRaf = 0;
  /** Called when the effective resolution changes (the settings panel and overlay refresh). */
  onResolution: () => void = () => {};
  /** Called after each drawn frame. */
  onFrame: (stats: WorldStats) => void = () => {};

  constructor(
    readonly backend: Backend,
    readonly canvas: HTMLCanvasElement,
    /** The Render resolution setting: 1 is native; lower steps are the host's choice (R111). */
    userScale = 1,
  ) {
    this.userScale = userScale;
    this.autoScale = null;
    const scale = userScale;
    this.stats = {
      backend: backend.label,
      width: 0,
      height: 0,
      cssWidth: 0,
      cssHeight: 0,
      dpr: 1,
      scale,
      userScale: scale,
      resolution: scale === 1 ? 'native' : 'user',
      nativeWidth: 0,
      nativeHeight: 0,
      autoEvents: [],
      frameMs: 0,
      p95Ms: 0,
      budgetMs: 0,
      limitedBy: null,
      frames: 0,
      tick: 0,
      cars: 0,
      debris: 0,
      snapped: 0,
      drawCalls: 0,
      lods: [],
    };
    const r = backend.renderer;
    r.setPixelRatio(1); // sizes below are device pixels already
    r.shadowMap.enabled = true;
    r.shadowMap.autoUpdate = false; // once per frame, not once per tile (§6.1)
    this.scene.background = new Color('#9fc6d8');
    this.scene.add(new HemisphereLight('#ffffff', '#8a7a60', 1.6));
    const sun = new DirectionalLight('#fff4e0', 2.2);
    sun.position.set(60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 400 });
    this.scene.add(sun, sun.target);
    const ground = (this.ground = new Mesh(new PlaneGeometry(1000, 1000), new MeshLambertMaterial({ color: '#b59f82', polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // A 5 m grid, so an empty field still reads as ground with scale and depth (P1-R03 brings the map).
    const grid = (this.grid = new GridHelper(1000, 200, '#8f7b62', '#a48e72'));
    grid.position.y = 0.01;
    this.scene.add(ground, grid);
    this.props = new PropRenderer(this.scene, null);
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

  /** Draws a `jj.map.v1` map (P1-R03) and its props from the snapshot; the ground beyond it is off-track. */
  loadMap(map: MapJson, opts: { repeat?: number } = {}): MapRenderer {
    return this.commitMap(this.stageMap(map, opts));
  }

  /** Builds a map's meshes without showing them (P1-M08a): the round's presentation stays as it is until `commitMap`. */
  stageMap(map: MapJson, opts: { repeat?: number } = {}): StagedMap {
    return { map, renderer: new MapRenderer(map, opts) };
  }

  /** Swaps a staged map in: the old map and its props go, the camera rig and the plain follow the new ground. */
  commitMap(staged: StagedMap): MapRenderer {
    const { map } = staged;
    if (this.map) {
      this.map.group.removeFromParent();
      this.map.dispose();
    }
    this.props?.dispose();
    this.map = staged.renderer.addTo(this.scene);
    this.props = new PropRenderer(this.scene, map);
    this.rig.obstacles = this.map.obstacles();
    this.rig.groundAt = this.map.groundAt;
    this.grid.visible = false;
    (this.ground.material as MeshLambertMaterial).color.set(SURFACE_COLOURS['off-track']!);
    // The plain beyond the map sits just under its lowest ground, or it would cover terrain that dips below zero.
    this.ground.position.y = Math.min(0, ...map.terrain.heights.map((h) => h / 100)) - 0.05;
    const t = map.terrain;
    this.mapBox = [t.originX / 1000, (t.originX + (t.cols - 1) * t.spacing) / 1000, t.originZ / 1000, (t.originZ + (t.rows - 1) * t.spacing) / 1000];
    return this.map;
  }

  /** Instances drawn per prop type (map props, dropped cones, debris). */
  propCounts(): Record<string, number> {
    return this.props.counts();
  }

  /** Where world point (x, y, z) m lands on the canvas in CSS pixels, through the overview camera. */
  project(x: number, y: number, z: number): [number, number] {
    const p = new Vector3(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
  }

  /** Loads the baked vehicle (P1-V02) and draws cars with it. */
  async loadVehicles(): Promise<VehicleRenderer> {
    this.vehicles = await VehicleRenderer.load(this.scene);
    return this.vehicles;
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

  /** The scale drawn at now. */
  get scale(): number {
    return this.autoScale ?? this.userScale;
  }

  /** The host chose a Render resolution: honoured as given, applied on the next frame, and any automatic step is cleared
   *  (the host's choice is never silently overridden or raised). */
  setUserScale(scale: number): void {
    this.userScale = scale;
    this.autoScale = null;
    this.budget.reset();
    this.stats.autoEvents = [];
    this.changed();
  }

  /** Feeds a frame interval (ms) to the budget; a measured miss lowers one step (never below the lowest, never raised). */
  noteFrameTime(dtMs: number): void {
    this.stats.frameMs = dtMs;
    this.stats.budgetMs = this.budget.cfgMs;
    const p95 = this.budget.push(dtMs);
    this.stats.p95Ms = this.budget.p95Ms;
    if (p95 === null || !this.autoLower) return;
    const to = stepBelow(this.scale);
    if (to === null) return;
    this.stats.autoEvents.push({ from: this.scale, to, p95Ms: p95, budgetMs: this.budget.cfgMs, seconds: this.budget.cfgSeconds, atFrame: this.stats.frames });
    this.autoScale = to;
    this.changed();
  }

  private changed(): void {
    this.resize();
    this.onResolution();
  }

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (this.lastRaf && this.realFrameTimes) this.noteFrameTime(now - this.lastRaf);
      this.lastRaf = now;
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
    const scale = this.scale;
    let w = Math.max(1, Math.round(dw * scale));
    let h = Math.max(1, Math.round(dh * scale));
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
    const resolution: ResolutionMode = scale >= 1 ? 'native' : this.autoScale !== null ? 'auto' : 'user';
    Object.assign(st, { width: w, height: h, cssWidth: Math.round(css.width), cssHeight: Math.round(css.height), dpr, limitedBy, scale, userScale: this.userScale, resolution, nativeWidth: dw, nativeHeight: dh });
  }

  /** Draws one frame at the interpolator's render tick. */
  frame(): void {
    this.resize();
    const t = this.interp.renderTick();
    const s = (this.sample = this.interp.sample(t, this.sample));
    this.place(s);
    this.vehicles?.update(s);
    this.identifyMarks.update(s);
    const r = this.backend.renderer;
    const st = this.stats;
    r.shadowMap.needsUpdate = true;
    r.info.autoReset = false;
    r.info.reset();
    // An auto grid with nobody on the field (an empty room's TV) shows the whole map, not one tile chasing no car.
    if (this.tiles && !(this.tiles.auto && (this.tiles.follow?.length ?? s.cars) === 0)) st.lods = this.drawTiles(s, this.tiles);
    else {
      const lod = lodForTileHeight(st.height);
      useLod(this.camera, lod);
      r.setScissorTest(false);
      r.setViewport(0, 0, st.width, st.height);
      this.backend.render(this.scene, this.camera);
      st.lods = [lod];
    }
    st.frames++;
    st.tick = t;
    st.cars = s.cars;
    st.debris = s.frame?.debris ?? 0;
    st.snapped = s.snapped;
    st.drawCalls = this.backend.drawCalls();
    this.onFrame(st);
  }

  /** The grid (P1-R04): each seat's tile chases its car with its own camera at its LOD class; spare cells and gutters
   *  are the paper backdrop. The shadow map was drawn once already. */
  private drawTiles(s: Sampled, view: TileView): number[] {
    // Auto: one tile per followed car (a room's seated cars), else per car in the snapshot.
    if (view.auto) view.count = Math.max(1, view.follow?.length ?? s.cars);
    const r = this.backend.renderer;
    const { width: w, height: h } = this.stats;
    const display = { x: 0, y: 0, w, h };
    const safe = { x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.9 };
    const gutter = Math.max(2, Math.round(Math.min(w, h) * 0.004));
    this.tileGrid ??= new GridAnimator(display, safe, { gutter });
    const seats = Array.from({ length: view.count }, (_, k) => k + 1);
    const now = performance.now();
    const moved = this.tileGrid.update(seats, now, display, safe);
    // While the grid moves, and once more when it settles: on a slow host a whole reflow can fall inside one frame, and
    // the DOM layers (per-tile HUD, frames, join chip) must end on the final rects, not the first frame's (G02).
    const animating = this.tileGrid.animating(now);
    if (moved || animating || this.layoutMoving) this.onLayout(this.tileGrid.layout, this.stats.dpr * this.scale);
    this.layoutMoving = moved || animating;
    const lods: number[] = [];
    r.autoClear = false;
    r.setScissorTest(false);
    r.setClearColor(PAPER);
    r.clear();
    r.setScissorTest(true);
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    this.rig.players = view.count;
    const arrows: { x: number; y: number; w: number; h: number; angle: number }[] = [];
    for (const t of this.tileGrid.tiles(now)) {
      const k = t.seat - 1;
      if (t.w < 1 || t.h < 1) continue;
      const cam = (this.tileCams[k] ??= new PerspectiveCamera(55, 16 / 9, 0.3, 2000));
      cam.aspect = t.w / t.h;
      cam.updateProjectionMatrix();
      const i = s.cars ? (view.follow?.[k] ?? k) % s.cars : -1;
      const mode = this.rig.mode(t.seat);
      if (i >= 0) {
        this.q.fromArray(s.rot, i * 4);
        this.v.fromArray(s.pos, i * 3);
        const orbit = view.orbit?.[k];
        if (orbit !== undefined && orbit !== 0) {
          const a = (orbit * Math.PI) / 180;
          cam.position.set(-6.2 * Math.sin(a), 2.4, -6.2 * Math.cos(a)).applyQuaternion(this.q).add(this.v);
          this.target.set(0, 0.6, 0).applyQuaternion(this.q).add(this.v);
          cam.lookAt(this.target);
        } else {
          this.rig.update(t.seat, cam, { pos: this.v.clone(), rot: this.q.clone(), life: s.life[i]! }, dt);
          if (mode === 'tp') {
            // The off-screen arrow: the own car projected outside its tile (the chase aims at it; this is the backstop).
            const p = this.v.clone().setY(this.v.y + 0.6).project(cam);
            if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) arrows.push({ x: t.x, y: t.y, w: t.w, h: t.h, angle: Math.atan2(-p.y, p.x) });
          }
        }
      }
      const lod = view.lods?.[k] ?? lodForTileHeight(t.h);
      useLod(cam, lod);
      lods.push(lod);
      // Layout rects are top-down; GL viewports are bottom-up.
      const [x, y, tw, th] = [Math.round(t.x), Math.round(h - t.y - t.h), Math.round(t.w), Math.round(t.h)];
      r.setViewport(x, y, tw, th);
      r.setScissor(x, y, tw, th);
      r.setClearColor(SKY);
      r.clear();
      this.backend.render(this.scene, cam);
      if (mode === 'fp' && i >= 0) {
        // Segmented first person: the rear-view mirror in its strip of the tile (rects are fractions, top-down).
        const M = CAMERA.firstPerson.mirror;
        const [mx, mw, mh] = [x + Math.round(M.x * tw), Math.round(M.w * tw), Math.round(M.h * th)];
        const my = y + th - Math.round(M.y * th) - mh;
        this.mirrorCam.aspect = mw / mh;
        this.mirrorCam.updateProjectionMatrix();
        this.rig.aimMirror(t.seat, this.mirrorCam, { pos: this.v.clone(), rot: this.q.clone(), life: s.life[i]! });
        useLod(this.mirrorCam, lodForTileHeight(mh));
        r.setViewport(mx, my, mw, mh);
        r.setScissor(mx, my, mw, mh);
        r.clear();
        this.backend.render(this.scene, this.mirrorCam);
      }
    }
    const key = arrows.map((a) => `${a.x},${a.y},${a.angle.toFixed(1)}`).join('|');
    if (key !== this.arrowKey) {
      this.arrowKey = key;
      this.onArrows(arrows, this.stats.dpr * this.scale);
    }
    r.setScissorTest(false);
    r.autoClear = true;
    return lods;
  }

  /** Each tile's rect on the backing store, in device pixels (what the viewports drew into), for the receipts. */
  tileRects(): { seat: number; x: number; y: number; w: number; h: number }[] | null {
    if (!this.tileGrid) return null;
    return this.tileGrid.tiles(performance.now()).map((t) => ({ seat: t.seat, x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h) }));
  }

  /** Per tile, how large the other cars are on its screen: the on-screen length (device px) of a 4.4 m span along each
   *  visible car, smallest first. The far car's size N of the P1-R acceptance, measured through the tile's own camera. */
  farCars(): { seat: number; tileW: number; tileH: number; visible: number; minPx: number; maxPx: number; farthestM: number }[] {
    const s = this.sample;
    const rects = this.tileRects();
    if (!s || !rects) return [];
    const out = [];
    const a = new Vector3();
    const b = new Vector3();
    const dir = new Vector3();
    const q = new Quaternion();
    for (const t of rects) {
      const k = t.seat - 1;
      const cam = this.tileCams[k];
      if (!cam || t.w < 1) continue;
      cam.updateMatrixWorld();
      const self = this.tiles?.follow?.[k] ?? k;
      let [visible, minPx, maxPx, farthest] = [0, Infinity, 0, 0];
      for (let i = 0; i < s.cars; i++) {
        if (i === self % Math.max(1, s.cars)) continue;
        q.fromArray(s.rot, i * 4);
        dir.set(0, 0, 2.2).applyQuaternion(q);
        a.fromArray(s.pos, i * 3).setY(s.pos[i * 3 + 1]! + 0.6);
        b.copy(a).sub(dir);
        a.add(dir);
        const dist = cam.position.distanceTo(a);
        a.project(cam);
        b.project(cam);
        if ([a, b].some((p) => Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1)) continue;
        const px = Math.hypot(((a.x - b.x) * t.w) / 2, ((a.y - b.y) * t.h) / 2);
        visible++;
        minPx = Math.min(minPx, px);
        maxPx = Math.max(maxPx, px);
        farthest = Math.max(farthest, dist);
      }
      out.push({ seat: t.seat, tileW: t.w, tileH: t.h, visible, minPx: visible ? +minPx.toFixed(1) : 0, maxPx: +maxPx.toFixed(1), farthestM: +farthest.toFixed(1) });
    }
    return out;
  }

  private place(s: Sampled): void {
    const box = [Infinity, -Infinity, Infinity, -Infinity]; // minX, maxX, minZ, maxZ of everything drawn
    const grow = (x: number, z: number) => {
      box[0] = Math.min(box[0]!, x);
      box[1] = Math.max(box[1]!, x);
      box[2] = Math.min(box[2]!, z);
      box[3] = Math.max(box[3]!, z);
    };
    for (let i = 0; i < s.cars; i++) grow(s.pos[i * 3]!, s.pos[i * 3 + 2]!);
    const f = s.frame;
    this.props.update(f);
    // With cars on the field the camera frames them and the props; with none, the whole map (or the props).
    if (s.cars > 0 || !this.mapBox) for (let i = 0; f && i < f.debris; i++) grow(f.debrisPos[i * 3]!, f.debrisPos[i * 3 + 2]!);
    else [box[0], box[1], box[2], box[3]] = this.mapBox;
    // The overview camera frames everything on the field (P1-R05 brings the real cameras): looking down at 50 degrees,
    // it starts close and backs off until the field's four corners all project inside the frame.
    if (box[0]! <= box[1]!) {
      this.target.set((box[0]! + box[1]!) / 2, 0, (box[2]! + box[3]!) / 2);
      this.half = [Math.max(12, (box[1]! - box[0]!) / 2 + 4), Math.max(12, (box[3]! - box[2]!) / 2 + 4)];
    }
    const tilt = (50 * Math.PI) / 180;
    const cam = this.camera;
    const [hx, hz] = this.half;
    let dist = Math.max(hx, hz) * 0.8;
    for (let k = 0; k < 120; k++, dist *= 1.03) {
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
