// paint-key.mjs (br-vhtm): bakes the paint key into the atlas as premultiplied paint coverage (web/shared/render/paint-key.js
// is the renderer's half of the rule).
//
// The atlas is drawn twice, paint white and paint black, with everything else the same. Their difference is the paint
// coverage of each texel (the rasteriser box-filters 4×4 sub-pixels, so edges carry fractional coverage); the black
// drawing is the rest of the texel. The stored texel is
//   alpha = 1 − coverage                       (non-paint coverage; pure paint is alpha 0)
//   rgb   = srgb( linear(livery) × alpha )     (premultiplied in linear light, which is where the GPU filters an sRGB texture)
// and the renderer draws rgb + coverage × tint. A texel with no paint keeps its colour exactly (alpha 1).
// Integer maths over fixed lookup tables, so the bytes are the same on every machine.

const LIN = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 65535);
});
/** The sRGB byte nearest a 16-bit linear value. */
function srgb(lin) {
  let lo = 0, hi = 255;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (LIN[mid] < lin) lo = mid + 1; else hi = mid; }
  return lo > 0 && lin - LIN[lo - 1] <= LIN[lo] - lin ? lo - 1 : lo;
}

/** RGBA atlases drawn with paint white and paint black → the premultiplied paint-key atlas. */
export function keyPaint(white, black) {
  if (white.length !== black.length) throw new Error('paint key: atlas sizes differ');
  const out = new Uint8Array(white.length);
  for (let o = 0; o < white.length; o += 4) {
    const d = Math.round((white[o] - black[o] + white[o + 1] - black[o + 1] + white[o + 2] - black[o + 2]) / 3);
    const a = 255 - Math.max(0, Math.min(255, d));
    out[o + 3] = a;
    if (a === 255) { out[o] = black[o]; out[o + 1] = black[o + 1]; out[o + 2] = black[o + 2]; continue; }
    if (a === 0) continue; // pure paint: (0, 0, 0, 0)
    for (let c = 0; c < 3; c++) {
      // black[c] is the livery averaged over the texel with paint as 0: the livery itself is black[c] / alpha.
      const livery = Math.min(255, Math.round((black[o + c] * 255) / a));
      out[o + c] = srgb(Math.round((LIN[livery] * a) / 255));
    }
  }
  return out;
}

/** The atlas a vehicle's drawAtlas gives, paint-keyed (drawAtlas(colours) merges `colours` over its defaults). */
export function paintKeyedAtlas(drawAtlas) {
  const white = drawAtlas({ paint: '#ffffff' }), black = drawAtlas({ paint: '#000000' });
  return { ...white, base: keyPaint(white.base, black.base) };
}
