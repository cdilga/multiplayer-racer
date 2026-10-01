// Visual-evidence capture for Joystick Jammers 0.2's Cruz Missile v2 asset.
//
// This script does NOT start its own server. Before running it:
//   python3 -m http.server 8231   # (or set PORT) from the REPO ROOT
//
// Usage:
//   node spikes/art-pipeline/G-cruze-v2/viewer/capture.mjs
//
// Env overrides (for debugging against the pre-contract spike GLB, which is
// missing most contract nodes -- see ASSET-CONTRACT.md and REPORT below):
//   PORT     - http.server port (default 8231)
//   GLB      - glb path to pass to the viewer (default: the real contract path)
//   OUT_DIR  - where PNGs + report.json land (default: art/vehicles/cruz-missile/previews)
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = process.env.PORT || 8231;
const BASE = `http://localhost:${PORT}/spikes/art-pipeline/G-cruze-v2/viewer/index.html`;
const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../../../..');
const GLB = process.env.GLB || '/art/vehicles/cruz-missile/cruz_missile.lod1.glb';
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(REPO_ROOT, process.env.OUT_DIR)
  : path.resolve(REPO_ROOT, 'art/vehicles/cruz-missile/previews');

await mkdir(OUT_DIR, { recursive: true });

async function urlFor(params) {
  const q = new URLSearchParams({ glb: GLB, ...params });
  return `${BASE}?${q.toString()}`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const results = [];

async function shoot(name, params, { w = 1200, h = 800 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const url = await urlFor(params);
  let report = null;
  try {
    await page.goto(url);
    await page.waitForFunction(
      'document.title === "READY" || document.title === "LOAD_ERROR"',
      null,
      { timeout: 30000 },
    );
    const title = await page.title();
    report = await page.evaluate(() => window.__report);
    if (title !== 'READY') errors.push(`title=${title}`);
    const file = path.join(OUT_DIR, name);
    await page.screenshot({ path: file });
  } catch (err) {
    errors.push(`exception: ${err.message}`);
  }
  await page.close();
  results.push({ name, url, w, h, errors, report });
  console.log(name, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'ok');
  return report;
}

// Composite N already-captured PNGs (as data URIs) into one page using plain
// HTML/CSS (no CDN, no scripts) and screenshot that page -- used for the
// identity grid, the 40px identity check, and the LOD comparison strip.
async function composite(name, { w, h, bodyHtml, headStyle = '' }) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:#cfd6dd;}${headStyle}</style>
    </head><body>${bodyHtml}</body></html>`);
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  await page.close();
  console.log(name, 'composited');
}

async function toDataUri(file) {
  const buf = await (await import('node:fs/promises')).readFile(file);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// 1. Recolor / paint proofs
// ---------------------------------------------------------------------------
await shoot('neutral_q_front.png', { cam: 'q_front', paint: '#c9ccd1', num: '1' });
await shoot('recolor_red_q_front.png', { cam: 'q_front', paint: '#e53935', pattern: '#ffd400', num: '2' });
await shoot('recolor_blue_q_rear.png', { cam: 'q_rear', paint: '#1e63d6', pattern: '#ffffff', num: '3' });
await shoot('recolor_green_side.png', { cam: 'side', paint: '#22c55e', pattern: '#ffffff', num: '4' });
await shoot('tyre_black_proof.png', { cam: 'q_front', paint: '#ff2bd6', pattern: '#ffffff', zoom: '1.3', num: '5' });

// ---------------------------------------------------------------------------
// 2. Orbit views
// ---------------------------------------------------------------------------
await shoot('orbit_front.png', { cam: 'front', paint: '#c9ccd1' });
await shoot('orbit_side.png', { cam: 'side', paint: '#c9ccd1' });
await shoot('orbit_rear.png', { cam: 'rear', paint: '#c9ccd1' });
await shoot('orbit_top.png', { cam: 'top', paint: '#c9ccd1', num: '7' });

// ---------------------------------------------------------------------------
// 3. Colliders
// ---------------------------------------------------------------------------
await shoot('colliders_q_front.png', { cam: 'q_front', colliders: '1', paint: '#c9ccd1' });
await shoot('colliders_side.png', { cam: 'side', colliders: '1', paint: '#c9ccd1' });

// ---------------------------------------------------------------------------
// 4. Rig states
// ---------------------------------------------------------------------------
await shoot('rig_steer_spin_susp.png', { cam: 'q_front', steer: '25', spin: '40', susp: '0.08', paint: '#c9ccd1' });
await shoot('rig_open_panels.png', {
  cam: 'q_front_left', open: 'door_L,door_rear_R,bonnet,boot', paint: '#c9ccd1',
});

// ---------------------------------------------------------------------------
// 5. Damage
// ---------------------------------------------------------------------------
await shoot('dents.png', { cam: 'q_front', dent: '1', paint: '#c9ccd1' });
await shoot('dents_rear.png', { cam: 'q_rear', dent: '1', paint: '#c9ccd1' });
await shoot('light_damage.png', { cam: 'front', lightdmg: 'light_head_L', paint: '#c9ccd1' });

// ---------------------------------------------------------------------------
// 6. LOD comparison strip
// ---------------------------------------------------------------------------
const lodTileW = 560, lodTileH = 420;
const lodFiles = [];
for (const lod of [0, 1, 2]) {
  const lodGlb = /\.lod\d+\./.test(GLB) ? GLB.replace(/\.lod\d+\./, `.lod${lod}.`) : GLB;
  const rep = await shoot(`lod${lod}_side.png`, { cam: 'side', paint: '#c9ccd1', glb: lodGlb }, { w: lodTileW, h: lodTileH });
  lodFiles.push({ lod, file: path.join(OUT_DIR, `lod${lod}_side.png`), triangles: rep && rep.triangles, drawCalls: rep && rep.drawCalls });
}
{
  const uris = await Promise.all(lodFiles.map((f) => toDataUri(f.file)));
  const cellW = lodTileW, cellH = lodTileH + 40;
  const bodyHtml = `<div style="display:flex;font-family:sans-serif;">${lodFiles.map((f, i) => `
    <div style="width:${cellW}px;">
      <img src="${uris[i]}" width="${lodTileW}" height="${lodTileH}" style="display:block;">
      <div style="text-align:center;padding:8px 0;color:#141414;font-size:20px;font-weight:bold;">
        LOD${f.lod} -- ${f.triangles ?? '?'} tris / ${f.drawCalls ?? '?'} calls
      </div>
    </div>`).join('')}</div>`;
  await composite('lods_side_by_side.png', { w: cellW * lodFiles.length, h: cellH, bodyHtml });
}

// ---------------------------------------------------------------------------
// 7. Identity grid (6 colours + roof numbers, high 3/4 cam) + tiny thumbnail
// ---------------------------------------------------------------------------
const IDENTITY = [
  { paint: '#e53935', pattern: '#ffd400', num: '1' },
  { paint: '#1e63d6', pattern: '#ffffff', num: '2' },
  { paint: '#ffcc00', pattern: '#141414', num: '3' },
  { paint: '#22c55e', pattern: '#ffffff', num: '4' },
  { paint: '#a855f7', pattern: '#ffe14d', num: '5' },
  { paint: '#ff7a00', pattern: '#ffffff', num: '6' },
];
{
  const tileW = 640, tileH = 540;
  const tileFiles = [];
  for (let i = 0; i < IDENTITY.length; i++) {
    const p = IDENTITY[i];
    const name = `identity_tile_${i}.png`;
    await shoot(name, { cam: 'q_front', paint: p.paint, pattern: p.pattern, num: p.num, zoom: '1.15' }, { w: tileW, h: tileH });
    tileFiles.push(path.join(OUT_DIR, name));
  }
  const uris = await Promise.all(tileFiles.map(toDataUri));
  const bodyHtml = `<div style="display:grid;grid-template-columns:repeat(3,${tileW}px);grid-template-rows:repeat(2,${tileH}px);">
    ${uris.map((u) => `<img src="${u}" width="${tileW}" height="${tileH}" style="display:block;">`).join('')}
  </div>`;
  await composite('identity_grid.png', { w: tileW * 3, h: tileH * 2, bodyHtml });
}

{
  // Car rendered ~40px tall, then upscaled 8x with nearest-neighbour for inspection.
  const tinyW = 70, tinyH = 50;
  await shoot('identity_40px_raw.png', { cam: 'q_front', paint: '#e53935', pattern: '#ffd400', num: '1' }, { w: tinyW, h: tinyH });
  const uri = await toDataUri(path.join(OUT_DIR, 'identity_40px_raw.png'));
  const scale = 8;
  const bodyHtml = `<img src="${uri}" width="${tinyW * scale}" height="${tinyH * scale}" style="image-rendering: pixelated; display:block;">`;
  await composite('identity_40px.png', { w: tinyW * scale, h: tinyH * scale, bodyHtml });
}

await browser.close();

await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  glb: GLB,
  outDir: OUT_DIR,
  captures: results,
}, null, 2));

const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
console.log(`\nDone. ${results.length} captures, ${totalErrors} error(s) logged. report.json written to ${OUT_DIR}`);
