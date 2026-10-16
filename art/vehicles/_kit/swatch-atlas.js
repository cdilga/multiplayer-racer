// swatch-atlas.js (br-bwju.5): a one-texture atlas of flat colour swatches for code-built bikes, drawn without a DOM and
// byte-reproducible (the Cruz Missile's rasteriser: 4x4 supersampling, integer box filter). 1024x512, 8 columns x 8 rows.
// Paint key: the swatch named 'paint' is baked pure white so the renderer tints it with the seat colour; every other
// swatch keeps its colour. The emissive atlas lights only the lamp swatches.
export const W = 1024, H = 512;
const COLS = 8, ROWS = 8;

/** An atlas over the swatch names `SW` (at most 64): swatchUV, drawAtlas and the colour tables. */
export function swatchAtlas(SW, DEFAULT_COLOURS, EMIT) {
  if (SW.length > COLS * ROWS) throw new Error(`${SW.length} swatches; at most ${COLS * ROWS}`);
  const swatchUV = (name) => { const i = SW.indexOf(name); if (i < 0) throw new Error('swatch ' + name); return [(i % COLS + 0.5) / COLS, 1 - (((i / COLS) | 0) + 0.5) / ROWS]; };
  const BAKE_COLOURS = { ...DEFAULT_COLOURS, paint: '#ffffff' };
  const shapes = (c, emissive) => SW.flatMap((n, i) => { const fill = emissive ? EMIT[n] : c[n]; return fill ? [{ rect: [(i % COLS) * W / COLS, ((i / COLS) | 0) * H / ROWS, W / COLS, H / ROWS], fill }] : []; });
  /** The base-colour and emissive atlases as RGBA pixel buffers (`W`x`H`, rows top to bottom). */
  const drawAtlas = (colours = BAKE_COLOURS) => {
    const c = { ...DEFAULT_COLOURS, ...colours };
    return { width: W, height: H, base: raster(shapes(c, false), '#000000'), emissive: raster(shapes(c, true), '#000000') };
  };
  return { swatchUV, drawAtlas, BAKE_COLOURS };
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

