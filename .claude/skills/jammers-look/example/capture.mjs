// capture.mjs: renders the Cruz Missile comic-look test scene with Playwright and writes the evidence set.
//   node .claude/skills/jammers-look/example/capture.mjs [outDir] [--no-bench]
// Needs only the repo-root node_modules (playwright 1.62.1, three 0.182.0); serves the repo root on a random localhost port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'docs/evidence/P1-F11'));
const BENCH = !process.argv.includes('--no-bench');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf);
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/.claude/skills/jammers-look/example/`;

const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
async function open(query, w, h, htmlPage = 'index.html') {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(`${query}: ${m.text()}`); });
  await page.goto(`${BASE}${htmlPage}?${query}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 90000 });
  return page;
}

// grain 0 keeps the stills small and reproducible; the grade, vignette and fringe code paths are the shipped defaults
const SHOTS = [
  { file: 'before-hero.png', q: 'look=off&view=hero', w: 1600, h: 900, note: 'plain MeshStandardMaterial, MSAA, same camera and lights' },
  { file: 'hero.png', q: 'look=on&view=hero&grainAmt=0', w: 1600, h: 900, note: 'three-quarter hero, tier L' },
  { file: 'before-side.png', q: 'look=off&view=side', w: 1600, h: 900, note: 'plain, side' },
  { file: 'side.png', q: 'look=on&view=side&grainAmt=0', w: 1600, h: 900, note: 'side view, tier L' },
  { file: 'before-thumb-40px.png', q: 'look=off&view=thumb', w: 128, h: 72, note: 'plain, car about 40 px tall' },
  { file: 'thumb-40px.png', q: 'look=on&view=thumb&grainAmt=0', w: 128, h: 72, note: 'car about 40 px tall, tier XS (toon + 1 px ink only)' },
  { file: 'pack.png', q: 'look=on&view=pack&grainAmt=0', w: 1600, h: 900, note: 'four cars, one material: paint key, damage creep, dust' },
  { file: 'speedlines.png', q: 'look=on&view=hero&grainAmt=0&speed=0.9', w: 1600, h: 900, note: 'speed lines at 0.9 speed' },
  { file: 'hero-fringe.png', q: 'look=on&view=hero&grainAmt=0&fringe=30', w: 1600, h: 900, note: 'chromatic fringe, look.fringe = 30, the big-hit effect' },
  { file: 'glsl-hero.png', page: 'index-glsl.html', q: 'view=hero&grainAmt=0', w: 1600, h: 900, note: 'GLSL route: plain WebGLRenderer, MeshToonMaterial + onBeforeCompile + prepass + one ShaderPass (no bloom)' },
  { file: 'glsl-pack.png', page: 'index-glsl.html', q: 'view=pack&grainAmt=0', w: 1600, h: 900, note: 'GLSL route: paint key on instanceColor, four cars, one material' },
  { file: 'glsl-thumb-40px.png', page: 'index-glsl.html', q: 'view=thumb&grainAmt=0', w: 128, h: 72, note: 'GLSL route: the 40 px car' },
  { file: 'minimal-props.png', page: 'minimal.html', q: 'x=1', w: 1280, h: 720, note: 'the recipes on ordinary meshes: barrel, crate, cone, glowing beacon (no car, atlas or instancing)' },
  { file: 'hero-outline-ids.png', q: 'look=on&view=hero&grainAmt=0&outline=ids', w: 1600, h: 900, note: 'cheap outline tier: object silhouettes only (no depth or normal taps)' },
  { file: 'hero-webgl2.png', q: 'look=on&view=hero&grainAmt=0&backend=webgl', w: 1600, h: 900, note: 'same recipe on WebGPURenderer forced onto its WebGL2 backend' },
  { file: 'debug-shade.png', q: 'look=on&view=hero&dbg=shade&nofxaa=1', w: 1600, h: 900, note: 'jjShade channel (0 lit, 1 cast shadow)' },
  { file: 'debug-id.png', q: 'look=on&view=pack&dbg=id&nofxaa=1', w: 1600, h: 900, note: 'object-id channel (hashed ids)' },
  { file: 'debug-edge.png', q: 'look=on&view=hero&dbg=edge&nofxaa=1', w: 1600, h: 900, note: 'edge mask' },
];
const info = { when: new Date().toISOString(), chromium: browser.version(), shots: {} };
for (const s of SHOTS) {
  const page = await open(`${s.q}&w=${s.w}&h=${s.h}`, s.w, s.h, s.page);
  info.shots[s.file] = { query: s.q, size: `${s.w}x${s.h}`, note: s.note, ...(await page.evaluate(() => window.__look)) };
  if (!info.gpu) info.gpu = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info');
    return { webgpuAdapter: a ? { vendor: a.info.vendor, architecture: a.info.architecture } : null, webgl2Renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null };
  });
  await page.screenshot({ path: path.join(OUT, s.file) });
  await page.close();
  console.log('shot', s.file, info.shots[s.file].backend, `${s.w}x${s.h}`);
}

// 8x nearest-neighbour views of the 40 px thumbnails, and a before/after strip, composed in a throwaway page
async function compose(file, html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html); await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: path.join(OUT, file) }); await page.close();
}
const b64 = (f) => `data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString('base64')}`;
const px = 'image-rendering:pixelated;width:1024px;height:576px;display:block';
await compose('thumb-40px@8x.png', `<body style="margin:0;background:#15203A"><img style="${px}" src="${b64('thumb-40px.png')}"></body>`, 1024, 576);
await compose('glsl-thumb-40px@8x.png', `<body style="margin:0;background:#15203A"><img style="${px}" src="${b64('glsl-thumb-40px.png')}"></body>`, 1024, 576);
await compose('before-thumb-40px@8x.png', `<body style="margin:0;background:#15203A"><img style="${px}" src="${b64('before-thumb-40px.png')}"></body>`, 1024, 576);
await compose('compare-hero.png', `<body style="margin:0;background:#15203A;display:flex;gap:8px"><img style="width:800px" src="${b64('before-hero.png')}"><img style="width:800px" src="${b64('hero.png')}"></body>`, 1608, 450);

// frame cost: headless Chromium on this Mac, NOT a perf receipt (G-PERF owns those). Median of 3 runs of 100 frames at 1080p.
if (BENCH) {
  info.bench = {};
  for (const [name, q] of Object.entries({ 'plain-webgpu': 'look=off&backend=webgpu', 'comic-webgpu': 'look=on&backend=webgpu', 'plain-webgl2': 'look=off&backend=webgl', 'comic-webgl2': 'look=on&backend=webgl', 'comic-webgpu-ids': 'look=on&backend=webgpu&outline=ids', 'comic-glsl-webglrenderer': 'glsl' })) {
    const runs = [], glsl = q === 'glsl';
    for (let i = 0; i < 3; i++) { const page = await open(glsl ? 'view=hero&bench=100&w=1920&h=1080' : `${q}&view=hero&bench=100`, 1920, 1080, glsl ? 'index-glsl.html' : 'index.html'); runs.push(await page.evaluate(() => window.__look.bench)); await page.close(); }
    const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
    info.bench[name] = { frames: 100, resolution: '1920x1080', pipelinedMsMedian: med('pipelinedMsPerFrame'), serialMsMedian: med('serialMsPerFrame'), runs };
    console.log('bench', name, JSON.stringify({ pipelined: med('pipelinedMsPerFrame'), serial: med('serialMsPerFrame') }));
  }
}
info.pageErrors = errors;
fs.writeFileSync(path.join(OUT, 'captures.json'), JSON.stringify(info, null, 2));
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close(); server.close();
