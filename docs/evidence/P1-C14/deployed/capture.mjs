// P1-C14 deployed check: the published preview's Host menu → Controllers, the lobby hint, and a phone's Help → Controls,
// at TV, laptop and a phone-sized host, with a resize. Real preview, real jj-server, Playwright Chromium on eris.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.PREVIEW;
const OUT = '/tmp/c14dep';
mkdirSync(OUT, { recursive: true });
const { chromiumArgs } = await import(`${process.cwd()}/web/tests/journeys/lib/chromium.mjs`);
const browser = await chromium.launch({ args: chromiumArgs });
const log = (...a) => console.log(...a);
for (const [w, h, name] of [[1920, 1080, 'tv'], [1366, 768, 'laptop'], [412, 915, 'phonehost']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const host = await ctx.newPage();
  host.on('pageerror', (e) => log('PAGEERROR', name, e.message));
  try {
    await host.goto(`${BASE}host`, { waitUntil: 'load' });
    await host.waitForFunction(() => document.querySelector('[data-act=menu]') && document.querySelector('.jj-foot-code, [data-foot-code]'), undefined, { timeout: 90000 });
    await host.waitForTimeout(2000);
    await host.screenshot({ path: `${OUT}/lobby-hint-${name}-${w}x${h}.jpg`, type: 'jpeg', quality: 80 });
    const hint = await host.evaluate(() => [...document.querySelectorAll('*')].map((e) => e.childElementCount === 0 ? e.textContent : '').find((t) => /pad or keyboard/i.test(t ?? '')) ?? null);
    log(name, 'lobby hint:', JSON.stringify(hint));
    await host.locator('[data-act=menu]').click();
    await host.locator('[data-act=controllers]').click();
    await host.waitForTimeout(800);
    await host.screenshot({ path: `${OUT}/host-menu-controllers-${name}-${w}x${h}.jpg`, type: 'jpeg', quality: 80 });
    const panel = await host.evaluate(() => {
      const p = document.querySelector('[data-controllers-slot]') ?? document.querySelector('[data-controllers-panel]');
      const btns = [...document.querySelectorAll('.jj-menu button')].map((b) => b.textContent.trim()).filter(Boolean);
      return { has: !!p, buttons: btns.slice(0, 30) };
    });
    log(name, 'controllers:', JSON.stringify(panel));
    // Add Keys A from the menu, then Control mappings.
    const add = host.locator('.jj-menu button', { hasText: /^Add/ }).first();
    if (await add.count()) { await add.click(); await host.waitForTimeout(800); }
    await host.screenshot({ path: `${OUT}/host-menu-controllers-added-${name}-${w}x${h}.jpg`, type: 'jpeg', quality: 80 });
    const map = host.locator('.jj-menu button.btn[data-act=controls]').last();
    if (await map.count()) { await map.click(); await host.waitForTimeout(800); await host.screenshot({ path: `${OUT}/host-menu-mappings-${name}-${w}x${h}.jpg`, type: 'jpeg', quality: 80 }); }
    // Resize with the menu open.
    await host.setViewportSize({ width: h, height: w > h ? Math.round(w * 0.75) : w });
    await host.waitForTimeout(800);
    await host.screenshot({ path: `${OUT}/host-menu-resized-from-${name}.jpg`, type: 'jpeg', quality: 80 });
    if (name === 'tv') {
      await host.keyboard.press('Escape');
      await host.keyboard.press('Escape');
      const joinUrl = await host.evaluate(() => window.__jjNet?.joinUrl?.() ?? null);
      log('join', joinUrl);
      if (joinUrl) {
        const pctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
        const phone = await pctx.newPage();
        phone.on('pageerror', (e) => log('PAGEERROR phone', e.message));
        await phone.goto(joinUrl);
        await phone.waitForFunction(() => window.__jjController?.inspect().phase === 'ready-to-join', undefined, { timeout: 60000 });
        await phone.getByRole('button', { name: 'Join the race' }).click();
        await phone.waitForFunction(() => window.__jjController.inspect().phase === 'playing', undefined, { timeout: 60000 });
        const done = phone.locator('[data-act=car-done]');
        await done.waitFor({ state: 'visible', timeout: 15000 }).then(() => done.click(), () => {});
        await phone.waitForFunction(() => window.__jjTutorial?.inspect()?.open === true, undefined, { timeout: 30000 }).catch(async () => { await phone.screenshot({ path: `${OUT}/phone-no-tutorial-844x390.jpg`, type: 'jpeg', quality: 80 }); log('phone state', JSON.stringify(await phone.evaluate(() => ({ t: window.__jjTutorial?.inspect?.() ?? null, c: window.__jjController?.inspect()?.phase, btns: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 20) })))); });
        await phone.screenshot({ path: `${OUT}/phone-help-steps-844x390.jpg`, type: 'jpeg', quality: 80 });
        await phone.locator('[data-act=controls]').click();
        await phone.waitForTimeout(600);
        log('phone page', await phone.evaluate(() => window.__jjTutorial.inspect().page));
        await phone.screenshot({ path: `${OUT}/phone-help-controls-844x390.jpg`, type: 'jpeg', quality: 80 });
        await pctx.close();
      }
    }
  } catch (e) { log('ERR', name, e.message.slice(0, 300)); await host.screenshot({ path: `${OUT}/err-${name}.jpg`, type: 'jpeg', quality: 70 }).catch(() => {}); }
  await ctx.close();
}
await browser.close();
