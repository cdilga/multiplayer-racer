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

/** Deterministic wobbly outline path for a w×h panel (tokens.wobble): seeded, never animated. */
export function wobblePath(id, w, h, amp, [minSeg, maxSeg]) {
  let s = 2166136261;
  for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
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
  return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;
}
