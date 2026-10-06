#!/usr/bin/env node
// P1-U02.2 (POC1-04, R95): the TV grid rule gives every player tile exactly the same area at any N, and nothing is black.
// For N = 1..40, 64 and 99 on every reference screen, asserts:
//   - N tiles, all exactly the same whole-pixel size (max/min area = 1), in reading order, in the arrangement the playable
//     aspect band picks, filling the screen (no gap beyond whole-pixel rounding; owner round 5);
//   - every empty cell is exactly a tile's size and sits after the last tile (no tile is ever larger);
//   - tiles, empty cells and margins cover the screen exactly once (the gutters are the tiles' and cells' own insets),
//     so every pixel is a tile, a filler (QR, standings, code or the painted backdrop) or a gutter line, never black.
// Run: node art/ui/poc/tv/grid-check.mjs [--json]   (CI: the `checks` job)
import { BAND, layoutGrid } from './grid.js';

const SCREENS = [
  { id: '1080p', w: 1920, h: 1080 },
  { id: '4k', w: 3840, h: 2160 },
  { id: '21x9', w: 2560, h: 1080 },
  { id: '5x4', w: 1280, h: 1024 },
  { id: '1366x768', w: 1366, h: 768 },
  { id: 'phone-portrait', w: 430, h: 932 },
];
const NS = [...Array.from({ length: 40 }, (_, i) => i + 1), 64, 99];
const failures = [];
const rows = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

for (const s of SCREENS) {
  const k = s.h > s.w ? Math.max(13 / 24, s.w / 1080) : s.h / 1080; // the mock's TV px scale (main.js setK)
  const gutter = 6 * k;
  for (const n of NS) {
    const where = `${s.id} N=${n}`;
    const lay = layoutGrid(n, { x: 0, y: 0, w: s.w, h: s.h }, { gutter, fill: true }); // the race grid fills (owner round 5)
    const { cols, rows: r, cell } = lay;
    if (lay.tiles.length !== n) fail(where, `${lay.tiles.length} tiles`);
    const areas = lay.tiles.map((t) => t.w * t.h);
    const ratio = Math.max(...areas) / Math.min(...areas);
    if (ratio !== 1) fail(where, `tile areas differ: max/min ${ratio}`);
    if (!lay.tiles.every((t) => Number.isInteger(t.x) && Number.isInteger(t.y) && Number.isInteger(t.w) && Number.isInteger(t.h))) fail(where, 'a tile is not on whole pixels');
    if (!(cell.w > 0 && cell.h > 0)) fail(where, `empty tile ${cell.w}x${cell.h}`);
    // Round 5: the band picks the arrangement and the tiles fill the area: no margin beyond whole-pixel rounding.
    for (const m of lay.fillers.filter((f) => f.kind === 'margin')) if (m.w > cols && m.h > r) fail(where, `a ${m.w}x${m.h} gap beside the tiles`);
    const chosen = layoutGrid(n, { x: 0, y: 0, w: s.w, h: s.h }, { gutter });
    if (chosen.cols !== cols || chosen.rows !== r) fail(where, `fill changed the band's arrangement ${chosen.cols}x${chosen.rows} to ${cols}x${r}`);
    for (let i = 1; i < n; i++) {
      const a = lay.tiles[i - 1], b = lay.tiles[i];
      if (!(b.y > a.y || (b.y === a.y && b.x > a.x))) fail(where, `seat ${i + 1} is not after seat ${i} in reading order`);
    }
    const cells = lay.fillers.filter((f) => f.kind === 'cell');
    if (cells.length !== cols * r - n) fail(where, `${cells.length} empty cells for ${cols}x${r} - ${n}`);
    for (const c of cells) if (c.w !== lay.tiles[0].w || c.h !== lay.tiles[0].h) fail(where, `empty cell ${c.w}x${c.h} is not a tile's size`);
    const last = lay.tiles.at(-1);
    for (const c of cells) if (!(c.y > last.y || (c.y === last.y && c.x > last.x))) fail(where, 'an empty cell comes before a tile');
    // Coverage: the C x R block of cells plus the margins is the screen, once.
    const margins = lay.fillers.filter((f) => f.kind === 'margin');
    const covered = cols * r * cell.w * cell.h + margins.reduce((a, m) => a + m.w * m.h, 0);
    if (Math.abs(covered - s.w * s.h) > 1e-6) fail(where, `covered ${covered} of ${s.w * s.h} px`);
    const inside = (m) => m.x >= -1e-9 && m.y >= -1e-9 && m.x + m.w <= s.w + 1e-9 && m.y + m.h <= s.h + 1e-9;
    if (!margins.every(inside)) fail(where, 'a margin leaves the screen');
    const block = { x: cell.x0, y: cell.y0, w: cols * cell.w, h: r * cell.h };
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    for (const m of margins) if (overlap(m, block) > 1e-6) fail(where, 'a margin overlaps the tiles');
    for (let i = 0; i < margins.length; i++) for (let j = i + 1; j < margins.length; j++) if (overlap(margins[i], margins[j]) > 1e-6) fail(where, 'margins overlap');
    rows.push({ screen: s.id, n, grid: `${cols}x${r}`, tile: `${lay.tiles[0].w}x${lay.tiles[0].h}`, cell: `${cell.w}x${cell.h}`, emptyCells: cells.length, areaRatio: ratio });
  }
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ format: 'jj.grid-check.v1', band: BAND, screens: SCREENS, ns: NS, rows, failures }, null, 2));
else console.log(`grid check: ${rows.length} layouts (${SCREENS.length} screens x N = 1..40, 64, 99): ${failures.length ? `${failures.length} FAILED` : 'every tile the same area, nothing black'}`);
for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
process.exit(failures.length ? 1 : 0);
