// The renderer bench (P1-R01, P1-R02), ported from Spike J's 24×24 bench (spikes/art-pipeline/J-cruze-lowpoly/bench.js)
// into the host app: N baked Cruz Missiles (P1-V02) on a starting grid, N chase-camera tiles on one canvas, every tile
// drawing the whole pack (the dynamic grid's worst case), through the production instanced vehicle renderer. Loaded
// only by `host/?bench`; `window.__bench.run({...})` returns the numbers.
import { Color, DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { createBackend, type Backend, type BackendKind } from './backend';
import type { Sampled } from './interp';
import { useLod, VehicleRenderer } from './vehicles/vehicles';

export interface BenchRun {
  backend: BackendKind;
  n?: number;
  lod?: number;
  shadows?: boolean;
  w?: number;
  h?: number;
  frames?: number;
}

/** Rows × cols minimising unused area with tiles near 16:9 (Spike J's layout, kept so the bench's numbers compare with its reference row). */
export function tileLayout(n: number, w: number, h: number): { cols: number; rows: number; tw: number; th: number } {
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

async function scene(n: number, shadows: boolean): Promise<{ scene: Scene; vehicles: VehicleRenderer }> {
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
  const vehicles = await VehicleRenderer.load(s);
  const poses = pack(n);
  const sample: Sampled = {
    tick: 0,
    cars: n,
    id: Uint32Array.from(poses, (_, i) => i + 1),
    flags: new Uint32Array(n),
    pos: Float32Array.from(poses.flatMap((p) => [p.x, 0, p.z])),
    rot: Float32Array.from(poses.flatMap(() => [0, 0, 0, 1])),
    steer: new Float32Array(n),
    life: new Uint32Array(n),
    snapped: 0,
    frame: null,
  };
  vehicles.update(sample);
  for (const t of vehicles.types) for (const im of t.meshes) im.castShadow = shadows;
  return { scene: s, vehicles };
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
  const { scene: s, vehicles } = await scene(n, shadows);
  const L = tileLayout(n, w, h);
  const poses = pack(n);
  const cams = poses.map(() => new PerspectiveCamera(60, L.tw / L.th, 0.3, 400));
  cams.forEach((c) => useLod(c, lod));
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
  const tris = vehicles.types.reduce((a, t) => {
    const g = t.meshes[lod]!.geometry;
    return a + ((g.index ? g.index.count : g.attributes.position!.count) / 3) * t.slots.length;
  }, 0);
  vehicles.dispose();
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
