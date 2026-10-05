// The host's Render resolution setting (R111): Native (default), 75 %, 50 %. Persisted per host, applied live without a
// reload, and shown with its source. It opens from the status chip (click, Enter or Space; Escape or a click away closes),
// so with it closed only the chip is on screen and no control covers a tile. P1-U02's host settings may take it over.
import { labelOf, LEVELS, saveChoice } from './resolution';
import type { World } from './world';

export function mountResolutionSetting(root: HTMLElement, world: World, chip: HTMLElement): HTMLElement {
  const el = document.createElement('label');
  el.dataset.testid = 'render-resolution';
  Object.assign(el.style, {
    display: 'none', position: 'fixed', bottom: '32px', right: '8px', zIndex: '2', background: 'rgba(0,0,0,.55)', color: '#f4efe6',
    borderRadius: '4px', padding: '2px 8px', font: '11px system-ui, sans-serif',
  });
  el.append('Render resolution ');
  const select = document.createElement('select');
  select.dataset.testid = 'render-resolution-select';
  for (const l of LEVELS) select.append(new Option(labelOf(l), String(l)));
  const sync = () => {
    const user = world.stats.userScale;
    if (![...select.options].some((o) => Number(o.value) === user)) select.append(new Option(`${Math.round(user * 100)} % (override)`, String(user)));
    select.value = String(user);
  };
  sync();
  select.addEventListener('change', () => {
    const v = Number(select.value);
    world.setUserScale(v);
    saveChoice(v);
  });
  el.append(select);
  world.onResolution = sync;
  root.append(el);
  Object.assign(chip.style, { pointerEvents: 'auto', cursor: 'pointer' });
  chip.tabIndex = 0;
  chip.setAttribute('role', 'button');
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');
  const open = (on: boolean) => {
    el.style.display = on ? 'block' : 'none';
    chip.setAttribute('aria-expanded', String(on));
    if (on) select.focus();
  };
  const isOpen = () => el.style.display !== 'none';
  chip.addEventListener('click', () => open(!isOpen()));
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(!isOpen());
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      open(false);
      chip.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !el.contains(e.target as Node) && !chip.contains(e.target as Node)) open(false);
  });
  return el;
}
