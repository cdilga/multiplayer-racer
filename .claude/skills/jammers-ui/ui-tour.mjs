#!/usr/bin/env node
// jammers-ui's worked example: operate the real game UI on a live preview (or any served build) at TV and phone sizes and
// capture each state for someone to look at. The host on the TV (1920x1080, `host?room&test=live`), one phone in portrait
// (412x915) and one in landscape (915x412) joining through the real Join page, both readying, the race starting. It reads
// state through the pages' own surfaces (window.__jjNet / __jjRoom / __jjController / __jjTest), never by guessing.
//
//   node .claude/skills/jammers-ui/ui-tour.mjs <base url ending in /> <out dir>
//   e.g. node .claude/skills/jammers-ui/ui-tour.mjs https://jammers-preview.dilger.dev/p/v02-eceaeeb8/ /tmp/ui-tour
//
// Prints one line per capture and `ui-tour: PASS` (exit 0), or `ui-tour: FAIL <state>: <why>` (exit 1). Run it where
// browsers run (eris: scripts/remote/eris.sh --run <id> '… $JJ_RUN_DIR'), not on the Mac.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [base, out] = process.argv.slice(2);
if (!base?.endsWith('/') || !out) {
  console.log('usage: ui-tour.mjs <base url ending in /> <out dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
let state = 'start';
const fail = async (why) => {
  console.log(`ui-tour: FAIL ${state}: ${why}`);
  await browser.close();
  process.exit(1);
};
const until = (page, fn, ms = 60_000) => page.waitForFunction(fn, undefined, { timeout: ms, polling: 200 }).catch((e) => fail(e.message.split('\n')[0]));
const shot = async (page, name) => {
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
};

try {
  state = 'host lobby (TV 1920x1080)';
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`${base}host?room&test=live`);
  await until(tv, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  await shot(tv, 'tv-1920x1080-lobby-empty');
  const join = await tv.evaluate(() => window.__jjNet.joinUrl());

  const phones = [];
  for (const [name, w, h] of [['Davo', 412, 915], ['Shazza', 915, 412]]) {
    state = `${name} joins (phone ${w}x${h})`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const phone = await ctx.newPage();
    await phone.goto(join);
    await until(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
    await shot(phone, `phone-${w}x${h}-join`);
    await phone.locator('#name').fill(name);
    await phone.getByRole('button', { name: 'Join the race' }).click();
    await until(phone, () => window.__jjController.inspect().phase === 'playing');
    await shot(phone, `phone-${w}x${h}-joined`);
    phones.push(phone);
  }
  state = 'host lobby with two players';
  await until(tv, () => window.__jjRoom.view().seats.length === 2);
  await shot(tv, 'tv-1920x1080-lobby-two');

  state = 'both ready, the race starts';
  for (const p of phones) await p.getByRole('button', { name: /^Ready/ }).click();
  await until(tv, () => window.__jjRoom.view().phase === 'Running', 90_000);
  await tv.waitForTimeout(1500);
  await shot(tv, 'tv-1920x1080-race');
  for (const [i, p] of phones.entries()) await shot(p, `phone-${i ? '915x412' : '412x915'}-race`);
  console.log('ui-tour: PASS');
} catch (e) {
  await fail(e.message.split('\n')[0]);
}
await browser.close();
