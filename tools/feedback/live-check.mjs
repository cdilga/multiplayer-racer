// A live check of player feedback (br-1s9h, R142) against a deployed build: opens a real room, sends one piece from the
// TV's footer button and one from a joined phone's settings (with the TV's picture), both saying TEST, to the REAL inbox.
// Prints the two feedback ids; mark them afterwards from the owner's local-multiplayer-games repo:
//   node tools/feedback.mjs mark <ids> wont_do --note test
// Not a CI test (the journey web/tests/journeys/feedback.test.mjs stubs the inbox). Run it by hand after a promote:
//   node tools/feedback/live-check.mjs https://jammers.dilger.dev/ [screenshot-dir]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [base, shots] = process.argv.slice(2);
if (!base || !/^https:\/\/.+\/$/.test(base)) {
  console.log('usage: live-check.mjs <base url ending in /> [screenshot-dir]');
  process.exit(2);
}
if (shots) mkdirSync(shots, { recursive: true });
const INBOX = 'https://games-feedback.dilger.dev';
const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const snap = (page, name) => (shots ? page.screenshot({ path: join(shots, `${name}.png`) }) : null);
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = null;
try {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostCtx.newPage();
  const tvUploads = [];
  host.on('response', (r) => {
    if (r.url().startsWith(`${INBOX}/api/feedback/`) && r.request().method() === 'POST') tvUploads.push({ url: r.url().slice(INBOX.length), status: r.status() });
  });
  await host.goto(`${base}host`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  const code = await host.evaluate(() => window.__jjNet.code());
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  console.log(`room ${code}`);

  // The TV.
  await snap(host, 'live-tv-lobby');
  const tvPost = host.waitForResponse((r) => r.url() === `${INBOX}/api/feedback` && r.request().method() === 'POST');
  await host.locator('.jj-foot [data-act=feedback]').click();
  await host.locator('[data-gfb=sheet]').waitFor({ timeout: 30_000 });
  const tvPicture = await host.locator('[data-gfb=include-shot]').count();
  await host.locator('[data-gfb=message]').fill('TEST: live check of the TV feedback button (an agent, not a player).');
  await snap(host, 'live-tv-sheet');
  await host.locator('[data-gfb=send]').click();
  const tv = await (await tvPost).json();
  await host.locator('[data-gfb=thanks]').waitFor();
  const tvThanks = await host.locator('[data-gfb=thanks]').innerText();
  console.log(`tv: ${tv.id} picture=${tvPicture === 1} "${tvThanks}" uploads=${JSON.stringify(tvUploads)}`);
  await host.locator('[data-gfb=root]').waitFor({ state: 'detached', timeout: 10_000 });

  // A phone, joined through the real join path.
  const phoneCtx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const phone = await phoneCtx.newPage();
  await phone.goto(joinUrl);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  const use = phone.locator('[data-overlay=cars] [data-act=car-done]');
  await use.waitFor({ timeout: 15_000 }).then(() => use.click()).catch(() => {});
  const skip = phone.getByRole('button', { name: 'Skip tutorial' });
  await skip.waitFor({ timeout: 15_000 }).then(() => skip.click()).catch(() => {});
  if (await use.isVisible().catch(() => false)) await use.click();
  await phone.locator('[data-act=settings]').click();
  const btn = phone.locator('.settings-body [data-act=feedback]');
  await btn.scrollIntoViewIfNeeded();
  const before = tvUploads.length;
  const phonePost = phone.waitForResponse((r) => r.url() === `${INBOX}/api/feedback` && r.request().method() === 'POST');
  await btn.click();
  await phone.locator('[data-gfb=sheet]').waitFor({ timeout: 30_000 });
  await wait(phone, () => document.querySelector('[data-gfb=include-tv]')?.closest('[data-tv]')?.dataset.tv, undefined, 30_000);
  const tvReady = await phone.evaluate(() => document.querySelector('[data-gfb=include-tv]').closest('[data-tv]').dataset.tv);
  const details = await phone.locator('[data-gfb=details]').innerText();
  await phone.locator('[data-gfb-kind=other]').click();
  await phone.locator('[data-gfb=message]').fill("TEST: live check of the phone's Send feedback with the TV's picture (an agent, not a player).");
  await snap(phone, 'live-phone-sheet');
  await phone.locator('[data-gfb=send]').click();
  const ph = await (await phonePost).json();
  await phone.locator('[data-gfb=thanks]').waitFor();
  for (let i = 0; i < 150 && tvUploads.length === before; i += 1) await host.waitForTimeout(100);
  const up = tvUploads.slice(before);
  console.log(`phone: ${ph.id} tv-picture=${tvReady} tv-uploaded=${JSON.stringify(up)} tv-sheet-shown=${await host.locator('[data-gfb=root]').count()}`);
  console.log(`phone details: ${details.replace(/\n+/g, ' | ')}`);
  if (tvPicture !== 1 || !tvUploads.slice(0, before).some((u) => u.status >= 200 && u.status < 300)) failed = 'the TV sent no picture with its own feedback';
  else if (tvReady !== 'ready' || !up.some((u) => u.url.includes(ph.id) && u.status >= 200 && u.status < 300)) failed = "the TV did not add its picture to the phone's feedback";
  console.log(`ids: ${tv.id} ${ph.id}`);
} catch (e) {
  failed = e.message;
} finally {
  await browser.close();
}
console.log(failed ? `feedback live check: FAIL ${failed}` : 'feedback live check: PASS');
process.exit(failed ? 1 : 0);
