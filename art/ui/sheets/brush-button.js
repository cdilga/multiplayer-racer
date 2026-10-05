// The brushed button (owner round 4, 2026-10-06): the button IS a brushed slab (straight-ish edges, a forward lean), like the sheet's tags and strips, and its
// ink outline follows the stroke, so the shape itself makes the button stand out (it replaces the bordered button sat in
// a torn ink slip). One module for the component sheet, the TV mocks and the phone mocks: it injects its own CSS and
// paints one SVG per `.btn.brush` (seeded by `data-bb` or the label, never animated), repainting when the button resizes.
//
// States are CSS on the SVG, so they work forced (`.is-hover`, `.is-pressed`, `.is-focus-kb`, `.is-focus-gp`,
// `.is-disabled`, as on the sheet) and live (:hover, :active, :focus-visible, [disabled]; `.gp` = gamepad focus):
//   hover     the fill lightens toward paper;
//   pressed   the button drops by the shadow offset and the shadow goes;
//   keyboard  a cobalt ring (saffron on ink) drawn as a wider stroke of the same brush path, so it follows the shape;
//   gamepad   a saffron ring with an ink hairline either side, the chevron tab, a lift and a deeper shadow;
//   disabled  paper-shade fill, soft-ink outline and text, no shadow.
// Each page sets the sizes for its profile: --bb-o (outline), --bb-sh (shadow y), --bb-kb / --bb-gp (ring widths),
// --bb-off (ring offset). The plain `.btn` stays as the compact variant for tight places (footer toolbar, list rows).
import { seeded } from './tokens-css.js';

const fmt = (pts) => `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;

/** A brushed slab across w×h: straight-ish top and bottom with a forward lean, ends that only hint at dry brush. */
export function brushButtonPath(id, w, h) {
  const rnd = seeded(`bb:${id}`);
  const e = Math.min(h * 0.12, w * 0.05); // round 4 (owner: "straight-ish edges"): the ends only hint at the brush
  const lean = h * 0.12; // the slab leans forward like the display italic: the top edge sits a little right of the bottom
  const wave = Math.max(0.4, h * 0.012);
  const pts = [];
  const nTop = Math.max(3, Math.round(w / Math.max(28, h * 0.7)));
  const x0 = e, x1 = w - e;
  for (let i = 0; i <= nTop; i++) pts.push([x0 + lean + (i / nTop) * (x1 - x0 - lean), (rnd() * 2 - 1) * wave]);
  // An end: a few bristles, each reaching out by its own small random length, so the cut reads painted, not ragged.
  const bristles = (xEdge, dir, leanFrom, leanTo, down) => {
    const n = 4;
    for (let i = 1; i < n; i++) {
      const t = i / n, y = down ? h * t : h * (1 - t);
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

const CSS = `
.btn.brush { position: relative; isolation: isolate; background: transparent !important; border-color: transparent !important; box-shadow: none !important; outline: none !important; padding-inline: var(--bb-pad, 1.15em); --bb-base: var(--c-paper); --bb-hov: color-mix(in srgb, var(--c-saffron) 32%, var(--c-paper)); --bb-fill: var(--bb-base); --bb-ink: var(--c-ink); --bb-ring-kb: var(--c-cobalt); }
.btn.brush::after { content: none !important; }
.btn.brush > svg.bb { position: absolute; left: 0; top: 0; z-index: -1; overflow: visible; pointer-events: none; }
.btn.brush:is(.primary, .btn-primary) { --bb-base: var(--c-saffron); --bb-hov: color-mix(in srgb, var(--c-saffron) 55%, var(--c-paper)); }
.btn.brush:is(.danger, .btn-destructive) { --bb-base: var(--c-danger); --bb-hov: color-mix(in srgb, var(--c-danger) 78%, var(--c-paper)); }
.btn.brush.cobalt { --bb-base: var(--c-cobalt); --bb-hov: color-mix(in srgb, var(--c-cobalt) 78%, var(--c-paper)); color: var(--c-paper); }
.btn.brush.danger-o { --bb-ink: var(--c-danger); }
.btn.brush.is-hover { --bb-fill: var(--bb-hov); }
@media (hover: hover) { .btn.brush:not([disabled]):hover { --bb-fill: var(--bb-hov); } }
.on-ink .btn.brush, .btn.brush.on-ink { --bb-ring-kb: var(--c-saffron); }
.bb .bb-fill { fill: var(--bb-fill); stroke: var(--bb-ink); stroke-width: var(--bb-o, 3px); stroke-linejoin: round; }
.bb .bb-shadow { fill: rgb(21 32 58 / .85); stroke: rgb(21 32 58 / .85); stroke-width: var(--bb-o, 3px); stroke-linejoin: round; transform: translateY(var(--bb-sh, 5px)); }
.on-ink .bb .bb-shadow { fill: rgb(0 0 0 / .55); stroke: rgb(0 0 0 / .55); }
.bb .bb-ring { display: none; fill: none; stroke-linejoin: round; }
.bb .bb-kb { stroke: var(--bb-ring-kb); stroke-width: calc(var(--bb-o, 3px) + 2 * (var(--bb-off, 2px) + var(--bb-kb, 3px))); }
.bb .bb-gp-edge { stroke: var(--c-ink); stroke-width: calc(var(--bb-o, 3px) + 2 * (var(--bb-off, 2px) + var(--bb-gp, 4px) + 2px)); }
.bb .bb-gp { stroke: var(--c-saffron); stroke-width: calc(var(--bb-o, 3px) + 2 * (var(--bb-off, 2px) + var(--bb-gp, 4px))); }
.bb .bb-gp-gap { stroke: var(--c-ink); stroke-width: calc(var(--bb-o, 3px) + 2 * var(--bb-off, 2px)); }
.btn.brush.is-pressed, .btn.brush:not([disabled]):active { transform: translateY(var(--bb-sh, 5px)); }
.btn.brush.is-pressed .bb-shadow, .btn.brush:not([disabled]):active .bb-shadow { display: none; }
.btn.brush.is-pressed .bb-fill, .btn.brush:not([disabled]):active .bb-fill { fill: color-mix(in srgb, var(--bb-fill) 86%, var(--c-ink)); }
.btn.brush.is-focus-kb .bb-kb, .btn.brush:focus-visible:not(.gp):not(.is-focus-gp) .bb-kb { display: block; }
.btn.brush.is-focus-gp, .btn.brush.gp { transform: translateY(calc(-1 * var(--bb-lift, 2px))); }
.btn.brush.is-focus-gp .bb-shadow, .btn.brush.gp .bb-shadow { transform: translateY(calc(var(--bb-sh, 5px) * 1.6)); }
.btn.brush.is-focus-gp :is(.bb-gp-edge, .bb-gp, .bb-gp-gap), .btn.brush.gp :is(.bb-gp-edge, .bb-gp, .bb-gp-gap) { display: block; }
.btn.brush.is-disabled, .btn.brush[disabled] { --bb-fill: var(--c-paper-shade) !important; --bb-ink: var(--c-ink-soft); color: var(--c-ink-soft) !important; transform: none; cursor: not-allowed; }
.btn.brush.is-disabled .bb-shadow, .btn.brush[disabled] .bb-shadow { display: none; }
.btn.brush.is-disabled img, .btn.brush[disabled] img { opacity: .55; }
`;

let styled = false;
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => { for (const en of entries) paintOne(en.target); }) : null;

function paintOne(el) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const old = el.querySelector(':scope > svg.bb');
  if (old && +old.getAttribute('width') === w && +old.getAttribute('height') === h) return;
  const id = el.dataset.bb || el.textContent.trim() || 'bb';
  const d = brushButtonPath(id, w, h);
  const svg = `<svg class="bb" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<path class="bb-ring bb-gp-edge" d="${d}"/><path class="bb-ring bb-gp" d="${d}"/><path class="bb-ring bb-gp-gap" d="${d}"/><path class="bb-ring bb-kb" d="${d}"/>`
    + `<path class="bb-shadow" d="${d}"/><path class="bb-fill" d="${d}"/></svg>`; // round 4: clean slabs, no streaks (owner: straight-ish, commit)
  if (old) old.outerHTML = svg; else el.insertAdjacentHTML('afterbegin', svg);
}

/** Paint every `.btn.brush` under root (and keep it painted through resizes). Safe to call again. */
export function paintBrushButtons(root = document) {
  if (!styled) {
    const s = document.createElement('style');
    s.dataset.brushButton = '';
    s.textContent = CSS;
    document.head.prepend(s); // first, so a page's own rules (sizes, per-screen tweaks) win
    styled = true;
  }
  for (const el of root.querySelectorAll('.btn.brush')) {
    paintOne(el);
    ro?.observe(el);
  }
}

/**
 * A brushed background for chips and rows (HUD name and position pills, lobby cards, results rows): the button's brush
 * shape as an SVG data URI, stretched to the element (`background-size: 100% 100%`), its ink outline kept at `stroke` px
 * however it stretches (non-scaling stroke), with the hard sticker shadow baked in. No DOM per element, so a grid of
 * 100+ tiles costs nothing extra. Returns a CSS `url(...)`.
 */
export function brushBg(id, { fill, ink = '#15203a', stroke = 2, shadow = 'rgb(21 32 58 / .85)', w = 200 } = {}) {
  const h = 40, d = brushButtonPath(id, w, h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -1.5 ${w + 6} ${h + 5.5}" preserveAspectRatio="none">`
    + (shadow ? `<path d="${d}" transform="translate(0 3)" fill="${shadow}" stroke="${shadow}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : '')
    + `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The brush system (owner round 4, 2026-10-06: "a consistent brush adjacent style and design language for the lot").
// Every surface that used to be a rounded box — number badges, status chips, HUD pills, roster cards, results rows,
// footer pills and toolbar buttons, paper panels — is now cut from the same seeded brush family as the buttons:
//   chip   short stroke, ragged bristle ends (pills, HUD, footer)       row    the same stroke on a long box (cards, rows)
//   badge  a stubby dab (number badges)                                  panel  a hand-cut sheet with a gentle wobble
// Each kind is two images, set once as CSS variables on :root by installBrushSkins():
//   --bz-<kind>-<i>-mask  the shape (plus its outline and the shadow below it): where the element shows at all;
//   --bz-<kind>-<i>-skin  the ink outline that follows the shape and the hard sticker shadow under it.
// A brushed element is `mask: <mask>` with `background: <skin>, <fill>`, so ANY fill works (a seat colour, a state
// colour) and the outline and shadow stay the language's. The `-on-ink` skins swap the outline to paper for ink surfaces.
import { wobblePath } from './tokens-css.js';

const SHAPES = {
  chip: { w: 150, h: 40, path: (id, w, h) => brushButtonPath(id, w, h) },
  row: { w: 560, h: 40, path: (id, w, h) => brushButtonPath(id, w, h) },
  badge: { w: 84, h: 40, path: (id, w, h) => wobblePath(`badge:${id}`, w, h, 1.6, [2, 3]) }, // a clean hand-cut dab: bristles fight a number this small
  panel: { w: 420, h: 300, path: (id, w, h) => wobblePath(`panel:${id}`, w, h, 2.2, [3, 5]) },
};
const enc = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

function skinPair(kind, i, { stroke, sy, ink, shadow }) {
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

// The one caption (br-dim.8, tokens.language.banner.caption): the intermission subtitle's brush strip for every caption.
// The page paints the strip like any [data-brush] tag; --capt-size sets the profile size (TV/desk/handheld).
//   .capt            saffron strip, ink text, tag skew and a -2° tilt, at most two lines
//   .capt.ink/.teal  a quiet line / a positive callout      .capt.flat  no tilt (in a band)      .capt.one  one line, ellipsis
const BZ_CSS = `
.capt { --capt-fill: var(--c-saffron); --capt-fg: var(--c-ink); position: relative; isolation: isolate; display: inline-block; width: fit-content; max-width: 100%; box-sizing: border-box; padding: .1em .65em .14em; color: var(--capt-fg); font: 900 italic var(--capt-size, 30px)/1.05 var(--font-display); text-transform: uppercase; letter-spacing: .01em; text-align: center; transform: rotate(var(--capt-rot, -2deg)) skewX(var(--skew-tag, -10deg)); }
.capt > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; transform: skewX(calc(-1 * var(--skew-tag, -10deg))); }
.capt > svg path { fill: var(--capt-fill); }
.capt.ink { --capt-fill: var(--c-ink); --capt-fg: var(--c-paper); }
.capt.teal { --capt-fill: var(--c-teal); }
.capt.flat { --capt-rot: 0deg; }
.capt.one > span { display: block; white-space: nowrap; text-overflow: ellipsis; }
.capt .badge { font-size: .8em; vertical-align: .05em; }
.bz { -webkit-mask: var(--bz-mask) 0 0 / 100% 100% no-repeat; mask: var(--bz-mask) 0 0 / 100% 100% no-repeat; background: var(--bz-skin) 0 0 / 100% 100% no-repeat, var(--bz-fill, var(--c-paper)) !important; border-color: transparent !important; border-radius: 0 !important; box-shadow: none !important; }
`;

/**
 * Put the brush skins on root as CSS variables, at this page's outline width (px, as it renders) and shadow depth (in
 * the shape's own units: about a tenth of its height). Call again when the page's scale changes. Four seeded variants
 * per kind (`-0` … `-3`) so neighbours never look stamped.
 */
export function installBrushSkins(root = document.documentElement, { stroke = 3, sy = 4, ink = '#15203a', paper = '#fff4de' } = {}) {
  if (!document.querySelector('style[data-bz]')) {
    const s = document.createElement('style');
    s.dataset.bz = '';
    s.textContent = BZ_CSS;
    document.head.prepend(s);
  }
  for (const kind of Object.keys(SHAPES)) {
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
