// atlas.js: the one texture the Tradie Ute uses, drawn in code (br-bwju.2; derived from the Cruz Missile's atlas.js). 1024×512.
//   side livery  u 0.00–0.70, v 0.50–1.00   (planar z,y projection of the body sides)
//   top livery   u 0.00–0.35, v 0.00–0.50   (bonnet, planar x,z)
//   deck/roof    u 0.35–0.70, v 0.00–0.50
//   swatches     u 0.70–1.00, 4×8 cells     (flat colours: every vertex of a swatch triangle samples the cell centre)
// The emissive map has the same layout and is black except the light swatches. UVs here have v up (0 = bottom row of the
// image), as Spike J's canvas texture had; the bake flips them for glTF.
//
// Paint key: the baked atlas draws paint pure white (#ffffff), and the renderer tints only pure-white texels by the car's
// instanceColor, so glass, tyres, lamps and the pink/lime livery keep their colours. One material for every car.
//
// No DOM: shapes rasterise into an RGBA buffer at 4×4 supersampling and box-filter down, all integer maths, so two bakes
// give identical bytes on any machine.

export const SW = ['paint', 'trim', 'glass', 'tyre', 'rim', 'head', 'led', 'tail', 'pink', 'lime', 'white', 'fog', 'under', 'bay', 'chrome', 'indicator'];
export const W = 1024, H = 512;
const SX = 0.7, CW = (1 - SX) / 4, CH = 1 / 8;
export function swatchUV(name) { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [SX + CW * (i % 4 + 0.5), 1 - CH * (((i / 4) | 0) + 0.5)]; }
export const REGION = { side: [0, 0.5, SX, 1], top: [0, 0, 0.35, 0.5], deck: [0.35, 0, SX, 0.5] };

export const DEFAULT_COLOURS = {
  paint: '#f2f4f8', trim: '#26282c', glass: '#2b3036', tyre: '#2a2a2c', rim: '#4a4c50', head: '#fff2c8', led: '#9ff6ff', tail: '#e8311f',
  pink: '#ff7a1a', lime: '#e8ff1f', white: '#f2f4f8', fog: '#ffe9b0', under: '#1c1d20', bay: '#34373e', chrome: '#9aa2ab', indicator: '#ff9a1a',
};
/** The colours the asset is baked with: paint pure white for the paint key. */
export const BAKE_COLOURS = { ...DEFAULT_COLOURS, paint: '#ffffff' };
const EMIT = { head: '#fff0c0', led: '#7ff2ff', tail: '#c81a0c', fog: '#ffe2a0', indicator: '#ff8a10' };

// The drawing, as data: rectangles and polygons in atlas pixels (y down from the top of the image), drawn in order.
// Tradie livery: hi-vis orange and yellow chevrons low on the flanks, a shoulder stripe; two bonnet stripes; tray chevrons.
// 'pink' is the hi-vis orange and 'lime' the hi-vis yellow (swatch names are the roster's).
const LEN = 5.3; // side projection: metres from the nose (z) over the atlas width
function sideShapes(c) {
  const [u0, v0, u1, v1] = REGION.side, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + x / LEN * px, oy + (1 - y / 1.7) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  out.push({ poly: m([[0.9, 0.40], [4.4, 0.40], [4.4, 0.50], [0.9, 0.50]]), fill: c.pink });
  for (let i = 0; i < 6; i++) { const x = 1.0 + i * 0.52; out.push({ poly: m([[x, 0.40], [x + 0.26, 0.40], [x + 0.46, 0.50], [x + 0.20, 0.50]]), fill: c.lime }); }
  out.push({ poly: m([[0.6, 1.02], [2.6, 1.02], [2.6, 1.07], [0.6, 1.07]]), fill: c.white });
  out.push({ poly: m([[3.5, 1.10], [5.1, 1.10], [5.1, 1.15], [3.5, 1.15]]), fill: c.lime });
  out.push({ poly: m([[0.25, 0.62], [0.55, 0.62], [0.55, 0.80], [0.25, 0.80]]), fill: c.pink });
  return out;
}
function topShapes(c) {
  const [u0, v0, u1, v1] = REGION.top, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + (x / 1.9 + 0.5) * px, oy + (y / 1.7) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  for (const s of [1, -1]) {
    out.push({ poly: m([[s * 0.14, 0.00], [s * 0.26, 0.00], [s * 0.26, 1.60], [s * 0.14, 1.60]]), fill: c.pink });
    out.push({ poly: m([[s * 0.30, 0.00], [s * 0.34, 0.00], [s * 0.34, 1.60], [s * 0.30, 1.60]]), fill: c.lime });
  }
  return out;
}
function deckShapes(c) {
  const [u0, v0, u1, v1] = REGION.deck, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts, s) => pts.map(([x, y]) => [ox + ((s * x) / 1.9 + 0.5) * px, oy + (y / 1.7) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  for (const s of [1, -1]) out.push({ poly: m([[0.55, 0.05], [0.80, 0.55], [0.70, 0.52], [0.88, 0.95], [0.62, 0.48], [0.72, 0.50]], s), fill: c.lime });
  return out;
}
function swatchShapes(c, emissive) {
  return SW.flatMap((n, i) => {
    const fill = emissive ? EMIT[n] : c[n];
    return fill ? [{ rect: [(SX + CW * (i % 4)) * W, CH * ((i / 4) | 0) * H, CW * W, CH * H], fill }] : [];
  });
}

const SS = 4; // supersampling per axis
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

// Fills shapes into an RGB buffer at SS× resolution, sampling sub-pixel centres; polygons by the even-odd rule.
function raster(shapes, background) {
  const w = W * SS, h = H * SS, buf = new Uint8Array(w * h * 3), bg = hex(background);
  for (let i = 0; i < w * h; i++) buf.set(bg, i * 3);
  const span = (y, x0, x1, rgb) => { for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) buf.set(rgb, (y * w + x) * 3); };
  for (const s of shapes) {
    const rgb = hex(s.fill);
    if (s.rect) {
      const [x, y, rw, rh] = s.rect.map((v) => v * SS);
      // sub-pixel centre (i + 0.5) inside [x, x + rw)
      const xa = Math.ceil(x - 0.5), xb = Math.ceil(x + rw - 0.5), ya = Math.ceil(y - 0.5), yb = Math.ceil(y + rh - 0.5);
      for (let yy = Math.max(0, ya); yy < Math.min(h, yb); yy++) span(yy, xa, xb, rgb);
      continue;
    }
    const pts = s.poly.map(([x, y]) => [x * SS, y * SS]);
    const ys = pts.map((p) => p[1]), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let yy = y0; yy <= y1; yy++) {
      const cy = yy + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy) !== (by <= cy)) xs.push(ax + (cy - ay) / (by - ay) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) span(yy, Math.ceil(xs[k] - 0.5), Math.ceil(xs[k + 1] - 0.5), rgb);
    }
  }
  // Box-filter SS×SS sub-pixels to one pixel, rounding half up; RGBA out, opaque.
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const i = ((y * SS + sy) * w + x * SS + sx) * 3; r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    const n = SS * SS, o = (y * W + x) * 4;
    out[o] = (r + n / 2) / n | 0; out[o + 1] = (g + n / 2) / n | 0; out[o + 2] = (b + n / 2) / n | 0; out[o + 3] = 255;
  }
  return out;
}

/** The base-colour and emissive atlases as RGBA pixel buffers (`W`×`H`, rows top to bottom). */
export function drawAtlas(colours = BAKE_COLOURS) {
  const c = { ...DEFAULT_COLOURS, ...colours };
  const base = raster([...sideShapes(c), ...topShapes(c), ...deckShapes(c), ...swatchShapes(c, false)], '#000000');
  const emissive = raster(swatchShapes(c, true), '#000000');
  return { width: W, height: H, base, emissive };
}
