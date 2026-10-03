// Design POC token loader (P1-U02/U03/U05): reads art/ui/tokens.json and exposes it as CSS custom properties and
// @font-face rules, with --k = the TV scale (output height / 1080) so mocks size everything in TV px at 1080p.
// The game's own token → CSS pipeline is P1-C01's; this exists only for the POC pages.
const ROOT = new URL('../../', import.meta.url);

export async function loadTokens() {
  const tokens = await (await fetch(new URL('tokens.json', ROOT))).json();
  const css = [];
  for (const face of [tokens.fonts.display, tokens.fonts.body]) {
    for (const f of face.files) {
      css.push(`@font-face{font-family:"${face.family}";src:url("${new URL(f.file, ROOT)}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:block}`);
    }
  }
  const vars = [];
  for (const [name, c] of Object.entries(tokens.palette)) vars.push(`--c-${name}:${c.hex}`);
  const fallback = tokens.fonts.fallback.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(',');
  vars.push(`--font-display:"${tokens.fonts.display.family}",${fallback}`, `--font-body:"${tokens.fonts.body.family}",${fallback}`);
  css.push(`:root{${vars.join(';')}}`);
  const style = document.createElement('style');
  style.textContent = css.join('\n');
  document.head.append(style);
  await Promise.all(
    [tokens.fonts.display, tokens.fonts.body].flatMap((face) =>
      face.files.map((f) => document.fonts.load(`${f.style} ${f.weight} 32px "${face.family}"`)),
    ),
  );
  return tokens;
}

/** The seat's identity colour and its badge text colour (seat n takes colour (n-1) mod palette length). */
export function seatColor(tokens, seat) {
  const c = tokens.identity.colors[(seat - 1) % tokens.identity.colors.length];
  return { hex: c.hex, on: tokens.palette[c.on].hex, name: c.name };
}

/** Keep --k = output height / 1080 (TV px at 1080p) on the root element. */
export function trackScale(el = document.documentElement, ref = 1080) {
  const set = () => el.style.setProperty('--k', String(window.innerHeight / ref));
  set();
  window.addEventListener('resize', set);
}

export const asset = (path) => new URL(path, ROOT).href;
