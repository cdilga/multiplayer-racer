// The per-tile HUD (P1-R07; accepted POC `poc/tv` "Per-tile HUD"): one DOM layer over the canvas, one box per tile, placed
// from the tile rects the renderer reports (device px / scale = CSS px). Top-left the number badge and name, top-right
// the position and lap on one line, bottom-left the boost meter, status chips (autopilot, reconnecting) beside it, the
// wreck countdown mid-tile. Text is 7.5 % of the tile height, 16 to 32 px at 1080p (x the screen scale); a tile too small
// for the name drops it, keeping number, place and lap. Tiles are the seated cars in seat-number order.
import { ordinal, shortName } from './format';
import type { RoomView } from '../worker/client';
import { promptHtml } from '../ui/prompts/steps';

type SeatView = RoomView['seats'][number] & {
  /** From `room_json`: the boost meter as a byte (0..255, `Host::room_json`). */
  boost?: number | null;
  /** Wreck/respawn countdown in ms; the worker doesn't send it yet (report in docs/evidence/P1-R07), so the banner waits for it. */
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
  /** Identify (P1-R06): that seat's tile pulses in its colour with "Cooee #N"; returns false if it has no tile now. */
  identify(seat: number): boolean;
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

  // The grid follows the seated cars in seat-number order (main.ts sets the tiles' `follow` the same way).
  const seatOf = (tile: number): SeatView | undefined =>
    room?.seats.filter((s) => s.car !== null).sort((a, b) => a.number - b.number)[tile - 1] as SeatView | undefined;

  const build = (tile: number): HTMLElement => {
    const b = document.createElement('div');
    b.className = 'hud-tile';
    b.dataset.tile = String(tile);
    b.innerHTML = `<div class="hud-top"><div class="hud-tl"><span class="badge hud-badge"></span><span class="hud-name"></span></div>
      <div class="hud-tr"><span class="display hud-pos"></span><span class="hud-lap"></span></div></div>
      <div class="hud-bottom"><div class="hud-boost" hidden><i></i></div><div class="hud-status"></div></div>
      <div class="hud-prompt" data-prompt hidden></div>
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
      const unplugged = s?.unpluggedMs ?? null;
      const state = s ? (unplugged !== null ? 'unplugged' : s.presence === 'Left' ? 'reconnecting' : s.presence === 'SittingOut' ? 'autopilot' : '') : '';
      // Placing rewrote the inline style, so the seat colour (border, Identify pulse) goes back on every paint.
      if (s) {
        box.style.setProperty('--seat', `var(--id-${s.colourIndex % 12})`);
        box.style.setProperty('--seat-on', `var(--id-${s.colourIndex % 12}-on)`);
      }
      // Before the lights go out there is no place or lap to show (Countdown/Preparing/Lobby): the pill waits for the race.
      const started = room?.phase === 'Running' || room?.phase === 'Finalising';
      const key = JSON.stringify([started, s?.number, s?.name, s?.colourIndex, pos, lap, total, s?.finished, state, unplugged === null ? null : Math.floor(unplugged / 1000), s?.boost, s?.wreckMs, started ? s?.prompt : null]);
      // Visibility is applied every paint, not only when the contents changed: a box's hidden flag must always match whether
      // its tile has a seat now, whatever the cache last saw.
      box.hidden = !s;
      if (cache.get(box) === key) continue;
      cache.set(box, key);
      if (!s) continue;
      box.dataset.seat = String(s.number);
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
      box.querySelector<HTMLElement>('.hud-tr')!.hidden = !started || (pos === null && lap === null && !s.finished);
      const boost = box.querySelector<HTMLElement>('.hud-boost')!;
      boost.hidden = s.boost === undefined || s.boost === null;
      boost.dataset.boost = boost.hidden ? '' : String(s.boost);
      if (!boost.hidden) boost.firstElementChild!.setAttribute('style', `width:${Math.round(Math.max(0, Math.min(1, s.boost! / 255)) * 100)}%`);
      box.querySelector<HTMLElement>('.hud-status')!.innerHTML =
        state === 'unplugged' ? `<span class="chip chip-warn" data-unplugged>Unplugged ${Math.floor(unplugged! / 1000)}s</span>` : state === 'autopilot' ? '<span class="chip chip-auto">Autopilot</span>' : state === 'reconnecting' ? '<span class="chip chip-warn">Reconnecting…</span>' : '';
      // The first-drive prompt (C06): the next control, only in a race, never covering the car (bottom of the tile).
      const pr = box.querySelector<HTMLElement>('[data-prompt]')!;
      const prompt = started ? s.prompt : null;
      pr.hidden = !prompt;
      pr.innerHTML = prompt ? promptHtml(prompt) : '';
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
    identify(seat) {
      if (layer.hidden) return false;
      const tile = [...boxes.keys()].find((t) => seatOf(t)?.seat === seat);
      const box = tile === undefined ? undefined : boxes.get(tile);
      const s = tile === undefined ? undefined : seatOf(tile);
      if (!box || !s) return false;
      box.querySelector('.hud-cooee')?.remove();
      // The accepted Cooee (R99, P1-R06.style; poc/tv .cooee): a high-exposure wash in the seat colour with a hot centre,
      // and "Cooee #N" on a tilted seat-colour slab; fast attack, 1.4 s decay; Reduced holds the label, no flash.
      const c = document.createElement('div');
      c.className = 'hud-cooee';
      const flash = document.createElement('i');
      flash.className = 'flash';
      const label = document.createElement('b');
      label.className = 'display';
      label.textContent = `Cooee #${s.number}`;
      c.append(flash, label);
      box.append(c);
      box.classList.remove('identify');
      void box.offsetWidth; // restart the pulse when it fires again
      box.classList.add('identify');
      setTimeout(() => {
        c.remove();
        box.classList.remove('identify');
      }, 1600);
      return true;
    },
  };
}
