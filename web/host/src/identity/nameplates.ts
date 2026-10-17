// P1-R13: DOM nameplate rings in other players' views and Overview. No WebGL draws/materials per seat.
import { applySeatPattern, seatColor } from '../../../shared/ui';
import type { World } from '../render/world';
import './nameplates.css';

export function mountNameplates(root: HTMLElement, world: World): void {
  const layer = document.createElement('div');
  layer.className = 'jj-nameplates';
  layer.setAttribute('aria-hidden', 'true');
  root.append(layer);
  const marks = new Map<string, HTMLElement>();
  const sizes = new WeakMap<HTMLElement, { key: string; width: number; height: number }>();
  world.onNameplates = (points) => {
    const live = new Set<string>();
    const groups = new Map<number, typeof points>();
    for (const point of points) (groups.get(point.tile) ?? groups.set(point.tile, []).get(point.tile)!).push(point);
    const placed = new Map<number, Array<{ left: number; right: number; top: number; bottom: number }>>();
    const pending: Array<{ point: typeof points[number]; mark: HTMLElement; width: number; height: number; x: number; y: number }> = [];
    for (const point of points) {
      const key = `${point.tile}:${point.car}`;
      live.add(key);
      let mark = marks.get(key);
      if (!mark) {
        mark = document.createElement('div'); mark.className = 'identity-nameplate';
        mark.innerHTML = '<span></span>'; marks.set(key, mark); layer.append(mark);
      }
      const v = world.vehicles!;
      const number = v.numberOf(point.id);
      mark.dataset.number = String(number); mark.dataset.car = String(point.car); mark.dataset.tile = String(point.tile);
      const text = `#${number}${point.font >= 18 ? ` ${v.nameOf(point.id)}` : ''}`;
      const keyStyle = `${number}:${v.paintOf(point.id)}:${text}:${point.font}:${point.clip.right - point.clip.left}`;
      let box = sizes.get(mark);
      if (box?.key !== keyStyle) {
        applySeatPattern(mark, number);
        mark.style.setProperty('--seat', v.paintOf(point.id)); mark.style.setProperty('--on', seatColor(number).on);
        mark.style.fontSize = `${point.font}px`; mark.firstElementChild!.textContent = text;
        mark.style.maxWidth = `${point.clip.right - point.clip.left}px`;
        box = { key: keyStyle, width: mark.offsetWidth, height: mark.offsetHeight }; sizes.set(mark, box);
      }
      // Stable labels require no layout reads or SVG work per frame.
      pending.push({ point, mark, width: box.width, height: box.height, x: point.x, y: point.y });
    }
    // Reflow intersecting nameplates within their own viewport. All remain present; dense projected fields scale to fit.
    for (const [tile, group] of groups) {
      const items = pending.filter(item => item.point.tile === tile).sort((a, b) => a.y - b.y || a.point.car - b.point.car);
      const clip = group[0]!.clip;
      const totalHeight = items.reduce((sum, item) => sum + item.height + 2, 0);
      let scale = Math.min(1, (clip.bottom - clip.top - 4) / totalHeight);
      const positions = placed.get(tile) ?? placed.set(tile, []).get(tile)!;
      let overflow = false;
      for (const item of items) {
        const width = item.width * scale, height = item.height * scale;
        item.x = Math.max(clip.left + width / 2, Math.min(clip.right - width / 2, item.x));
        item.y = Math.max(clip.top + height, item.y);
        // Visit occupied bottoms once, from top to bottom. Repeating find() can hit the same
        // rectangle forever when floating-point subtraction rounds the new top below its gap.
        // Moving below each bottom also keeps every earlier rectangle clear.
        for (const rect of [...positions].sort((a, b) => a.bottom - b.bottom)) {
          if (item.x - width / 2 < rect.right + 2 && item.x + width / 2 > rect.left - 2 && item.y - height < rect.bottom + 2 && item.y > rect.top - 2) item.y = rect.bottom + height + 2;
        }
        if (item.y > clip.bottom) overflow = true;
        positions.push({ left: item.x - width / 2, right: item.x + width / 2, top: item.y - height, bottom: item.y });
      }
      if (overflow) {
        scale = Math.min(scale, (clip.bottom - clip.top - 4) / totalHeight);
        let y = clip.top + 2;
        for (const item of items) { y += item.height * scale; item.y = y; y += 2 * scale; }
      }
      for (const item of items) {
        item.mark.style.transform = `translate(-50%, -100%) scale(${scale})`;
        item.mark.style.left = `${item.x}px`; item.mark.style.top = `${item.y}px`;
        item.mark.style.setProperty('--lead', `${Math.max(0, item.point.carY - item.y) / scale}px`);
      }
    }
    for (const [key, mark] of marks) if (!live.has(key)) { mark.remove(); marks.delete(key); }
  };
}
