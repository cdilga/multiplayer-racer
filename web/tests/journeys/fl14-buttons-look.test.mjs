// P1-FL14 (owner 2026-10-16, R130): the phone controller's buttons look finished. The real controller in `playing` (the
// R90 state opener, no host) at the owner's phone sizes, landscape and portrait, in Chromium and WebKit, with every state a
// button can show: idle, pressed (a held finger), disabled, Ready on, and the launch pod ready and cooling. It asserts what
// a look can't be trusted to: every tool is a >= 48 CSS px target, nothing overlaps the sticks or the HUD, a press and a
// disabled button change how they paint, Identify's label contrasts with the seat colour, and the launch bar is full when
// the launch is ready. JJ_CAPTURE_DIR=<dir> saves a still of each state for the self-review (docs/evidence/P1-FL14/).
//   node --test web/tests/journeys/fl14-buttons-look.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/fl14/';
const OUT = process.env.JJ_CAPTURE_DIR;
const SIZES = [[915, 412], [412, 915], [667, 375], [640, 300]];
let server;
before(async () => { server = await serve(build('./', 'fl14'), BASE, { JJ_STUN_URLS: '' }); });
after(async () => { await server?.close(); });

/** Opens the controller in a state, with the first-run tutorial and the turn-sideways card already seen. */
async function open(browser, engine, [w, h], frag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: engine === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${server.origin}${BASE}j/ABCD#state=${frag}`);
  await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready', undefined, { timeout: 30_000 });
  for (const sel of ['[data-act=upright]', '[data-act=tut-skip]', '[data-act=skip]']) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
  }
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

/** The visible tools with their boxes, and the boxes they must stay clear of. */
const layout = (page) => page.evaluate(() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const tools = [...document.querySelectorAll('.tools .btn')].filter((e) => e.offsetParent).map((e) => ({ act: e.dataset.act, ...box(e) }));
  const keep = [...document.querySelectorAll('.zone .base, .strip .who, .strip .race, .pod')].filter((e) => e.offsetParent).map((e) => ({ what: e.className, ...box(e) }));
  return { tools, keep, over: document.documentElement.scrollWidth - innerWidth };
});
const hits = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const paint = (page, sel) => page.locator(sel).evaluate((e) => { const s = getComputedStyle(e); return { filter: s.filter, opacity: s.opacity, transform: s.transform, color: s.color }; });

/** WCAG contrast of two `rgb(...)` colours. */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const shot = async (page, name) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${name}.png` }); } };

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`FL14 buttons look (${engine})`, { timeout: 240_000 }, async () => {
    const browser = await type.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      for (const size of SIZES) {
        const tag = `${engine}-${size[0]}x${size[1]}`;
        for (const [state, frag] of [['race', 'playing&round=racing&boost=140'], ['lobby', 'playing&round=lobby']]) {
          const { ctx, page, errs } = await open(browser, engine, size, frag);
          const { tools, keep, over } = await layout(page);
          await shot(page, `${tag}-${state}-idle`);
          assert.ok(tools.length >= 6, `${tag} ${state}: tools on screen (${tools.length})`);
          for (const t of tools) assert.ok(t.w >= 47.5 && t.h >= 47.5, `${tag} ${state}: ${t.act} is ${t.w.toFixed(1)}x${t.h.toFixed(1)}, under 48 px`);
          for (const t of tools) for (const k of keep) assert.ok(!hits(t, k), `${tag} ${state}: ${t.act} overlaps ${k.what}`);
          for (let i = 0; i < tools.length; i++) for (let j = i + 1; j < tools.length; j++) assert.ok(!hits(tools[i], tools[j]), `${tag} ${state}: ${tools[i].act} overlaps ${tools[j].act}`);
          assert.ok(tools.every((t) => t.x >= 0 && t.x + t.w <= size[0] + 0.5), `${tag} ${state}: a tool is off the edge`);
          assert.ok(over <= 1, `${tag} ${state}: the page scrolls sideways by ${over}px`);
          // Identify's label against the seat colour.
          const idc = await page.locator('[data-act=identify]').evaluate((e) => ({ fg: getComputedStyle(e).color, bg: getComputedStyle(e).getPropertyValue('--seat').trim() }));
          const seat = idc.bg.startsWith('#') ? `rgb(${[1, 3, 5].map((i) => parseInt(idc.bg.slice(i, i + 2), 16)).join(',')})` : idc.bg;
          assert.ok(contrast(idc.fg, seat) >= 4.5, `${tag}: Identify ${idc.fg} on ${seat} has contrast ${contrast(idc.fg, seat).toFixed(2)}`);
          if (state === 'lobby') {
            // Disabled: Ready before your car is confirmed. The real rule (view.ts updateHud) sets it; the style must read as off.
            await page.locator('[data-act=ready]').evaluate((e) => { e.disabled = true; });
            const off = await paint(page, '[data-act=ready]');
            assert.ok(Number(off.opacity) < 0.8, `${tag}: a disabled Ready still paints at opacity ${off.opacity}`);
            await shot(page, `${tag}-lobby-disabled-ready`);
            await page.locator('[data-act=ready]').evaluate((e) => { e.disabled = false; });
          }
          // Pressed: a finger held on Identify (and on Ready in the lobby) paints darker and sits lower.
          for (const act of state === 'lobby' ? ['ready', 'identify'] : ['identify']) {
            const sel = `[data-act=${act}]`;
            const rest = await paint(page, sel);
            const b = await page.locator(sel).boundingBox();
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(150);
            const held = await paint(page, sel);
            assert.notEqual(held.filter, rest.filter, `${tag}: ${act} looks the same pressed`);
            assert.notEqual(held.transform, rest.transform, `${tag}: ${act} doesn't move when pressed`);
            await shot(page, `${tag}-${state}-pressed-${act}`);
            await page.mouse.up();
            await page.waitForTimeout(150);
          }
          // The launch pod is full when the launch is ready.
          const v = await page.locator('[data-hud=launch]').evaluate((e) => e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width);
          assert.ok(v > 0.9, `${tag} ${state}: the launch bar is ${(v * 100).toFixed(0)} % full while the launch is ready`);
          assert.deepEqual(errs, [], `${tag} ${state}: page errors`);
          await ctx.close();
        }
        // Ready on, and the launch cooling.
        for (const [state, frag] of [['ready-on', 'playing&round=lobby&ready=1'], ['cooling', 'playing&round=racing&boost=140&cool=0.6']]) {
          const { ctx, page, errs } = await open(browser, engine, size, frag);
          await page.waitForTimeout(250);
          if (state === 'cooling') {
            const v = await page.locator('[data-hud=launch]').evaluate((e) => e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width);
            assert.ok(v > 0.25 && v < 0.55, `${tag}: the cooling launch bar is ${(v * 100).toFixed(0)} % full, not ~40 %`);
            assert.ok(await page.locator('.pod-boost[data-cooling]').count(), `${tag}: the pod isn't marked cooling`);
          } else {
            assert.equal(await page.locator('[data-act=ready]').getAttribute('aria-pressed'), 'true');
          }
          await shot(page, `${tag}-${state}`);
          assert.deepEqual(errs, [], `${tag} ${state}: page errors`);
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
}
