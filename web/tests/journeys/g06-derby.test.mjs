// P1-G06: derby rounds end to end in a real room (jj-server, `host?room&test=live`).
// JN8: six controllers (five synthetic, one real phone over WebRTC) play a derby round in the bowl to results ranked by raw
//      points, and the next round starts on its own.
// JN9: a late joiner enters mid-derby at a safe edge pose, scores, and appears in the results.
// The host switches the next round between Race and Derby in the lobby (both run back to back), and no car leaves the bowl.
// JJ_CAPTURE_DIR=<dir> keeps the TV and phone stills for the self-review (docs/evidence/P1-G06/).
//   node --test web/tests/journeys/g06-derby.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/g06/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-G06');
let browser, server;
before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'g06'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frames = (host, list) => host.evaluate(async (list) => {
  for (const [endpoint, frame] of list) window.__jjTest.input({ type: 'controller', endpoint, frame });
  await window.__jjTest.step(1);
}, list);
const shot = async (page, name) => page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 80 });

/** One car rams another: placed 12 m back along the line between them, at 20 m/s into it. */
const ram = (host, by, into) => host.evaluate(async ({ by, into }) => {
  const s = window.__jjTest;
  const o = await s.observe();
  const a = o.cars.find((c) => c.car === by), b = o.cars.find((c) => c.car === into);
  const [dx, dz] = [b.position[0] - a.position[0], b.position[2] - a.position[2]];
  const d = Math.hypot(dx, dz) || 1;
  await s.command({ cmd: 'place', car: by, pose: { x: b.position[0] - (dx / d) * 12, y: b.position[1] + 0.3, z: b.position[2] - (dz / d) * 12, headingDeg: (Math.atan2(dx, dz) * 180) / Math.PI }, linvel: [(dx / d) * 20, 0, (dz / d) * 20] });
  await s.step(120);
}, { by, into });

/** Every car's distance from the bowl's centre (the arena is built round the origin) and its height. */
const inBowl = (host) => host.evaluate(async () => {
  const o = await window.__jjTest.observe();
  return { cars: o.cars.map((c) => ({ car: c.car, r: Math.hypot(c.position[0], c.position[2]), y: c.position[1] })) };
});

test('JN8 + JN9: a derby round in the bowl to results by raw points, a late joiner scores, the next round starts on its own, then Race again', { timeout: 600_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&mode=derby&derbyMs=40000`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  await host.evaluate(() => window.__jjTest.input({ type: 'ui', ui: 'intermission-ms:15000' }));
  // The lobby says the next round is a derby.
  await wait(host, () => window.__jjRoom.view().nextMode === 'derby' && document.querySelector('[data-act=mode][data-mode=derby]')?.getAttribute('aria-pressed') === 'true');
  // One real phone, over WebRTC.
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(joinUrl);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.locator('#name').fill('Davo');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  // Five synthetic controllers.
  const syn = ['s1', 's2', 's3', 's4', 's5'];
  for (const [k, e] of syn.entries()) await frames(host, [[e, { hello: true }], [e, { claim: `Racer ${k + 1}` }]]);
  await wait(host, () => window.__jjRoom.view().seats.length === 6);
  if (process.env.JJ_CAPTURE_DIR) await shot(host, 'tv-lobby-derby-1920x1080');
  const done = phone.locator('[data-act=car-done]');
  await done.waitFor({ state: 'visible', timeout: 15_000 }).then(() => done.click(), () => {});
  await phone.getByRole('button', { name: /^Ready/ }).click();
  await frames(host, syn.map((e) => [e, { ready: true }]));
  await wait(host, () => window.__jjRoom.view().phase === 'Running' && window.__jjRoom.view().mode === 'derby', undefined, 180_000);
  assert.equal((await host.evaluate(() => window.__jjRoom.view())).mode, 'derby');
  // Hold the clock and drive the round in steps (the derby is game time).
  await host.evaluate(() => window.__jjTest.hold(true));
  // Council review 2026-11-15 (N1a): 2.5 s after GO the Overview showed bare floor and one car. Every car drives off at
  // full throttle on its own line from GO, a frame drawn every 6 ticks; at 1, 3 and 10 s every car is inside the frame.
  const framing = await host.evaluate(async () => {
    const t = window.__jjTest, out = {};
    let o = await t.observe();
    const start = o.tick;
    for (let k = 0; k * 6 <= 10 * 120; k++) {
      for (const [i, c] of o.cars.entries()) {
        const seat = o.host.seats.find((s) => s.car === c.car);
        if (!seat?.endpoint?.startsWith('s')) continue;
        t.input({ type: 'controller', endpoint: seat.endpoint, frame: { state: { source: seat.source, seq: (o.tick + 1) & 0xffff, drive: [Math.round(((i % 3) - 1) * 0.35 * 32767), 32767], action: [0, 0] } } });
      }
      await t.step(6);
      window.__jjRender.frame();
      o = await t.observe();
      const s = (o.tick - start) / 120;
      for (const at of [1, 3, 10]) if (!out[at] && s >= at) out[at] = { s, cars: window.__jjRender.stats().cars, sim: o.cars.length, stats: window.__jjOverview.stats() };
    }
    return out;
  });
  for (const at of [1, 3, 10]) {
    const f = framing[at];
    assert.ok(f?.stats, `the Overview draws at ${at} s`);
    // The frame's own cars (CI 18229: the sim's count, read after the frame, was a car ahead of the drawn snapshot).
    assert.equal(f.stats.cars.length, f.cars, `every car is framed at ${at} s (sim ${f.sim})`);
    assert.ok(f.stats.cars.every((c) => c.inFrame), `every car inside the Overview frame at ${at} s: ${JSON.stringify(f.stats.cars.filter((c) => !c.inFrame))} frame ${JSON.stringify(f.stats.frame)}`);
  }
  // N1c: the strip is readable from the couch (>= 32 px at 1080p) and says what its numbers are.
  const strip = await host.evaluate(() => ({ band: window.__jjOverview.band(), text: document.querySelector('.jj-ov-band')?.textContent }));
  assert.ok(strip.band.fontPx >= 32, `the derby strip is at least 32 px at 1080p: ${JSON.stringify(strip)}`);
  assert.equal(strip.band.title, 'Damage dealt', `the strip is titled: ${JSON.stringify(strip)}`);
  assert.match(strip.text, /\d+ dmg/, `each standing counts damage: ${strip.text}`);
  // N1b: callouts in the Overview are one banner at a time, beside its car, never over a car or a name label.
  // The sim's clock is held: a real takedown (the derby bots ram) would put its own, newer banner up mid-check.
  await host.evaluate(() => window.__jjTest.hold(true));
  const banners = await host.evaluate(async () => {
    const o = await window.__jjTest.observe();
    const ids = o.cars.map((c) => c.car);
    const out = [];
    const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    for (const [k, car] of ids.entries()) {
      // Up for a minute, not the game's 2.2 s: three frames at 1080p under SwiftShader can outlast a real callout (CI run
      // 18117), and this checks where the banner sits, not how long it stays.
      const t0 = performance.now();
      window.__jjOverview.callout(car, 'Takedown', 60_000);
      // A second car scores while the first is still up: only the newest shows.
      if (k + 1 < ids.length) window.__jjOverview.callout(ids[k + 1], 'Takedown', 60_000);
      for (let f = 0; f < 3; f++) { window.__jjRender.frame(); await new Promise((r) => setTimeout(r, 16)); }
      const b = window.__jjOverview.banner(), st = window.__jjOverview.stats();
      const shown = [...document.querySelectorAll('.jj-callout-banner')].filter((e) => !e.hidden).length;
      const labels = [...document.querySelectorAll('.identity-nameplate')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
      out.push({ want: ids[k + 1] ?? car, b, shown, ms: Math.round(performance.now() - t0), carHit: b ? st.cars.filter((c) => overlap(b.rect, c.box) > 0).map((c) => c.car) : null, labelHit: b ? labels.filter((l) => overlap(b.rect, l) > 0).length : null, inFrame: b ? b.rect[0] >= st.frame.left - 0.5 && b.rect[2] <= st.frame.right + 0.5 && b.rect[1] >= st.frame.top - 0.5 && b.rect[3] <= st.frame.bottom + 0.5 : null });
    }
    return out;
  });
  for (const b of banners) {
    assert.ok(b.b && b.b.car === b.want && b.shown === 1, `one banner, the newest callout's: ${JSON.stringify(b)}`);
    assert.deepEqual(b.carHit, [], `the banner covers no car: ${JSON.stringify(b)}`);
    assert.equal(b.labelHit, 0, `the banner covers no name label: ${JSON.stringify(b)}`);
    assert.ok(b.inFrame, `the banner sits inside the gameplay frame: ${JSON.stringify(b)}`);
  }
  if (process.env.JJ_CAPTURE_DIR) await shot(host, 'tv-derby-10s-1920x1080');
  const cars = (await host.evaluate(async () => (await window.__jjTest.observe()).cars.map((c) => c.car)));
  assert.equal(cars.length, 6, 'six cars in the bowl');
  // Rams: car 1 into car 0, car 2 into car 3 (twice), car 4 into car 5.
  await ram(host, cars[1], cars[0]);
  await ram(host, cars[2], cars[3]);
  await ram(host, cars[2], cars[3]);
  await ram(host, cars[4], cars[5]);
  const mid = await host.evaluate(() => window.__jjRoom.view());
  const scored = mid.seats.filter((s) => s.derby && s.derby.points > 0);
  assert.ok(scored.length >= 2, `rams score raw points: ${JSON.stringify(mid.seats.map((s) => [s.number, s.derby]))}`);
  assert.ok(mid.derbyLeftMs > 0 && mid.derbyLeftMs <= 40_000, `the derby clock runs: ${mid.derbyLeftMs}`);
  // JN9: a late joiner drops in mid-derby, protected on the edge, and scores.
  await frames(host, [['late', { hello: true }], ['late', { claim: 'Late Lenny' }]]);
  await wait(host, () => window.__jjRoom.view().seats.some((s) => s.name === 'Late Lenny' && s.car !== null && s.car !== undefined), undefined, 30_000);
  const lateCar = await host.evaluate(() => window.__jjRoom.view().seats.find((s) => s.name === 'Late Lenny').car);
  await host.evaluate(() => window.__jjTest.step(3 * 120));
  // A target can itself be under spawn protection (wrecked earlier and back), and damage to it scores nothing (P1-S10):
  // the late joiner rams others until a hit counts, as a player would.
  let late;
  for (const target of [cars[1], cars[3], cars[0], cars[5]]) {
    await ram(host, lateCar, target);
    late = (await host.evaluate(() => window.__jjRoom.view())).seats.find((s) => s.name === 'Late Lenny');
    if (late.derby?.points > 0) break;
  }
  assert.ok(late.derby && late.derby.points > 0, `the late joiner scores: ${JSON.stringify(late)}`);
  if (process.env.JJ_CAPTURE_DIR) {
    await host.evaluate(async () => { for (let i = 0; i < 10; i++) { window.__jjRender.frame(); await new Promise((r) => setTimeout(r, 16)); } });
    await shot(host, 'tv-derby-running-1920x1080');
    await host.evaluate(() => window.__jjTest.hold(false));
    await wait(phone, () => /pts/.test(document.querySelector('[data-hud=lap]')?.textContent ?? ''), undefined, 15_000);
    await shot(phone, 'phone-derby-hud-844x390');
    await host.evaluate(() => window.__jjTest.hold(true));
  }
  // No car leaves the bowl: every car inside the arena's bowl (an arena for seven is ~30 m to its lip) and above its floor.
  const positions = await inBowl(host);
  for (const c of positions.cars) assert.ok(c.r < 45 && c.y > -2, `car ${c.car} stays in the bowl: ${JSON.stringify(c)}`);
  // The round ends on game time and ranks by raw points: stepped a second at a time until round 1 ends (not past it).
  for (let k = 0; k < 60 && (await host.evaluate(() => window.__jjRoom.view().phase)) === 'Running'; k++) await host.evaluate(() => window.__jjTest.step(120));
  await host.evaluate(() => window.__jjTest.hold(false));
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission' && document.querySelector('[data-screen=results]'), undefined, 60_000);
  const res = await host.evaluate(() => window.__jjRoom.view());
  assert.equal(res.round, 1, 'round 1\'s results');
  assert.equal(res.results.length, 7, `every seat, the late joiner included, is in the results: ${JSON.stringify(res.results)}`);
  assert.ok(res.results.some((r) => r.name === 'Late Lenny'), 'the late joiner appears in the results');
  assert.ok(res.results.every((r) => r.time_ms === null), 'a derby has no times');
  const byPlace = [...res.results].sort((a, b) => a.place - b.place);
  const pointsOf = (num) => res.seats.find((s) => s.number === num)?.derby?.points ?? 0;
  for (let i = 1; i < byPlace.length; i++) assert.ok(pointsOf(byPlace[i - 1].number) >= pointsOf(byPlace[i].number), `ranked by raw points: ${JSON.stringify(byPlace.map((r) => [r.number, r.place, pointsOf(r.number)]))}`);
  if (process.env.JJ_CAPTURE_DIR) await shot(host, 'tv-derby-results-1920x1080');
  // The next round starts on its own after the Intermission, still a derby; the host switches to Race for the one after.
  await host.evaluate(() => window.__jjTest.input({ type: 'ui', ui: 'mode:race' }));
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
  assert.equal((await host.evaluate(() => window.__jjRoom.view())).mode, 'race', 'the next round is the mode the host chose: Race');
  assert.deepEqual(errors, []);
});
