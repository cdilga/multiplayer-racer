// Sheet-only helper: loads ../tokens.json and exposes it as CSS custom properties plus @font-face
// rules, so every sheet renders from the tokens alone. (The game's real token → CSS pipeline is
// P1-C01's web/shared/ui; this exists only for the design sheets.)
export async function applyTokens(profile = 'desk') {
  const tokens = await (await fetch('../tokens.json')).json();
  const css = [];
  for (const face of [tokens.fonts.display, tokens.fonts.body]) {
    for (const f of face.files) {
      css.push(`@font-face{font-family:"${face.family}";src:url("../${f.file}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:block}`);
    }
  }
  const vars = [];
  for (const [name, c] of Object.entries(tokens.palette)) vars.push(`--c-${name}:${c.hex}`);
  tokens.identity.colors.forEach((c, i) => {
    vars.push(`--id-${i}:${c.hex}`, `--id-${i}-on:${tokens.palette[c.on].hex}`);
  });
  const fallback = tokens.fonts.fallback.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(',');
  vars.push(`--font-display:"${tokens.fonts.display.family}",${fallback}`);
  vars.push(`--font-body:"${tokens.fonts.body.family}",${fallback}`);
  const p = tokens.type.profiles[profile];
  for (const [k, v] of Object.entries(p.scale)) vars.push(`--fs-${k}:${v}px`);
  const mult = tokens.space.profileMultiplier[profile];
  tokens.space.steps.forEach((s, i) => vars.push(`--sp-${i}:${s * mult}px`));
  vars.push(`--outline:${tokens.ink.outlinePx[profile]}px`);
  vars.push(`--radius:${tokens.layout.radiusPx[profile]}px`);
  // R102 language (P1-U01.3): per-element corners, slants and the torn-banner amplitude.
  const L = tokens.language;
  vars.push(`--r-panel:${L.corners.panelPx[profile]}px`, `--r-banner:${L.corners.bannerPx[profile]}px`, `--r-badge:${L.corners.badgePx[profile]}px`);
  vars.push(`--slant-heading:${L.slant.headingRotateDeg}deg`, `--skew-tag:${L.slant.tagSkewDeg}deg`, `--rot-tag:${L.slant.tagRotateDeg}deg`, `--skew-strip:${L.slant.stripSkewDeg}deg`);
  vars.push(`--torn-amp:${L.banner.heading.tornAmplitudePx[profile]}`);
  vars.push(`--touch:${tokens.layout.minTouchTargetPx}px`);
  const sh = tokens.ink.stickerShadow;
  vars.push(`--sticker-shadow:${sh.x}px ${sh.y}px ${sh.blur}px rgb(21 32 58 / ${sh.opacity})`);
  vars.push(`--focus-kb-w:${tokens.focus.keyboard.widthPx[profile]}px`, `--focus-kb-off:${tokens.focus.keyboard.offsetPx[profile]}px`);
  vars.push(`--focus-gp-w:${tokens.focus.gamepad.widthPx[profile]}px`, `--focus-gp-off:${tokens.focus.gamepad.offsetPx[profile]}px`);
  css.push(`:root{${vars.join(';')}}`);
  const style = document.createElement('style');
  style.textContent = css.join('\n');
  document.head.append(style);
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
  return tokens;
}

/** A seeded random source in [0, 1) from an element's stable id: the same id gives the same shape everywhere. */
export function seeded(id) {
  let s = 2166136261;
  for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

/** A free panel's tilt in degrees, seeded by id, within ±max (tokens.language.slant.panelTiltMaxDeg). */
export function tiltFor(id, max) {
  const rnd = seeded(`tilt:${id}`);
  const t = (rnd() * 2 - 1) * max;
  return +(Math.sign(t) * Math.max(Math.abs(t), max * 0.35)).toFixed(2); // never so small it reads as a mistake
}

const fmt = (pts) => `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;

/**
 * Painted shapes for the R102 language (tokens.language.banner), seeded by id and never animated:
 * - 'torn': a heading banner, ragged teeth along the top and bottom and chewed ends (amp = tornAmplitudePx);
 * - 'brush': a tag or strip, near-straight top and bottom with dry-brush ends.
 */
export function paintPath(id, w, h, amp, kind = 'torn') {
  const rnd = seeded(`${kind}:${id}`);
  const pts = [];
  const along = (x0, x1, y, out, toothPx, depth) => {
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / toothPx));
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + rnd() * 0.6)) / n;
      pts.push([x, y + out * rnd() * depth]);
    }
  };
  const end = (x, y0, y1, out, n, depth) => {
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

/** A highlighter stroke under a word (tokens.language.banner.underline): thick at the start, tapering out, rough start. */
export function strokePath(id, w, h) {
  const rnd = seeded(`stroke:${id}`);
  const top = [], bottom = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = t * w;
    const half = (h / 2) * (1 - 0.65 * t * t) * (0.9 + rnd() * 0.2);
    const mid = h / 2 + (t - 0.5) * h * 0.25;
    top.push([x, mid - half]);
    bottom.push([x, mid + half]);
  }
  return fmt([[-h * 0.3 * rnd(), h / 2], ...top, [w + h * 0.2, h * 0.55], ...bottom.reverse()]);
}

/** Deterministic wobbly outline path for a w×h panel (tokens.wobble): seeded, never animated. */
export function wobblePath(id, w, h, amp, [minSeg, maxSeg]) {
  const rnd = seeded(id);
  const pts = [];
  const edge = (x0, y0, x1, y1, nx, ny) => {
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
