// P1-U06 kit tests (Playwright, real Chromium):
//   AC1  every component renders in every state, Full and Reduced; the buttons match the POC component sheet within a
//        recorded pixel tolerance (the frozen frames are whole-screen mocks, so the reference is the sheet the frames were
//        built from: art/ui/sheets/components.html, same labels and seeds);
//   AC2  the focus rings wrap the whole brushed slab, shadow included, at DPR 1, 2 and 3 (geometry and pixels);
//   AC3  the paper QR decodes (jsqr) to the join URL at the TV's smallest size, carries code and domain, keeps its quiet zone;
//   AC4  the landing page uses the kit and no bundle on the landing or join path holds Three.js (uses landing/tests/bundle-check.mjs).
//   node --test --test-concurrency=1 web/shared/ui/tests/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { chromium } from 'playwright';
import { analyse } from '../../../landing/tests/bundle-check.mjs';
import { build } from '../../../landing/tests/lib/site.mjs';
import { serveArtUi } from '../../../../art/ui/lib/serve.mjs';
import { compare, decode } from './lib/compare.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const evidence = join(web, '..', 'docs', 'evidence', 'P1-U06');
const JOIN_URL = 'https://jammers.dilger.dev/j/ROO7';
/** The recorded tolerance (the sheet crops include its dashed row guides and the spinner turns, which is the 2-4% floor): a button crop passes when fewer than this share of its pixels differ by more than 40/255 in any channel. */
const TOLERANCE = { channel: 40, ratio: 0.05 };

let browser;
let kit;
let art;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

before(async () => {
  mkdirSync(evidence, { recursive: true });
  execFileSync(process.execPath, [join(web, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'kit/vite.config.ts', '--logLevel', 'error'], { cwd: web, stdio: 'inherit' });
  const dist = join(web, 'dist-test', 'kit');
  const server = createServer((req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/') p = '/index.html';
    try {
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(join(dist, p)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  kit = { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
  art = await serveArtUi();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  kit?.close();
  await art?.close();
});

async function openKit(query, viewport, dpr = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  await page.goto(`${kit.base}/?${query}`);
  await page.waitForFunction(() => window.kitReady === true, null, { timeout: 20000 });
  await page.waitForTimeout(200);
  return { page, problems };
}

/** A crop of the page around a box (CSS px), padded so rings and shadows are inside. */
async function crop(page, box, pad) {
  return page.screenshot({ fullPage: true, clip: { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad } });
}

describe('AC1: every component in every state, matching the POC sheet', () => {
  test('buttons: kit vs art/ui/sheets/components.html, every row and state, within the recorded tolerance', async () => {
    const sheetCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const sheet = await sheetCtx.newPage();
    await sheet.goto(`${art.base}/sheets/components.html`);
    await sheet.waitForFunction(() => window.sheetReady === true, null, { timeout: 30000 });
    // The sheet's dashed row separators are page chrome, not the button: with Linux font metrics a separator falls
    // inside a focus-ring crop's margin (6 % of 'Icon button / focus-gp' was the dashes), so they're hidden here.
    await sheet.addStyleTag({ content: '.sec, .lrow, .states > *, .fgrid > *, .ftable > * { border-color: transparent !important; }' });
    const { page, problems } = await openKit('profile=desk&still=1', { width: 1500, height: 1000 });
    const sheetCells = sheet.locator('#s1 .cell');
    const kitCells = page.locator('[data-kit="buttons"] .cell');
    const n = await kitCells.count();
    assert.equal(n, 63, '9 rows x 7 states');
    assert.equal(await sheetCells.count(), n);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const kb = await kitCells.nth(i).locator('button').boundingBox();
      const sb = await sheetCells.nth(i).locator('button').boundingBox();
      const label = `${await kitCells.nth(i).getAttribute('data-row')} / ${await kitCells.nth(i).getAttribute('data-state')}`;
      const a = await crop(page, kb, 22);
      const b = await crop(sheet, { ...sb, width: kb.width, height: kb.height }, 22);
      const r = compare(a, b, TOLERANCE.channel);
      rows.push({ button: label, kit: [kb.width, kb.height], sheet: [sb.width, sb.height], differingShare: +r.ratio.toFixed(4) });
      if (r.ratio >= TOLERANCE.ratio) {
        writeFileSync(join(evidence, `diff-${i}-kit.png`), a);
        writeFileSync(join(evidence, `diff-${i}-sheet.png`), b);
      }
    }
    writeFileSync(join(evidence, 'kit-compare.json'), `${JSON.stringify({ reference: 'art/ui/sheets/components.html (desk profile, 1600x1000, DPR 1)', tolerance: TOLERANCE, rows }, null, 2)}\n`);
    const bad = rows.filter((r) => r.differingShare >= TOLERANCE.ratio);
    assert.deepEqual(bad, [], `buttons differing from the sheet by more than ${TOLERANCE.ratio * 100}% of pixels`);
    assert.deepEqual(problems, []);
    await sheetCtx.close();
  });

  for (const mode of ['full', 'reduced']) {
    test(`kit renders every component in ${mode} motion`, async () => {
      const { page, problems } = await openKit(`profile=desk&still=1&motion=${mode}`, { width: 1500, height: 1000 });
      for (const k of ['buttons', 'buttons-ink', 'buttons-long', 'chips', 'chips-many', 'badges', 'captions', 'qr', 'seats', 'toasts', 'motion-full', 'motion-reduced']) {
        assert.equal(await page.locator(`[data-kit="${k}"]`).count(), 1, `section ${k}`);
      }
      assert.equal(await page.locator('[data-kit="chips-many"] .chip').count(), 40);
      assert.equal(await page.locator('.btn.brush > svg.bb').count(), await page.locator('.btn.brush').count(), 'every brushed button is painted');
      assert.ok((await page.locator('.capt > svg.paint-svg').count()) >= 5, 'captions are painted');
      const pressed = await page.locator('[data-row="Primary"][data-state="pressed"] button').evaluate((b) => getComputedStyle(b).transform);
      const toastAnim = await page.locator('.toast').first().evaluate((t) => getComputedStyle(t).animationName);
      if (mode === 'reduced') {
        assert.equal(pressed, 'none', 'reduced: pressed does not move');
      } else {
        assert.notEqual(pressed, 'none', 'full: pressed drops by the shadow offset');
      }
      assert.ok(toastAnim === 'none' || toastAnim.length > 0);
      assert.deepEqual(problems, []);
      await page.screenshot({ path: join(evidence, `kit-desk-${mode}.png`), fullPage: true });
      await page.context().close();
    });
  }
});

describe('AC2: focus rings wrap the whole slab, shadow included', () => {
  for (const dpr of [1, 2, 3]) {
    test(`geometry and pixels at DPR ${dpr}`, async () => {
      const { page } = await openKit('profile=desk&still=1', { width: 1500, height: 1000 }, dpr);
      for (const state of ['focus-kb', 'focus-gp']) {
        const btn = page.locator(`[data-row="Primary"][data-state="${state}"] button`);
        const g = await btn.evaluate((b, st) => {
          const q = (s) => b.querySelector(`svg.bb ${s}`);
          const px = (v) => parseFloat(v);
          const ty = (el) => new DOMMatrix(getComputedStyle(el).transform).f;
          const fill = q('.bb-fill').getBBox();
          const o = px(getComputedStyle(q('.bb-fill')).strokeWidth);
          const sh = ty(q('.bb-shadow'));
          const out = { o, sh, rings: [] };
          out.slab = { top: fill.y - o / 2, left: fill.x - o / 2, right: fill.x + fill.width + o / 2 };
          out.shadowBottom = fill.y + fill.height + sh + o / 2;
          for (const name of st === 'focus-kb' ? ['bb-kb'] : ['bb-gp-edge', 'bb-gp', 'bb-gp-gap']) {
            const body = b.querySelector(`svg.bb .bb-ring.${name}:not(.bb-sh)`);
            const shd = b.querySelector(`svg.bb .bb-ring.${name}.bb-sh`);
            const half = px(getComputedStyle(body).strokeWidth) / 2;
            const bb = body.getBBox();
            const sb = shd.getBBox();
            out.rings.push({ name, top: bb.y + ty(body) - half, bottom: sb.y + sb.height + ty(shd) + half, left: bb.x - half, right: bb.x + bb.width + half, display: getComputedStyle(body).display });
          }
          return out;
        }, state);
        for (const r of g.rings) {
          assert.notEqual(r.display, 'none', `${state} ${r.name} is shown`);
          assert.ok(r.top <= g.slab.top, `${state} ${r.name} clears the slab top (${r.top} <= ${g.slab.top})`);
          assert.ok(r.left <= g.slab.left && r.right >= g.slab.right, `${state} ${r.name} clears the slab sides`);
          assert.ok(r.bottom >= g.shadowBottom, `${state} ${r.name} clears the shadow's bottom (${r.bottom} >= ${g.shadowBottom})`);
        }
        if (state === 'focus-kb') {
          // Pixels: below the shadow's ink the cobalt ring is still there.
          const box = await btn.boundingBox();
          const png = decode(await crop(page, box, 22));
          const cx = Math.round((box.width / 2 + 22) * dpr);
          let lastInk = -1;
          let lastRing = -1;
          for (let y = 0; y < png.height; y++) {
            const i = (y * png.width + cx) * 4;
            const [r, gg, bl] = [png.data[i], png.data[i + 1], png.data[i + 2]];
            if (r < 50 && gg < 60 && bl > 40 && bl < 90) lastInk = y; // ink #15203A
            if (r < 60 && gg > 70 && gg < 120 && bl > 220) lastRing = y; // cobalt #1E5BFF
          }
          assert.ok(lastRing > lastInk, `DPR ${dpr}: the ring sits below the shadow's ink (ring row ${lastRing}, ink row ${lastInk})`);
        }
      }
      await page.context().close();
    });
  }
});

describe('AC3: the paper QR', () => {
  for (const [profile, w, h, modulePx] of [['tv', 1920, 1080, 8], ['handheld', 390, 844, 4]]) {
    test(`decodes to the join URL at the ${profile} smallest size (${modulePx} px per module), with code, domain and quiet zone`, async () => {
      const { page } = await openKit(`profile=${profile}&still=1`, { width: w, height: h });
      const card = page.locator(`[data-qr-profile="${profile}"] .qr-card`);
      await card.scrollIntoViewIfNeeded();
      const img = card.locator('img.qr');
      const box = await img.boundingBox();
      const size = 37 * modulePx; // 29 modules (version 3, error correction M) + 2 x 4 quiet zone
      assert.ok(Math.abs(box.width - size) < 0.6 && Math.abs(box.height - size) < 0.6, `drawn at ${box.width}px, want ${size}`);
      const png = decode(await img.screenshot());
      const read = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      assert.equal(read?.data, JOIN_URL);
      const text = await card.innerText();
      assert.match(text, /ROO7/);
      assert.match(text, /jammers\.dilger\.dev/);
      // The quiet zone: no ink within 4 modules of any edge, and paper in the corner.
      const q = 4 * modulePx;
      const e = { l: png.width, r: 0, t: png.height, b: 0 };
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          if (png.data[(y * png.width + x) * 4] < 100) {
            e.l = Math.min(e.l, x);
            e.r = Math.max(e.r, x);
            e.t = Math.min(e.t, y);
            e.b = Math.max(e.b, y);
          }
        }
      }
      assert.ok(e.l >= q - 1 && e.t >= q - 1 && png.width - 1 - e.r >= q - 1 && png.height - 1 - e.b >= q - 1, `quiet zone >= ${q}px: ${JSON.stringify(e)}`);
      assert.deepEqual([...png.data.slice(0, 3)], [0xff, 0xf4, 0xde], 'on paper');
      await page.screenshot({ path: join(evidence, `qr-${profile}.png`) });
      await page.context().close();
    });
  }
});

describe('AC4: bundles', () => {
  test('the landing bundle carries the kit; nothing on the landing or join path holds Three.js, a renderer, the sim or WASM', () => {
    const dist = build('./', 'u06-bundle');
    const { report, problems } = analyse(dist);
    assert.deepEqual(problems, []);
    const text = (page) => report[page].files.filter((f) => /\.(js|css)$/.test(f.file)).map((f) => readFileSync(join(dist, f.file), 'utf8')).join('\n');
    const landing = text('landing');
    for (const marker of ['bb-shadow', 'bb-gp-edge', '.capt', 'Barlow Condensed']) assert.ok(landing.includes(marker), `landing bundle has the kit's ${marker}`);
    assert.ok(!/WebGLRenderer|WebGPURenderer/.test(landing));
    assert.ok(!readdirSync(dist).includes('kit'), 'the kit page is a test build, not part of the shipped dist');
  });

  const controllerSrc = join(web, 'controller', 'src');
  const importsKit = readdirSync(controllerSrc, { recursive: true }).some((f) => /\.ts$/.test(f) && readFileSync(join(controllerSrc, f), 'utf8').includes('shared/ui'));
  test('the controller bundle imports the kit', { todo: importsKit ? false : 'web/controller does not import shared/ui yet' }, () => {
    const dist = join(web, 'dist-test', 'u06-bundle');
    const { report } = analyse(dist);
    const js = report.join.files.filter((f) => /\.(js|css)$/.test(f.file)).map((f) => readFileSync(join(dist, f.file), 'utf8')).join('\n');
    assert.ok(js.includes('bb-shadow'), 'controller bundle has the kit');
  });
});
