// The grid's spare cells on the TV (P1-R04, look P1-R04.style from the accepted set art/ui/accepted/2026-10-07/,
// poc/tv "grid" states): every cell the layout leaves is painted paper, never black. The join cell holds the paper QR
// card (a saffron "Join now" strip over the QR, the room code and the address under it, whole device pixels per module);
// a cell too small for a scannable QR shows the code and address; the next cell is the Players card (every racer in
// race order, columns and size flexing with the count, never cut); the rest and the margins are the dotted paper
// backdrop. What no cell holds docks in the footer (P1-R04.3, html[data-grid-dock]). Plain DOM over the canvas, CSS px.
import { paintCaptions, paperQrCard, paperQrSvg } from '../../../shared/ui';
import type { Layout, Rect } from './grid';
import { onPositions, positions, type Position } from './positions';
import './grid.css';

const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The largest QR edge (CSS px, whole device px per module) that leaves room for its strip and label in a w x h cell. */
function qrEdge(modules: number, w: number, h: number, dpr: number): number {
  const d = Math.max(1, Math.floor((Math.min(w * 0.78, h * 0.56) * dpr) / modules));
  return (d * modules) / dpr;
}

/** Columns for n rows of the Players card in w x h (CSS px): the arrangement that gives the biggest legible type. */
function playersFit(n: number, w: number, h: number): { cols: number; fs: number } {
  let best = { cols: 1, fs: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const fs = Math.min((h / Math.max(1, rows)) * 0.6, w / cols / 8.5, h * 0.09);
    if (fs > best.fs + 1e-6) best = { cols, fs };
  }
  return best;
}

function playersCard(list: Position[], w: number, h: number): string {
  const head = '<h3 class="display jj-pl-head">Players</h3>';
  if (!list.length) return `<div class="jj-players">${head}<p class="jj-pl-none">Places show once the race is on.</p></div>`;
  const { cols, fs } = playersFit(list.length, w * 0.84, h * 0.7);
  const items = list
    .map((p) => `<li><b class="tnum">${p.place}</b><span class="badge" style="--b:var(--id-${p.colour});--on:var(--id-${p.colour}-on)">#${p.number}</span><span class="nm">${esc(p.name)}</span></li>`)
    .join('');
  const rows = Math.ceil(list.length / cols);
  return `<div class="jj-players" style="--pl-fs:${fs.toFixed(2)}px">${head}<ol style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},auto)">${items}</ol></div>`;
}

export function mountGridOverlay(root: HTMLElement, joinUrl: string) {
  const el = document.createElement('div');
  el.className = 'jj-grid';
  el.dataset.testid = 'grid-overlay';
  root.append(el);
  const arrowsEl = document.createElement('div');
  arrowsEl.className = 'jj-arrows';
  root.append(arrowsEl);
  const url = new URL(joinUrl, location.href);
  const host = url.host;
  const code = /\/j\/([A-Za-z0-9]{4})/.exec(url.pathname)?.[1]?.toUpperCase() ?? '';
  const modules = paperQrSvg(joinUrl).modules;
  let last = '';
  let lastL: Layout | null = null;
  let lastScale = 1;
  const render = (L: Layout | null, scale: number) => {
    lastL = L;
    lastScale = scale;
    const dpr = window.devicePixelRatio || 1;
    const px = (r: Rect) => `left:${r.x / scale}px;top:${r.y / scale}px;width:${r.w / scale}px;height:${r.h / scale}px`;
    const parts = (L?.fillers ?? []).map((f) => {
      const [w, h] = [f.w / scale, f.h / scale];
      let inner = '';
      if (f.kind === 'qr') {
        const q = qrEdge(modules, w, h, dpr);
        const card = paperQrCard({ url: joinUrl, code: code || host, domain: host, size: q });
        inner = `<div class="jj-qrcell" style="--q:${q}px"><span class="capt one jj-join-now" data-brush="join-now"><span>Join now</span></span>${card.outerHTML}</div>`;
      } else if (f.kind === 'code') {
        inner = `<div class="jj-join-text"><span class="capt one" data-brush="join-at"><span>Join at</span></span>${code ? `<b class="display jj-code">${esc(code)}</b>` : ''}<span class="jj-domain">${esc(host)}</span></div>`;
      } else if (f.kind === 'standings') {
        inner = playersCard(positions(), w, h);
      }
      return `<div class="jj-filler" data-kind="${f.kind}" style="${px(f)}">${inner}</div>`;
    });
    if (L?.joinChip) {
      // Anchored by its right edge and sized to its text, so a long address never runs past the screen.
      const c = L.joinChip;
      const right = `right:calc(100% - ${(c.x + c.w) / scale}px);top:${c.y / scale}px;height:${c.h / scale}px`;
      parts.push(`<div class="jj-chip" data-kind="chip" style="${right}"><span>Join at</span> <b>${esc(host)}</b></div>`);
    }
    // What no spare cell holds docks in the host footer (P1-R04.3): the footer shows its QR and positions from this.
    const dock = [L?.dock.qr && 'qr', L?.dock.positions && 'positions'].filter(Boolean).join(' ');
    if (document.documentElement.dataset.gridDock !== dock) document.documentElement.dataset.gridDock = dock;
    const html = parts.join('');
    if (html !== last) {
      el.innerHTML = last = html;
      paintCaptions(el);
    }
  };
  onPositions(() => {
    if (lastL?.fillers.some((f) => f.kind === 'standings')) render(lastL, lastScale);
  });
  return {
    el,
    /** Draws the layout's fillers and join chip; `scale` converts its device pixels to CSS pixels. */
    render,
    /** The off-screen arrow on each tile whose own car the camera lost (P1-R05), pointing towards the car. */
    arrows(list: (Rect & { angle: number })[], scale: number) {
      arrowsEl.innerHTML = list
        .map((a) => {
          const [cx, cy] = [(a.x + a.w / 2) / scale, (a.y + a.h / 2) / scale];
          const r = Math.min(a.w, a.h) / scale / 2 - 24;
          const [x, y] = [cx + Math.cos(a.angle) * r, cy + Math.sin(a.angle) * r];
          return `<div class="jj-arrow" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${a.angle}rad)">➤</div>`;
        })
        .join('');
    },
  };
}
