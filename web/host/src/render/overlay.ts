// The renderer's status chip (P1-R01, R111): the build, the backend, and the actual render resolution with whether it is
// native, lowered by the host's setting, or capped by the browser. Always visible, small, in a corner; P1-U02's host
// UI may restyle or move it, never drop it.
import type { World } from './world';

export function mountOverlay(root: HTMLElement, world: World, build: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'jj-render-chip';
  chip.dataset.testid = 'render-chip';
  root.append(chip);
  let last = '';
  world.onFrame = (s) => {
    const how = s.limitedBy ? `capped (${s.limitedBy})` : s.resolution === 'native' ? 'native' : `${Math.round(s.scale * 100)} %`;
    const text = `${build} · ${s.backend} · ${s.width}×${s.height} ${how}`;
    if (text !== last) chip.textContent = last = text;
  };
  return chip;
}
