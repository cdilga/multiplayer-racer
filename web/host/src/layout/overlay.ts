// The grid's spare cells on the TV (P1-R04): every cell the layout leaves is painted, never black. The join cell shows
// the join QR (or, too small for a scannable QR, the join address), the next the standings, the rest and the margins
// the paper backdrop; with no QR cell, a join chip sits in the safe area's corner. Plain DOM over the canvas, in CSS
// pixels. The accepted look (G-DESIGN) is P1-R04.style's; the standings' content is P1-R07's.
import { renderSVG } from 'uqr';
import type { Layout, Rect } from './grid';

export function mountGridOverlay(root: HTMLElement, joinUrl: string) {
  const el = document.createElement('div');
  el.className = 'jj-grid';
  el.dataset.testid = 'grid-overlay';
  root.append(el);
  const qr = renderSVG(joinUrl, { border: 1 });
  const host = joinUrl.replace(/^https?:\/\//, '');
  let last = '';
  return {
    el,
    /** Draws the layout's fillers and join chip; `scale` converts its device pixels to CSS pixels. */
    render(L: Layout | null, scale: number) {
      const px = (r: Rect) => `left:${r.x / scale}px;top:${r.y / scale}px;width:${r.w / scale}px;height:${r.h / scale}px`;
      const parts = (L?.fillers ?? []).map((f) => {
        const inner =
          f.kind === 'qr'
            ? `<div class="jj-qr" aria-label="Scan to join">${qr}</div><div class="jj-join-text">Scan to join</div>`
            : f.kind === 'code'
              ? `<div class="jj-join-text">Join at<br><b>${host}</b></div>`
              : f.kind === 'standings'
                ? `<div class="jj-standings">Standings</div>`
                : '';
        return `<div class="jj-filler" data-kind="${f.kind}" style="${px(f)}">${inner}</div>`;
      });
      if (L?.joinChip) parts.push(`<div class="jj-chip" data-kind="chip" style="${px(L.joinChip)}">${qr}</div>`);
      const html = parts.join('');
      if (html !== last) el.innerHTML = last = html;
    },
  };
}
