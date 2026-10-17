// atlas.js: the one texture the Lion President uses, drawn in code (br-bwju.3; the Cruz Missile's atlas layout and
// rasteriser, Hawk Dash's full-length top region). 1024×512.
//   side livery  u 0.00–0.70, v 0.50–1.00   (planar z,y projection of the body sides; 4.8 m × 1.6 m)
//   top livery   u 0.00–0.70, v 0.00–0.50   (planar z,x projection of bonnet and boot, nose at u 0; 4.8 m × 1.9 m)
//   swatches     u 0.70–1.00, 4×8 cells     (flat colours: every vertex of a swatch triangle samples the cell centre)
// The emissive map has the same layout and is black except the light swatches. UVs have v up (0 = bottom row of the
// image); the bake flips them for glTF.
//
// Paint key: drawAtlas draws paint pure white (#ffffff); the bake stores it as premultiplied paint coverage (alpha;
// tools/vehicles/paint-key.mjs) and the renderer tints that coverage by the car's instanceColor, so the gloss-black roof and scoops, the black-and-gold pinstripe, glass, tyres and lamps keep their
// colours. One material for every car.
//
// No DOM: shapes rasterise into an RGBA buffer at 4×4 supersampling and box-filter down, all integer maths, so two bakes
// give identical bytes on any machine.

export const SW = ['paint', 'trim', 'glass', 'tyre', 'rim', 'head', 'led', 'tail', 'stripe', 'grille', 'roofblack', 'gold', 'under', 'bay', 'chrome', 'caliper', 'taildk'];
export const W = 1024, H = 512;
const SX = 0.7, CW = (1 - SX) / 4, CH = 1 / 8;
export function swatchUV(name) { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [SX + CW * (i % 4 + 0.5), 1 - CH * (((i / 4) | 0) + 0.5)]; }
export const REGION = { side: [0, 0.5, SX, 1], top: [0, 0, SX, 0.5] };
/** Metres the livery regions cover: side (along the car from the nose, height), top (along the car from the nose, width). */
export const SPAN = { side: [4.8, 1.6], top: [4.8, 1.9] };

export const DEFAULT_COLOURS = {
  paint: '#d8231c', trim: '#232427', glass: '#3e4955', tyre: '#2a2a2c', rim: '#4a4d52', head: '#ffdc2e', led: '#ffe84a', tail: '#e8311f',
  stripe: '#16181c', grille: '#111214', roofblack: '#141518', gold: '#e2b23a', under: '#1c1d20', bay: '#34373e', chrome: '#b4bcc6', caliper: '#d61a1a', taildk: '#4a0b08',
};
/** The colours the asset is baked with: paint pure white for the paint key. */
export const BAKE_COLOURS = { ...DEFAULT_COLOURS, paint: '#ffffff' };
const EMIT = { head: '#ffc800', led: '#ffd800', tail: '#c81a0c', taildk: '#2c0503' };

// The drawing, as data: rectangles and polygons in atlas pixels (y down from the top of the image), drawn in order.
// Side: the sheet's swoosh, measured off its side view (metres from the nose, height): a black band that starts as a point
// at the headlamp's corner, sweeps up over the front wing and runs back, rising and thickening, to the tail lamp; a gold
// pinstripe above it (a red gap between) and one below it.
const SWOOSH = [[0.12, 0.70], [0.45, 0.765], [0.80, 0.815], [1.40, 0.90], [2.55, 0.94], [3.40, 0.975], [4.32, 1.0]];
const swooshBand = (lo, hi) => [...SWOOSH.map(([z, y], i) => [z, y + lo(i / (SWOOSH.length - 1))]), ...SWOOSH.slice().reverse().map(([z, y], i) => [z, y + hi(1 - i / (SWOOSH.length - 1))])];
function sideShapes(c) {
  const [u0, v0, u1, v1] = REGION.side, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + (x / SPAN.side[0]) * px, oy + (1 - y / SPAN.side[1]) * py]);
  const th = (t) => 0.012 + 0.058 * Math.min(1, t * 1.6); // the band's thickness along its length
  return [
    { rect: [ox, oy, px, py], fill: c.paint },
    { poly: m(swooshBand((t) => th(t) + 0.012 * Math.min(1, t * 4), (t) => th(t) + 0.012 * Math.min(1, t * 4) + 0.015)), fill: c.gold },
    { poly: m(swooshBand(() => 0, th)), fill: c.stripe },
    { poly: m(swooshBand((t) => -0.011 * Math.min(1, t * 4) - 0.015, (t) => -0.011 * Math.min(1, t * 4))), fill: c.gold },
  ];
}
// Top: plain paint (the roof is the gloss-black swatch on the greenhouse).
function topShapes(c) {
  const [u0, v0, u1, v1] = REGION.top, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  return [{ rect: [ox, oy, px, py], fill: c.paint }];
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
  const base = raster([...sideShapes(c), ...topShapes(c), ...swatchShapes(c, false)], '#000000');
  const emissive = raster(swatchShapes(c, true), '#000000');
  return { width: W, height: H, base, emissive };
}
