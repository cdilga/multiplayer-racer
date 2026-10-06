// Painted shapes for the R102 language (tokens.language.banner), ported from art/ui/sheets/tokens-css.js (seeded, paintPath,
// strokePath, wobblePath, tiltFor): seeded by an element's stable id so the same banner has the same torn edge everywhere,
// and never animated.
export function seeded(id: string): () => number {
  let s = 2166136261;
  for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

type Pt = [number, number];
const fmt = (pts: Pt[]) => `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;

/** A torn heading banner: ragged teeth along the top and bottom, chewed ends (amp = tokens tornAmplitudePx). */
export function tornPath(id: string, w: number, h: number, amp: number): string {
  return paintPath(id, w, h, amp, 'torn');
}

/**
 * The R102 shapes (tokens.language.banner), ported from art/ui/sheets/tokens-css.js `paintPath`, seeded by id, never animated:
 * 'torn' is a heading banner (ragged teeth top and bottom, chewed ends); 'brush' is a tag, strip or caption (near-straight
 * top and bottom, dry-brush ends).
 */
export function paintPath(id: string, w: number, h: number, amp: number, kind: 'torn' | 'brush' = 'torn'): string {
  const rnd = seeded(`${kind}:${id}`);
  const pts: Pt[] = [];
  const along = (x0: number, x1: number, y: number, out: number, toothPx: number, depth: number) => {
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / toothPx));
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * (i + rnd() * 0.6)) / n, y + out * rnd() * depth]);
  };
  const end = (x: number, y0: number, y1: number, out: number, n: number, depth: number) => {
    for (let i = 0; i < n; i++) pts.push([x + out * rnd() * depth, y0 + ((y1 - y0) * (i + 0.5)) / n]);
  };
  if (kind === 'torn') {
    along(0, w, 0, -1, 9, amp);
    end(w, 0, h, 1, 4, amp * 1.6);
    along(w, 0, h, 1, 9, amp);
    end(0, h, 0, -1, 4, amp * 1.6);
  } else {
    along(0, w, 0, -1, 40, amp * 0.3);
    end(w, 0, h, 1, 7, amp * 2.2);
    along(w, 0, h, 1, 40, amp * 0.3);
    end(0, h, 0, -1, 7, amp * 2.2);
  }
  return fmt(pts);
}

/** A highlighter stroke under a word (tokens.language.banner.underline): thick at the start, tapering out. */
export function strokePath(id: string, w: number, h: number): string {
  const rnd = seeded(`stroke:${id}`);
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const half = (h / 2) * (1 - 0.65 * t * t) * (0.9 + rnd() * 0.2);
    const mid = h / 2 + (t - 0.5) * h * 0.25;
    top.push([t * w, mid - half]);
    bottom.push([t * w, mid + half]);
  }
  return fmt([[-h * 0.3 * rnd(), h / 2], ...top, [w + h * 0.2, h * 0.55], ...bottom.reverse()]);
}

/** A hand-cut outline for a w×h panel or badge: seeded wobble of ±amp on each edge, [min, max] segments per edge. */
export function wobblePath(id: string, w: number, h: number, amp: number, [minSeg, maxSeg]: [number, number]): string {
  const rnd = seeded(id);
  const pts: Pt[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const n = minSeg + Math.floor(rnd() * (maxSeg - minSeg + 1));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const j = i === 0 ? 0 : (rnd() * 2 - 1) * amp;
      pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
    }
  };
  edge(0, 0, w, 0, 0, 1);
  edge(w, 0, w, h, 1, 0);
  edge(w, h, 0, h, 0, 1);
  edge(0, h, 0, 0, 1, 0);
  return fmt(pts);
}

/** A free panel's tilt in degrees, seeded by id, within ±max (tokens.language.slant.panelTiltMaxDeg); never so small it reads as a mistake. */
export function tiltFor(id: string, max: number): number {
  const t = (seeded(`tilt:${id}`)() * 2 - 1) * max;
  return +(Math.sign(t) * Math.max(Math.abs(t), max * 0.35)).toFixed(2);
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
