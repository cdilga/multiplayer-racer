// The brush system: brushed buttons, and the mask + skin shapes for chips, rows, badges and panels. Ported from
// art/ui/sheets/brush-button.js (owner round 4, 2026-10-06; accepted 2026-10-07), with the seeded shape maths from
// art/ui/sheets/tokens-css.js (`paintPath`, `wobblePath`, via paint.ts). The CSS those functions rely on is brush.css.
//
// A button IS a brushed slab (straight-ish edges, a forward lean) and its ink outline follows the stroke. One SVG per
// `.btn.brush` is painted from the button's size, seeded by `data-bb` or its label, never animated, and repainted when the
// button resizes. States are CSS on the SVG (see brush.css), forced with classes or live from :hover, :active,
// :focus-visible and [disabled]. Nothing here caps a count: a page can hold any number of brushed elements.
import { seeded, wobblePath } from './paint';
import { tokenData } from './tokens.generated';

const fmt = (pts: Array<[number, number]>) => `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;

/** A brushed slab across w×h: straight-ish top and bottom with a forward lean, ends that only hint at dry brush. */
export function brushButtonPath(id: string, w: number, h: number): string {
  const rnd = seeded(`bb:${id}`);
  const e = Math.min(h * 0.12, w * 0.05); // round 4 (owner: "straight-ish edges"): the ends only hint at the brush
  const lean = h * 0.12; // the slab leans forward like the display italic: the top edge sits a little right of the bottom
  const wave = Math.max(0.4, h * 0.012);
  const pts: Array<[number, number]> = [];
  const nTop = Math.max(3, Math.round(w / Math.max(28, h * 0.7)));
  const x0 = e;
  const x1 = w - e;
  for (let i = 0; i <= nTop; i++) pts.push([x0 + lean + (i / nTop) * (x1 - x0 - lean), (rnd() * 2 - 1) * wave]);
  // An end: a few bristles, each reaching out by its own small random length, so the cut reads painted, not ragged.
  const bristles = (xEdge: number, dir: number, leanFrom: number, leanTo: number, down: boolean) => {
    const n = 4;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const y = down ? h * t : h * (1 - t);
      const reach = 0.35 + rnd() * 0.65;
      const ln = leanFrom + (leanTo - leanFrom) * t;
      pts.push([xEdge + dir * e * reach + ln, y + (rnd() - 0.5) * h * 0.05]);
    }
  };
  bristles(x1, 1, 0, -lean, true);
  for (let i = nTop; i >= 0; i--) pts.push([x0 + (i / nTop) * (x1 - x0 - lean), h + (rnd() * 2 - 1) * wave]);
  bristles(x0, -1, 0, lean, false);
  return fmt(pts);
}

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => entries.forEach((en) => paintOne(en.target as HTMLElement))) : null;

function paintOne(el: HTMLElement): void {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  const old = el.querySelector(':scope > svg.bb');
  if (old && +(old.getAttribute('width') ?? 0) === w && +(old.getAttribute('height') ?? 0) === h) return;
  const id = el.dataset.bb || el.textContent?.trim() || 'bb';
  const d = brushButtonPath(id, w, h);
  // Focus rings wrap the whole sticker: each ring is drawn round the slab and again round its shadow (owner, round 4: the
  // outline sits outside the bottom shadow, never under it), then the shadow and the slab go on top. Layer by layer (both
  // ink edges, then both saffron rings, ...) so one copy never paints over the other's colour.
  const rings = ['bb-gp-edge', 'bb-gp', 'bb-gp-gap', 'bb-kb'].map((r) => `<path class="bb-ring ${r}" d="${d}"/><path class="bb-ring ${r} bb-sh" d="${d}"/>`).join('');
  const svg = `<svg class="bb" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<g class="bb-rings">${rings}</g><path class="bb-shadow" d="${d}"/><path class="bb-fill" d="${d}"/></svg>`;
  if (old) old.outerHTML = svg;
  else el.insertAdjacentHTML('afterbegin', svg);
}

/** Paint every `.btn.brush` under root (and keep it painted through resizes). Safe to call again. */
export function paintBrushButtons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('.btn.brush')) {
    paintOne(el);
    ro?.observe(el);
  }
}

/** The chevron tab a gamepad-focused button carries on its leading edge (CSS shows it under `.is-focus-gp`/`.gp`). */
export function gamepadTab(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'gp-tab');
  svg.setAttribute('viewBox', '0 0 18 32');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.5 2.5h6.5l7 13.5-7 13.5H2.5L9.5 16z');
  svg.append(path);
  return svg;
}

export interface BrushBgOptions {
  fill: string;
  ink?: string;
  stroke?: number;
  shadow?: string;
  w?: number;
}

/**
 * A brushed background for chips and rows as a CSS `url(...)`: the button's brush shape as an SVG data URI, stretched to
 * the element (`background-size: 100% 100%`), its outline kept at `stroke` px however it stretches (non-scaling stroke),
 * with the hard sticker shadow baked in. No DOM per element, so a grid of 100+ tiles costs nothing extra.
 */
export function brushBg(id: string, { fill, ink = tokenData.palette.ink, stroke = 2, shadow = 'rgb(21 32 58 / .85)', w = 200 }: BrushBgOptions): string {
  const h = 40;
  const d = brushButtonPath(id, w, h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -1.5 ${w + 6} ${h + 5.5}" preserveAspectRatio="none">`
    + (shadow ? `<path d="${d}" transform="translate(0 3)" fill="${shadow}" stroke="${shadow}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : '')
    + `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// The brush system (owner round 4: "a consistent brush adjacent style and design language for the lot"). Every surface that
// used to be a rounded box (number badges, status chips, HUD pills, roster cards, results rows, paper panels) is cut from
// the same seeded brush family as the buttons:
//   chip   short stroke, ragged bristle ends        row    the same stroke on a long box (cards, rows, toasts)
//   badge  a stubby dab (number badges)             panel  a hand-cut sheet with a gentle wobble
// Each kind is two images, set once as CSS variables on :root by installBrushSkins():
//   --bz-<kind>-<i>-mask  the shape (plus its outline and the shadow below it): where the element shows at all;
//   --bz-<kind>-<i>-skin  the ink outline that follows the shape and the hard sticker shadow under it.
// A brushed element is `mask: <mask>` with `background: <skin>, <fill>` (the `.bz` class in brush.css), so ANY fill works
// (a seat colour, a state colour) and the outline and shadow stay the language's. The `-on-ink` skins swap the outline to paper.
type Kind = 'chip' | 'row' | 'badge' | 'panel';
const SHAPES: Record<Kind, { w: number; h: number; path: (id: string, w: number, h: number) => string }> = {
  chip: { w: 150, h: 40, path: brushButtonPath },
  row: { w: 560, h: 40, path: brushButtonPath },
  badge: { w: 84, h: 40, path: (id, w, h) => wobblePath(`badge:${id}`, w, h, 1.6, [2, 3]) }, // a clean hand-cut dab: bristles fight a number this small
  panel: { w: 420, h: 300, path: (id, w, h) => wobblePath(`panel:${id}`, w, h, 2.2, [3, 5]) },
};
const enc = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

function skinPair(kind: Kind, i: number, { stroke, sy, ink, shadow }: { stroke: number; sy: number; ink: string; shadow: string }) {
  const { w, h, path } = SHAPES[kind];
  const d = path(`${kind}-${i}`, w, h);
  const vb = `-4 -3 ${w + 8} ${h + sy + 6}`;
  const st = `stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round"`;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="none">`;
  // mask: the shape with its full outline, and the shadow under it
  const mask = `${head}<path d="${d}" fill="#000" stroke="#000" ${st}/><path d="${d}" transform="translate(0 ${sy})" fill="#000" stroke="#000" ${st}/></svg>`;
  // skin: the shadow where it shows below the shape (shadow minus shape), then the outline on top
  const skin = `${head}<defs><mask id="m" maskUnits="userSpaceOnUse" x="-4" y="-3" width="${w + 8}" height="${h + sy + 6}"><rect x="-4" y="-3" width="${w + 8}" height="${h + sy + 6}" fill="#fff"/><path d="${d}" fill="#000"/></mask></defs>`
    + `<g mask="url(#m)"><path d="${d}" transform="translate(0 ${sy})" fill="${shadow}" stroke="${shadow}" ${st}/></g>`
    + `<path d="${d}" fill="none" stroke="${ink}" ${st}/></svg>`;
  return { mask: enc(mask), skin: enc(skin) };
}

export interface BrushSkinOptions {
  /** Outline width in px as it renders (default: the page's --outline). */
  stroke?: number;
  /** Shadow depth in the shape's own units (about a tenth of its height). */
  sy?: number;
  ink?: string;
  paper?: string;
}

/** The page's current --outline in px (it is a calc() on TV profiles, so measure it rather than parse it). */
export function outlinePx(root: HTMLElement = document.documentElement): number {
  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--outline);height:0';
  root.append(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px || 3;
}

/**
 * Put the brush skins on root as CSS variables, at this page's outline width and shadow depth. Call again when the profile
 * (and so the outline) changes; applyProfile does. Four seeded variants per kind (`-0` ... `-3`) so neighbours never look stamped.
 */
export function installBrushSkins(root: HTMLElement = document.documentElement, o: BrushSkinOptions = {}): void {
  const { stroke = outlinePx(root), sy = 4, ink = tokenData.palette.ink, paper = tokenData.palette.paper } = o;
  for (const kind of Object.keys(SHAPES) as Kind[]) {
    const ksy = kind === 'panel' ? sy * 1.6 : sy;
    for (let i = 0; i < 4; i++) {
      const a = skinPair(kind, i, { stroke, sy: ksy, ink, shadow: ink });
      const b = skinPair(kind, i, { stroke, sy: ksy, ink: paper, shadow: 'rgba(0,0,0,.55)' });
      root.style.setProperty(`--bz-${kind}-${i}-mask`, a.mask);
      root.style.setProperty(`--bz-${kind}-${i}-skin`, a.skin);
      root.style.setProperty(`--bz-${kind}-${i}-skin-on-ink`, b.skin);
    }
  }
}
