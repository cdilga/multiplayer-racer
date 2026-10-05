// host-layout.js: the host screen's one layout solver (br-u02-qr-list-space-jdc). Pure (no DOM), so Node checks run it too.
// solveHost(n, rect, opts) -> the equal-tile grid (grid.js) plus the join QR and the player list, placed so that the game
// tiles keep the most area the chrome allows:
//   1. The chrome (QR + list) takes only what it minimally needs: the QR a minimum scannable size (qr-space.json: modules x
//      min px per module, a decoder-tested floor), the list one row per player at the smallest legible tier. Free space
//      the grid already leaves (spare cells, the aspect-band margins) is used first; only when none holds them is a strip
//      reserved on one side, and then the smallest one that holds them (side and size swept; the grid re-solved in the rest).
//   2. Whatever the free space allows beyond the minimum goes to the chrome (the largest QR square, the biggest list tier
//      and scale) as long as the tiles do not shrink: among options with the same tile area the QR is the largest.
//   3. The QR hides only when no option holds it at the minimum size at all. The list never hides or truncates: it has
//      columns and rows for every player (no count limit anywhere) and an option that cannot hold it is not an option.
import { layoutGrid } from './grid.js';

/** Minimum QR: css px per module (the larger of the handheld floor and the TV's 8 px at 1080p scaled by k), whole device px. */
export function qrMin(rules, k, dpr) {
  const css = Math.max(rules.qr.minModuleCssPx.handheld, rules.qr.minModuleCssPx.tvAt1080 * k);
  const d = Math.ceil(css * dpr - 1e-6);
  return { d, moduleCss: d / dpr, q: (rules.qr.modules * d) / dpr };
}

const ctxOf = (rules, k, dpr) => ({
  k, dpr, modules: rules.qr.modules, dMin: qrMin(rules, k, dpr).d,
  pad: Math.max(3, rules.padK * k), gap: Math.max(4, rules.gapK * k), b: Math.max(2, Math.round(rules.qr.borderK * k)),
  lp: Math.max(3, rules.list.cardPadK * k) + Math.max(2, Math.round(3 * k)), // the list card's padding + border
  rules,
});
const qOf = (d, c) => (c.modules * d) / c.dpr;
const labelH = (q, c) => Math.round(Math.max(14, q * 0.17) * 1.15 + c.gap * 0.6);

/** The largest QR (whole device px per module) that fits an outer box w x h; null below the minimum size. */
function fitQr(w, h, c, label = true) {
  const dMax = Math.floor(((Math.min(w, h) - 2 * c.b) * c.dpr) / c.modules + 1e-9);
  if (dMax < c.dMin) return null;
  if (label) for (let d = dMax; d >= Math.max(c.dMin, Math.ceil(dMax * c.rules.qr.labelShare)); d--) {
    const q = qOf(d, c), lh = labelH(q, c);
    if (q + 2 * c.b + lh <= h && q + 2 * c.b <= w) return { d, q, lh, ow: q + 2 * c.b, oh: q + 2 * c.b + lh };
  }
  const q = qOf(dMax, c);
  return { d: dMax, q, lh: 0, ow: q + 2 * c.b, oh: q + 2 * c.b };
}

/** The list for n players in an outer box w x h: every player has a row; columns and scale flex, never a count. */
function fitList(n, w, h, c) {
  const aw = w - 2 * c.lp, ah = h - 2 * c.lp, L = c.rules.list;
  if (aw <= 0 || ah <= 0 || n <= 0) return null;
  for (const [ti, t] of L.tiers.entries()) {
    const r0 = Math.max(t.hK * c.k, L.minRowPx), cw0 = Math.max(t.wK * c.k, t.minWPx);
    let best = null;
    for (let cols = 1; cols <= n && cols * cw0 <= aw + 1e-6; cols++) {
      const rows = Math.ceil(n / cols);
      if (rows * r0 > ah + 1e-6) continue;
      const s = Math.min(aw / cols / cw0, ah / rows / r0), sc = Math.min(s, L.maxScale);
      if (!best || sc > best.sc + 1e-9) best = { tier: t.id, rank: L.tiers.length - ti, cols, rows, sc, r: r0 * sc, cw: cw0 * sc };
    }
    if (best) {
      const head = ah - best.rows * best.r >= best.r * 1.4;
      return { ...best, head, w: best.cols * best.cw + 2 * c.lp, h: best.rows * best.r + 2 * c.lp + (head ? best.r * 1.4 : 0), lq: best.rank * 10 + best.sc };
    }
  }
  return null;
}

/** Where the chrome goes among the free regions, or null when the list (required when wanted) fits nowhere. */
function place(regions, n, want, c) {
  const rs = [];
  const seen = new Set();
  for (const [i, r] of regions.entries()) { const key = `${Math.round(r.w)}x${Math.round(r.h)}`; if (r.kind === 'cell' && seen.has(key)) continue; seen.add(key); rs.push({ ...r, i }); }
  const outer = (r) => ({ x: r.x + c.pad, y: r.y + c.pad, w: r.w - 2 * c.pad, h: r.h - 2 * c.pad });
  const centre = (box, w, h) => ({ x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2 });
  const qrAt = (box, f) => ({ ...centre(box, f.ow, f.oh), ...f });
  const listAt = (box, f) => ({ ...centre(box, f.w, f.h), ...f });
  const cands = [];
  const qrs = want.qr ? rs.map((r) => ({ r, f: fitQr(r.w - 2 * c.pad, r.h - 2 * c.pad, c) })).filter((x) => x.f) : [];
  const lists = want.list ? rs.map((r) => ({ r, f: fitList(n, r.w - 2 * c.pad, r.h - 2 * c.pad, c) })).filter((x) => x.f) : [];
  if (!want.list) { for (const a of qrs) cands.push({ qr: qrAt(outer(a.r), a.f), list: null, q: a.f.q, lq: 0, used: [a.r.i] }); if (!qrs.length) cands.push({ qr: null, list: null, q: 0, lq: 0, used: [] }); }
  else {
    for (const b of lists) cands.push({ qr: null, list: listAt(outer(b.r), b.f), q: 0, lq: b.f.lq, used: [b.r.i] });
    for (const a of qrs) for (const b of lists) if (a.r.i !== b.r.i) cands.push({ qr: qrAt(outer(a.r), a.f), list: listAt(outer(b.r), b.f), q: a.f.q, lq: b.f.lq, used: [a.r.i, b.r.i] });
    // QR and list sharing one region: the QR as large as leaves the list its minimum, beside it or above it.
    if (want.qr) for (const r of [...rs].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 4)) {
      const box = outer(r), dMax = Math.floor(((Math.min(box.w, box.h) - 2 * c.b) * c.dpr) / c.modules + 1e-9);
      for (const mode of ['row', 'col']) for (let d = dMax; d >= c.dMin; d--) {
        const q = qOf(d, c), o = q + 2 * c.b;
        const rem = mode === 'row' ? { x: box.x + o + c.gap, y: box.y, w: box.w - o - c.gap, h: box.h } : { x: box.x, y: box.y + o + c.gap, w: box.w, h: box.h - o - c.gap };
        const lf = rem.w > 0 && rem.h > 0 ? fitList(n, rem.w, rem.h, c) : null;
        if (!lf) continue;
        const qf = { d, q, lh: 0, ow: o, oh: o };
        cands.push({ qr: { ...qf, ...(mode === 'row' ? { x: box.x, y: box.y + (box.h - o) / 2 } : { x: box.x + (box.w - o) / 2, y: box.y }) }, list: mode === 'col' ? { ...listAt(rem, lf), y: rem.y } : listAt(rem, lf), q, lq: lf.lq, used: [r.i] }); // stacked: the list sits right under the QR
        break;
      }
    }
  }
  if (!cands.length) return null;
  // The QR hides only when no candidate holds it: with one, the largest QR first, then the better list.
  const withQr = want.qr && cands.some((x) => x.qr);
  return cands.filter((x) => !withQr || x.qr).sort((a, b) => b.q - a.q || b.lq - a.lq)[0];
}

function regionsOf(grid, rect, side, s) {
  // No strip: the grid's own fillers (spare cells, aspect-band margins). A strip on `side`: the block hugs the opposite
  // edge, so the strip, the margin beside the block and the strip's own width are one region.
  if (!side) return { tiles: grid.tiles, regions: grid.fillers.map((f) => ({ ...f })), block: null };
  const { cols, rows, cell } = grid, bw = cols * cell.w, bh = rows * cell.h;
  const horiz = side === 'right' || side === 'left';
  const dx = horiz ? (side === 'right' ? rect.x - cell.x0 : rect.x + rect.w - (cell.x0 + bw)) : 0;
  const dy = horiz ? 0 : (side === 'bottom' ? rect.y - cell.y0 : rect.y + rect.h - (cell.y0 + bh));
  const mv = (r) => ({ ...r, x: r.x + dx, y: r.y + dy });
  const x0 = cell.x0 + dx, y0 = cell.y0 + dy, x1 = x0 + bw, y1 = y0 + bh;
  const regions = grid.fillers.filter((f) => f.kind === 'cell').map(mv);
  const add = (x, y, w, h, kind) => { if (w > 0.5 && h > 0.5) regions.push({ x, y, w, h, kind }); };
  if (horiz) {
    if (side === 'right') add(x1, rect.y, rect.x + rect.w - x1, rect.h, 'strip'); else add(rect.x, rect.y, x0 - rect.x, rect.h, 'strip');
    add(x0, rect.y, bw, y0 - rect.y, 'margin'); add(x0, y1, bw, rect.y + rect.h - y1, 'margin');
  } else {
    if (side === 'bottom') add(rect.x, y1, rect.w, rect.y + rect.h - y1, 'strip'); else add(rect.x, rect.y, rect.w, y0 - rect.y, 'strip');
    add(rect.x, y0, x0 - rect.x, bh, 'margin'); add(x1, y0, rect.x + rect.w - x1, bh, 'margin');
  }
  return { tiles: grid.tiles.map(mv), regions, block: { x0, y0, x1, y1 }, cell: { ...cell, x0, y0 } };
}

/**
 * @param n players; rect the area above the footer ({x,y,w,h}); opts { rules, k, dpr, gutter, qr: bool, list: bool }
 * @returns the grid as layoutGrid returns it, plus `fillers` = every free region (kind cell | margin | strip) and
 *   `chrome` { qr: {x,y,q,d,lh,ow,oh}|null, list: {x,y,w,h,cols,rows,r,cw,tier,head}|null, side, strip, area, qrMin, wanted }
 */
export function solveHost(n, rect, { rules, k = 1, dpr = 1, gutter = 0, qr = true, list = true } = {}) {
  const c = ctxOf(rules, k, dpr), want = { qr, list: list && n > 0 };
  const area = (g) => (g?.cell ? n * g.cell.w * g.cell.h : 0);
  const mk = (grid, side, s) => { const r = regionsOf(grid, rect, side, s); return { grid, side, s, ...r, area: area(grid) }; };
  const none = layoutGrid(n, rect, { gutter });
  const opts = [];
  const consider = (o) => { o.place = place(o.regions, n, want, c); if (o.place) opts.push(o); };
  const base = mk(none, null, 0);
  if (n <= 0 || (!want.qr && !want.list)) { base.place = { qr: null, list: null, q: 0, lq: 0, used: [] }; opts.push(base); } else {
    consider(base);
    let bestQr = base.place?.qr ? base.area : 0, bestAny = base.place ? base.area : 0;
    const tol = 1 - rules.areaTolerance;
    for (const side of ['right', 'left', 'bottom', 'top']) {
      const dim = side === 'right' || side === 'left' ? rect.w : rect.h;
      const step = Math.max(1, Math.round(dim / rules.stripStepDivisor));
      for (let s = step; s <= dim * rules.stripMaxShare; s += step) {
        const r2 = side === 'right' ? { ...rect, w: rect.w - s } : side === 'left' ? { ...rect, x: rect.x + s, w: rect.w - s } : side === 'bottom' ? { ...rect, h: rect.h - s } : { ...rect, y: rect.y + s, h: rect.h - s };
        const g = layoutGrid(n, r2, { gutter });
        if (!g) continue;
        const a = area(g);
        if (a < (want.qr ? bestQr : bestAny) * tol) continue;
        const o = mk(g, side, s);
        consider(o);
        if (o.place) { bestAny = Math.max(bestAny, a); if (o.place.qr) bestQr = Math.max(bestQr, a); }
      }
    }
  }
  if (!opts.length) { base.place = { qr: null, list: null, q: 0, lq: 0, used: [] }; opts.push(base); }
  const qrAny = want.qr && opts.some((o) => o.place.qr);
  const pool = opts.filter((o) => !qrAny || o.place.qr);
  const top = Math.max(...pool.map((o) => o.area));
  const best = pool.filter((o) => o.area >= top * (1 - rules.areaTolerance)).sort((a, b) => b.place.q - a.place.q || b.place.lq - a.place.lq || a.s - b.s)[0];
  const used = new Set(best.place.used);
  return {
    rows: best.grid.rows, cols: best.grid.cols, cell: best.cell ?? best.grid.cell, tiles: best.tiles,
    fillers: best.regions.map((r, i) => ({ ...r, used: used.has(i) })),
    chrome: { qr: best.place.qr, list: best.place.list, side: best.side, strip: best.s, area: best.area, qrMin: qrMin(rules, k, dpr), wanted: want, optionsTried: opts.length },
  };
}

/** The rule a caller needs to test "does a free region hold the minimum QR": the outer box of the smallest QR. */
export function qrMinOuter(rules, k, dpr) {
  const c = ctxOf(rules, k, dpr);
  const o = qrMin(rules, k, dpr).q + 2 * c.b;
  return { w: o + 2 * c.pad, h: o + 2 * c.pad };
}
export { fitQr, fitList, ctxOf, regionsOf, place };
