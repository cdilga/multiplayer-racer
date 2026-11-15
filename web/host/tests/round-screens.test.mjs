// Artifacts default to OS scratch; set JJ_EVIDENCE_DIR / JJ_EVIDENCE / JJ_CAPTURE_DIR explicitly to recapture a committed receipt.
import { evidencePath } from '../../tests/lib/evidence.mjs';
// P1-R07 browser tests: the host's round screens and per-tile HUD, drawn from fixture room views (`host/?roundfixture=<kind>-<n>`,
// web/host/src/round/fixture-testing.ts) on the real web build in headless Chromium: no server, worker or players.
// Needs: scripts/build-host-wasm.sh && (cd web && npx vite build).
//   node --test web/host/tests/round-screens.test.mjs
// Writes the capture matrix (jpg) to docs/evidence/P1-R07/ (set JJ_EVIDENCE_DIR explicitly; default OS scratch); `JJ_NO_CAPTURES=1` skips it.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import jsQR from 'jsqr';
import { chromium } from 'playwright';
import { slotArgs } from '../../tests/journeys/lib/chromium.mjs';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = evidencePath('P1-R07');
const fixture = async (name) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const VP = { '1080p': [1920, 1080], '4k': [3840, 2160], '21x9': [3440, 1440], phone: [412, 915] };

let browser;
let server;
before(async () => {
  browser = await chromium.launch({ args: slotArgs });
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(spec, [width, height] = VP['1080p'], holdHud = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (holdHud) await page.addInitScript((n) => {
    // These assertions inspect layout, not frame rate. Stop after the real renderer places every HUD box, before
    // another 99-view software frame blocks the observation. The test explicitly draws the settled layout below.
    const placed = new MutationObserver(() => {
      if (document.querySelectorAll('.hud-tile[data-seat]').length !== n) return;
      window.__jjRender.hold();
      placed.disconnect();
    });
    placed.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-seat'] });
  }, Number(spec.split('-')[1]));
  const mode = await openHost(page, `${server.url}/host/?roundfixture=${spec}`);
  assert.equal(mode, 'fixture');
  page.errors = errors;
  return page;
}

/** Waits until the HUD has a box per tile (the grid has laid out and reported its rects). The tiles report after a drawn
 *  frame, and on a software rasteriser (CI's SwiftShader) a 99-tile frame takes seconds, more on a loaded runner: the wait
 *  scales with the tile count (these tests judge layout, not speed; frame cost is P1-Q01's). */
async function untilHud(page, n) {
  await page.waitForFunction((k) => document.querySelectorAll('.hud-tile[data-seat]').length === k, n, { timeout: Math.max(30_000, n * 900) });
}

/** Rects (CSS px) of every element matching `selector`, plus the viewport. */
const rects = (page, selector) =>
  page.evaluate((sel) => {
    const r = (e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, text: e.textContent };
    };
    return { vw: innerWidth, vh: innerHeight, list: [...document.querySelectorAll(sel)].map(r) };
  }, selector);

const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function assertLaidOut({ vw, vh, list }, n, label) {
  assert.equal(list.length, n, `${label}: every one of ${n} is drawn (no cap)`);
  for (const [i, r] of list.entries()) {
    assert.ok(r.w > 4 && r.h > 4, `${label}: card ${i} has a size`);
    assert.ok(r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= vw + 0.5 && r.y + r.h <= vh + 0.5, `${label}: card ${i} on screen (${JSON.stringify(r)} in ${vw}x${vh})`);
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${label}: cards ${i} and ${j} overlap`);
}

const noGame = (text, label) => assert.ok(!/\bgame(s)?\b/i.test(text), `${label}: copy never says "game" (R112): ${text.match(/.{0,30}\bgames?\b.{0,30}/i)?.[0]}`);

for (const [vpName, vp] of [['1080p', VP['1080p']], ['21x9', VP['21x9']], ['phone', VP.phone]]) {
  test(`${vpName}: the lobby lists every player at N = 1, 2, 8, 32 and 99, nothing overlapping or off screen`, async () => {
    const page = await open('lobby-1', vp);
    try {
      for (const n of [1, 2, 8, 32, 99]) {
        await page.evaluate((c) => window.__jjRoundFixture.set(window.__jjRoundFixture.make('lobby', c)), n);
        assertLaidOut(await rects(page, '.lcard'), n, `lobby N=${n} ${vpName}`);
        // Everything else on the screen is on screen too: the QR card and Start race.
        for (const sel of ['.qr-card', '[data-act=start]']) {
          const r = await rects(page, sel);
          assertLaidOut(r, 1, `lobby N=${n} ${vpName} ${sel}`);
        }
        // The cards never run into the QR column or the button.
        const cards = (await rects(page, '.lcard')).list;
        for (const sel of ['.qr-card', '[data-act=start]']) for (const c of cards) assert.ok(!overlap(c, (await rects(page, sel)).list[0]), `${sel} clear of cards`);
        noGame(await page.locator('body').innerText(), `lobby N=${n}`);
      }
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  });

  test(`${vpName}: results list every row in place order at N = 1, 2, 8, 32 and 99, nothing overlapping or off screen`, async () => {
    const page = await open('results-1', vp);
    try {
      for (const n of [1, 2, 8, 32, 99]) {
        await page.evaluate((c) => window.__jjRoundFixture.set(window.__jjRoundFixture.make('results', c)), n);
        const r = await rects(page, '[data-results] [data-row]');
        assertLaidOut(r, n, `results N=${n} ${vpName}`);
        const places = await page.$$eval('[data-results] [data-row]', (els) => els.map((e) => Number(e.dataset.place)));
        assert.deepEqual(places, Array.from({ length: n }, (_, i) => i + 1), `N=${n}: DOM order is place order`);
        for (const sel of ['.qr-card', '[data-act=start]', '[data-act=lobby]']) assertLaidOut(await rects(page, sel), 1, `results N=${n} ${vpName} ${sel}`);
        noGame(await page.locator('body').innerText(), `results N=${n}`);
      }
    } finally {
      await page.close();
    }
  });
}

test('results: countdown labels keep the Start button stationary; captions leave every placing and action visible', async () => {
  for (const vp of [[1280,720],[375,667],[412,915],[915,412]]) {
    const joinUrl='https://jammers-preview.dilger.dev/p/v02-cc9b2c81/j/ROO7';
    const page=await open(`results-2&joinfixture=${encodeURIComponent(joinUrl)}`,vp);
    try {
      await page.evaluate(() => document.fonts.ready);
      const bounds=await page.evaluate(async () => {
        const out=[];
        for(const seconds of [60,59,58,57,56,55,54,53,52,51,50,10,9,1]) {
          const room=window.__jjRoundFixture.make('results',2); room.remainingMs=seconds*1000;
          window.__jjRoundFixture.set(room);
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          out.push(document.querySelector('[data-act=start]').getBoundingClientRect().toJSON());
        }
        return out;
      });
      for(const b of bounds) for(const key of ['x','y','width','height'])
        assert.ok(Math.abs(b[key]-bounds[0][key])<.05,`${vp}: timer moved Start ${key}: ${JSON.stringify(bounds)}`);
      await page.evaluate(() => document.documentElement.style.setProperty('--jj-caption-space','64px'));
      await page.waitForTimeout(100);
      const rows=await rects(page,'[data-results] [data-row]');
      assertLaidOut(rows,2,`${vp}: caption placings`);
      const typeSize=await page.locator('[data-row]').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
      assert.ok(typeSize>=12,`${vp}: two placings retain readable text beside a caption (${typeSize}px)`);
      const actions=await rects(page,'.rs-join .qr-card, [data-act=start], [data-act=lobby]');
      assertLaidOut(actions,3,`${vp}: caption controls`);
      for(const row of rows.list) for(const action of actions.list) assert.ok(!overlap(row,action),'caption never collapses placings under the controls');
      assert.deepEqual(page.errors,[]);
    } finally {await page.close();}
  }
});

test('lobby: roster churn preserves Start and mode buttons through a real press, while labels and cards update', async () => {
  const page = await open('lobby-2', [1280, 720]);
  try {
    const button = page.locator('[data-act=start]');
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const same = await page.evaluate(() => {
      const start = document.querySelector('[data-act=start]');
      const modes = [...document.querySelectorAll('[data-act=mode]')];
      const room = window.__jjRoundFixture.make('lobby', 2);
      room.seats[0].ready = true;
      room.seats[1].ready = false;
      room.seats[1].unpluggedMs = 5000;
      window.__jjRoundFixture.set(room);
      return { start: start === document.querySelector('[data-act=start]'), modes: modes.every(b => b.isConnected) };
    });
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.__jjRoundFixture.inputs()), [{ type: 'ui', ui: 'start' }], 'a roster update between down and up does not lose Start');
    assert.deepEqual(same, { start: true, modes: true });
    assert.match(await page.locator('.lb-head .tag').innerText(), /2 in the room · 1 ready/i);
    assert.match(await page.locator('.lcard[data-seat="2"]').innerText(), /Unplugged 5s/i);
    await page.evaluate(() => {
      const room = window.__jjRoundFixture.make('lobby', 0);
      room.nextMode = 'derby'; room.derbyMs = 180_000;
      window.__jjRoundFixture.set(room);
    });
    assert.equal(await button.isDisabled(), true, 'an emptied lobby cannot start');
    assert.equal(await button.textContent(), 'Start derby');
    assert.equal(await page.locator('[data-mode=derby]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('[data-start-hint]').innerText(), /Scan to join/);
    await page.evaluate(() => {
      const room = window.__jjRoundFixture.make('lobby', 3);
      room.nextMode = 'derby'; room.derbyMs = 180_000;
      window.__jjRoundFixture.set(room);
    });
    assert.equal(await button.isDisabled(), false);
    assert.match(await page.locator('[data-start-hint]').innerText(), /3 min in the bowl/);
    assert.equal(await button.locator('svg.bb').count(), 1, 'changing the label preserves the brush');
    assert.equal(await page.locator('.lcard').count(), 3, 'new arrivals still get cards');
    await page.locator('[data-mode=race]').click();
    assert.deepEqual(await page.evaluate(() => window.__jjRoundFixture.inputs()), [{ type: 'ui', ui: 'start' }, { type: 'ui', ui: 'mode:race' }], 'updates do not duplicate action handlers');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

// Council review 2026-11-15: the armed lobby never said who it was waiting for, away seats counted as in the room, and a host
// pad's car choice was only in the controls strip (scrolled away past two host seats). The hint names the first seat holding
// the start; the header counts away seats; a seat still choosing shows the car it is on in its own card, at full and name tiers.
test('lobby: says who the start waits for, counts away seats, and shows the car a seat is browsing', async () => {
  const page = await open('lobby-3', [1366, 768]);
  try {
    const set = (patch) => page.evaluate((patch) => {
      const room = window.__jjRoundFixture.make('lobby', patch.n ?? 3);
      room.armed = true;
      room.seats.forEach((s, i) => Object.assign(s, { ready: true, presence: 'Active', unpluggedMs: null, vehicle: null, choosing: false }, patch.seats?.[i] ?? {}));
      window.__jjRoundFixture.set(room);
    }, patch);
    await set({ seats: [{}, { ready: false, name: 'Bruce', unpluggedMs: 4000 }, { ready: false }] });
    assert.match(await page.locator('[data-waiting]').innerText(), /^Waiting for #2 Bruce \(unplugged\) \+ 1 more$/);
    assert.match(await page.locator('.lb-head .tag').innerText(), /3 in the room · 1 ready · 1 away/i);
    await set({ seats: [{}, {}, { ready: false, name: 'Sheila', vehicle: 'cruz-missile', choosing: true }] });
    assert.match(await page.locator('[data-waiting]').innerText(), /^Waiting for #3 Sheila$/);
    assert.doesNotMatch(await page.locator('.lb-head .tag').innerText(), /away/i);
    assert.match(await page.locator('.lcard[data-seat="3"]').innerText(), /‹ Cruz Missile ›/, 'full tier: the browsed car');
    await set({ seats: [] });
    assert.equal(await page.locator('[data-waiting]').isHidden(), true, 'everyone ready: nobody is waited for');
    // A smaller card tier (name) still names the browsed car in place of its tick.
    await set({ n: 24, seats: [{ ready: false, vehicle: 'cruz-missile', choosing: true }] });
    const tier = await page.locator('.lb-roster').getAttribute('data-tier');
    if (tier === 'name' || tier === 'full') assert.match(await page.locator('.lcard[data-seat="1"]').innerText(), /‹ Cruz Missile ›/, `${tier} tier`);
    else assert.fail(`24 seats at 1366x768 drew the ${tier} tier; pick a count that draws the name tier`);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('Ready states: every card says whether the player is ready; a ready player is told so in words', async () => {
  const room = await fixture('lobby-8');
  const page = await open('lobby-8');
  try {
    await page.evaluate((r) => window.__jjRoundFixture.set(r), room);
    const cards = await page.$$eval('.lcard', (els) => els.map((e) => ({ seat: Number(e.dataset.seat), ready: e.dataset.ready, text: e.innerText })));
    assert.equal(cards.length, 8);
    for (const c of cards) {
      const seat = room.seats.find((s) => s.seat === c.seat);
      assert.equal(c.ready, String(seat.ready), `seat ${c.seat}`);
      assert.match(c.text, seat.ready ? /ready/i : /choosing/i);
    }
    assert.ok(cards.some((c) => c.ready === 'false') && cards.some((c) => c.ready === 'true'), 'the fixture has both');
    // At N = 99 the words become ticks, but every card still carries its state.
    const big = await open('lobby-99');
    try {
      const n = await big.$$eval('.lcard[data-ready]', (els) => els.length);
      assert.equal(n, 99);
      assert.ok((await big.$$eval('.lcard[data-ready=true]', (e) => e.length)) > 0 && (await big.$$eval('.lcard[data-ready=false]', (e) => e.length)) > 0);
    } finally {
      await big.close();
    }
  } finally {
    await page.close();
  }
});

// Council review 2026-11-15 (#9, #12): back in the lobby the room's points vanished, and a bots-only lobby greyed Start
// with "Scan to join" as its only word. The head names the leader and every card its place and points once a round has
// counted (a seat that joined since starts on 0); with bots alone the hint says why Start is off.
const BOTS = [{ skill: 1, assist: 0, position: null }, { skill: 0, assist: 1, position: null }, { skill: 2, assist: 0, position: null }];
test('lobby: the room\'s running points after a round, and why bots alone cannot start', async () => {
  const page = await open('lobby-4', [1366, 768]);
  try {
    assert.equal(await page.locator('[data-standings]').isHidden(), true, 'no round played: no standings');
    assert.equal(await page.locator('.lb-pts').count(), 0);
    await page.evaluate((bots) => {
      const room = window.__jjRoundFixture.make('lobby', 5);
      room.round = 2; room.seats[1].name = 'Davo'; room.botList = bots;
      // Seat 5 joined after the last round: no row yet. A seat that left keeps its row but has no card.
      room.standings = [{ seat: 9, place: 1, points: 60, wins: 2 }, { seat: 2, place: 2, points: 53, wins: 1 }, { seat: 4, place: 3, points: 41, wins: 0 }, { seat: 1, place: 4, points: 30, wins: 0 }, { seat: 3, place: 5, points: 22, wins: 0 }];
      window.__jjRoundFixture.set(room);
    }, BOTS);
    assert.equal(await page.locator('[data-standings]').innerText(), 'After round 2: #2 Davo leads on 53 pts', 'the leader here, not the one who left');
    const pts = await page.$$eval('.lcard[data-seat]', (els) => els.map((e) => [Number(e.dataset.seat), e.querySelector('.lb-pts')?.getAttribute('aria-label')]));
    assert.deepEqual(pts, [[1, '4th, 30 points'], [2, '2nd, 53 points'], [3, '5th, 22 points'], [4, '3rd, 41 points'], [5, '0 points']]);
    assert.equal(await page.locator('.lcard.bot .lb-pts').count(), 0, 'bots score no points');
    await page.evaluate((bots) => {
      const room = window.__jjRoundFixture.make('lobby', 0);
      room.botList = bots;
      window.__jjRoundFixture.set(room);
    }, BOTS);
    assert.equal(await page.locator('[data-act=start]').isDisabled(), true);
    assert.match(await page.locator('[data-start-hint]').innerText(), /^Needs at least one player: bots don't count\s+Scan to join/);
    await page.evaluate(() => window.__jjRoundFixture.set(window.__jjRoundFixture.make('lobby', 0)));
    assert.match(await page.locator('[data-start-hint]').innerText(), /^Scan to join/, 'an empty room just says how to join');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

// Council review 2026-11-15 (#4, #11): at 915x412 (a phone held sideways) seven placings under the vote were slivers and
// the lobby's hints ran under the footer; at 1080p the footer and hint lines were ~22-24 px. Placings stay legible rows
// clear of the vote and buttons, every shown hint is above the footer, and 1080p text is >= 28 px in the same 5 % band.
test('phone-size host: seven placings beside the vote stay legible rows, lobby hints clear the footer; couch-size text at 1080p', async () => {
  const sevenWithVote = (bots) => {
    const room = window.__jjRoundFixture.make('results', 4);
    room.results = room.results.map((r, i) => ({ ...r, place: [1, 3, 4, 6][i] }));
    room.botList = bots;
    room.botResults = [{ index: 0, place: 2, timeMs: 93_000 }, { index: 1, place: 5, timeMs: 97_000 }, { index: 2, place: 7, timeMs: 99_000 }];
    room.between = { active: true, resultsLeftMs: 0, voteOpen: true, voteLeftMs: 12_000, votes: { rematch: 1, new: 2, surprise: 0 }, bySeat: {}, leading: 'new', hostChoice: null, decided: null, flyoverLeftMs: null, flyoverMs: 6000, resultsMs: 8000, voteMs: 15_000 };
    return room;
  };
  for (const vp of [[915, 412], [1366, 768], [1920, 1080]]) {
    const page = await open('lobby-4', vp);
    try {
      await page.evaluate(() => document.fonts.ready);
      for (const n of [0, 4]) {
        await page.evaluate((n) => window.__jjRoundFixture.set(window.__jjRoundFixture.make('lobby', n)), n);
        const foot = (await rects(page, '.jj-foot')).list[0];
        const hints = await page.$$eval('.lobby .lb-hint', (els) => els.filter((e) => e.checkVisibility() && e.textContent).map((e) => ({ b: e.getBoundingClientRect().bottom, t: e.textContent })));
        assert.ok(hints.length >= 1);
        for (const h of hints) assert.ok(h.b <= foot.y + 0.5, `${vp} lobby N=${n}: "${h.t}" ends at ${h.b}, footer starts at ${foot.y}`);
        if (vp[1] === 1080) {
          assert.ok(Math.abs(foot.h - 54) < 1, `the footer band stays 5 % of 1080 (${foot.h})`);
          const sizes = await page.evaluate(() => [...document.querySelectorAll('.foot-count, .foot-code, .lobby .lb-hint')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
          for (const px of sizes) assert.ok(px >= 28, `1080p status and hint text >= 28 px (${sizes})`);
        }
      }
      await page.evaluate(`window.__jjRoundFixture.set((${sevenWithVote})(${JSON.stringify(BOTS)}))`);
      await page.waitForTimeout(100);
      const rows = await rects(page, '[data-results] [data-row]');
      assertLaidOut(rows, 7, `${vp} results 7 + vote`);
      const fontPx = await page.locator('[data-results] [data-row]').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      for (const r of rows.list) assert.ok(r.h >= 30 && r.w >= 200, `${vp}: a placing is a readable row, not a sliver (${JSON.stringify(r)})`);
      assert.ok(fontPx >= 12, `${vp}: placing text ${fontPx}px`);
      const actions = await rects(page, '.rs-join .qr-card, [data-vote], [data-act=start], [data-act=lobby]');
      assertLaidOut(actions, 4, `${vp} results actions`);
      for (const row of rows.list) for (const a of actions.list) assert.ok(!overlap(row, a), `${vp}: placings clear of the vote and buttons`);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  }
});

test('the lobby QR decodes to the join URL after downscaling to what a phone sees from 3 m (module >= 4 px at 1080p)', async () => {
  for (const [vpName, vp, expectModulePx] of [['1080p', VP['1080p'], 4], ['4k', VP['4k'], 4], ['phone', VP.phone, 3]]) {
    for (const spec of ['lobby-8', 'results-8']) {
      const page = await open(spec, vp);
      try {
        const box = await page.locator('.qr-card .qr').boundingBox();
        const modules = await page.evaluate(() => {
          const img = document.querySelector('.qr-card .qr');
          return Number(/viewBox="0 0 (\d+)/.exec(decodeURIComponent(img.src))?.[1]);
        });
        const modulePx = box.width / modules;
        assert.ok(modulePx >= expectModulePx, `${spec} ${vpName}: ${modulePx.toFixed(2)} px per module`);
        // Screenshot the QR card, then scale to exactly 4 px per module (what a phone resolves at 3 m) and decode.
        const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
        const px = await page.evaluate(
          async ([b64, side]) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = c.height = side;
            const g = c.getContext('2d');
            g.imageSmoothingQuality = 'high';
            g.fillStyle = '#fff';
            g.fillRect(0, 0, side, side);
            // A phone also sees the paper around the code: pad it with the quiet zone's colour.
            g.drawImage(img, 0, 0, side, side);
            return [...g.getImageData(0, 0, side, side).data];
          },
          [png.toString('base64'), Math.round(modules * Math.min(4, modulePx))],
        );
        const side = Math.round(modules * Math.min(4, modulePx));
        const got = jsQR(Uint8ClampedArray.from(px), side, side);
        assert.equal(got?.data, `${new URL(server.url).origin}/j/ROO7`, `${spec} ${vpName}: decoded`);
      } finally {
        await page.close();
      }
    }
  }
});

test('countdown shows 3, 2, 1, then GO when the race starts', async () => {
  const page = await open('countdown-8-3');
  try {
    const seen = [];
    for (const name of ['countdown-8-3', 'countdown-8-2', 'countdown-8-1']) {
      await page.evaluate((r) => window.__jjRoundFixture.set(r), await fixture(name));
      seen.push(await page.locator('[data-screen=countdown]').getAttribute('data-count'));
      assert.match(await page.locator('[data-screen=countdown] .cd-num').innerText(), /^\d$/);
    }
    assert.deepEqual(seen, ['3', '2', '1']);
    await page.evaluate((r) => window.__jjRoundFixture.set(r), await fixture('race-8'));
    assert.equal(await page.locator('[data-screen=countdown]').getAttribute('data-count'), 'GO');
    assert.match(await page.locator('[data-screen=countdown] .cd-num').innerText(), /GO/);
    await page.waitForFunction(() => !document.querySelector('[data-screen=countdown]'), null, { timeout: 5000 });
    noGame(await page.locator('body').innerText(), 'countdown');
  } finally {
    await page.close();
  }
});

test('results: 32 rows in place order, the buttons send the host commands, the timer ticks without redrawing', async () => {
  const room = await fixture('results-32');
  const page = await open('results-32');
  try {
    await page.evaluate((r) => window.__jjRoundFixture.set(r), room);
    const rows = await page.$$eval('[data-results] [data-row]', (els) => els.map((e) => [Number(e.dataset.place), Number(e.dataset.number)]));
    assert.equal(rows.length, 32);
    assert.deepEqual(rows.map((r) => r[0]), room.results.map((r) => r.place));
    assert.deepEqual(rows.map((r) => r[1]), room.results.map((r) => r.number));
    const first = await page.$('[data-results] [data-row]');
    await page.evaluate((r) => window.__jjRoundFixture.set({ ...r, remainingMs: 41_000 }), room);
    assert.match(await page.locator('[data-next]').innerText(), /41/);
    assert.ok(await first.evaluate((e) => e.isConnected), 'the list was not rebuilt by a timer tick');
    await page.getByRole('button', { name: 'Start next round now' }).click();
    await page.getByRole('button', { name: 'Return to lobby' }).click();
    const inputs = await page.evaluate(() => window.__jjRoundFixture.inputs());
    assert.deepEqual(inputs, [{ type: 'ui', ui: 'start' }, { type: 'ui', ui: 'end' }]);
  } finally {
    await page.close();
  }
});

for (const n of [1, 2, 8, 32, 99]) {
  test(`per-tile HUD at N = ${n} sits inside each tile and shows that seat's number, position and lap`, async () => {
    const page = await open(`race-${n}`, VP['1080p'], true);
    try {
      await untilHud(page, n);
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__jjRender.frame());
      const res = await page.evaluate(() => {
        const render = window.__jjRender;
        const scale = render.stats().dpr * (render.stats().scale ?? 1);
        const room = window.__jjRoundFixture.make('race', document.querySelectorAll('.hud-tile[data-seat]').length);
        const tiles = render.tileRects();
        return {
          scale,
          tiles,
          room,
          // The page's text, read in this same round trip: at N = 99 on a software rasteriser (CI's SwiftShader) the main
          // thread is backed up behind multi-second frames, and locator.innerText's own extra round trips ran past 30 s on a
          // loaded runner (CI run 1954). Same text, one wait.
          text: document.body.innerText,
          boxes: [...document.querySelectorAll('.hud-tile[data-seat]')].map((e) => {
            const r = e.getBoundingClientRect();
            const inner = (sel) => {
              const x = e.querySelector(sel);
              if (!x || x.hidden || getComputedStyle(x).display === 'none') return null;
              const b = x.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height, text: x.textContent.trim() };
            };
            return { tile: Number(e.dataset.tile), seat: Number(e.dataset.seat), x: r.x, y: r.y, w: r.width, h: r.height, badge: inner('.hud-badge'), pos: inner('.hud-pos'), lap: inner('.hud-lap'), name: inner('.hud-name'), tr: inner('.hud-tr') };
          }),
        };
      });
      assert.equal(res.boxes.length, n);
      const dpr = res.tiles.length ? res.scale : 1;
      for (const b of res.boxes) {
        const t = res.tiles.find((x) => x.seat === b.tile);
        assert.ok(t, `tile ${b.tile} exists`);
        const tr = { x: t.x / dpr, y: t.y / dpr, w: t.w / dpr, h: t.h / dpr };
        const inside = (r) => r.x >= tr.x - 1.5 && r.y >= tr.y - 1.5 && r.x + r.w <= tr.x + tr.w + 1.5 && r.y + r.h <= tr.y + tr.h + 1.5;
        assert.ok(inside(b), `HUD box ${b.tile} within its tile`);
        const seat = res.room.seats.find((s) => s.car + 1 === b.tile);
        assert.equal(b.seat, seat.number, `tile ${b.tile} shows seat ${seat.number}`);
        assert.equal(b.badge.text, `#${seat.number}`);
        assert.ok(inside(b.badge), `badge ${b.tile} inside the tile`);
        assert.ok(b.tr && inside(b.tr), `position and lap ${b.tile} inside the tile`);
        assert.match(b.pos.text, new RegExp(`^${seat.position}(st|nd|rd|th)$`), `tile ${b.tile} position`);
        assert.equal(b.lap.text, `Lap ${seat.laps + 1}/${res.room.laps}`, `tile ${b.tile} lap`);
        if (b.name) assert.ok(inside(b.name), `name ${b.tile} inside the tile`);
        // Badge top-left, position top-right of the same tile.
        assert.ok(b.badge.x < b.tr.x, 'number left of the place');
      }
      // The HUD boxes never overlap each other.
      for (let i = 0; i < res.boxes.length; i++) for (let j = i + 1; j < res.boxes.length; j++) assert.ok(!overlap(res.boxes[i], res.boxes[j]), `HUD ${i}/${j} overlap`);
      noGame(res.text, `race N=${n}`);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  });
}

test('captures: lobby, countdown, race and results across sizes and counts (docs/evidence/P1-R07)', { skip: process.env.JJ_NO_CAPTURES === '1', timeout: 600_000 }, async () => {
  await mkdir(evidenceDir, { recursive: true });
  const matrix = [
    ...[1, 2, 8, 32, 99].flatMap((n) => ['lobby', 'race', 'results'].map((k) => [`${k}-${n}`, '1080p'])),
    ['countdown-8-3', '1080p'],
    ['countdown-8-1', '1080p'],
    ...['lobby-32', 'race-8', 'results-32', 'results-8', 'countdown-8-3'].map((s) => [s, '4k']),
    ...['lobby-32', 'lobby-99', 'race-8', 'results-32', 'results-99'].map((s) => [s, '21x9']),
    ...['lobby-8', 'lobby-32', 'lobby-99', 'race-8', 'race-32', 'results-8', 'results-32', 'countdown-8-3'].map((s) => [s, 'phone']),
  ];
  for (const [spec, vpName] of matrix) {
    const page = await open(spec, VP[vpName]);
    try {
      if (spec.startsWith('race') || spec.startsWith('countdown')) await untilHud(page, Number(spec.split('-')[1]));
      await page.waitForTimeout(spec.startsWith('countdown') ? 200 : 700);
      await page.screenshot({ path: join(evidenceDir, `${spec}@${vpName}.jpg`), type: 'jpeg', quality: 82 });
    } finally {
      await page.close();
    }
  }
});
