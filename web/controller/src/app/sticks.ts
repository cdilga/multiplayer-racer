// The two sticks (P1-C02), ported from the POC (art/ui/poc/phone/phone.js `stickZone`/`attachStick`): Pointer Events
// with one pointer per zone, so two thumbs drive two sticks independently; the base floats to where the thumb lands
// (kept inside the zone), the knob is clamped to the base's radius, release springs back to centre. Values are
// −1..1 with y down-positive, as the screen; the session flips y for the wire.
import type { Stick } from './session';

export type StickKind = 'drive' | 'action';

export function stickZone(kind: StickKind): HTMLElement {
  const z = document.createElement('div');
  z.className = `zone ${kind}`;
  z.dataset.box = `zone-${kind}`;
  z.setAttribute('aria-label', kind === 'drive' ? 'Drive stick: steer, accelerate, brake and reverse' : 'Action stick: boost right, drift left, utilities up and down');
  z.innerHTML = `<span class="tag display">${kind === 'drive' ? 'Drive' : 'Action'}</span><div class="base"><div class="preload" style="--p:0%"></div><div class="knob"></div></div>`;
  return z;
}

export interface StickHandle {
  readonly value: Stick;
  /** Release the stick (pointercancel, page hidden, menu opened). */
  release(): void;
}

export function attachStick(z: HTMLElement, onChange: (v: Stick) => void, fixed = false, vibrate: () => boolean = () => true): StickHandle {
  const base = z.querySelector<HTMLElement>('.base')!;
  const knob = z.querySelector<HTMLElement>('.knob')!;
  const value: Stick = { x: 0, y: 0, touch: false };
  let home = { x: 0, y: 0 };
  let pid: number | null = null;
  let origin = { x: 0, y: 0 };
  const R = () => base.offsetWidth * 0.42;
  const place = (x: number, y: number) => {
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
  };
  const setHome = () => {
    const r = z.getBoundingClientRect();
    home = { x: r.width / 2, y: r.height * 0.58 };
    if (pid === null) place(home.x, home.y);
  };
  new ResizeObserver(setHome).observe(z);
  setHome();
  const move = (dx: number, dy: number) => {
    const r = R() || 1;
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px) scale(1.08)`;
    value.x = (dx * k) / r;
    value.y = (dy * k) / r;
    value.touch = true;
    onChange(value);
  };
  const release = () => {
    pid = null;
    z.classList.remove('active');
    knob.style.transform = '';
    value.x = 0;
    value.y = 0;
    value.touch = false;
    place(home.x, home.y);
    onChange(value);
  };
  z.addEventListener('pointerdown', (e) => {
    if (pid !== null || z.classList.contains('disabled')) return;
    e.preventDefault();
    pid = e.pointerId;
    try {
      z.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; zone events still arrive.
    }
    const r = z.getBoundingClientRect();
    const rad = R();
    origin = fixed
      ? { ...home }
      : { x: Math.min(Math.max(e.clientX - r.left, rad + 8), r.width - rad - 8), y: Math.min(Math.max(e.clientY - r.top, rad + 8), r.height - rad - 8) };
    place(origin.x, origin.y);
    z.classList.add('active');
    if (vibrate()) navigator.vibrate?.(8);
    move(e.clientX - r.left - origin.x, e.clientY - r.top - origin.y);
  });
  z.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const r = z.getBoundingClientRect();
    move(e.clientX - r.left - origin.x, e.clientY - r.top - origin.y);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId === pid) release();
  };
  z.addEventListener('pointerup', end);
  z.addEventListener('pointercancel', end);
  return { value, release };
}
