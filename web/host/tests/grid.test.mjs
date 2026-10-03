// P1-R04 unit tests: the grid layout kernel (web/host/src/layout/grid.ts, imported as TypeScript; Node strips the
// types). Pure, so plain node --test, no browser:
//   node --test web/host/tests/grid.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BAND, GridAnimator, layout } from '../src/layout/grid.ts';

const NS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 16, 20, 24, 32, 37];
const SCREENS = {
  'portrait phone': { w: 412, h: 915 },
  '16:9 1080p': { w: 1920, h: 1080 },
  '16:9 4K': { w: 3840, h: 2160 },
  '21:9': { w: 3440, h: 1440 },
};
// Title/action safe: 5 % in from each edge.
const safeOf = (s) => ({ x: s.w * 0.05, y: s.h * 0.05, w: s.w * 0.9, h: s.h * 0.9 });
const seatsOf = (n) => Array.from({ length: n }, (_, i) => 100 + i * 7); // ids aren't indices

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [name, s] of Object.entries(SCREENS)) {
  test(`${name}: every N tiles equal, in order, no overlap, nothing black`, () => {
    const display = { x: 0, y: 0, ...s };
    for (const n of NS) {
      const seats = seatsOf(n);
      const L = layout(display, safeOf(s), seats);
      assert.equal(L.tiles.length, n, `N=${n}: every seat has a tile (no cap)`);
      // Seat order kept: tiles in join order, reading order on screen.
      assert.deepEqual(L.tiles.map((t) => t.seat), seats);
      for (let i = 1; i < n; i++) {
        const [a, b] = [L.tiles[i - 1], L.tiles[i]];
        assert.ok(b.y > a.y || (b.y === a.y && b.x > a.x), `N=${n}: seat ${i} reads after seat ${i - 1}`);
      }
      // R95: every tile exactly the same whole-pixel size, inside the playable band.
      for (const t of L.tiles) {
        assert.equal(t.w, L.tiles[0].w);
        assert.equal(t.h, L.tiles[0].h);
        assert.ok(Number.isInteger(t.w) && Number.isInteger(t.h));
      }
      const a = L.cell.w / L.cell.h;
      assert.ok(a >= BAND.min - 0.01 && a <= BAND.max + 0.01, `N=${n}: tile aspect ${a.toFixed(2)} in the band`);
      // No overlap between any two rects; tiles, cells and margins cover the screen exactly once (never black).
      const all = [...L.tiles, ...L.fillers];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `N=${n}: rects ${i} and ${j} overlap`);
      const area = all.reduce((sum, r) => sum + r.w * r.h, 0);
      assert.ok(Math.abs(area - s.w * s.h) < 1, `N=${n}: covered ${area} of ${s.w * s.h}`);
      // Gap cells: each exactly a tile, after the last tile; the first holds the join (QR or code), then standings.
      const cells = L.fillers.filter((f) => f.kind !== 'margin');
      assert.equal(cells.length, L.rows * L.cols - n);
      for (const c of cells) assert.equal(c.w * c.h, L.cell.w * L.cell.h);
      if (cells.length) assert.ok(['qr', 'code'].includes(cells[0].kind), `N=${n}: the first gap cell holds the join`);
      if (cells.length > 1) assert.equal(cells[1].kind, 'standings');
      for (const c of cells.slice(2)) assert.equal(c.kind, 'backdrop');
      // Whenever no cell shows the QR, a join chip sits inside the safe area.
      if (!cells.some((c) => c.kind === 'qr')) {
        const sa = safeOf(s);
        assert.ok(L.joinChip, `N=${n}: a join chip`);
        assert.ok(L.joinChip.x >= sa.x - 1 && L.joinChip.x + L.joinChip.w <= sa.x + sa.w + 1 && L.joinChip.y >= sa.y - 1 && L.joinChip.y + L.joinChip.h <= sa.y + sa.h + 1);
      }
    }
  });
}

test('one player fills the screen, with a corner QR', () => {
  const L = layout({ x: 0, y: 0, w: 1920, h: 1080 }, safeOf({ w: 1920, h: 1080 }), [5]);
  assert.deepEqual([L.tiles[0].w, L.tiles[0].h], [1920, 1080]);
  assert.ok(L.joinChip);
});

test('portrait stacks vertically and ultrawide adds columns', () => {
  const p = layout({ x: 0, y: 0, w: 412, h: 915 }, safeOf({ w: 412, h: 915 }), seatsOf(4));
  assert.equal(p.cols, 1);
  const u = layout({ x: 0, y: 0, w: 3440, h: 1440 }, safeOf({ w: 3440, h: 1440 }), seatsOf(4));
  assert.ok(u.cols >= u.rows);
});

test('no cap: 99 and 500 seats all get equal tiles', () => {
  for (const n of [99, 500]) {
    const L = layout({ x: 0, y: 0, w: 3840, h: 2160 }, safeOf({ w: 3840, h: 2160 }), seatsOf(n));
    assert.equal(L.tiles.length, n);
    assert.ok(L.tiles.every((t) => t.w === L.tiles[0].w && t.h === L.tiles[0].h && t.w > 0 && t.h > 0));
  }
});

test('reflow animates on join and leave only, never on position changes', () => {
  const display = { x: 0, y: 0, w: 1920, h: 1080 };
  const g = new GridAnimator(display, safeOf(display), { durationMs: 300 });
  g.update([1, 2, 3], 0);
  assert.equal(g.reflows, 1);
  const before = g.tiles(1000);
  // The race order changes (3 leads): nothing moves.
  assert.equal(g.update([3, 1, 2], 1000), false);
  assert.equal(g.animating(1000), false);
  assert.deepEqual(g.tiles(1000), before);
  assert.deepEqual(g.order, [1, 2, 3], 'join order kept');
  // A join: the layout changes and tweens for 300 ms.
  assert.equal(g.update([3, 1, 2, 4], 2000), true);
  assert.equal(g.reflows, 2);
  assert.ok(g.animating(2100));
  const mid = g.tiles(2150);
  const end = g.tiles(2300);
  assert.notDeepEqual(mid, end, 'mid-reflow tiles are between');
  assert.deepEqual(end, g.layout.tiles);
  assert.equal(g.animating(2300), false);
  // A leave reflows; the rest keep their join order.
  g.update([4, 1, 3], 3000);
  assert.deepEqual(g.order, [1, 3, 4]);
  assert.equal(g.reflows, 3);
});
