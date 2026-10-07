// P1-R07 / P1-G07 browser tests: the host's footer, pause flow, End/Disband/Remove confirmations, the diagnostics overlay,
// the HUD's boost and wreck fields, the pre-race HUD and the results caption, on fixture room views (`host/?roundfixture=`).
// Run on eris (no browsers on the Mac): needs the web build (npx vite build; JJ_DIST overrides web/dist).
//   node --test web/host/tests/chrome.test.mjs
// Captures go to docs/evidence/P1-R07 (JJ_EVIDENCE_DIR overrides); JJ_NO_CAPTURES=1 skips them.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R07');
const VP = { '1080p': [1920, 1080], '4k': [3840, 2160], '21x9': [3440, 1440], phone: [412, 915], 'phone-landscape': [915, 412] };
let browser;
let server;
before(async () => {
  browser = await chromium.launch();
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(spec, [width, height] = VP['1080p'], dpr = 1) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  assert.equal(await openHost(page, `${server.url}/host/?roundfixture=${spec}`), 'fixture');
  return page;
}
const inputs = (page) => page.evaluate(() => window.__jjRoundFixture.inputs());
const box = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return b && { x: b.x, y: b.y, w: b.width, h: b.height };
};
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const capture = async (page, name) => {
  if (process.env.JJ_NO_CAPTURES === '1') return;
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, `${name}.jpg`), type: 'jpeg', quality: 82 });
};
const untilHud = (page, n) => page.waitForFunction((k) => document.querySelectorAll('.hud-tile[data-seat]').length === k, n, { timeout: 30_000 });

test('footer: the host menu, room code and domain, count and diagnostics sit in the bottom margin, clear of every tile and card', async () => {
  for (const [name, vp] of Object.entries(VP)) {
    const page = await open('lobby-8', vp);
    try {
      const f = await box(page, '.jj-foot');
      assert.ok(f.x === 0 && Math.abs(f.y + f.h - vp[1]) < 1, `${name}: footer on the bottom edge`);
      assert.ok(f.h >= 29 && f.h <= vp[1] * 0.06 + 31, `${name}: footer height ${f.h}`);
      for (const sel of ['[data-act=menu]', '[data-foot-code]', '[data-foot-count]', '[data-act=diagnostics]']) {
        const b = await box(page, `.jj-foot ${sel}`);
        if (!b && sel === '[data-foot-count]' && vp[0] < vp[1]) continue; // portrait: the count is in the lobby head
        assert.ok(b && b.x >= 0 && b.x + b.w <= vp[0] + 0.5 && b.y >= f.y - 0.5 && b.y + b.h <= f.y + f.h + 0.5, `${name}: ${sel} inside the footer`);
      }
      for (const sel of ['.lobby', '.qr-card', '[data-act=start]']) assert.ok(!overlap(await box(page, sel), f), `${name}: ${sel} clear of the footer`);
      for (const c of await page.locator('.lcard').all()) {
        const r = await c.boundingBox();
        assert.ok(!overlap({ x: r.x, y: r.y, w: r.width, h: r.height }, f), `${name}: a card clear of the footer`);
      }
      assert.match(await page.locator('[data-foot-code]').innerText(), /ROO7/);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  }
});

test('footer: in a race the tiles stay above it (the grid keeps its bottom safe margin)', async () => {
  const page = await open('race-8');
  try {
    await untilHud(page, 8);
    const f = await box(page, '.jj-foot');
    for (const t of await page.locator('.hud-tile[data-seat]').all()) {
      const b = await t.boundingBox();
      assert.ok(b.y + b.height <= f.y + 0.5, 'tile ends above the footer');
    }
    assert.equal((await page.locator('[data-act=menu]').innerText()).trim(), 'Pause');
  } finally {
    await page.close();
  }
});

test('pause flow: the menu pauses a race first, Resume lifts it; End round and Disband room each ask, with different words', async () => {
  const page = await open('race-8');
  try {
    await untilHud(page, 8);
    await page.locator('[data-act=menu]').click();
    assert.ok(await page.locator('.jj-menu').isVisible());
    assert.deepEqual(await inputs(page), [{ type: 'ui', ui: 'pause', on: true }]);
    assert.match(await page.locator('.mn-panel h2').innerText(), /paused/i);
    await capture(page, 'menu-race-8@1080p');
    // End round: its own confirmation.
    await page.getByRole('button', { name: 'End round' }).click();
    const endText = await page.locator('[data-confirm=end]').innerText();
    assert.match(endText, /end this round/i);
    assert.ok(!/disband/i.test(endText));
    assert.equal((await inputs(page)).length, 1, 'asking sends nothing');
    await capture(page, 'confirm-end@1080p');
    await page.getByRole('button', { name: 'Keep racing' }).click();
    assert.ok(await page.locator('[data-menu]').isVisible(), 'back to the menu');
    // Disband room: another confirmation, naming the code.
    await page.getByRole('button', { name: 'Disband room' }).click();
    const disbandText = await page.locator('[data-confirm=disband]').innerText();
    assert.match(disbandText, /disband the room/i);
    assert.match(disbandText, /ROO7/);
    assert.ok(!/end this round/i.test(disbandText));
    await capture(page, 'confirm-disband@1080p');
    await page.keyboard.press('Escape'); // Escape backs out of a confirmation
    assert.ok(await page.locator('[data-menu]').isVisible());
    assert.equal((await inputs(page)).length, 1, 'nothing sent by backing out');
    // Confirm End round.
    await page.getByRole('button', { name: 'End round' }).click();
    await page.getByRole('button', { name: 'End round' }).last().click();
    assert.deepEqual((await inputs(page)).slice(1), [{ type: 'ui', ui: 'end' }, { type: 'ui', ui: 'pause', on: false }]);
    assert.ok(!(await page.locator('.jj-menu').isVisible()));
    // Open again: Resume lifts the pause; Disband confirms to disband + the network hook.
    await page.locator('[data-act=menu]').click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.locator('[data-act=menu]').click();
    await page.getByRole('button', { name: 'Disband room' }).click();
    await page.getByRole('button', { name: 'Disband room' }).last().click();
    const sent = await inputs(page);
    assert.ok(sent.some((i) => i.ui === 'disband'));
    assert.equal(await page.evaluate(() => window.__jjRoundFixture.disbands()), 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('lobby and intermission: the menu has Disband but no End round, and does not pause anything', async () => {
  for (const spec of ['lobby-4', 'results-4']) {
    const page = await open(spec);
    try {
      await page.locator('[data-act=menu]').click();
      assert.equal(await page.getByRole('button', { name: 'End round' }).count(), 0, spec);
      assert.equal(await page.getByRole('button', { name: 'Disband room' }).count(), 1, spec);
      assert.match(await page.locator('.mn-panel h2').innerText(), /host menu/i);
      assert.deepEqual(await inputs(page), [], `${spec}: nothing sent by opening`);
      await page.keyboard.press('Escape');
      assert.ok(!(await page.locator('.jj-menu').isVisible()));
    } finally {
      await page.close();
    }
  }
});

test('Remove (G07): from the menu list and from a lobby card, after a confirmation naming the player; backing out sends nothing', async () => {
  const page = await open('lobby-8');
  try {
    // A lobby card opens the confirmation directly.
    await page.locator('.lcard[data-number="3"]').click();
    const text = await page.locator('[data-confirm=remove]').innerText();
    assert.match(text, /remove #3/i);
    await capture(page, 'confirm-remove@1080p');
    await page.getByRole('button', { name: 'Keep them' }).click();
    assert.deepEqual(await inputs(page), []);
    // The menu's player list (the way during a race) lists every player with a Remove button.
    assert.equal(await page.locator('[data-players] li[data-seat]').count(), 8);
    await page.locator('[data-players] li[data-number="5"] [data-act=ask-remove]').click();
    assert.match(await page.locator('[data-confirm=remove]').innerText(), /remove #5/i);
    await page.getByRole('button', { name: 'Remove player' }).click();
    assert.deepEqual(await inputs(page), [{ type: 'ui', ui: 'remove-seat:5' }]);
    // The room view drops the seat: the list and card follow.
    await page.evaluate(() => {
      const r = window.__jjRoundFixture.make('lobby', 8);
      window.__jjRoundFixture.set({ ...r, seats: r.seats.filter((s) => s.seat !== 5) });
    });
    assert.equal(await page.locator('[data-players] li[data-seat]').count(), 7);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.lcard').count(), 7);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('Remove (G07) mid-race: the menu pauses the race, a removal leaves the pause on until Resume', async () => {
  const page = await open('race-8');
  try {
    await untilHud(page, 8);
    await page.locator('[data-act=menu]').click();
    await page.locator('[data-players] li[data-number="2"] [data-act=ask-remove]').click();
    assert.match(await page.locator('[data-confirm=remove]').innerText(), /debris stays/i);
    await page.getByRole('button', { name: 'Remove player' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    assert.deepEqual(await inputs(page), [{ type: 'ui', ui: 'pause', on: true }, { type: 'ui', ui: 'remove-seat:2' }, { type: 'ui', ui: 'pause', on: false }]);
  } finally {
    await page.close();
  }
});

test('diagnostics: room code, direct or relay and RTT per seat, no addresses', async () => {
  const page = await open('race-8');
  try {
    await untilHud(page, 8);
    await page.evaluate(() => {
      const p = (kind, rttMs, protocol = 'udp', relayProtocol = null) => ({ local: kind, remote: kind, kind, protocol, relayProtocol, rttMs });
      window.__jjRoundFixture.setPaths({ 'ep-1': p('host', 3), 'ep-2': p('srflx', 18), 'ep-3': p('coturn-relay', 61, 'udp', 'udp'), 'ep-4': p('cloudflare-relay', 95, 'udp', 'udp'), 'ep-5': null, 'ep-9': p('host', 7) });
    });
    await page.locator('[data-act=diagnostics]').click();
    await page.waitForFunction(() => document.querySelectorAll('.jj-diag tr[data-seat]').length === 8, null, { timeout: 5000 });
    const rows = await page.$$eval('.jj-diag tr[data-seat]', (els) => els.map((e) => ({ seat: Number(e.dataset.seat), path: e.querySelector('[data-path]').textContent, rtt: e.querySelector('[data-rtt]').textContent })));
    assert.equal(rows[0].path.startsWith('Direct'), true);
    assert.equal(rows[0].rtt, '3 ms');
    assert.match(rows[1].path, /^Direct/);
    assert.match(rows[2].path, /^Relay \(coturn\)/);
    assert.equal(rows[2].rtt, '61 ms');
    assert.match(rows[3].path, /^Relay \(Cloudflare\)/);
    assert.equal(rows[4].path, 'connecting');
    assert.equal(await page.locator('[data-diag-code]').innerText(), 'ROO7');
    const text = await page.locator('.jj-diag').innerText();
    assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text) && !/ep-\d/.test(text), 'no addresses or endpoint ids');
    assert.match(text, /Viewer 1/, 'a path with no seat is still listed');
    await capture(page, 'diagnostics-race-8@1080p');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.locator('.jj-diag').isVisible()));
  } finally {
    await page.close();
  }
});

test('HUD: boost meter and wreck countdown render from the room view; pre-race tiles show no place or lap', async () => {
  const page = await open('race-8');
  try {
    await untilHud(page, 8);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => [...document.querySelectorAll('.hud-tile[data-seat]')].map((e) => {
      const b = e.querySelector('.hud-boost');
      const c = e.querySelector('.hud-centre');
      return { seat: Number(e.dataset.seat), boostHidden: b.hidden, boost: b.dataset.boost, width: b.firstElementChild.style.width, wreckHidden: c.hidden, wreck: e.querySelector('.cd').textContent };
    }));
    const room = await page.evaluate(() => window.__jjRoundFixture.make('race', 8));
    for (const r of res) {
      const s = room.seats.find((x) => x.number === r.seat);
      assert.equal(r.boostHidden, false);
      assert.equal(r.width, `${Math.round((s.boost / 255) * 100)}%`, `seat ${r.seat} boost`);
      assert.equal(r.wreckHidden, !(s.wreckMs > 0), `seat ${r.seat} wreck banner`);
      if (s.wreckMs > 0) assert.equal(r.wreck, '3', 'ceil(2.4 s)');
    }
    assert.ok(res.some((r) => !r.wreckHidden) && res.some((r) => r.wreckHidden), 'the fixture has both');
    await capture(page, 'race-8-boost-wreck@1080p');
    // Before the lights: the countdown phase shows tiles with no "1st / Lap 1/1" pill.
    await page.evaluate(() => window.__jjRoundFixture.set(window.__jjRoundFixture.make('countdown', 8, 3)));
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.hud-tile[data-seat] .hud-tr:not([hidden])').count(), 0, 'no place or lap in the countdown');
    // ...and back once the race runs.
    await page.evaluate(() => window.__jjRoundFixture.set(window.__jjRoundFixture.make('race', 8)));
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.hud-tile[data-seat] .hud-tr:not([hidden])').count(), 8);
  } finally {
    await page.close();
  }
});

test('results: the next-race caption and buttons never overlap the QR card (address line included) at any aspect', async () => {
  for (const [name, vp] of Object.entries(VP)) {
    for (const n of [1, 8, 32]) {
      const page = await open(`results-${n}`, vp);
      try {
        const qr = await box(page, '.rs-join .qr-card');
        for (const sel of ['[data-next]', '[data-act=start]', '[data-act=lobby]', '.rs-list']) assert.ok(!overlap(qr, await box(page, sel)), `${name} N=${n}: ${sel} clear of the QR card`);
        const f = await box(page, '.jj-foot');
        for (const sel of ['.rs-join .qr-card', '[data-act=lobby]']) assert.ok(!overlap(f, await box(page, sel)), `${name} N=${n}: ${sel} clear of the footer`);
        const cap = await box(page, '[data-next]');
        assert.ok(cap.x >= 0 && cap.x + cap.w <= vp[0] + 0.5, `${name} N=${n}: caption on screen`);
        if (n === 8) await capture(page, `results-8-caption@${name}`);
      } finally {
        await page.close();
      }
    }
  }
});

test('captures: menu, confirmations and diagnostics on a phone and a 4K TV', { skip: process.env.JJ_NO_CAPTURES === '1', timeout: 300_000 }, async () => {
  for (const [vpName, vp] of [['phone', VP.phone], ['4k', VP['4k']]]) {
    const page = await open('race-8', vp);
    try {
      await untilHud(page, 8);
      await page.locator('[data-act=diagnostics]').click();
      await page.waitForTimeout(400);
      await capture(page, `diagnostics-race-8@${vpName}`);
      await page.locator('[data-act=diagnostics]').click();
      await page.locator('[data-act=menu]').click();
      await capture(page, `menu-race-8@${vpName}`);
      await page.getByRole('button', { name: 'Disband room' }).click();
      await capture(page, `confirm-disband@${vpName}`);
    } finally {
      await page.close();
    }
  }
  for (const [spec, vpName] of [['lobby-8', 'phone'], ['results-8', 'phone'], ['lobby-32', '1080p'], ['results-32', '1080p']]) {
    const page = await open(spec, VP[vpName]);
    try {
      await page.waitForTimeout(300);
      await capture(page, `${spec}-footer@${vpName}`);
    } finally {
      await page.close();
    }
  }
});
