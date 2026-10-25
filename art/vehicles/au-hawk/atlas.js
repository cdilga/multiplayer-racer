// atlas.js: the one texture the AU Hawk uses, drawn in code (br-bwju.3; the Cruz Missile's atlas layout and rasteriser).
// 1024×512.
//   side livery  u 0.00–0.70, v 0.50–1.00   (planar z,y projection of the body sides; 4.8 m × 1.6 m)
//   top livery   u 0.00–0.70, v 0.00–0.50   (planar z,x projection of bonnet, roof and boot, nose at u 0; 4.8 m × 1.9 m),
//                                           plain paint (the AU has no livery)
//   swatches     u 0.70–1.00, 4×8 cells     (flat colours: every vertex of a swatch triangle samples the cell centre)
// The emissive map has the same layout and is black except the light swatches. UVs have v up (0 = bottom row of the
// image); the bake flips them for glTF.
//
// Paint key: drawAtlas draws paint pure white (#ffffff); the bake stores it as premultiplied paint coverage (alpha;
// tools/vehicles/paint-key.mjs) and the renderer tints that coverage by the car's instanceColor, so the stripes, glass, tyres and lamps keep their colours. One material for every car.
//
// No DOM: shapes rasterise into an RGBA buffer at 4×4 supersampling and box-filter down, all integer maths, so two bakes
// give identical bytes on any machine.

export const SW = ['paint', 'trim', 'glass', 'tyre', 'rim', 'head', 'led', 'tail', 'stripe', 'grille', 'white', 'fog', 'under', 'bay', 'chrome', 'indicator', 'roofblack', 'taildk', 'barrel'];
export const W = 1024, H = 512;
const SX = 0.7, CW = (1 - SX) / 4, CH = 1 / 8;
export function swatchUV(name) { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [SX + CW * (i % 4 + 0.5), 1 - CH * (((i / 4) | 0) + 0.5)]; }
export const REGION = { side: [0, 0.5, SX, 1], top: [0, 0, SX, 0.5], wheelFace: [0.852, 0.01, 0.998, 0.24], windscreen: [0.702, 0.01, 0.845, 0.35], backlight: [0.852, 0.25, 0.998, 0.35] };
/** Metres the livery regions cover: side (along the car from the nose, height), top (along the car from the nose, width). */
export const SPAN = { side: [5.1, 1.8], top: [5.1, 2.1] };

export const DEFAULT_COLOURS = {
  paint: '#f06a1a', trim: '#26282c', glass: '#48494c', tyre: '#2a2a2c', rim: '#b9bfc8', head: '#dde2e6', led: '#fff6dc', tail: '#a8161b',
  stripe: '#16181c', grille: '#111214', white: '#f2f4f8', fog: '#ffe9b0', under: '#1c1d20', bay: '#34373e', chrome: '#b4bcc6', indicator: '#ff9a1a',
  roofblack: '#141518', taildk: '#3a1412', barrel: '#25282d',
};
/** The colours the asset is baked with: paint pure white for the paint key. */
export const BAKE_COLOURS = { ...DEFAULT_COLOURS, paint: '#ffffff' };
const EMIT = { head: '#5a5448', led: '#fff2d0', tail: '#c81a0c', fog: '#ffe2a0', indicator: '#ff8a10', taildk: '#1e0503' };

// The drawing, as data: rectangles and polygons in atlas pixels (y down from the top of the image), drawn in order.
// Side: the sheet's black "C" graphic, measured off its side view (metres from the nose, height): a broad leg down behind
// the front arch, a band along the sill, and a kick up over the rear arch that runs back under the shoulder to the tail
// lamp; a pinstripe follows its inside edge, a paint gap away.
const C_OUT = [[1.12, 0.86], [1.25, 0.62], [1.40, 0.45], [1.50, 0.365], [2.86, 0.365], [2.98, 0.48], [3.10, 0.70], [3.24, 0.82], [3.50, 0.85], [4.30, 0.87]];
const C_IN = [[1.31, 0.86], [1.40, 0.64], [1.50, 0.48], [1.60, 0.425], [2.81, 0.425], [2.92, 0.53], [3.03, 0.73], [3.20, 0.875], [3.50, 0.905], [4.30, 0.925]];
const offsetIn = (pts, d) => pts.map(([x, y], i) => [x + (i < 3 ? d : i > 6 ? 0 : d * 0.5), y + (i < 3 ? 0 : d)]);
function sideShapes(c) {
  const [u0, v0, u1, v1] = REGION.side, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + (x / SPAN.side[0]) * px, oy + (1 - y / SPAN.side[1]) * py]);
  const pin0 = offsetIn(C_IN, 0.035), pin1 = offsetIn(C_IN, 0.058); // a gap wide enough to keep full paint between its filtered edges
  return [
    { rect: [ox, oy, px, py], fill: c.paint },
  ];
}
// Top: twin stripes 0.185 m wide with a 0.07 m gap, nose to tail (the sheet's top view).
function topShapes(c) {
  const [u0, v0, u1, v1] = REGION.top, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([d, x]) => [ox + (d / SPAN.top[0]) * px, oy + (1 - (x / SPAN.top[1] + 0.5)) * py]);
  const out = [{ rect: [ox, oy, px, py], fill: c.paint }];
  return out;
}
function swatchShapes(c, emissive) {
  return SW.flatMap((n, i) => {
    const fill = emissive ? EMIT[n] : c[n];
    return fill ? [{ rect: [(SX + CW * (i % 4)) * W, CH * ((i / 4) | 0) * H, CW * W, CH * H], fill }] : [];
  });
}

// Glass recognisers from the sheet, kept in the existing atlas: black rubber surround, broad reflections and the
// silhouettes of seats/mirror behind tinted glass. No transparency, interior mesh or extra material/draw call.
function glassShapes() {
  return ['windscreen', 'backlight'].flatMap((name) => {
    const [u0, v0, u1, v1] = REGION[name], x = u0 * W, y = (1 - v1) * H, w = (u1 - u0) * W, h = (v1 - v0) * H;
    const poly = (pts, fill) => ({ poly: pts.map(([a, b]) => [x + a * w, y + b * h]), fill });
    const shapes = [{ rect: [x, y, w, h], fill: '#171e24' },
      poly([[.04,.05],[.96,.05],[.96,.93],[.04,.93]], '#3d4c58'),
      poly([[.04,.05],[.96,.05],[.96,.35],[.23,.22],[.04,.58]], '#4b5a65'),
      poly([[.10,.38],[.90,.43],[.96,.85],[.04,.85]], '#35434c')];
    for (const s of [.25, .75]) {
      shapes.push(poly([[s-.12,.54],[s+.12,.54],[s+.17,.91],[s-.17,.91]], '#273139'));
      shapes.push(poly([[s-.075,.40],[s+.075,.40],[s+.09,.59],[s-.09,.59]], '#29333a'));
    }
    shapes.push(poly([[.04,.86],[.96,.86],[.96,.94],[.04,.94]], '#263139'));
    if (name === 'windscreen') shapes.push(poly([[.47,.06],[.53,.06],[.53,.20],[.59,.20],[.59,.27],[.41,.27],[.41,.20],[.47,.20]], '#202a30'));
    return shapes;
  });
}

// Radial detail belongs in the atlas, leaving the wheel's triangles for its silhouette and sealed inner face.
function wheelShapes(c) {
  const [u0, v0, u1, v1] = REGION.wheelFace, x = u0 * W, y = (1 - v1) * H, w = (u1 - u0) * W, h = (v1 - v0) * H;
  const poly = (pts, fill) => ({ poly: pts.map(([a, b]) => [x + (a + 1) * w / 2, y + (b + 1) * h / 2]), fill });
  const circle = (r, fill, n = 48) => poly(Array.from({ length: n }, (_, i) => [Math.cos(i * Math.PI * 2 / n) * r, Math.sin(i * Math.PI * 2 / n) * r]), fill);
  const shapes = [{ rect: [x, y, w, h], fill: c.tyre }, circle(.79, c.rim), circle(.73, '#15171a'), circle(.67, '#22252a')];
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + k * Math.PI * 2 / 5, point = (r, b) => [Math.cos(a) * r - Math.sin(a) * b, Math.sin(a) * r + Math.cos(a) * b];
    shapes.push(poly([point(.12,-.11),point(.71,-.14),point(.71,.14),point(.12,.11)], c.rim));
    shapes.push(poly([point(.12,-.11),point(.71,-.14),point(.71,-.025),point(.12,0)], '#e0e4e9'));
  }
  shapes.push(circle(.19, c.rim, 10), circle(.10, '#25282b', 10));
  return shapes;
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
  const base = raster([...sideShapes(c), ...topShapes(c), ...swatchShapes(c, false), ...wheelShapes(c), ...glassShapes()], '#000000');
  const emissive = raster(swatchShapes(c, true), '#000000');
  return { width: W, height: H, base, emissive };
}
