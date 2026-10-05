// P1-M09 capture page code (bundled by signs-capture.mjs): draws sheets of signs with the real kit, one cell per
// sign, the panel framed so it fills a given fraction of the cell (what a close approach looks like in a tile).
import { AmbientLight, Color, DirectionalLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { SIZES, panelHeight, signModule, type SignDef } from '../src/render/signs/sign-kit';

const panel = (d: SignDef) => {
  if (d.family === 'warning') {
    const diag = SIZES.warning.side * Math.SQRT2;
    return { w: diag, h: diag, cy: SIZES.warning.bottom + diag / 2 };
  }
  const s = SIZES[d.family];
  const h = panelHeight(d);
  return { w: s.w, h, cy: s.bottom + h / 2 };
};

interface SheetOpts {
  defs: SignDef[];
  cell: { w: number; h: number };
  cols: number;
  fill: number; // panel's share of the cell: the larger of width and height fits
  bg: string;
}

(window as unknown as Record<string, unknown>).SignSheet = {
  flat(o: SheetOpts) {
    const rows = Math.ceil(o.defs.length / o.cols);
    const W = o.cell.w * o.cols;
    const H = o.cell.h * rows;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    document.body.append(canvas);
    const r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    r.setClearColor(new Color(o.bg));
    r.setScissorTest(true);
    const mat = new MeshBasicMaterial({ vertexColors: true });
    o.defs.forEach((d, i) => {
      const [cx, cyCell] = [(i % o.cols) * o.cell.w, H - (Math.floor(i / o.cols) + 1) * o.cell.h];
      const p = panel(d);
      // Metres per pixel so the panel fills `fill` of the cell along its tighter axis.
      const mpp = Math.max(p.w / (o.cell.w * o.fill), p.h / (o.cell.h * o.fill));
      const cam = new OrthographicCamera((-o.cell.w * mpp) / 2, (o.cell.w * mpp) / 2, (o.cell.h * mpp) / 2, (-o.cell.h * mpp) / 2, 0.1, 20);
      cam.position.set(0, p.cy, 5);
      const scene = new Scene();
      scene.add(new Mesh(signModule(d).geometry(), mat));
      r.setViewport(cx, cyCell, o.cell.w, o.cell.h);
      r.setScissor(cx, cyCell, o.cell.w, o.cell.h);
      r.render(scene, cam);
    });
    return { w: W, h: H };
  },
  /** A perspective view of signs on their posts, standing on ground, lit like a map. */
  world(o: { defs: SignDef[]; w: number; h: number; bg: string; yaw: number }) {
    const canvas = document.createElement('canvas');
    canvas.width = o.w;
    canvas.height = o.h;
    document.body.append(canvas);
    const r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(o.w, o.h, false);
    r.setClearColor(new Color(o.bg));
    const scene = new Scene();
    scene.add(new AmbientLight('#ffffff', 1.6));
    const sun = new DirectionalLight('#ffffff', 2.2);
    sun.position.set(-4, 8, 6);
    scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: '#b78a5e' }));
    scene.add(ground);
    const mat = new MeshLambertMaterial({ vertexColors: true });
    o.defs.forEach((d, i) => {
      const m = new Mesh(signModule(d).geometry(), mat);
      m.position.set((i - (o.defs.length - 1) / 2) * 3.4, 0, 0);
      m.rotation.y = o.yaw;
      scene.add(m);
    });
    const cam = new PerspectiveCamera(40, o.w / o.h, 0.1, 200);
    cam.position.set(0, 2.2, 15);
    cam.lookAt(0, 1.7, 0);
    r.render(scene, cam);
  },
};
