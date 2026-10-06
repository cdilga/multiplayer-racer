// The paper join QR (owner round 4, e74b0ac): always on paper (ink modules on the paper colour, as art/ui/poc/shared/
// qr-roo7-paper.svg), always labelled with the room code in the display face and the domain, never with anything in the middle.
// The POC made that SVG offline with art/ui/poc/shared/make-qr.py (python `qrcode`); production builds it here with the
// bundled `uqr` encoder, so any room code and any join URL works. Rules from tokens.qr: error correction M, a quiet zone of
// at least 4 modules on every side (inside the SVG, so the paper surrounds the code), a minimum px per module per profile.
import { encode } from 'uqr';
import { tokenData } from './tokens.generated';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PaperQr {
  /** Modules per side, quiet zone included. */
  modules: number;
  /** The SVG markup: paper background, ink modules, viewBox in modules, crisp edges. */
  svg: string;
}

/** Encodes `url` (error correction M) into a paper SVG with the full quiet zone. */
export function paperQrSvg(url: string): PaperQr {
  const q = tokenData.qr.quietZoneModules;
  const { data, size } = encode(url, { ecc: 'M', border: 0 });
  const n = size + 2 * q;
  let path = '';
  for (let y = 0; y < size; y++) {
    // Runs of dark modules in a row become one rect: a short path, the same picture.
    for (let x = 0; x < size; x++) {
      if (!data[y]![x]) continue;
      let run = 1;
      while (x + run < size && data[y]![x + run]) run++;
      path += `M${x + q} ${y + q}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const { ink, paper } = tokenData.palette;
  return {
    modules: n,
    svg: `<svg xmlns="${SVG_NS}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${paper}"/><path fill="${ink}" d="${path}"/></svg>`,
  };
}

/** The smallest the QR may be drawn on `profile`: modules (quiet zone included) times tokens.qr.minModulePx. */
export function paperQrMinPx(url: string, profile: 'tv' | 'desk' | 'handheld'): number {
  return paperQrSvg(url).modules * tokenData.qr.minModulePx[profile];
}

export interface PaperQrCardOptions {
  /** The join URL the QR carries, e.g. https://jammers.dilger.dev/j/ROO7. */
  url: string;
  /** The room code shown beside it, e.g. ROO7. */
  code: string;
  /** The domain shown with the code, e.g. jammers.dilger.dev. */
  domain: string;
  /** Edge of the QR image in CSS px; the page sizes it (default: --qr-size, else the profile's minimum). */
  size?: number;
}

/**
 * The labelled paper QR: `<figure class="qr-card">` with the QR image, the code in the display face and the domain.
 * The label sits outside the QR's quiet zone, never inside the code.
 */
export function paperQrCard(o: PaperQrCardOptions): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'qr-card';
  if (o.size) fig.style.setProperty('--qr-size', `${o.size}px`);
  const img = document.createElement('img');
  img.className = 'qr';
  img.alt = `Join QR for room ${o.code}`;
  img.src = `data:image/svg+xml,${encodeURIComponent(paperQrSvg(o.url).svg)}`;
  img.decoding = 'sync';
  const code = document.createElement('b');
  code.className = 'display qr-code';
  code.textContent = o.code;
  const domain = document.createElement('span');
  domain.className = 'qr-domain';
  domain.textContent = o.domain;
  const cap = document.createElement('figcaption');
  cap.append(code, domain);
  fig.append(img, cap);
  return fig;
}
