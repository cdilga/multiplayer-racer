// atlas.js: the one texture the Tradie Ute uses, drawn in code (br-bwju.2; derived from the Cruz Missile's atlas.js). 1024×512.
//   side livery  u 0.00–0.70, v 0.50–1.00   (planar z,y projection of the body sides)
//   top livery   u 0.00–0.35, v 0.00–0.50   (bonnet, planar x,z)
//   canopy side  u 0.35–0.70, v 0.00–0.50   (planar z,y over the canopy box: doors, seam, locks; br-bwju.8)
//   swatches     u 0.70–1.00, v 0.375–1.00 (flat colours: every vertex of a swatch triangle samples the cell centre)
//   canopy rear  u 0.70–0.85, v 0.00–0.375 (planar x,y over the canopy's back: rear door, window, handle, third brake light; br-bwju.8)
//   canopy roof  u 0.85–1.00, v 0.00–0.375 (planar x,z over the canopy's lid: ribs and hatch seams on the seat colour)
// The emissive map has the same layout and is black except the light swatches. UVs here have v up (0 = bottom row of the
// image), as Spike J's canvas texture had; the bake flips them for glTF.
//
// Paint key: drawAtlas draws paint pure white (#ffffff); the bake stores it as premultiplied paint coverage (alpha;
// tools/vehicles/paint-key.mjs) and the renderer tints that coverage by the car's instanceColor, so glass, tyres, lamps and the pink/lime livery keep their colours. One material for every car.
//
// No DOM: shapes rasterise into an RGBA buffer at 4×4 supersampling and box-filter down, all integer maths, so two bakes
// give identical bytes on any machine.

export const SW = ['paint', 'trim', 'glass', 'tyre', 'rim', 'head', 'led', 'tail', 'pink', 'lime', 'white', 'fog', 'under', 'bay', 'chrome', 'indicator', 'canopy', 'awning'];
export const W = 1024, H = 512;
const SX = 0.7, CW = (1 - SX) / 4, CH = 1 / 8;
export function swatchUV(name) { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [SX + CW * (i % 4 + 0.5), 1 - CH * (((i / 4) | 0) + 0.5)]; }
export const REGION = { side: [0, 0.5, SX, 1], top: [0, 0, 0.35, 0.5], canopy: [0.35, 0, SX, 0.5], canopyRear: [SX, 0, 0.85, 0.375], canopyTop: [0.85, 0, 1, 0.375] };

export const DEFAULT_COLOURS = {
  paint: '#f2f4f8', trim: '#26282c', glass: '#2b3036', tyre: '#2a2a2c', rim: '#1f2023', head: '#fff2c8', led: '#9ff6ff', tail: '#e8311f',
  pink: '#ff7a1a', lime: '#f2c81a', white: '#f2f4f8', fog: '#ffe9b0', under: '#1c1d20', bay: '#34373e', chrome: '#aab2bb', indicator: '#ff9a1a',
  canopy: '#1d1f22', awning: '#4b4e52', checker: '#3d4046', checkerHi: '#5a5e65', canopyHi: '#2a2d31',
};
/** The colours the asset is baked with: paint pure white for the paint key. */
export const BAKE_COLOURS = { ...DEFAULT_COLOURS, paint: '#ffffff' };
const EMIT = { head: '#fff0c0', led: '#7ff2ff', tail: '#c81a0c', fog: '#ffe2a0', indicator: '#ff8a10' };

// The drawing, as data: rectangles and polygons in atlas pixels (y down from the top of the image), drawn in order.
// The owner's Triton (br-bwju.8): plain paint; behind the cab, under the tray deck, the black frame and checker-plate
// under-tray boxes; the canopy's black doors with a seam and two round locks a side. 'lime' is the winch hook's yellow.
const LEN = 5.3; // side projection: metres from the nose (z) over the atlas width
function sideShapes(c) {
  const [u0, v0, u1, v1] = REGION.side, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + x / LEN * px, oy + (1 - y / 1.7) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  const cab = 3.48; // the cab's back (z -0.93) in metres from the nose
  out.push({ poly: m([[cab, 0], [LEN, 0], [LEN, 1.7], [cab, 1.7]]), fill: c.under });
  out.push({ poly: m([[cab + 0.62, 0.42], [LEN - 0.12, 0.42], [LEN - 0.12, 1.02], [cab + 0.62, 1.02]]), fill: c.checker }); // under-tray boxes
  for (let x = cab + 0.66; x < LEN - 0.16; x += 0.08) for (let y = 0.46; y < 1.0; y += 0.08) out.push({ poly: m([[x, y], [x + 0.04, y + 0.02], [x, y + 0.04], [x - 0.04, y + 0.02]].map(([a, b]) => [a + 0.02, b])), fill: c.checkerHi });
  out.push({ poly: m([[cab + 0.62, 0.70], [LEN - 0.12, 0.70], [LEN - 0.12, 0.72], [cab + 0.62, 0.72]]), fill: c.under }); // the boxes' lids
  // The cab's own details (br-bwju.8; the owner's Triton is plain paint, so no livery). Doors cut at 1.66, 2.55 and 3.44 m
  // from the nose; the body side runs from the sill (0.34 m) to the shoulder (1.25 m).
  out.push({ poly: m([[1.70, 0.34], [cab - 0.04, 0.34], [cab - 0.04, 0.44], [1.70, 0.44]]), fill: c.trim }); // the black rocker under the doors
  for (const x of [2.36, 3.24]) out.push({ poly: m([[x, 1.10], [x + 0.13, 1.10], [x + 0.13, 1.15], [x, 1.15]]), fill: c.trim }); // door handles
  out.push({ poly: m([[0.34, 1.19], [cab - 0.10, 1.19], [cab - 0.10, 1.21], [0.34, 1.21]]), fill: c.chrome }); // the shoulder's chrome line
  // The J-line: the chrome sweep where the cab meets the tray, down the cab's back and forward along the sill.
  out.push({ poly: m([[cab - 0.10, 1.21], [cab - 0.02, 1.21], [cab - 0.02, 0.46], [cab - 0.30, 0.46], [cab - 0.30, 0.50], [cab - 0.10, 0.50]]), fill: c.chrome });
  // Wheel-arch flares' lips and the front guard's indicator repeater.
  out.push({ poly: m([[0.78, 1.00], [0.86, 1.00], [0.86, 1.06], [0.78, 1.06]]), fill: c.indicator });
  return out;
}
function topShapes(c) {
  const [u0, v0, u1, v1] = REGION.top, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + (x / 1.9 + 0.5) * px, oy + (y / 1.7) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  // The owner's Triton is plain paint (br-bwju.8): the bonnet keeps only its washer jets and the cowl's vent strip.
  for (const s of [1, -1]) out.push({ poly: m([[s * 0.42, 1.30], [s * 0.46, 1.30], [s * 0.46, 1.34], [s * 0.42, 1.34]]), fill: c.trim });
  out.push({ poly: m([[-0.30, 1.50], [0.30, 1.50], [0.30, 1.56], [-0.30, 1.56]]), fill: c.trim }); // the cowl's vent strip
  return out;
}
function canopyShapes(c) {
  // u: 0 at the canopy's front, 1 at its back; v: 0 at the deck, 1 at the canopy's top (the model's canopyUV)
  const [u0, v0, u1, v1] = REGION.canopy, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([u, v]) => [ox + u * px, oy + (1 - v) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.canopy }];
  out.push({ poly: m([[0.02, 0.44], [0.98, 0.44], [0.98, 0.95], [0.02, 0.95]]), fill: c.canopyHi }); // the upper lift-up door
  out.push({ poly: m([[0.02, 0.40], [0.98, 0.40], [0.98, 0.43], [0.02, 0.43]]), fill: '#0c0d0f' }); // seam over the lower boxes
  out.push({ poly: m([[0.49, 0.04], [0.51, 0.04], [0.51, 0.40], [0.49, 0.40]]), fill: '#0c0d0f' }); // the lower doors' split
  for (const u of [0.24, 0.76]) { // round locks
    const r = 0.035, oct = Array.from({ length: 8 }, (_, i) => [u + r * Math.cos(i * Math.PI / 4) * py / px * 2, 0.24 + r * 2 * Math.sin(i * Math.PI / 4)]);
    out.push({ poly: m(oct), fill: c.chrome });
  }
  // br-bwju.8: the real canopy's hardware: the upper door's T-handles, its gas struts at each end, a louvred vent, the drip
  // rail along the top, chrome corner protectors, and amber and red side reflectors.
  for (const u of [0.30, 0.70]) out.push({ poly: m([[u - 0.035, 0.60], [u + 0.035, 0.60], [u + 0.035, 0.63], [u + 0.008, 0.63], [u + 0.008, 0.68], [u - 0.008, 0.68], [u - 0.008, 0.63], [u - 0.035, 0.63]]), fill: c.chrome });
  for (const [a, b] of [[0.05, 0.11], [0.95, 0.89]]) out.push({ poly: m([[a, 0.50], [a + 0.012, 0.50], [b + 0.012, 0.88], [b, 0.88]]), fill: c.chrome });
  for (let k = 0; k < 6; k++) out.push({ poly: m([[0.43, 0.83 - k * 0.045], [0.57, 0.83 - k * 0.045], [0.57, 0.85 - k * 0.045], [0.43, 0.85 - k * 0.045]]), fill: '#0c0d0f' });
  out.push({ poly: m([[0, 0.96], [1, 0.96], [1, 1], [0, 1]]), fill: c.chrome }); // drip rail
  for (const [a, b] of [[0, 0.025], [0.975, 1]]) out.push({ poly: m([[a, 0.04], [b, 0.04], [b, 1], [a, 1]]), fill: c.chrome }); // corner protectors
  out.push({ poly: m([[0.03, 0.07], [0.07, 0.07], [0.07, 0.13], [0.03, 0.13]]), fill: c.indicator });
  out.push({ poly: m([[0.93, 0.07], [0.97, 0.07], [0.97, 0.13], [0.93, 0.13]]), fill: c.tail });
  return out;
}

function canopyRearShapes(c, emissive) {
  // u: 0 at the canopy's right (-X), 1 at its left; v: 0 at the deck, 1 at the canopy's top (the model's canopyRearUV)
  const [u0, v0, u1, v1] = REGION.canopyRear, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([u, v]) => [ox + u * px, oy + (1 - v) * py]);
  if (emissive) return [{ poly: m([[0.38, 0.92], [0.62, 0.92], [0.62, 0.96], [0.38, 0.96]]), fill: EMIT.tail }];
  const out = [{ rect: [ox, oy, px, py], fill: c.canopy }];
  out.push({ poly: m([[0.06, 0.08], [0.94, 0.08], [0.94, 0.90], [0.06, 0.90]]), fill: c.canopyHi }); // the rear door
  out.push({ poly: m([[0.12, 0.50], [0.88, 0.50], [0.88, 0.84], [0.12, 0.84]]), fill: c.glass }); // its tinted window
  out.push({ poly: m([[0.14, 0.78], [0.40, 0.84], [0.30, 0.84], [0.14, 0.80]]), fill: '#5a6470' }); // the glass's glint
  out.push({ poly: m([[0.40, 0.40], [0.60, 0.40], [0.60, 0.44], [0.40, 0.44]]), fill: c.chrome }); // T-handle
  out.push({ poly: m([[0.48, 0.34], [0.52, 0.34], [0.52, 0.40], [0.48, 0.40]]), fill: c.chrome });
  out.push({ poly: m([[0.38, 0.92], [0.62, 0.92], [0.62, 0.96], [0.38, 0.96]]), fill: c.tail }); // the third brake light
  for (const u of [0.02, 0.98]) out.push({ poly: m([[u - 0.02, 0], [u + 0.02, 0], [u + 0.02, 1], [u - 0.02, 1]]), fill: c.chrome }); // corner protectors
  return out;
}

function canopyTopShapes(c) {
  // u across the lid (-X to +X), v along it (front to back): the seat colour with the tie-down rails along its edges. Wide
  // pure-white areas only: thin lines every few texels would blend the white away in the mipmaps and the lid would stop
  // taking the seat colour at a distance (the chase cam reads whose ute it is from the lid).
  const [u0, v0, u1, v1] = REGION.canopyTop, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([u, v]) => [ox + u * px, oy + v * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  for (const u of [0.02, 0.98]) out.push({ poly: m([[u - 0.02, 0], [u + 0.02, 0], [u + 0.02, 1], [u - 0.02, 1]]), fill: c.trim }); // tie-down rails along the edges
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
  const base = raster([...sideShapes(c), ...topShapes(c), ...canopyShapes(c), ...canopyRearShapes(c, false), ...canopyTopShapes(c), ...swatchShapes(c, false)], '#000000');
  const emissive = raster([...swatchShapes(c, true), ...canopyRearShapes(c, true)], '#000000');
  return { width: W, height: H, base, emissive };
}
