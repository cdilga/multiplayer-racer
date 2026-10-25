// atlas.js: the one texture the Cruz Missile uses, drawn in code (P1-V02, from Spike J's atlas.js). 1024×512.
//   side livery  u 0.00–0.70, v 0.50–1.00   (planar z,y projection of the body sides)
//   top livery   u 0.00–0.35, v 0.00–0.50   (bonnet, planar x,z)
//   deck         u 0.35–0.70, v 0.00–0.50   (boot lid and tail, planar x,z)
//   roof         u 0.70–1.00, v 0.00–0.25   (the painted roof, planar x,z over z 0.30 … −1.20; br-bwju.11)
//   swatches     u 0.70–1.00, 4×8 cells     (flat colours: every vertex of a swatch triangle samples the cell centre; rows 0–4 used)
// The emissive map has the same layout and is black except the light swatches. UVs here have v up (0 = bottom row of the
// image), as Spike J's canvas texture had; the bake flips them for glTF.
//
// Paint key: drawAtlas draws paint pure white (#ffffff); the bake stores it as premultiplied paint coverage (alpha;
// tools/vehicles/paint-key.mjs) and the renderer tints that coverage by the car's instanceColor, so glass, tyres, lamps and the pink/lime livery keep their colours. One material for every car.
//
// No DOM: shapes rasterise into an RGBA buffer at 4×4 supersampling and box-filter down, all integer maths, so two bakes
// give identical bytes on any machine.

export const SW = ['paint', 'trim', 'glass', 'tyre', 'rim', 'head', 'led', 'tail', 'pink', 'lime', 'white', 'fog', 'under', 'bay', 'chrome', 'indicator', 'black', 'grille', 'taildk'];
export const W = 1024, H = 512;
const SX = 0.7, CW = (1 - SX) / 4, CH = 1 / 8;
export function swatchUV(name) { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [SX + CW * (i % 4 + 0.5), 1 - CH * (((i / 4) | 0) + 0.5)]; }
export const REGION = { side: [0, 0.5, SX, 1], top: [0, 0, 0.35, 0.5], deck: [0.35, 0, SX, 0.5], roof: [SX, 0, 1, 0.25], wheel: [.925,.375,1,.5], windscreen: [.7,.25,.925,.375] };

export const DEFAULT_COLOURS = {
  paint: '#22c3e6', trim: '#26282c', glass: '#303840', tyre: '#2a2a2c', rim: '#4a4c50', head: '#fff2c8', led: '#9ff6ff', tail: '#e8311f',
  pink: '#ff2ea6', lime: '#c6ff2e', white: '#f2f4f8', fog: '#ffe9b0', under: '#1c1d20', bay: '#34373e', chrome: '#9aa2ab', indicator: '#ff9a1a', black: '#0d0e10', grille: '#17181b', taildk: '#8c1b10',
};
/** The colours the asset is baked with: paint pure white for the paint key. */
export const BAKE_COLOURS = { ...DEFAULT_COLOURS, paint: '#ffffff' };
const EMIT = { head: '#fff0c0', led: '#7ff2ff', tail: '#c81a0c', fog: '#ffe2a0', indicator: '#ff8a10' };

// The drawing, as data: rectangles and polygons in atlas pixels (y down from the top of the image), drawn in order.
// The livery is traced off the reference sheet (br-bwju.11): the side bolts from its side view (x along the car from the nose,
// metres; y up), the bonnet, roof and boot bolts from its top view (x across, +X the car's left; metres from the nose, from
// the roof's front edge z 0.30, from the tail). Colour regions are classified by hue, outlined and simplified to ~1.5 px.
const SIDE = [
  ['lime', [[4.39,1.49],[4.4,1.49],[4.39,1.38],[4.24,1.23],[4.14,1.22],[4.22,1.31],[4.19,1.32]]],
  ['lime', [[3.78,1.08],[3.79,1.08],[3.62,0.92],[3.62,0.91],[3.76,0.91],[3.49,0.81],[3.47,0.86],[3.32,0.83],[3.17,0.74],[2.78,0.57],[2.51,0.38],[2.31,0.29],[2.12,0.29],[2.44,0.53],[2.64,0.66],[2.83,0.75],[2.64,0.58],[2.65,0.56],[3.08,0.83],[3.04,0.78],[3.05,0.77],[3.6,1.04]]],
  ['lime', [[1.92,1.02],[1.93,1.01],[1.82,0.95],[1.45,0.82],[1.65,0.94]]],
  ['lime', [[1.78,0.8],[1.33,0.45],[1.26,0.41],[1.23,0.41],[1.21,0.38],[1.2,0.39],[1.17,0.52],[1.2,0.62]]],
  ['lime', [[4.03,0.72],[4.04,0.7],[3.98,0.63],[3.98,0.62],[4.18,0.66],[3.96,0.38],[3.94,0.36],[3.89,0.35],[3.87,0.5],[3.82,0.6]]],
  ['lime', [[0.42,0.58],[0.43,0.57],[0.38,0.48],[0.24,0.38],[0.2,0.48]]],
  ['pink', [[4.35,1.5],[4.38,1.5],[4.25,1.38],[4.14,1.29],[4.03,1.23],[4.18,1.38],[4.17,1.39],[4.09,1.35],[4.15,1.46]]],
  ['pink', [[3.28,1.16],[3.03,0.99],[2.96,0.99],[2.95,0.92],[2.59,0.68],[2.57,0.66],[2.59,0.66],[2.7,0.72],[2.82,0.75],[2.6,0.65],[2.5,0.58],[2.08,0.27],[1.8,0.27],[1.84,0.31],[2.59,0.83],[2.57,0.83],[2.2,0.73],[2.23,0.75],[2.21,0.77],[2.0,0.67],[1.75,0.6],[2.5,0.9]]],
  ['pink', [[4.03,0.87],[4.04,0.86],[4.0,0.82],[4.0,0.8],[4.11,0.85],[4.12,0.85],[4.12,0.83],[4.1,0.8],[4.06,0.75],[3.89,0.65],[3.98,0.78],[3.97,0.8],[3.9,0.78]]],
  ['pink', [[0.5,0.7],[0.43,0.64],[0.42,0.59],[0.31,0.55],[0.4,0.63],[0.39,0.65],[0.42,0.66],[0.44,0.65]]],
  ['pink', [[2.89,0.5],[2.9,0.5],[2.86,0.45],[2.69,0.29],[2.56,0.29],[2.7,0.4]]],
  ['pink', [[4.26,0.49],[4.14,0.32],[4.14,0.28],[4.01,0.27],[4.12,0.4],[4.1,0.41],[4.02,0.39]]],
  ['pink', [[2.95,0.34],[3.05,0.33],[2.96,0.21],[2.77,0.2],[2.86,0.24]]],
  ['pink', [[0.22,0.31],[0.31,0.31],[0.23,0.23],[0.1,0.23],[0.08,0.24]]],
  ['white', [[2.38,0.71],[2.4,0.7],[1.92,0.37],[1.82,0.38],[1.95,0.48],[1.96,0.49],[1.95,0.5],[1.52,0.4],[2.08,0.61],[2.29,0.68],[2.31,0.66],[2.32,0.69]]]
];
const BONNET = [
  ['pink', [[-0.73,1.18],[-0.7,1.14],[-0.62,0.95],[-0.4,0.3],[-0.58,0.61],[-0.61,0.62],[-0.6,0.51],[-0.64,0.59],[-0.73,0.84],[-0.66,0.77],[-0.65,0.79]]],
  ['pink', [[0.73,1.17],[0.71,0.98],[0.66,0.77],[0.67,0.77],[0.75,0.84],[0.61,0.48],[0.62,0.6],[0.6,0.61],[0.48,0.41],[0.48,0.46],[0.45,0.49],[0.48,0.49]]],
  ['lime', [[0.5,1.19],[0.49,1.1],[0.42,0.85],[0.43,0.84],[0.67,1.11],[0.7,1.12],[0.62,0.93],[0.49,0.56],[0.43,0.54],[0.43,0.41],[0.38,0.26],[0.31,0.13],[0.27,0.12],[0.26,0.13],[0.45,0.74],[0.44,0.75],[0.3,0.61],[0.29,0.6],[0.29,0.63],[0.38,1.02]]],
  ['lime', [[-0.5,1.18],[-0.36,1.01],[-0.27,0.6],[-0.43,0.76],[-0.45,0.74],[-0.25,0.12],[-0.3,0.14],[-0.38,0.28],[-0.5,0.65],[-0.68,1.11],[-0.43,0.85],[-0.42,0.87]]]
];
const ROOF = [
  ['pink', [[-0.48,0.88],[-0.41,0.6],[-0.36,0.29],[-0.43,0.37],[-0.45,0.36],[-0.44,0.28],[-0.45,0.29],[-0.48,0.43],[-0.5,0.42],[-0.5,0.37],[-0.52,0.36],[-0.5,0.75],[-0.48,0.73],[-0.46,0.74]]],
  ['pink', [[0.5,0.8],[0.52,0.79],[0.52,0.43],[0.47,0.29],[0.45,0.29],[0.46,0.38],[0.45,0.41],[0.4,0.29],[0.37,0.28],[0.38,0.39],[0.45,0.76],[0.48,0.72]]],
  ['lime', [[-0.5,1.41],[-0.36,1.19],[-0.28,0.88],[-0.34,0.98],[-0.49,1.3],[-0.52,1.38],[-0.52,1.4]]],
  ['lime', [[0.5,1.4],[0.52,1.39],[0.52,1.37],[0.48,1.25],[0.29,0.9],[0.36,1.18]]],
  ['lime', [[-0.4,0.78],[-0.23,0.44],[-0.22,0.26],[-0.34,0.28],[-0.39,0.56]]],
  ['lime', [[0.4,0.77],[0.41,0.72],[0.38,0.6],[0.41,0.58],[0.36,0.29],[0.34,0.27],[0.23,0.26],[0.24,0.45]]]
];
const DECK = [
  ['pink', [[-0.73,-0.06],[-0.71,-0.06],[-0.69,-0.04],[-0.71,0.02],[-0.74,0.26],[-0.76,0.26],[-0.78,0.25],[-0.78,0.17],[-0.74,-0.05]]],
  ['pink', [[0.73,-0.06],[0.75,-0.06],[0.76,-0.04],[0.79,0.16],[0.78,0.26],[0.75,0.26],[0.75,0.16],[0.71,-0.04]]],
  ['pink', [[0.08,0.18],[0.22,0.19],[0.34,0.32],[0.27,0.25],[0.24,0.25],[0.31,0.38],[0.08,0.2]]],
  ['pink', [[-0.2,0.19],[-0.05,0.19],[-0.21,0.31],[-0.28,0.38],[-0.2,0.26],[-0.22,0.26],[-0.3,0.3]]],
  ['lime', [[0.09,0.22],[0.22,0.32],[0.29,0.4],[0.29,0.44],[0.35,0.56],[0.25,0.54],[0.22,0.52]]],
  ['lime', [[-0.08,0.22],[-0.07,0.23],[-0.12,0.31],[-0.2,0.52],[-0.24,0.54],[-0.34,0.55],[-0.27,0.45],[-0.28,0.43],[-0.42,0.57],[-0.34,0.44],[-0.31,0.43]]],
  ['lime', [[-0.68,0.26],[-0.7,0.5],[-0.83,1.02],[-0.83,0.75],[-0.85,0.75],[-0.9,0.92],[-0.9,0.8],[-0.78,0.38],[-0.76,0.41],[-0.72,0.4],[-0.71,0.33]]],
  ['lime', [[0.33,0.39],[0.44,0.55],[0.44,0.58],[0.32,0.43]]]
];
const fillOf = (c, k) => c[k];
function sideShapes(c) {
  const [u0, v0, u1, v1] = REGION.side, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, y]) => [ox + x / 4.5 * px, oy + (1 - y / 1.6) * py]);
  return [{ rect: [ox, oy, px, py], fill: c.paint }, ...SIDE.map(([k, pts]) => ({ poly: m(pts), fill: fillOf(c, k) }))];
}
// A top-view region: distance down from the region's top edge (0 … span metres), x across ±0.95 m.
function planShapes(c, region, list, span) {
  const [u0, v0, u1, v1] = region, px = (u1 - u0) * W, py = (v1 - v0) * H, ox = u0 * W, oy = (1 - v1) * H;
  const m = (pts) => pts.map(([x, d]) => [ox + (x / 1.9 + 0.5) * px, oy + (d / span) * py]);
  return [{ rect: [ox, oy, px, py], fill: c.paint }, ...list.map(([k, pts]) => ({ poly: m(pts), fill: fillOf(c, k) }))];
}
const topShapes = (c) => planShapes(c, REGION.top, BONNET, 1.4);
const deckShapes = (c) => planShapes(c, REGION.deck, DECK, 1.4);
const roofShapes = (c) => planShapes(c, REGION.roof, ROOF, 1.5);
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
  const detail=[];
  const rect=(r,fill)=>detail.push({rect:r,fill});
  const poly=(p,fill)=>detail.push({poly:p,fill});
  // Five spokes and an inset barrel at distance, without repeated spoke sidewalls.
  {const [u0,v0,u1,v1]=REGION.wheel,x=(u0+u1)*W/2,y=(1-(v0+v1)/2)*H,rx=(u1-u0)*W*.46,ry=(v1-v0)*H*.46;
    rect([u0*W,(1-v1)*H,(u1-u0)*W,(v1-v0)*H],c.under);
    for(let k=0;k<5;k++){const a=Math.PI/2+.2+k*Math.PI*2/5;
      poly([[.14,-.1],[.92,-.19],[.92,.19],[.14,.1]].map(([r,t])=>[x+rx*(Math.cos(a)*r-Math.sin(a)*t),y-ry*(Math.sin(a)*r+Math.cos(a)*t)]),c.rim);}
    poly(Array.from({length:6},(_,i)=>[x+rx*.22*Math.cos(i*Math.PI/3),y+ry*.22*Math.sin(i*Math.PI/3)]),c.trim);
  }
  // A restrained reflection and seat silhouettes, matching the reference's visible cabin interior.
  {const [u0,v0,u1,v1]=REGION.windscreen,x=u0*W,y=(1-v1)*H,w=(u1-u0)*W,h=(v1-v0)*H;
    rect([x,y,w,h],c.glass);
    poly([[x,y],[x+w*.6,y],[x+w*.3,y+h],[x,y+h]],'#3b4752');
    for(const f of [.15,.60])poly([[x+w*f,y+h*.88],[x+w*f,y+h*.48],[x+w*(f+.04),y+h*.44],[x+w*(f+.04),y+h*.21],[x+w*(f+.19),y+h*.21],[x+w*(f+.19),y+h*.44],[x+w*(f+.24),y+h*.48],[x+w*(f+.27),y+h*.88]],'#242b32');
  }
  const base = raster([...sideShapes(c), ...topShapes(c), ...deckShapes(c), ...roofShapes(c), ...swatchShapes(c, false),...detail], '#000000');
  const emissive = raster(swatchShapes(c, true), '#000000');
  return { width: W, height: H, base, emissive };
}
