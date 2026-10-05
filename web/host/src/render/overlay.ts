// The renderer's status chip (P1-R01, R111): the build, the backend, and the actual render resolution with where it comes
// from: native, lowered by the host's setting, lowered automatically after a measured frame-budget miss, or capped by the
// browser (then it says so and what it used instead). Always visible, small, in a corner; P1-U02's host UI may restyle or
// move it, never drop it.
import { labelOf } from './resolution';
import type { World, WorldStats } from './world';

/** How the chip names the resolution's source. */
export function describeResolution(s: WorldStats): string {
  const used = `${s.width}×${s.height}`;
  if (s.limitedBy) return `${used} capped by browser (${s.limitedBy}; native would be ${s.nativeWidth}×${s.nativeHeight})`;
  if (s.resolution === 'native') return `${used} native`;
  if (s.resolution === 'user') return `${used} user-lowered (${labelOf(s.scale)})`;
  return `${used} auto-lowered to ${labelOf(s.scale)} (frame budget missed: p95 ${Math.round(s.autoEvents.at(-1)?.p95Ms ?? 0)} ms)`;
}

export function mountOverlay(root: HTMLElement, world: World, build: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'jj-render-chip';
  chip.dataset.testid = 'render-chip';
  root.append(chip);
  let last = '';
  world.onFrame = (s) => {
    const text = `${build} · ${s.backend} · ${describeResolution(s)}`;
    if (text !== last) {
      chip.textContent = last = text;
      chip.dataset.source = s.limitedBy ? 'capped' : s.resolution;
    }
  };
  return chip;
}
