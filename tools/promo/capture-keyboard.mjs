// The host's Keys & pads drawer in a real room lobby: keyboard clusters and pads join from the host's own keyboard.
// Served as the public site so the QR card and footer name jammers.dilger.dev, not the capture server.
//   JJ_PROMO_BUILD=web/dist-test/promo-grow JJ_PROMO_CAPTURE=/tmp/jj-promo3-keyboard node tools/promo/capture-keyboard.mjs
import { chromium } from 'playwright';
import { build, serve } from '../../web/landing/tests/lib/site.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.JJ_PROMO_CAPTURE ?? '/tmp/jj-promo3-keyboard';
mkdirSync(out, { recursive: true });
const server = await serve(process.env.JJ_PROMO_BUILD ?? build('./', 'promo-keyboard'), '/p/promo/', { JJ_STUN_URLS: '', JJ_PUBLIC_ORIGIN: 'https://jammers.dilger.dev' });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(120000);
try {
  await page.goto(`${server.origin}/p/promo/host?room&test=live&look=on&res=1&autores=off`);
  await page.waitForFunction(() => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  await page.waitForTimeout(1500);
  // A keyboard player joins the real way: a press on a key cluster (P1-C05), then Host menu -> Controllers.
  await page.keyboard.press('KeyW');
  await page.waitForFunction(() => window.__jjRoom.view().seats.some((s) => s.local), undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, 'lobby-keys.jpg'), type: 'jpeg', quality: 93 });
  await page.locator('.jj-foot [data-act=menu]').click();
  await page.getByRole('button', { name: 'Controllers', exact: true }).click().catch((e) => console.log('no Controllers button', e.message));
  // Keys A joins through its own Add button (a headless page has no key focus for the W press above).
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.waitForFunction(() => window.__jjRoom.view().seats.some((s) => s.local), undefined, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, 'controllers-menu.jpg'), type: 'jpeg', quality: 93 });
  const seats = await page.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ number: s.number, name: s.name, local: s.local })));
  writeFileSync(join(out, 'capture.json'), JSON.stringify({ origin: 'https://jammers.dilger.dev (JJ_PUBLIC_ORIGIN)', seats, how: 'KeyW press on the host keyboard, then Host menu -> Controllers' }, null, 2));
  console.log(JSON.stringify(seats));
} finally {
  await browser.close();
  await server.close();
}
