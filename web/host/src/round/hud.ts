// The per-tile HUD (P1-R07; accepted POC `poc/tv` "Per-tile HUD"): one DOM layer over the canvas, one box per tile, placed
// from the tile rects the renderer reports (device px / scale = CSS px). Top-left the number badge and name, top-right
// the position and lap on one line, bottom-left the boost meter, status chips (autopilot, reconnecting) beside it, the
// wreck countdown mid-tile. Text is 7.5 % of the tile height, 16 to 32 px at 1080p (x the screen scale); a tile too small
// for the name drops it, keeping number, place and lap. Tile k follows car k, so a tile's seat is the one whose car is k.
import { ordinal, shortName } from './format';
import type { RoomView } from '../worker/client';

type SeatView = RoomView['seats'][number] & {
  /** Hooks for data RoomView doesn't carry yet (the worker side adds them): boost 0..1, wreck countdown in ms. */
  boost?: number | null;
  wreckMs?: number | null;
};

export interface TileRect {
  seat: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Hud {
  /** Places the boxes: tile rects in device px, `scale` = device px per CSS px. */
  place(rects: TileRect[] | null, scale: number): void;
  /** The room changed: refresh text. */
  update(room: RoomView): void;
  /** Show or hide the whole layer (only races show it). */
  show(on: boolean): void;
}

export function mountHud(parent: HTMLElement, kOf: () => number): Hud {
  const layer = document.createElement('div');
  layer.className = 'jj-hud';
  layer.hidden = true;
  parent.append(layer);
  const boxes = new Map<number, HTMLElement>();
  let rects: TileRect[] = [];
  let scale = 1;
  let room: RoomView | null = null;
  const cache = new WeakMap<HTMLElement, string>();

  const seatOf = (tile: number): SeatView | undefined => room?.seats.find((s) => s.car !== null && s.car + 1 === tile) as SeatView | undefined;

  const build = (tile: number): HTMLElement => {
    const b = document.createElement('div');
    b.className = 'hud-tile';
    b.dataset.tile = String(tile);
    b.innerHTML = `<div class="hud-top"><div class="hud-tl"><span class="badge hud-badge"></span><span class="hud-name"></span></div>
      <div class="hud-tr"><span class="display hud-pos"></span><span class="hud-lap"></span></div></div>
      <div class="hud-bottom"><div class="hud-boost" hidden><i></i></div><div class="hud-status"></div></div>
      <div class="hud-centre" hidden><div class="display wreck-word">Wrecked!</div><div class="wreck-back">Back in <b class="cd"></b> s</div></div>`;
    layer.append(b);
    return b;
  };

  const paint = () => {
    if (layer.hidden) return;
    const k = kOf();
    const live = new Set(rects.map((r) => r.seat));
    for (const [t, b] of boxes) if (!live.has(t)) (b.remove(), boxes.delete(t));
    for (const r of rects) {
      const box = boxes.get(r.seat) ?? (boxes.set(r.seat, build(r.seat)), boxes.get(r.seat)!);
      const w = r.w / scale;
      const h = r.h / scale;
      box.style.cssText = `left:${r.x / scale}px;top:${r.y / scale}px;width:${w}px;height:${h}px;--hud:${Math.min(32 * k, Math.max(16 * k, h * 0.075))}px`;
      box.classList.toggle('compact', w < 230 * k || h < 140 * k);
      const s = seatOf(r.seat);
      const total = room?.laps ?? 0;
      const lap = s?.laps === null || s?.laps === undefined ? null : Math.min(s.laps + 1, Math.max(1, total));
      const pos = s?.position ?? null;
      const state = s ? (s.presence === 'Left' ? 'reconnecting' : s.presence === 'SittingOut' ? 'autopilot' : '') : '';
      const key = JSON.stringify([s?.number, s?.name, s?.colourIndex, pos, lap, total, s?.finished, state, s?.boost, s?.wreckMs]);
      if (cache.get(box) === key) continue;
      cache.set(box, key);
      box.hidden = !s;
      if (!s) continue;
      box.dataset.seat = String(s.number);
      box.style.setProperty('--seat', `var(--id-${s.colourIndex % 12})`);
      const badge = box.querySelector<HTMLElement>('.hud-badge')!;
      badge.textContent = `#${s.number}`;
      badge.style.setProperty('--b', `var(--id-${s.colourIndex % 12})`);
      badge.style.setProperty('--on', `var(--id-${s.colourIndex % 12}-on)`);
      box.querySelector('.hud-name')!.textContent = shortName(s.name || (s.local ? 'Host keys' : 'Player'));
      const posEl = box.querySelector<HTMLElement>('.hud-pos')!;
      if (pos === null) posEl.textContent = '–';
      else {
        const [n, suf] = ordinal(pos);
        posEl.innerHTML = `${n}<sup>${suf}</sup>`;
      }
      posEl.dataset.pos = pos === null ? '' : String(pos);
      const lapEl = box.querySelector<HTMLElement>('.hud-lap')!;
      lapEl.textContent = s.finished ? 'Finished' : lap === null ? '' : `Lap ${lap}/${total}`;
      lapEl.dataset.lap = lap === null ? '' : String(lap);
      // Before the race there is no place or lap yet: no empty pill.
      box.querySelector<HTMLElement>('.hud-tr')!.hidden = pos === null && lap === null && !s.finished;
      const boost = box.querySelector<HTMLElement>('.hud-boost')!;
      boost.hidden = s.boost === undefined || s.boost === null;
      if (!boost.hidden) boost.firstElementChild!.setAttribute('style', `width:${Math.round(Math.max(0, Math.min(1, s.boost!)) * 100)}%`);
      box.querySelector<HTMLElement>('.hud-status')!.innerHTML =
        state === 'autopilot' ? '<span class="chip chip-auto">Autopilot</span>' : state === 'reconnecting' ? '<span class="chip chip-warn">Reconnecting…</span>' : '';
      const centre = box.querySelector<HTMLElement>('.hud-centre')!;
      centre.hidden = !(s.wreckMs !== undefined && s.wreckMs !== null && s.wreckMs > 0);
      if (!centre.hidden) box.querySelector('.cd')!.textContent = String(Math.ceil(s.wreckMs! / 1000));
    }
  };

  return {
    place(r, sc) {
      rects = r ?? [];
      scale = sc || 1;
      paint();
    },
    update(r) {
      room = r;
      paint();
    },
    show(on) {
      layer.hidden = !on;
      if (on) paint();
    },
  };
}
