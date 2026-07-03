# Skip Bin Arcade bundled fonts (br-skip-bin-arcade-design-language-5k3.25)

Two brand typefaces, **bundled and self-hosted in this repo** (no CDN, no network
fetch — CLAUDE.md rule). Consumed via CSS custom properties defined in
`static/css/{host,player,landing}.css`:

| Token | @font-face family | File | Source face | License |
|-------|-------------------|------|-------------|---------|
| `--font-display` | `SkipBinDisplay` | `skip-bin-display.woff2` | DejaVu Serif Bold (Latin subset) | DejaVu / Bitstream Vera (permissive, redistributable) |
| `--font-body` | `SkipBinBody` | `skip-bin-body.woff2` | DejaVu Sans (Latin subset) | DejaVu / Bitstream Vera (permissive, redistributable) |

The `@font-face` `src` lists the repo-local woff2 FIRST, then `local(...)`
fallbacks:

```css
src: url('/static/assets/fonts/skip-bin-display.woff2') format('woff2'),
     local('Oswald'), local('Bebas Neue'), ...;
```

## Provenance / how these were produced (offline, no CDN)
- Source: DejaVu family TTFs (open-licensed). Full license text: `LICENSE_DEJAVU.txt`.
- Subset to printable Latin + common punctuation with `fontTools.subset` (keeps
  the files small, ~15 KB each), then packed to WOFF2 (brotli, quality 11).
- The files are valid WOFF2 (signature `wOF2`); they reconstruct to a valid sfnt
  that `fontTools` parses (DejaVu Serif / DejaVu Sans, full Latin cmap).

## Swapping in a different open-license display/body face later
Replace the `.woff2` files and keep the same filenames + `@font-face` families;
no CSS/component changes needed. (Condensed display faces like Oswald/Anton or a
body face like Inter — all SIL OFL — are drop-in replacements.)
