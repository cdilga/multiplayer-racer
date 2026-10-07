// The lobby's car picker (P1-C03, R101/R110), ported from the accepted phone mock's `lobby()` (art/ui/poc/phone/phone.js): the
// car big in a tilted panel with its class tag, name, four stat bars and a line about it, arrows and a swipe through the roster,
// and a row of thumbnails. The roster is data (roster.json): any number of cars, no cap; with one car the arrows and thumbnails
// stay out of the way. Ready is never blocked by it: the sheet is opened from a button, and closing it changes nothing else.
// The pick is kept per device and realm; there is no wire message for it yet, so the host (and the TV's "choosing" state) don't
// see it.
import { icon } from '../../../shared/ui';
import data from './roster.json' with { type: 'json' };

export interface RosterCar {
  id: string;
  name: string;
  cls: string;
  blurb: string;
  art?: string;
  shape?: keyof typeof data.shapes;
  stats: number[];
}

const ART: Record<string, string> = {
  'cruz-missile-hero.png': new URL('../../../../art/ui/brand/renders/cruz-missile-hero.png', import.meta.url).href,
};
const STATS = ['Speed', 'Accel', 'Handling', 'Toughness'];
const SHAPE_NAMES = Object.keys(data.shapes) as Array<keyof typeof data.shapes>;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const ROSTER: RosterCar[] = data.cars as RosterCar[];

/** The roster for the state opener's `&roster=N` (a test surface for "any number of cars"): the real cars, then silhouettes. */
export function rosterOf(extra = 0): RosterCar[] {
  const out = [...ROSTER];
  for (let k = 0; k < extra - out.length; k++) {
    const shape = SHAPE_NAMES[k % SHAPE_NAMES.length]!;
    out.push({ id: `test-${k}`, name: `Test car ${k + 1}`, cls: 'Silhouette', blurb: 'A stand-in so the picker can be seen with a long roster.', shape, stats: [3 + (k % 6), 4 + ((k * 2) % 6), 5 + ((k * 3) % 5), 2 + ((k * 5) % 7)] });
  }
  return out;
}

const art = (c: RosterCar, hex: string, big: boolean): string =>
  c.art
    ? `<img class="carimg${big ? ' big' : ''}" alt="${esc(c.name)}" src="${ART[c.art] ?? ''}">`
    : `<svg class="carimg sil${big ? ' big' : ''}" viewBox="0 0 200 90" role="img" aria-label="${esc(c.name)} (silhouette)"><path d="${data.shapes[c.shape ?? 'sedan']}" fill="${hex}" stroke="#15203A" stroke-width="5" stroke-linejoin="round"/><circle cx="52" cy="66" r="15" fill="#15203A"/><circle cx="152" cy="66" r="15" fill="#15203A"/></svg>`;

export class CarSheet {
  readonly el: HTMLElement;
  private i: number;
  private closed = false;

  constructor(
    host: HTMLElement,
    private readonly o: { roster: RosterCar[]; start: number; colour: string; onPick: (car: RosterCar, index: number) => void; onClose: () => void },
  ) {
    this.i = Math.max(0, Math.min(o.roster.length - 1, o.start));
    this.el = document.createElement('div');
    this.el.className = 'menusheet car-sheet';
    this.el.dataset.overlay = 'cars';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Choose your car');
    this.el.style.setProperty('--seat', o.colour);
    host.append(this.el);
    this.render();
  }

  get open(): boolean {
    return !this.closed;
  }

  get index(): number {
    return this.i;
  }

  private render(): void {
    const { roster, colour } = this.o;
    const c = roster[this.i]!;
    const many = roster.length > 1;
    this.el.innerHTML = `<div class="picker">
      <div class="stage" data-box="car"><div class="carpanel"><span class="tag"><span>${esc(c.cls)}</span></span>${art(c, colour, true)}
        <div class="stats">${STATS.map((n, k) => `<div class="stat"><span>${n}</span><i style="--v:${Math.max(0, Math.min(10, c.stats[k] ?? 0)) * 10}%"></i></div>`).join('')}</div>
        <p class="blurb">${esc(c.blurb)}</p></div>
        <span class="bn carname" data-car-name>${esc(c.name)}</span>
        ${many ? '<button type="button" class="btn icon arrow prev" aria-label="Previous car"><i data-ico="chevron-left"></i></button><button type="button" class="btn icon arrow next" aria-label="Next car"><i data-ico="chevron-right"></i></button>' : ''}
      </div>
      <div class="side">
        ${many ? `<div class="thumbs" role="listbox" aria-label="Cars">${roster.map((r, k) => `<button type="button" class="thumb" role="option" data-i="${k}" aria-label="${esc(r.name)}" aria-selected="${k === this.i}">${art(r, colour, false)}</button>`).join('')}</div>` : ''}
        <p class="waiting" data-note="car-local">Your pick stays on this phone for now: the host doesn't see it yet.</p>
        <button type="button" class="btn primary big" data-act="car-done">Done</button>
      </div></div>`;
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-ico]')) el.replaceWith(icon(el.dataset.ico!));
    this.wire();
  }

  private go(k: number): void {
    const n = this.o.roster.length;
    this.i = ((k % n) + n) % n;
    this.o.onPick(this.o.roster[this.i]!, this.i);
    this.render();
  }

  private wire(): void {
    this.el.querySelector('.prev')?.addEventListener('click', () => this.go(this.i - 1));
    this.el.querySelector('.next')?.addEventListener('click', () => this.go(this.i + 1));
    this.el.querySelector('.thumbs')?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.thumb');
      if (t) this.go(Number(t.dataset.i));
    });
    // Swipe the stage to change car.
    const stage = this.el.querySelector<HTMLElement>('.stage')!;
    let sx: number | null = null;
    stage.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('button')) sx = e.clientX;
    });
    stage.addEventListener('pointerup', (e) => {
      if (sx !== null && Math.abs(e.clientX - sx) > 40 && this.o.roster.length > 1) this.go(this.i + (e.clientX < sx ? 1 : -1));
      sx = null;
    });
    this.el.querySelector('[data-act=car-done]')!.addEventListener('click', () => this.close());
  }

  rehost(host: HTMLElement): void {
    host.append(this.el);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.el.remove();
    this.o.onClose();
  }
}
