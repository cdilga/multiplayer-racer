import { chromium } from 'playwright';

const SHOT = '/private/tmp/claude-501/-Users-cdilga-Documents-dev-multiplayer-racer/548bdb12-fdbb-49d1-b4c3-c15a6f3a6224/scratchpad/host-webgpu-fallback.png';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

// Force navigator.gpu PRESENT so WebGPUBackend is selected and its
// createRenderer() throws "not yet implemented" -> exercises the WebGL fallback.
await page.addInitScript(() => {
  const fakeDevice = {
    limits: { maxBindGroups: 4, maxTextureDimension2D: 8192 },
    features: new Set(),
    destroy() {}
  };
  const fakeAdapter = {
    info: { vendor: 'fake', architecture: 'test', device: 'forced', description: 'forced-present' },
    features: new Set(),
    async requestDevice() { return fakeDevice; }
  };
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { async requestAdapter() { return fakeAdapter; }, getPreferredCanvasFormat: () => 'bgra8unorm' }
  });
});

await page.goto('http://localhost:8000/host', { waitUntil: 'load' });
// Give RenderSystem.init() time to select backend + create renderer + render frames.
await page.waitForTimeout(6000);

// 1) Crash overlay present?
const crash = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  const hit = /something went wrong|failed to create|webgpu renderer not yet implemented/i.test(txt);
  // Also look for a visible error-overlay element
  const overlay = document.querySelector('.error-overlay, #error-overlay, [data-error-overlay]');
  return { hit, overlayVisible: !!overlay, snippet: txt.slice(0, 200) };
});

// 2) Canvas present + nonblank (sample pixels)
const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { found: false };
  const w = c.width, h = c.height;
  // Read pixels via a 2D copy to detect nonblank cheaply
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const g = tmp.getContext('2d');
  let nonblank = false, sampled = 0, nonzero = 0;
  try {
    g.drawImage(c, 0, 0);
    const data = g.getImageData(0, 0, Math.min(w, 200), Math.min(h, 200)).data;
    for (let i = 0; i < data.length; i += 4) {
      sampled++;
      if (data[i] || data[i+1] || data[i+2]) nonzero++;
    }
    nonblank = nonzero > 0;
  } catch (e) {
    return { found: true, w, h, readError: String(e) };
  }
  return { found: true, w, h, nonblank, sampled, nonzero };
});

// 3) Renderer/backend introspection from the live host instance
const backendInfo = await page.evaluate(() => {
  const gh = window.gameHost || window.GAME_HOST || null;
  const rs = gh && gh.systems && gh.systems.render;
  const out = { hasHost: !!gh, hasRender: !!rs };
  try {
    if (rs) {
      out.rendererType = rs.renderer ? rs.renderer.constructor.name : null;
      out.isWebGL = !!(rs.renderer && rs.renderer.isWebGLRenderer);
      out.backendName = rs.rendererBackend ? rs.rendererBackend.name : null;
      out.diag = rs.getRenderDiagnostics ? rs.getRenderDiagnostics() : (rs.renderDiagnostics || null);
    }
  } catch (e) { out.introspectError = String(e); }
  return out;
});

await page.screenshot({ path: SHOT });

console.log('=== CRASH OVERLAY ===', JSON.stringify(crash));
console.log('=== CANVAS ===', JSON.stringify(canvasInfo));
console.log('=== BACKEND ===', JSON.stringify(backendInfo, null, 2));
console.log('=== FALLBACK LOG LINES ===');
for (const l of logs.filter((l) => /webgpu|fallback|webgl|renderer/i.test(l))) console.log('  ' + l);
console.log('=== ANY ERROR LOGS ===');
for (const l of logs.filter((l) => /\[error\]|\[pageerror\]/i.test(l))) console.log('  ' + l);

await browser.close();
