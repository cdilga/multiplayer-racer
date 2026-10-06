// The one caption (br-dim.8, tokens.language.banner.caption): the intermission subtitle's brush strip, used for every caption
// (replay annotations, quiet lines, callouts). Ported from the `.capt` rules in art/ui/sheets/brush-button.js and the
// `[data-brush]` painting in art/ui/sheets/components.js, which draw the strip with paintPath(..., 'brush').
//
// The strip is painted behind the text from the element's size and repainted when it resizes. The text is any length and
// the page decides how many captions there are; the design clamps one caption to two lines with an ellipsis (brush.css),
// so copy stays short, but nothing here truncates or counts.
import { paintPath } from './paint';

export type CaptionTone = 'saffron' | 'ink' | 'teal';

export interface CaptionOptions {
  /** saffron (default): a replay annotation; ink: a quiet line; teal: a positive callout. */
  tone?: CaptionTone;
  /** No tilt, for use inside a band (the host footer). */
  flat?: boolean;
  /** One line with an ellipsis instead of two. */
  oneLine?: boolean;
  /** Seeds the brush shape: the same id gives the same strip everywhere. Defaults to the text. */
  id?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => entries.forEach((en) => paintStrip(en.target as HTMLElement))) : null;

function paintStrip(el: HTMLElement): void {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  let svg = el.querySelector<SVGSVGElement>(':scope > svg.paint-svg');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'paint-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.append(document.createElementNS(SVG_NS, 'path'));
    el.prepend(svg);
  }
  const amp = parseFloat(getComputedStyle(el).getPropertyValue('--torn-amp')) || 3;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.firstElementChild?.setAttribute('d', paintPath(el.dataset.brush || el.textContent?.trim() || 'capt', w, h, amp, 'brush'));
}

/** Paint every `.capt[data-brush]` under root and keep it painted through resizes. Safe to call again. */
export function paintCaptions(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('.capt[data-brush]')) {
    paintStrip(el);
    ro?.observe(el);
  }
}

/** A caption element: `<span class="capt"><span>text</span></span>`, painted once it is in the document. */
export function caption(content: string | Node, o: CaptionOptions = {}): HTMLElement {
  const el = document.createElement('span');
  el.className = ['capt', o.tone === 'ink' ? 'ink' : o.tone === 'teal' ? 'teal' : '', o.flat ? 'flat' : '', o.oneLine ? 'one' : ''].filter(Boolean).join(' ');
  el.dataset.brush = o.id ?? (typeof content === 'string' ? content : 'capt');
  const inner = document.createElement('span');
  inner.append(content);
  el.append(inner);
  ro?.observe(el); // paints as soon as it has a size, i.e. once it is attached
  return el;
}
