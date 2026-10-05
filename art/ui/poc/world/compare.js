// compare.js — the A/B compare page of the world look (P1-U05, br-dim.12). Open `index.html#compare=gtao|smaa|shadows|control`.
//
// The owner could not see a difference between GTAO on/off, SMAA on/off, or between shadow options. This page renders the SAME frozen
// frame twice (this page's own world, in two iframes at the real size, each stopped by ?freeze=N on the same fixed-step frame) with
// one setting on and off, then shows: the two images side by side or as a wipe, a 4x crop of the region that differs most (or one you
// pick), a difference heatmap, and the numbers (mean absolute difference, % of scene pixels changed over a threshold). So the effect
// is visible, or demonstrably isn't. `control` is A = B: the noise floor of the comparison (it should read 0).
//
// URL (hash): #compare=<setting>&view=tv|grid&n=24&size=1920x1080&freeze=90&crop=x,y[,w,h]&thr=12&amp=8&mode=side|wipe&cam=
//   view=tv    one full-size tile (the big-tile case); view=grid&n=24 a grid (the small-tile case; each tile is a fraction of size).
//   size=WxH   the world's real viewport (canvas CSS px) the two frames are rendered at; the page scales them to fit.
//   crop=      source-pixel rectangle for the 4x crop (default: the window with the largest summed difference).
//   thr=       a pixel counts as changed when its largest channel differs by more than this (of 255). Default 12.
// Any other query (look=, ink=, tm=, roadtex=, af= ...) is passed to both frames; grain and heat shimmer are forced off in both
// (they read the renderer clock, so they would differ between two frames of the same scene).
// window.__compare (R90: settable, steppable, introspectable): ready, spec, metrics, setMode, setCrop, setAmp, export() (data URLs
// of A, B, the heatmap and the crops), and rerun({...}) to render another setting without reloading.
const q = new URLSearchParams(location.search);
const [stateRaw, ...restH] = location.hash.replace(/^#/, '').split('&');
const H = new URLSearchParams(restH.join('&'));
const setting = stateRaw.split('=')[1] ?? 'gtao';

export const SETTINGS = {
  gtao: { title: 'GTAO (ambient occlusion)', a: { ao: '1' }, b: { ao: '0' }, aName: 'GTAO on', bName: 'GTAO off', note: 'GTAO needs one camera, so it runs in a single-view tile only; in a grid the page leaves it out whatever ao= says.' },
  smaa: { title: 'SMAA', a: { smaa: '1' }, b: { smaa: '0' }, aName: 'SMAA', bName: 'default AA', note: 'default AA = FXAA on four tiles or fewer, none in a bigger grid (the outlines carry the edges).' },
  shadows: { title: 'Sun shadows', a: { shadow: 'pcf' }, b: { shadow: 'off' }, aName: 'shadows PCF 4096', bName: 'shadows off', note: 'Shadows also key the halftone dots, so off removes the dots in shade as well.' },
  control: { title: 'Control (A = B)', a: {}, b: {}, aName: 'A', bName: 'B (same options)', note: 'The noise floor of the comparison: identical options twice. Anything above 0 here is run-to-run noise.' },
};
const spec = SETTINGS[setting];
if (!spec) throw new Error(`unknown compare setting ${setting}; use ${Object.keys(SETTINGS).join(', ')}`);

const view = H.get('view') ?? 'tv';
const N = +(H.get('n') ?? 24);
const [SW, SH] = (H.get('size') ?? '1920x1080').split('x').map(Number);
const FREEZE = +(H.get('freeze') ?? 90);
const THR = +(H.get('thr') ?? 12);
let AMP = +(H.get('amp') ?? 8);
let mode = H.get('mode') ?? 'side';

document.body.classList.add('compare');
document.getElementById('world')?.remove();
const style = document.createElement('style');
style.textContent = `
html:has(body.compare) { height: auto; overflow: auto; }
body.compare { height: auto; min-height: 100%; background: #FFF6E3; color: #15203A; overflow: visible; font: 600 14px/1.3 system-ui, sans-serif; }
body.compare #ui { position: static; inset: auto; }
.cmp { padding: 12px 16px 24px; max-width: 1900px; margin: 0 auto; display: grid; gap: 12px; }
.cmp h1 { margin: 0; font-size: 20px; }
.cmp .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cmp button, .cmp select { font: inherit; padding: 5px 10px; border: 2px solid #15203A; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
.cmp button.on { background: #15203A; color: #FFF6E3; }
.cmp .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cmp .cell { display: grid; gap: 4px; align-content: start; min-width: 0; }
.cmp .cell b { font-size: 13px; }
.cmp .frame { position: relative; border: 3px solid #15203A; border-radius: 6px; overflow: hidden; background: #000; }
.cmp canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.cmp .frame .box { position: absolute; border: 2px solid #FFD23F; box-shadow: 0 0 0 1px #15203A; pointer-events: none; }
.cmp .wipe { position: relative; }
.cmp .wipe canvas.top { position: absolute; inset: 0; }
.cmp .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.cmp .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.cmp .metrics div { border: 2px solid #15203A; border-radius: 8px; padding: 6px 8px; }
.cmp .metrics span { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.cmp .lower { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
.cmp .lower .metrics { grid-template-columns: 1fr 1fr; }
.cmp .note { font-weight: 500; opacity: .85; }
.cmp .legend { height: 10px; border-radius: 5px; background: linear-gradient(90deg, #000, #3b0f70, #b5367a, #fb8761, #fcfdbf); }
.cmp .status { font-weight: 500; }
@media (max-width: 760px) { .cmp .pair, .cmp .row3, .cmp .lower { grid-template-columns: 1fr; } }
`;
document.head.append(style);

const ui = document.getElementById('ui');
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const root = el('div', 'cmp');
const title = el('h1', null, `A/B: ${spec.title} — ${view === 'grid' ? `${N}-tile grid` : 'one tile'} at ${SW}x${SH}`);
const status = el('div', 'status', 'rendering the two frames...');
root.append(title, el('div', 'note', spec.note), status);
ui.append(root);

// Both frames come from this page (the world), stopped on the same fixed-step frame. The iframes sit off-screen at their true size.
const stage = el('div');
Object.assign(stage.style, { position: 'fixed', left: '-20000px', top: '0', width: `${SW}px`, height: `${SH}px`, pointerEvents: 'none' });
document.body.append(stage);

function frameUrl(over) {
  const u = new URL(location.href);
  u.hash = view === 'grid' ? `#grid&n=${N}` : '#tv';
  const p = new URLSearchParams(q);
  for (const k of ['bar', 'ao', 'smaa', 'shadow']) if (!(k in over)) p.delete(k); // the setting under test is set per frame
  p.set('bar', '0'); p.set('grain', '0'); p.set('shimmer', '0'); p.set('freeze', String(FREEZE));
  for (const [k, v] of Object.entries(over)) p.set(k, v);
  u.search = p.toString();
  return u.href;
}
async function render(over) {
  const f = document.createElement('iframe');
  f.style.cssText = `width:${SW}px;height:${SH}px;border:0;display:block`;
  f.src = frameUrl(over);
  stage.append(f);
  const t0 = performance.now();
  while (!(f.contentWindow.__world?.ready === true && f.contentWindow.__world.snapshot?.())) {
    if (performance.now() - t0 > 120000) throw new Error('a frame never froze');
    await new Promise((r) => setTimeout(r, 100));
  }
  const w = f.contentWindow.__world, snap = w.snapshot();
  const c = document.createElement('canvas'); c.width = snap.width; c.height = snap.height;
  c.getContext('2d').drawImage(snap, 0, 0);
  const out = { canvas: c, options: w.options(), rects: w.tileRects(), backend: w.backend, cssW: f.contentWindow.innerWidth };
  f.remove();
  return out;
}

const ramp = [[0, 0, 0], [59, 15, 112], [181, 54, 122], [251, 135, 97], [252, 253, 191]];
function heat(v) { // v 0..1 to the ramp
  const x = Math.min(1, Math.max(0, v)) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
  return ramp[i].map((a, k) => Math.round(a + (ramp[i + 1][k] - a) * f));
}

let A, B, mask, diffD, metrics, crop, cw, ch, S;
function analyse() {
  const w = A.canvas.width, h = A.canvas.height;
  S = w / A.cssW; // canvas pixels per CSS pixel
  const da = A.canvas.getContext('2d').getImageData(0, 0, w, h).data, db = B.canvas.getContext('2d').getImageData(0, 0, w, h).data;
  mask = new Uint8Array(w * h);
  for (const r of A.rects) for (let y = Math.round(r.y * S); y < Math.min(h, Math.round((r.y + r.h) * S)); y++) mask.fill(1, y * w + Math.round(r.x * S), y * w + Math.min(w, Math.round((r.x + r.w) * S)));
  diffD = new Float32Array(w * h);
  let n = 0, sum = 0, over = 0, strong = 0, max = 0;
  for (let i = 0; i < w * h; i++) {
    const dr = Math.abs(da[i * 4] - db[i * 4]), dg = Math.abs(da[i * 4 + 1] - db[i * 4 + 1]), dbl = Math.abs(da[i * 4 + 2] - db[i * 4 + 2]);
    const m = Math.max(dr, dg, dbl);
    diffD[i] = m;
    if (!mask[i]) continue;
    n++; sum += (dr + dg + dbl) / 3; if (m > THR) over++; if (m > 32) strong++; if (m > max) max = m;
  }
  metrics = { setting, view, tiles: view === 'grid' ? N : 1, size: `${SW}x${SH}`, canvasPx: [w, h], scenePixels: n, meanAbsDiff: +(sum / n).toFixed(4), pctChangedOverThr: +(100 * over / n).toFixed(4), thr: THR, pctChangedOver32: +(100 * strong / n).toFixed(4), maxDiff: max, a: A.options, b: B.options, backend: A.backend };
  // the 4x crop: the largest summed difference in a window of cw x ch source pixels (or the crop= given)
  cw = Math.round(Math.min(160 * S, w / 6)); ch = Math.round(cw * 9 / 16);
  const given = H.get('crop')?.split(',').map(Number);
  if (given?.length >= 2) { crop = { x: given[0], y: given[1], w: given[2] ?? cw, h: given[3] ?? ch }; }
  else {
    const bs = Math.max(4, Math.round(cw / 4)), bx = Math.floor(w / bs), by = Math.floor(h / bs), blocks = new Float64Array(bx * by);
    for (let y = 0; y < by * bs; y++) for (let x = 0; x < bx * bs; x++) { const i = y * w + x; if (mask[i]) blocks[Math.floor(y / bs) * bx + Math.floor(x / bs)] += diffD[i]; }
    const wb = Math.round(cw / bs), hb = Math.round(ch / bs);
    let best = -1, bi = 0, bj = 0;
    for (let j = 0; j + hb <= by; j++) for (let i = 0; i + wb <= bx; i++) { let s = 0; for (let jj = 0; jj < hb; jj++) for (let ii = 0; ii < wb; ii++) s += blocks[(j + jj) * bx + i + ii]; if (s > best) { best = s; bi = i; bj = j; } }
    crop = { x: bi * bs, y: bj * bs, w: wb * bs, h: hb * bs };
  }
  metrics.crop = crop;
}

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function heatCanvas() {
  const w = A.canvas.width, h = A.canvas.height, c = cv(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const [r, g, b] = mask[i] ? heat(diffD[i] * AMP / 255) : [24, 24, 24]; img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}
function cropCanvas(src, scale = 4) {
  const c = cv(crop.w * scale, crop.h * scale), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  return c;
}
const show = (c, cls) => { c.className = cls ?? ''; return c; };
const boxFor = () => { const b = el('div', 'box'); const w = A.canvas.width, h = A.canvas.height; Object.assign(b.style, { left: `${100 * crop.x / w}%`, top: `${100 * crop.y / h}%`, width: `${100 * crop.w / w}%`, height: `${100 * crop.h / h}%` }); return b; };

let body;
let wipePct = 50;
function draw() {
  body?.remove();
  body = el('div', 'cmp-body');
  body.style.display = 'grid'; body.style.gap = '12px';
  const heatC = heatCanvas();
  const frame = (c, label, extra) => { const cell = el('div', 'cell'); cell.append(el('b', null, label)); const f = el('div', 'frame'); f.append(c); if (extra !== false) f.append(boxFor()); cell.append(f); return cell; };
  const metricsEl = el('div', 'metrics', `
    <div>mean abs diff (0-255)<span>${metrics.meanAbsDiff}</span></div>
    <div>% scene pixels changed (&gt;${THR})<span>${metrics.pctChangedOverThr}%</span></div>
    <div>% changed (&gt;32, strong)<span>${metrics.pctChangedOver32}%</span></div>
    <div>largest pixel difference<span>${metrics.maxDiff}</span></div>`);
  if (mode === 'wipe') {
    const cell = el('div', 'cell');
    cell.append(el('b', null, `wipe: ${spec.aName} (left) | ${spec.bName} (right)`));
    const f = el('div', 'frame wipe');
    const a = show(A.canvas), b = show(B.canvas, 'top');
    const sync = () => { b.style.clipPath = `inset(0 0 0 ${wipePct}%)`; line.style.left = `${wipePct}%`; };
    const line = el('div'); Object.assign(line.style, { position: 'absolute', top: 0, bottom: 0, width: '3px', background: '#FFD23F', boxShadow: '0 0 0 1px #15203A' });
    f.append(a, b, line, boxFor());
    const rng = el('input'); rng.type = 'range'; rng.min = 0; rng.max = 100; rng.value = wipePct; rng.style.width = '100%'; rng.oninput = () => { wipePct = +rng.value; sync(); };
    sync(); cell.append(f, rng); body.append(cell);
  } else {
    const pair = el('div', 'pair');
    pair.append(frame(show(A.canvas), `A: ${spec.aName}`), frame(show(B.canvas), `B: ${spec.bName}`));
    body.append(pair);
  }
  const row = el('div', 'row3');
  const caption = (t) => `${t}`;
  row.append(
    (() => { const c = el('div', 'cell'); c.append(el('b', null, caption(`4x crop, A: ${spec.aName}`)), el('div', 'frame').appendChild(show(cropCanvas(A.canvas))).parentNode); return c; })(),
    (() => { const c = el('div', 'cell'); c.append(el('b', null, caption(`4x crop, B: ${spec.bName}`)), el('div', 'frame').appendChild(show(cropCanvas(B.canvas))).parentNode); return c; })(),
    (() => { const c = el('div', 'cell'); c.append(el('b', null, caption(`4x crop of the difference (x${AMP})`)), el('div', 'frame').appendChild(show(cropCanvas(heatC))).parentNode); return c; })(),
  );
  const hm = frame(show(heatC), `difference heatmap (|A-B| x${AMP}, largest channel; grey = outside the scene)`);
  const leg = el('div', 'legend'); hm.append(leg);
  const lower = el('div', 'lower'); lower.append(hm, metricsEl); body.append(row, lower);
  root.append(body);
  window.__compare.heatCanvas = heatC;
}
function chrome() {
  const bar = el('div', 'bar');
  const mk = (t, f, on) => { const b = el('button', on ? 'on' : null, t); b.onclick = f; return b; };
  for (const m of ['side', 'wipe']) bar.append(mk(m === 'side' ? 'Side by side' : 'Wipe', () => api.setMode(m), mode === m));
  bar.append(el('span', null, 'Heatmap gain'));
  const sel = el('select'); for (const g of [1, 4, 8, 16, 32]) { const o = el('option', null, `x${g}`); o.value = g; o.selected = g === AMP; sel.append(o); }
  sel.onchange = () => api.setAmp(+sel.value); bar.append(sel);
  for (const k of Object.keys(SETTINGS)) { const b = el('button', k === setting ? 'on' : null, k); b.onclick = () => { const u = new URL(location.href); u.hash = `#compare=${k}&${H.toString()}`; location.href = u.href; location.reload(); }; bar.append(b); }
  return bar;
}

async function run() {
  status.textContent = `rendering ${spec.aName}...`;
  A = await render(spec.a);
  status.textContent = `rendering ${spec.bName}...`;
  B = await render(spec.b);
  analyse();
  status.textContent = `${A.backend}, frame ${FREEZE} of a fixed 1/60 s sim; ${A.canvas.width}x${A.canvas.height} px; crop ${crop.x},${crop.y} ${crop.w}x${crop.h} (4x)`;
  root.insertBefore(chrome(), status);
  draw();
  api.ready = true;
}
const api = window.__compare = {
  ready: false, spec: { setting, ...spec, view, n: N, size: [SW, SH], freeze: FREEZE },
  get metrics() { return metrics; },
  setMode(m) { mode = m; if (A) { root.querySelectorAll('.bar button').forEach((b) => b.classList.toggle('on', b.textContent === (m === 'side' ? 'Side by side' : 'Wipe'))); draw(); } },
  setAmp(g) { AMP = g; if (A) draw(); },
  /** Move the 4x crop (source pixels; w and h default to the auto size). */
  setCrop(x, y, w = cw, h = ch) { crop = { x, y, w, h }; metrics.crop = crop; draw(); return crop; },
  /** The images as data URLs: A, B, the heatmap, the three 4x crops. */
  export(type = 'image/jpeg', quality = 0.92) {
    const u = (c) => c.toDataURL(type, quality);
    return { a: u(A.canvas), b: u(B.canvas), heat: u(heatCanvas()), cropA: u(cropCanvas(A.canvas)), cropB: u(cropCanvas(B.canvas)), cropDiff: u(cropCanvas(heatCanvas())), metrics };
  },
};
run().catch((e) => { status.textContent = `failed: ${e.message}`; api.error = e.message; throw e; });
