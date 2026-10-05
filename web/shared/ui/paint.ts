// Painted shapes for the R102 language (tokens.language.banner), ported from art/ui/sheets/tokens-css.js: seeded by
// an element's stable id so the same banner has the same torn edge everywhere, and never animated.
function seeded(id: string): () => number {
  let s = 2166136261;
  for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

type Pt = [number, number];
const fmt = (pts: Pt[]) => `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;

/** A torn heading banner: ragged teeth along the top and bottom, chewed ends (amp = tokens tornAmplitudePx). */
export function tornPath(id: string, w: number, h: number, amp: number): string {
  const rnd = seeded(`torn:${id}`);
  const pts: Pt[] = [];
  const along = (x0: number, x1: number, y: number, out: number) => {
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 9));
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * (i + rnd() * 0.6)) / n, y + out * rnd() * amp]);
  };
  const end = (x: number, y0: number, y1: number, out: number) => {
    for (let i = 0; i < 4; i++) pts.push([x + out * rnd() * amp * 1.6, y0 + ((y1 - y0) * (i + 0.5)) / 4]);
  };
  along(0, w, 0, -1);
  end(w, 0, h, 1);
  along(w, 0, h, 1);
  end(0, h, 0, -1);
  return fmt(pts);
}

/** Puts a torn banner behind `el` (an SVG sized to it, redrawn on resize). `amp` is the --torn-amp value if omitted. */
export function tornBanner(el: HTMLElement, id: string, amp?: number): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'paint-svg');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.append(path);
  el.prepend(svg);
  const draw = () => {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const a = amp ?? (parseFloat(getComputedStyle(el).getPropertyValue('--torn-amp')) || 3);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    path.setAttribute('d', tornPath(id, w, h, a));
  };
  draw();
  new ResizeObserver(draw).observe(el);
}
