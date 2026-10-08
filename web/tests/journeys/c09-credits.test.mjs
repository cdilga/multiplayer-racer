// P1-C09: the Credits and licences page opens from the landing page and from the host menu under `/` and `/p/<id>/`, lists
// the team, inspirations, fonts, music, voice and reference sources, and every shipped third-party licence from the
// generated list, and makes no off-origin request. JJ_CAPTURE_DIR saves the device/state matrix.
//   node --test web/tests/journeys/c09-credits.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const licences = JSON.parse(readFileSync(resolve(here, '../../landing/credits/licences.json'), 'utf8'));
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const BASES = ['/', '/p/c09/'];
const sites = {};
let browser;

before(async () => {
  browser = await chromium.launch({ args: chromiumArgs });
  const dist = build('./', 'c09');
  for (const base of BASES) sites[base] = await serve(dist, base, { JJ_STUN_URLS: '' });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  for (const s of Object.values(sites)) await s.close();
});
closeContextsAfterEach(() => browser);

const SIZES = { 'phone-portrait-390x844': [390, 844], 'phone-landscape-844x390': [844, 390], 'tv-1920x1080': [1920, 1080] };

/** A page that records every request that isn't this origin's or isn't under the base. */
async function watched(base, viewport = { width: 390, height: 844 }) {
  const page = await (await browser.newContext({ viewport, hasTouch: true })).newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  page.on('request', (r) => {
    if (r.url().startsWith('data:') || r.url().startsWith('blob:')) return;
    if (!r.url().startsWith(sites[base].origin)) problems.push(`off-origin request: ${r.url()}`);
    else if (!new URL(r.url()).pathname.startsWith(base)) problems.push(`outside the base ${base}: ${r.url()}`);
  });
  return { page, problems };
}

async function checkPage(page, base) {
  assert.equal(new URL(page.url()).pathname, `${base}credits`);
  await page.waitForFunction(() => document.documentElement.dataset.jjCredits === 'ready');
  const text = await page.locator('main').innerText();
  for (const h of ['The team', 'Inspirations', 'Fonts', 'Music', 'The announcer', 'Reference photos and signs', 'Shader kit', 'Third-party licences']) {
    assert.ok(new RegExp(h, 'i').test(text), `has the "${h}" section`);
  }
  assert.match(text, /Chris Dilger/);
  assert.match(text, /SIL Open Font License/);
  assert.match(text, /YuE2/);
  assert.match(text, /CC BY-NC 4\.0/);
  assert.match(text, /Qwen3-TTS/);
  assert.match(text, /Wikimedia Commons/);
  assert.match(text, /webgpu-threejs-tsl/);
  // Every shipped dependency of the generated list is on the page, with its licence.
  assert.equal(await page.locator('#lic-web tbody tr').count(), licences.web.length);
  assert.equal(await page.locator('#lic-rust tbody tr').count(), licences.rust.length);
  const three = licences.web.find((e) => e.name === 'three');
  assert.match(await page.locator('#lic-web tbody tr', { hasText: 'three' }).first().innerText(), new RegExp(three.licence));
  assert.match(await page.locator('#lic-rust tbody tr', { hasText: 'asupersync' }).first().innerText(), /Rider/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal overflow');
  assert.equal(await page.evaluate(() => document.fonts.check('900 italic 32px "Barlow Condensed"')), true, 'the self-hosted font loaded');
}

for (const base of BASES) {
  test(`the landing page's Credits link opens the page under ${base}`, { timeout: 90_000 }, async () => {
    const { page, problems } = await watched(base);
    await page.goto(sites[base].origin + base, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Credits and licences' }).click();
    await checkPage(page, base);
    // Back goes to the landing page under the same base.
    await page.getByRole('link', { name: 'Back to Joystick Jammers' }).click();
    assert.equal(new URL(page.url()).pathname, base);
    assert.deepEqual(problems, []);
  });
}

test('the host menu has a Credits link that opens the page under the base, with no off-origin request', { timeout: 120_000 }, async () => {
  const base = '/p/c09/';
  const { page: host, problems } = await watched(base, { width: 1280, height: 720 });
  await host.goto(`${sites[base].origin}${base}host?room&test=live`);
  await host.waitForFunction(() => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, { timeout: 60_000 });
  await host.locator('[data-act=menu]').click();
  const link = host.locator('[data-credits]');
  assert.equal(await link.getAttribute('href'), `${base}credits`);
  const [credits] = await Promise.all([host.context().waitForEvent('page'), link.click()]);
  await credits.waitForLoadState();
  await checkPage(credits, base);
  assert.equal(problems.filter((p) => !/ice|stun|turn|api\/v1/i.test(p)).length, 0, JSON.stringify(problems));
});

test('captures: the page at phone, TV and full-screen sizes, and after a resize', { timeout: 120_000 }, async () => {
  const base = '/';
  const { page, problems } = await watched(base);
  await page.goto(`${sites[base].origin}${base}credits`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.jjCredits === 'ready');
  const shot = (name, full = false) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png`, fullPage: full });
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    await shot(`credits-${label}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${label}: no horizontal overflow`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#c-lic').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot('credits-licences-phone-portrait-390x844');
  await page.locator('.c-text summary').click();
  await page.locator('#c-fonts').scrollIntoViewIfNeeded();
  await shot('credits-fonts-licence-open-390x844');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await shot('credits-resized-back-1280x720');
  assert.deepEqual(problems, []);
});
