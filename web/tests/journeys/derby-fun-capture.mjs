// br-bhkz (owner 2026-11-17, the derby fun pass): the stills for the self-reviews, from a real room (jj-server,
// `host?room&test=live&mode=derby`), not a test. A TV (1920x1080), a phone in landscape (915x412), a phone upright
// (412x915) and four synthetic controllers play a derby: the countdown's how-to-win, the Overview's strip with every
// car's health, a staged T-bone and what it earned on the TV and the phones, the grid tiles, each new weapon in play and
// close up (a fitted roo bar, a lit bunger and its blast, a magpie in flight, the boxes that hold them), and the arena.
//   JJ_CAPTURE_DIR=<dir> [JJ_CHROMIUM_CHANNEL=chrome JJ_CHROMIUM_GPU=native] node web/tests/journeys/derby-fun-capture.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/derby-fun/';
const out = process.env.JJ_CAPTURE_DIR;
if (!out) throw new Error('set JJ_CAPTURE_DIR to where the stills go');
mkdirSync(out, { recursive: true });
// JJ_BASE_URL=https://jammers-preview.dilger.dev/p/<id>/ captures a published preview (what the owner opens) instead of a
// local build.
const remote = process.env.JJ_BASE_URL ? `${process.env.JJ_BASE_URL.replace(/\/$/, '')}/` : null;
const server = remote ? null : await serve(process.env.JJ_DIST ?? build('./', 'derby-fun'), BASE, { JJ_STUN_URLS: '' });
const base = remote ?? `${server.origin}${BASE}`;
// JJ_CHROMIUM_CHANNEL=chrome uses the machine's own Chrome (a Mac without Playwright's browsers installed).
const browser = await chromium.launch({ args: chromiumArgs, channel: process.env.JJ_CHROMIUM_CHANNEL || undefined });
const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = async (page, name) => {
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 72 });
  console.log(`captured ${name}.jpg`);
};
const errors = [];
try {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  host.on('pageerror', (e) => errors.push(`host: ${e.message}`));
  await host.goto(`${base}host?room&test=live&mode=derby&derbyMs=180000`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const join1 = async (name, viewport) => {
    const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport })).newPage();
    phone.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await phone.goto(joinUrl);
    await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
    await phone.locator('#name').fill(name);
    await phone.getByRole('button', { name: 'Join the race' }).click();
    await wait(phone, () => window.__jjController.inspect().phase === 'playing');
    return phone;
  };
  const wide = await join1('Davo', { width: 915, height: 412 });
  const tall = await join1('Shazza', { width: 412, height: 915 });
  const frames = (list) => host.evaluate(async (list) => {
    for (const [endpoint, frame] of list) window.__jjTest.input({ type: 'controller', endpoint, frame });
    await window.__jjTest.step(1);
  }, list);
  const syn = ['s1', 's2', 's3', 's4'];
  for (const [k, e] of syn.entries()) await frames([[e, { hello: true }], [e, { claim: `Racer ${k + 1}` }]]);
  await wait(host, () => window.__jjRoom.view().seats.length === 6);
  for (const phone of [wide, tall]) {
    const done = phone.locator('[data-act=car-done]');
    await done.waitFor({ state: 'visible', timeout: 15_000 }).then(() => done.click(), () => {});
    await phone.getByRole('button', { name: /^Ready/ }).click();
  }
  await frames(syn.map((e) => [e, { ready: true }]));
  // The last three seconds: the number over the tips.
  await wait(host, () => window.__jjRoom.view().phase === 'Countdown' && !!document.querySelector('[data-derby-tips]') && ['2', '3'].includes(document.querySelector('[data-screen=countdown]')?.dataset.count ?? ''), undefined, 180_000);
  await shot(host, 'tv-1920x1080-countdown-tips');
  await wait(host, () => window.__jjRoom.view().phase === 'Running' && window.__jjRoom.view().mode === 'derby', undefined, 60_000);
  // Hold the clock: the round is driven in steps from here, a frame drawn after each.
  await host.evaluate(() => window.__jjTest.hold(true));
  const step = (ticks) => host.evaluate(async (ticks) => {
    await window.__jjTest.step(ticks);
    window.__jjRender.frame();
  }, ticks);
  /** Waits `ms` with a frame drawn every 50 ms (the held page draws only when asked: a camera change needs its frames). */
  const settle = async (ms = 500) => {
    for (let t = 0; t < ms; t += 50) {
      await host.evaluate(() => document.documentElement.classList.contains('peek') || window.__jjRender.frame());
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const carOf = (name) => host.evaluate((name) => window.__jjRoom.view().seats.find((s) => s.name === name)?.car, name);
  const [davo, shazza] = [await carOf('Davo'), await carOf('Shazza')];
  /** The world canvas alone, from `eye` looking at `target` (m): a close look at a piece of the scene. */
  await host.addStyleTag({ content: 'html.peek body * { visibility: hidden !important; } html.peek canvas { visibility: visible !important; }' });
  const peek = async (name, eye, target, fov = 40) => {
    await host.evaluate(({ eye, target, fov }) => {
      document.documentElement.classList.add('peek');
      window.__jjRender.peek(eye, target, fov);
    }, { eye, target, fov });
    await settle(300);
    await shot(host, name);
    await host.evaluate(() => {
      document.documentElement.classList.remove('peek');
      window.__jjRender.frame();
    });
  };
  const poseOf = (car) => host.evaluate(async (car) => {
    const c = (await window.__jjTest.observe()).cars.find((c) => c.car === car);
    return { p: c.position, h: (c.headingDeg * Math.PI) / 180 };
  }, car);
  // Three seconds in: protection has ended and every fresh car has been handed its item.
  await step(360);
  await settle();
  await shot(host, 'tv-1920x1080-overview-start');
  await shot(wide, 'phone-915x412-derby-start');
  await shot(tall, 'phone-412x915-derby-start');
  // The arena from above its rim, and the boxes close up.
  await peek('arena-from-the-rim', [0, 46, 62], [0, 0, 0], 50);
  const boxes = await host.evaluate(async () => (await window.__jjTest.observe()).items?.stations?.slice(0, 40).map((s) => s.position) ?? []);
  if (boxes.length) {
    const b = boxes[Math.floor(boxes.length / 2)];
    await peek('boxes-close-up', [b[0] + 7, b[1] + 4.5, b[2] + 7], b, 45);
    // A wider look across the floor: one of every print somewhere in it.
    await peek('boxes-wide', [b[0] + 16, b[1] + 9, b[2] + 16], b, 50);
  }
  // Davo T-bones Shazza on a clear stretch of the flat rim, a third of the way round from the grid: she stands nose to
  // the middle, he comes along the rim 12 m off at 16 m/s into her door.
  const rim = await host.evaluate(async ({ by, into }) => {
    const s = window.__jjTest;
    const a = (await s.observe()).cars.find((c) => c.car === by);
    const r = Math.hypot(a.position[0], a.position[2]);
    const th = Math.atan2(a.position[2], a.position[0]) + 2.1;
    const [cx, cz] = [Math.cos(th), Math.sin(th)];
    // Along the rim (the tangent), and the heading that faces the middle.
    const [tx, tz] = [-cz, cx];
    const at = [cx * r, cz * r];
    // With the clock held the phones read as dropped out and the autopilot drives their cars: both are placed at once,
    // 7 m apart, so she has no time to drive off before he arrives.
    await s.command({ cmd: 'place', car: into, pose: { x: at[0], y: 0.1, z: at[1], headingDeg: (Math.atan2(-cx, -cz) * 180) / Math.PI }, linvel: [0, 0, 0] });
    await s.command({ cmd: 'place', car: by, pose: { x: at[0] - tx * 7, y: 0.1, z: at[1] - tz * 7, headingDeg: (Math.atan2(tx, tz) * 180) / Math.PI }, linvel: [tx * 16, 0, tz * 16] });
    return { at, t: [tx, tz] };
  }, { by: davo, into: shazza });
  await step(60);
  console.log('t-bone', JSON.stringify(await host.evaluate(async ({ by, into }) => {
    const o = await window.__jjTest.observe();
    const brief = (c) => ({ speed: +c.forwardSpeed.toFixed(1), points: c.derby?.points, parts: c.parts.filter((p) => p.health < 100 && p.part !== 'core').map((p) => `${p.part}:${Math.round(p.health)}`).join(' ') });
    return { rammer: brief(o.cars.find((c) => c.car === by)), rammed: brief(o.cars.find((c) => c.car === into)) };
  }, { by: davo, into: shazza })));
  // The phones hear their HUD ten times a second: a few more ticks, and time for it to arrive.
  await step(24);
  await settle(900);
  await settle(700);
  await shot(host, 'tv-1920x1080-overview-t-bone');
  await shot(wide, 'phone-915x412-derby-hit');
  await shot(tall, 'phone-412x915-derby-rammed');
  // The grid: every tile with its car's health and what its hit earned.
  await host.evaluate(() => window.__jjOverview.set('grid'));
  await step(20);
  await settle(800);
  await shot(host, 'tv-1920x1080-grid-hit');
  // Davo's weapons, one at a time. Whatever he holds is used up first, well away from the others.
  const give = (item, forward = true) => host.evaluate(async ({ car, item, forward }) => {
    const s = window.__jjTest;
    for (let k = 0; k < 2; k++) await s.command({ cmd: 'utility', car, forward: false });
    await s.step(2);
    const got = await s.command({ cmd: 'pickupItem', car, item });
    const used = await s.command({ cmd: 'utility', car, forward });
    return { got: got.accepted, used: used.outcome };
  }, { car: davo, item, forward });
  // Davo alone on the far side of the rim, so each weapon is seen by itself.
  await host.evaluate(async ({ car, at, t }) => {
    const s = window.__jjTest;
    const r = Math.hypot(at[0], at[1]);
    const th = Math.atan2(at[1], at[0]) + 2.1;
    const [cx, cz] = [Math.cos(th), Math.sin(th)];
    await s.command({ cmd: 'place', car, pose: { x: cx * r, y: 0.3, z: cz * r, headingDeg: (Math.atan2(-cz, cx) * 180) / Math.PI }, linvel: [0, 0, 0] });
    await s.step(60);
    void t;
  }, { car: davo, at: rim.at, t: rim.t });
  // A roo bar on his nose.
  console.log('roo bar', JSON.stringify(await give('roo-bar')));
  await step(12);
  await settle(600);
  await shot(host, 'tv-1920x1080-grid-roo-bar');
  await shot(wide, 'phone-915x412-roo-bar');
  {
    const { p, h } = await poseOf(davo);
    const [fx, fz] = [Math.sin(h), Math.cos(h)];
    await peek('roo-bar-close-up', [p[0] + fx * 6 + fz * 3.5, p[1] + 2.4, p[2] + fz * 6 - fx * 3.5], [p[0] + fx * 1.5, p[1] + 0.7, p[2] + fz * 1.5], 35);
  }
  // A bunger: lit where it landed, then its blast.
  console.log('bunger', JSON.stringify(await give('bunger')));
  await step(70);
  const lit = await host.evaluate(async () => (await window.__jjTest.observe()).items?.bungers?.at(-1)?.position ?? null);
  await settle(400);
  await shot(host, 'tv-1920x1080-grid-bunger-lit');
  if (lit) await peek('bunger-close-up', [lit[0] + 4, lit[1] + 2.2, lit[2] + 4], [lit[0], lit[1] + 0.4, lit[2]], 35);
  await step(44);
  await settle(250);
  await shot(host, 'tv-1920x1080-grid-bunger-blast');
  if (lit) await peek('bunger-blast-from-above', [lit[0] + 14, lit[1] + 16, lit[2] + 14], lit, 45);
  // A magpie on its way to whoever is winning.
  await step(120);
  console.log('magpie', JSON.stringify(await give('magpie')));
  await step(30);
  const bird = await host.evaluate(async () => (await window.__jjTest.observe()).items?.magpies?.at(-1) ?? null);
  await settle(400);
  await shot(host, 'tv-1920x1080-grid-magpie');
  if (bird?.position) {
    const [b, d] = [bird.position, bird.heading];
    await peek('magpie-close-up', [b[0] + d[2] * 5 - d[0] * 2, b[1] + 2, b[2] - d[0] * 5 - d[2] * 2], b, 35);
  }
  await host.evaluate(() => window.__jjOverview.set('overview'));
  await step(6);
  await settle(700);
  await shot(host, 'tv-1920x1080-overview-magpie');
  // A minute of everyone on the autopilot: the strip and the phones mid-carnage.
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  for (let k = 0; k < 10; k++) await step(360);
  await settle(800);
  await shot(host, 'tv-1920x1080-overview-carnage');
  await shot(wide, 'phone-915x412-derby-carnage');
  await shot(tall, 'phone-412x915-derby-carnage');
  await host.evaluate(() => window.__jjOverview.set('grid'));
  await step(12);
  await settle(800);
  await shot(host, 'tv-1920x1080-grid-carnage');
  // The next wreck somebody caused: its tile's banner says who.
  const wrecked = await host.evaluate(async () => {
    for (let k = 0; k < 600; k++) {
      await window.__jjTest.step(12);
      const s = window.__jjRoom.view().seats.find((s) => s.wreckMs > 300 && s.wreckBy !== null && s.wreckBy !== undefined);
      if (s) return { number: s.number, by: s.wreckBy, why: s.wreckWhy };
    }
    return null;
  });
  console.log('wrecked', JSON.stringify(wrecked));
  await settle(500);
  if (wrecked) await shot(host, 'tv-1920x1080-grid-wrecked-by');
  // The same round on a laptop and a small phone (a resize mid-round, both ways up).
  await host.setViewportSize({ width: 1366, height: 768 });
  // A phone that went full screen on Ready leaves it first (a full-screen window can't be resized).
  for (const [phone, size] of [[wide, { width: 667, height: 375 }], [tall, { width: 375, height: 667 }]]) {
    await phone.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
    await phone.setViewportSize(size).catch((e) => console.log(`resize refused: ${e.message.split('\n')[0]}`));
  }
  await step(24);
  await settle(900);
  await shot(host, 'laptop-1366x768-grid');
  await shot(wide, 'phone-667x375-derby');
  await shot(tall, 'phone-375x667-derby');
  await host.evaluate(() => window.__jjOverview.set('overview'));
  await step(12);
  await settle(900);
  await shot(host, 'laptop-1366x768-overview');
  const facts = await host.evaluate(async () => {
    const o = await window.__jjTest.observe();
    return { tick: o.tick, bungers: o.items?.bungers?.length ?? 0, magpies: o.items?.magpies?.length ?? 0, seats: window.__jjRoom.view().seats.map((s) => ({ n: s.number, name: s.name, derby: s.derby, inv: s.inventory })) };
  });
  console.log(JSON.stringify(facts));
} finally {
  await browser.close();
  await server?.close();
}
if (errors.length) {
  console.error(`page errors:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else console.log('derby-fun-capture: PASS');
