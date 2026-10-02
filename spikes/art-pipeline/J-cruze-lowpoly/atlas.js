// atlas.js — the one texture the car uses (drawn in code, no files). 1024×512.
//   side livery  u 0.00–0.70, v 0.50–1.00   (planar z,y projection of the body sides; left side mirrored so bolts sweep back)
//   top livery   u 0.00–0.35, v 0.00–0.50   (bonnet, planar x,z)
//   deck/roof    u 0.35–0.70, v 0.00–0.50
//   swatches     u 0.70–1.00, 4×8 cells     (flat colours: every vertex of a swatch triangle samples the cell centre)
// The emissive map is the same layout, black except light swatches. Repaint = redraw with another paint colour.
import * as THREE from 'three';

export const SW = ['paint', 'trim', 'glass', 'tyre', 'rim', 'head', 'led', 'tail', 'pink', 'lime', 'white', 'fog', 'under', 'bay', 'chrome', 'indicator'];
const W = 1024, H = 512, SX = 0.7, CW = (1 - SX) / 4, CH = 1 / 8;
export function swatchUV(name) { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [SX + CW * (i % 4 + 0.5), 1 - CH * (((i / 4) | 0) + 0.5)]; }
export const REGION = { side: [0, 0.5, SX, 1], top: [0, 0, 0.35, 0.5], deck: [0.35, 0, SX, 0.5] };

export const DEFAULT_COLOURS = {
  paint: '#22c3e6', trim: '#26282c', glass: '#2b3036', tyre: '#2a2a2c', rim: '#4a4c50', head: '#fff2c8', led: '#9ff6ff', tail: '#e8311f',
  pink: '#ff2ea6', lime: '#c6ff2e', white: '#f2f4f8', fog: '#ffe9b0', under: '#1c1d20', bay: '#34373e', chrome: '#9aa2ab', indicator: '#ff9a1a',
};
const EMIT = { head: '#fff0c0', led: '#7ff2ff', tail: '#c81a0c', fog: '#ffe2a0', indicator: '#ff8a10' };

function bolt(ctx, pts, fill) { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); }

// Side livery in metres: x = distance from the nose (0 … 4.5), y = height (0 … 1.6). Shapes copied from the reference side view.
function drawSide(ctx, c) {
  const [u0, v0, u1, v1] = REGION.side, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = c.paint; ctx.fillRect(0, 0, px, py);
  const m = (pts) => pts.map(([x, y]) => [x / 4.5 * px, (1 - y / 1.6) * py]);
  // big rising slashes across both doors (pink, lime, white) and a few on the front wing and rear quarter
  bolt(ctx, m([[1.30, 0.42], [2.75, 1.10], [3.05, 1.12], [2.35, 0.78], [2.65, 0.80], [1.85, 0.28]]), c.pink);
  bolt(ctx, m([[1.85, 0.25], [3.35, 1.02], [3.75, 1.08], [3.00, 0.66], [3.30, 0.68], [2.45, 0.22]]), c.lime);
  bolt(ctx, m([[1.50, 0.30], [2.55, 0.68], [2.35, 0.50], [2.00, 0.30]]), c.white);
  bolt(ctx, m([[1.50, 0.86], [2.05, 0.95], [1.60, 0.92]]), c.lime);
  bolt(ctx, m([[0.35, 0.95], [1.05, 1.05], [0.55, 1.00]]), c.pink);
  bolt(ctx, m([[0.40, 0.50], [1.25, 0.72], [0.95, 0.62], [1.10, 0.66], [0.55, 0.42]]), c.lime);
  bolt(ctx, m([[3.30, 0.30], [4.20, 0.80], [4.30, 0.70], [3.80, 0.42], [3.95, 0.45], [3.55, 0.25]]), c.pink);
  bolt(ctx, m([[3.70, 0.62], [4.35, 1.00], [4.40, 0.90], [3.95, 0.66]]), c.lime);
  bolt(ctx, m([[0.20, 0.30], [0.75, 0.45], [0.30, 0.38]]), c.pink);
  ctx.restore();
}
// Bonnet: two lime/pink lightning bolts pointing forward from the cowl (x across −0.95…0.95, y = 0 at the nose … 1.4 at the cowl).
function drawTop(ctx, c) {
  const [u0, v0, u1, v1] = REGION.top, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = c.paint; ctx.fillRect(0, 0, px, py);
  const m = (pts, s) => pts.map(([x, y]) => [((s * x) / 1.9 + 0.5) * px, (y / 1.4) * py]);
  for (const s of [1, -1]) {
    bolt(ctx, m([[0.30, 1.35], [0.62, 0.70], [0.48, 0.74], [0.70, 0.25], [0.40, 0.80], [0.54, 0.78]], s), c.lime);
    bolt(ctx, m([[0.62, 1.30], [0.84, 0.85], [0.74, 0.86], [0.90, 0.55], [0.66, 0.92], [0.76, 0.90]], s), c.pink);
  }
  ctx.restore();
}
function drawDeck(ctx, c) {
  const [u0, v0, u1, v1] = REGION.deck, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = c.paint; ctx.fillRect(0, 0, px, py);
  const m = (pts, s) => pts.map(([x, y]) => [((s * x) / 1.9 + 0.5) * px, (y / 1.4) * py]);
  for (const s of [1, -1]) bolt(ctx, m([[0.55, 0.05], [0.80, 0.55], [0.70, 0.52], [0.88, 0.95], [0.62, 0.48], [0.72, 0.50]], s), c.lime);
  ctx.restore();
}

export function makeAtlas(colours = {}) {
  const c = { ...DEFAULT_COLOURS, ...colours };
  const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; };
  const base = mk(), emit = mk(), b = base.getContext('2d'), e = emit.getContext('2d');
  drawSide(b, c); drawTop(b, c); drawDeck(b, c);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  SW.forEach((n, i) => {
    const x = (SX + CW * (i % 4)) * W, y = CH * ((i / 4) | 0) * H;
    b.fillStyle = c[n]; b.fillRect(x, y, CW * W, CH * H);
    if (EMIT[n]) { e.fillStyle = EMIT[n]; e.fillRect(x, y, CW * W, CH * H); }
  });
  const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = true; return t; };
  return { map: tex(base), emissiveMap: tex(emit), canvas: base };
}

// paintKey: the atlas is drawn with pure-white paint and the per-car colour (instanceColor / vertex colour) multiplies only
// texels that are pure white, so glass, tyres, lights and livery accents keep their colour. One material for every car.
export function carMaterial(colours, { paintKey = false } = {}) {
  const a = makeAtlas(paintKey ? { ...colours, paint: '#ffffff' } : colours);
  const m = new THREE.MeshStandardMaterial({ map: a.map, emissiveMap: a.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05 });
  if (paintKey) m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#if defined( USE_COLOR )
      float paintMask = step( 0.985, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );
      diffuseColor.rgb *= mix( vec3( 1.0 ), vColor, paintMask );
    #endif`);
  };
  return m;
}
