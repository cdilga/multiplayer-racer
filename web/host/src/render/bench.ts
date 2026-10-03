// The renderer backend bench (P1-R01), ported from Spike J's 24×24 bench (spikes/art-pipeline/J-cruze-lowpoly/bench.js)
// into the host app: N baked Cruz Missiles (P1-V02's LOD GLB) on a starting grid, N chase-camera tiles on one canvas,
// every tile drawing the whole pack (the dynamic grid's worst case). One InstancedMesh per GLB mesh, so draws per tile
// stay constant in N. Loaded only by `host/?bench`; `window.__bench.run({...})` returns the numbers.
import { Color, DirectionalLight, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import lod0 from '../../../../art/vehicles/cruz-missile/cruz-missile.lod0.glb?url';
import lod1 from '../../../../art/vehicles/cruz-missile/cruz-missile.lod1.glb?url';
import lod2 from '../../../../art/vehicles/cruz-missile/cruz-missile.lod2.glb?url';
import { createBackend, type Backend, type BackendKind } from './backend';

const LODS = [lod0, lod1, lod2];
const PAINT = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389', '#ff7a2e', '#9b7bff', '#ff3b3b', '#3bd6c6'];

export interface BenchRun {
  backend: BackendKind;
  n?: number;
  lod?: number;
  shadows?: boolean;
  w?: number;
  h?: number;
  frames?: number;
}

/** Rows × cols minimising unused area with tiles near 16:9 (Spike J's layout; P1-R04 owns the real grid). */
function layout(n: number, w: number, h: number) {
  let best = { cols: 1, rows: n, tw: w, th: h / n, cost: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tw = w / cols;
    const th = h / rows;
    const cost = Math.abs(Math.log(tw / th / (16 / 9))) + (rows * cols - n) * 0.05;
    if (cost < best.cost) best = { cols, rows, tw, th, cost };
  }
  return best;
}

const pack = (n: number) => Array.from({ length: n }, (_, i) => ({ x: ((i % 4) - 1.5) * 3.2, z: -Math.floor(i / 4) * 6.5 }));

async function scene(n: number, lod: number, shadows: boolean): Promise<{ scene: Scene; tris: number }> {
  const gltf = await new GLTFLoader().loadAsync(LODS[lod]!);
  const s = new Scene();
  s.background = new Color('#d9c7a5');
  s.add(new HemisphereLight('#ffffff', '#8a7a60', 1.5));
  const sun = new DirectionalLight('#fff4e0', 2.2);
  sun.position.set(30, 60, 20);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  s.add(sun, sun.target);
  const ground = new Mesh(new PlaneGeometry(400, 400), new MeshLambertMaterial({ color: '#c96f3b' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  s.add(ground);
  gltf.scene.updateMatrixWorld(true);
  const poses = pack(n);
  const car = new Matrix4();
  const m = new Matrix4();
  const col = new Color();
  let tris = 0;
  gltf.scene.traverse((o) => {
    if (!(o instanceof Mesh) || o.name.startsWith('collider_')) return; // LOD0's collider proxies are never drawn
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    const im = new InstancedMesh(g, o.material, n);
    im.castShadow = shadows;
    im.frustumCulled = false;
    // The GLB carries damage warp morph targets: WebGPURenderer's morph node needs the influences on the instanced
    // mesh too (WebGLRenderer tolerates their absence). All zero = the intact car.
    if (o.morphTargetInfluences) im.morphTargetInfluences = o.morphTargetInfluences.map(() => 0);
    for (let i = 0; i < n; i++) {
      car.makeTranslation(poses[i]!.x, 0, poses[i]!.z);
      im.setMatrixAt(i, m.multiplyMatrices(car, o.matrixWorld));
      im.setColorAt(i, col.set(PAINT[i % PAINT.length]!));
    }
    s.add(im);
  });
  return { scene: s, tris };
}

let backend: Backend | null = null;

export async function run(canvas: HTMLCanvasElement, opts: BenchRun) {
  const { n = 24, lod = 1, shadows = false, w = 1920, h = 1080, frames = 120 } = opts;
  if (!backend || backend.kind !== opts.backend) {
    backend?.renderer.dispose();
    // A backend owns its canvas's context for good, so each one gets a fresh canvas.
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
    backend = await createBackend(opts.backend, canvas);
  }
  const b = backend;
  const r = b.renderer;
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  r.autoClear = false;
  r.shadowMap.enabled = shadows;
  r.info.autoReset = false; // counted per whole frame (all tiles)
  const { scene: s, tris } = await scene(n, lod, shadows);
  const L = layout(n, w, h);
  const poses = pack(n);
  const cams = poses.map(() => new PerspectiveCamera(60, L.tw / L.th, 0.3, 400));
  let draws = 0;
  const frame = () => {
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    r.info.reset();
    for (let i = 0; i < n; i++) {
      const c = cams[i]!;
      const p = poses[i]!;
      c.position.set(p.x, 2.4, p.z - 6.2);
      c.lookAt(p.x, 1.0, p.z + 4);
      const x = (i % L.cols) * L.tw;
      const y = h - (Math.floor(i / L.cols) + 1) * L.th;
      r.setViewport(x, y, L.tw, L.th);
      r.setScissor(x, y, L.tw, L.th);
      b.render(s, c);
    }
    draws = b.drawCalls();
  };
  for (let i = 0; i < 10; i++) {
    frame();
    await b.finish();
  }
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    frame();
    await b.finish();
    times.push(performance.now() - t0);
  }
  times.sort((a, z) => a - z);
  // Back-to-back frames with one GPU wait at the end: throughput without the per-frame sync, which could penalise a
  // backend that pipelines (WebGPU's queue).
  const t1 = performance.now();
  for (let i = 0; i < frames; i++) frame();
  await b.finish();
  const throughput = (performance.now() - t1) / frames;
  return {
    backend: b.label,
    kind: b.kind,
    n,
    lod,
    shadows,
    w,
    h,
    tiles: `${L.cols}x${L.rows}`,
    tile_px: `${Math.round(L.tw)}x${Math.round(L.th)}`,
    car_tris: tris,
    draws_per_frame: draws,
    ms_median: +times[frames >> 1]!.toFixed(2),
    ms_p90: +times[Math.floor(frames * 0.9)]!.toFixed(2),
    ms_throughput: +throughput.toFixed(2),
  };
}

export function mountBench(root: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100vw;height:100vh;display:block';
  root.replaceChildren(canvas);
  (window as unknown as { __bench: unknown }).__bench = {
    run: (o: BenchRun) => run(root.querySelector('canvas')!, o),
    shot: () => root.querySelector('canvas')!.toDataURL('image/png'),
  };
  document.documentElement.dataset.jjHost = 'bench';
}
