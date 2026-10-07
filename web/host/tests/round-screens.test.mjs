// P1-R07 browser tests: the host's round screens and per-tile HUD, drawn from fixture room views (`host/?roundfixture=<kind>-<n>`,
// web/host/src/round/fixture-testing.ts) on the real web build in headless Chromium: no server, worker or players.
// Needs: scripts/build-host-wasm.sh && (cd web && npx vite build).
//   node --test web/host/tests/round-screens.test.mjs
// Writes the capture matrix (jpg) to docs/evidence/P1-R07/ (JJ_EVIDENCE_DIR overrides); `JJ_NO_CAPTURES=1` skips it.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import jsQR from 'jsqr';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R07');
const JOIN_URL = 'https://jammers.dilger.dev/j/ROO7';
const fixture = async (name) => JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const VP = { '1080p': [1920, 1080], '4k': [3840, 2160], '21x9': [3440, 1440], phone: [412, 915] };

let browser;
let server;
before(async () => {
  browser = await chromium.launch();
  server = await serve(join(repo, 'web/dist'));
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(spec, [width, height] = VP['1080p']) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const mode = await openHost(page, `${server.url}/host/?roundfixture=${spec}`);
  assert.equal(mode, 'fixture');
  page.errors = errors;
  return page;
}

/** Waits until the HUD has a box per tile (the grid has laid out and reported its rects). */
async function untilHud(page, n) {
  await page.waitForFunction((k) => document.querySelectorAll('.hud-tile[data-seat]').length === k, n, { timeout: 30_000 });
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
        assert.equal(got?.data, JOIN_URL, `${spec} ${vpName}: decoded`);
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
    const page = await open(`race-${n}`);
    try {
      await untilHud(page, n);
      await page.waitForTimeout(400);
      const res = await page.evaluate(() => {
        const render = window.__jjRender;
        const scale = render.stats().dpr * (render.stats().scale ?? 1);
        const room = window.__jjRoundFixture.make('race', document.querySelectorAll('.hud-tile[data-seat]').length);
        const tiles = render.tileRects();
        return {
          scale,
          tiles,
          room,
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
      noGame(await page.locator('body').innerText(), `race N=${n}`);
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
