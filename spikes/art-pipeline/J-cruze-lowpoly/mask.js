// mask.js — binary silhouette masks shared by the reference extractor (node) and the evaluator (browser). Pure functions, no imports.
// A mask is a Uint8Array of 0/1, row-major, top row first.

// car = saturated or dark; then fill holes by flooding the background in from the border.
export function segment(rgba, w, h, { sat = 0.2, dark = 0.3 } = {}) {
  const car = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    car[i] = (mx > 0 && (mx - mn) / mx > sat) || mx < dark ? 1 : 0;
  }
  return fillHoles(car, w, h);
}

export function fillHoles(m, w, h) {
  const bg = new Uint8Array(w * h), st = [];
  const push = (i) => { if (!m[i] && !bg[i]) { bg[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const i = st.pop(), x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = bg[i] ? 0 : 1;
  return out;
}

// separable square min/max filters
function pass(m, w, h, r, horiz, isMax) {
  const out = new Uint8Array(w * h), n = horiz ? w : h, lines = horiz ? h : w;
  for (let l = 0; l < lines; l++) for (let k = 0; k < n; k++) {
    let v = isMax ? 0 : 1;
    for (let d = -r; d <= r; d++) {
      const kk = k + d; const s = kk < 0 || kk >= n ? 0 : m[horiz ? l * w + kk : kk * w + l];
      if (isMax ? s : !s) { v = isMax ? 1 : 0; break; }
    }
    out[horiz ? l * w + k : k * w + l] = v;
  }
  return out;
}
export const erode = (m, w, h, r) => pass(pass(m, w, h, r, true, false), w, h, r, false, false);
export const dilate = (m, w, h, r) => pass(pass(m, w, h, r, true, true), w, h, r, false, true);
export const openMask = (m, w, h, r) => (r > 0 ? dilate(erode(m, w, h, r), w, h, r) : m);

export function largest(m, w, h) {
  const lab = new Int32Array(w * h); let best = 0, bestN = 0, id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    id++; let n = 0; const st = [s]; lab[s] = id;
    while (st.length) {
      const i = st.pop(), x = i % w, y = (i / w) | 0; n++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && m[j] && !lab[j]) { lab[j] = id; st.push(j); }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}

export function bbox(m, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropMask(m, w, b) {
  const out = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) out.set(m.subarray((b.y + y) * w + b.x, (b.y + y) * w + b.x + b.w), y * b.w);
  return out;
}

// Compare two bbox-cropped masks. Ours is scaled so its height equals the reference height (scale-free, but the
// width/height ratio still counts), bottom-aligned and centred. Returns IoU plus per-row/column error profiles for tuning.
export function compare(ref, rw, rh, ours, ow, oh, { ignoreBottom = 0 } = {}) {
  const s = rh / oh, sw = Math.round(ow * s), W = Math.max(rw, sw), H = rh;
  const offR = (W - rw) >> 1, offO = (W - sw) >> 1;
  let inter = 0, uni = 0, miss = 0, extra = 0;
  const diff = new Int8Array(W * H), both = new Uint8Array(W * H); // diff: +1 ours only, -1 ref only
  const yMax = Math.round(H * (1 - ignoreBottom));
  for (let y = 0; y < yMax; y++) for (let x = 0; x < W; x++) {
    const rx = x - offR, ox = x - offO;
    const a = rx >= 0 && rx < rw ? ref[y * rw + rx] : 0;
    const oxs = Math.floor(ox / s), oys = Math.floor(y / s);
    const b = ox >= 0 && ox < sw && oxs < ow && oys < oh ? ours[oys * ow + oxs] : 0;
    if (a && b) { inter++; both[y * W + x] = 1; } if (a || b) uni++;
    if (a && !b) { miss++; diff[y * W + x] = -1; } else if (b && !a) { extra++; diff[y * W + x] = 1; }
  }
  return { iou: inter / uni, aspect: sw / rw, miss: miss / uni, extra: extra / uni, W, H, diff, both };
}
