# br-skip-bin-arcade-design-language-5k3.25 slice A — Evidence (NobleBay) — bundled-fonts REPAIR

Repairs the validation BLOCKED (fonts were local()-only). Slice A foundation only; NO dirty component UI touched. Reservations 3501-3509 (renewed). Bead in_progress; NOT closed.

## REPAIR: real repo-local bundled .woff2 fonts (open-licensed, no CDN)
- `static/assets/fonts/skip-bin-display.woff2` — 13384 bytes, WOFF2 (sig `wOF2`). Source: **DejaVu Serif Bold** (Latin subset).
- `static/assets/fonts/skip-bin-body.woff2` — 14016 bytes, WOFF2 (sig `wOF2`). Source: **DejaVu Sans** (Latin subset).
- `static/assets/fonts/LICENSE_DEJAVU.txt` — full DejaVu/Bitstream Vera license (permissive, redistributable).
- `static/assets/fonts/README.md` — provenance + how produced + swap-in seam.
- Produced OFFLINE (no CDN/network): subset with fontTools.subset, packed to WOFF2 with brotli (quality 11) via fontTools. Files are OTS-valid and **browser-decodable** (Chromium `new FontFace(...).load()` resolves — verified).

## CSS now consumes the bundled woff2 (url ahead of local())
In all three shared stylesheets (host/player/landing.css):
```css
@font-face { font-family: 'SkipBinDisplay';
  src: url('/static/assets/fonts/skip-bin-display.woff2') format('woff2'),
       local('Oswald'), local('Bebas Neue'), ...; }
@font-face { font-family: 'SkipBinBody';
  src: url('/static/assets/fonts/skip-bin-body.woff2') format('woff2'),
       local('Inter'), local('Helvetica Neue'), ...; }
```

## Tests updated to FAIL if bundling regresses
- `tests/unit/ui-theme.test.js`: each @font-face must reference a repo-local `/static/assets/fonts/skip-bin-*.woff2` with `format('woff2')` (local-only now fails); no remote CDN url; AND the woff2 files must exist, be >2000 bytes, and carry the `wOF2` signature (reads the bytes).
- `tests/e2e/ui-system.spec.ts`: fetches both `/static/assets/fonts/*.woff2` from the SERVED app — asserts HTTP 200, `wOF2` signature, size, AND that the browser DECODES each via `FontFace.load()`.

## Commands (fresh, by me)
- `npx vitest run tests/unit/ui-theme.test.js tests/unit/grain-overlay.test.js` => **43 passed** (log: vitest.log)
- `npm run build` => **PASS** (`✓ built`; woff2 copied to dist/assets/fonts/, served at /static/assets/fonts/) (log: build.log)
- `npx playwright test tests/e2e/ui-system.spec.ts` => **2 passed** — host + player: tokens resolve to SkipBin families; both woff2 serve (200, wOF2) and load in-browser (FontFace.load ok); grain overlay pointer-events:none + reduce-effects hide. (log: e2e.log). Screenshots: host-foundation.png, player-foundation.png.

## Scope
Only reserved paths touched: host/player/landing.css (M), static/assets/fonts/ (new woff2+README+LICENSE), static/js/ui/GrainOverlay.js, 3 tests, artifacts. Dirty component UI (LobbyUI/RaceUI/RoomCodeOverlay/host+player templates/RenderSystem/GameHost) NOT touched — component adoption/de-glass remains deferred slice C.

## Remaining (deferred slice C) — unchanged
Adopt tokens + remove glass/glow inside the dirty component UIs and wire GrainOverlay.attach() into the host bootstrap; needs those files released. Optional: swap DejaVu for a condensed display face (e.g. Oswald OFL) per the README seam (filenames/families unchanged).

---

# Slice C — full UI adoption / de-glass (NobleBay)

Full-bead adoption pass after the PASS-SLICE/BLOCKED-FULL-BEAD verdict. Reserved every additional file (3524-3533) before editing. Preserved other-agent WIP in dirty files (line-local font/blur edits only). Bead in_progress; NOT closed.

## DE-GLASS — all glass/blur removed from production UI (10 occurrences -> none)
- static/css/player.css (1), static/css/landing.css (4), static/js/ui/LobbyUI.js (2), frontend/player/index.html (1), frontend/host/index.html (2): every `backdrop-filter: blur(Npx)` / `-webkit-backdrop-filter` -> `none`.
- ResultsUI.js: 4 soft red neon glows (`box-shadow: 0 0 Npx rgba`) -> hard sticker offset shadows (`2px 2px 0 rgba`).
- Final scan: `grep -rniE "blur\(" static/css static/js/ui frontend/{host,player}/index.html` => NONE.

## ONE TYPE SYSTEM — production UI routed onto the brand faces
- Aliased legacy token: appended `:root { --font-sans: var(--font-body); }` to host/player/landing.css, so every existing `var(--font-sans)` usage now resolves to the bundled brand body face (unifies without touching those consumers).
- Wrapped raw declarations onto tokens (behavior-preserving, original stack kept as fallback): `font-family: -apple-system,...` -> `var(--font-body, ...)`; `font-family: monospace` -> `var(--font-mono, monospace)`; across host.css, RaceUI, ResultsUI, LobbyUI, RoomCodeOverlayUI, GameMenuUI, StatsOverlayUI, VehicleIdentityOverlay, frontend/host/index.html.
- Final scan: no unwrapped `-apple-system`/`monospace`/`'Segoe UI'` `font-family` in production UI.

## JUSTIFIED EXCEPTIONS (not player-facing chrome)
- Dev/debug JS: `PhysicsTuningUI.js`, `BugReportUI.js` (documented in the guard test).
- Dev tool pages: `frontend/weapon-lab/index.html`, `frontend/car-viewer/index.html` (developer surfaces, untracked/other-bead, not reserved, not player chrome).

## REGRESSION GUARD (new test — fails on regression, not manual grep)
- `tests/unit/ui-deglass-guard.test.js` (3533, new, 27 tests): for every production-UI file asserts (1) no `blur(`; (2) no raw system/monospace `font-family` outside `var(--font-*)`; plus adoption asserted (tokens are used) and the `--font-sans -> --font-body` alias exists in all three stylesheets. Debug exceptions are an explicit list.

## COMMANDS (fresh, by me)
- `npx vitest run tests/unit/ui-theme.test.js tests/unit/grain-overlay.test.js tests/unit/ui-deglass-guard.test.js` => **70 passed** (34 theme + 9 overlay + 27 de-glass guard).
- `npm run build` => **PASS** (`✓ built`).
- `npx playwright test tests/e2e/ui-system.spec.ts` => **2 passed** (host + player: tokens resolve, bundled woff2 serve+decode, grain overlay pointer-events:none + reduce-effects hidden, no console errors). Screenshots: host-foundation.png, player-foundation.png.

## SCOPE / WIP PRESERVATION
- Edited only reserved paths (foundation 3501-3509 + adoption 3524-3533). Component files LobbyUI/RaceUI/RoomCodeOverlayUI/host-template were dirty from other agents; my edits are line-local font/blur changes (~5 lines each) that preserve their WIP — build + e2e confirm the components still compile and run with no console errors. GameMenuUI/StatsOverlayUI/VehicleIdentityOverlay/ResultsUI/player-template were clean.
- Controller invariant held: player/phone UI unchanged except de-glass + font tokens; no world rendering or heavy overlay added; grain overlay is pointer-events:none (asserted on /player).

---

# Blocker fix pass (StormyMill position 20) — NobleBay

Fixed the four validation blockers, not a redesign. Reserved 3547-3558 before editing. Bead in_progress; NOT closed.

## 1) Remaining raw fonts — FIXED (comprehensive)
- `frontend/player/index.html:99` `font-family: 'monospace'` -> `var(--font-mono, monospace)`.
- `static/css/landing.css:406` `font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace` -> `var(--font-mono, ...)`.
- `font-family: inherit` (landing.css:247) left as-is (a keyword, inherits the tokenized parent — allowed).
- Final scan: zero un-tokenized `font-family` in production UI.

## 2) Guard strengthened
`tests/unit/ui-deglass-guard.test.js` (now 40 tests):
- Font rule rewritten to parse EVERY `font-family:` value and fail unless it is `var(--font-*)`, a keyword (inherit/initial/unset), or a `'SkipBin*'` @font-face family. This catches quoted monospace, mono-stack starts ('SF Mono'/'Cascadia Code'), BlinkMacSystemFont, etc. (regression-verified against the two cases above).
- New glow rule: fails any `box-shadow|text-shadow|drop-shadow` containing `0 0 <N>px` (soft glow) and any `--glow-(cyan|green|pink): 0 0 Npx` soft token, across all production UI; asserts the glow tokens are neutralised to sticker shadows. Narrow allowed-exception list is present but empty (everything was converted).

## 3) Soft neon glow — REMOVED / converted to sticker chrome
- Neutralised the neon glow TOKENS at the source: `--glow-cyan/green/pink` in host.css, player.css, landing.css -> `var(--shadow-sticker, 2px 2px 0 #14110f)`. This de-glows all 18 `var(--glow-*)` consumers (the bulk of the player.css/landing.css glow usages StormyMill listed) in 9 token lines — surgical, not a redesign.
- Converted all 32 literal `0 0 Npx` soft glows (box-shadow/text-shadow/drop-shadow) across host/player/landing.css, both templates, LobbyUI, RaceUI, VehicleIdentityOverlay, ResultsUI -> hard sticker offset shadows `2px 2px 0`. Zero-blur hairlines (`0 0 0 1px`) preserved.
- Repaired 3 non-shadow properties the blunt pass had clipped (recovered exact originals from HEAD): `flex: 0 0 30px` (player template), `margin: 0 0 30px` (ResultsUI title), `margin: 0 0 15px` (LobbyUI audio h3). Re-audit: no `2px 2px 0` on any non-shadow property.
- Final scan: zero soft glow in production UI.

## 4) Browser proof now exercises adopted production UI
`tests/e2e/ui-system.spec.ts` (docstring updated off "slice A"): new test renders the REAL `window.RaceUI` HUD (3 players) and asserts the health-bar name `font-family` resolves through the brand token chain (`SkipBin`/mono, not bare `-apple-system`), no element has `backdrop-filter` blur, name text FITS (`scrollWidth <= clientWidth`), stacked HUD items do NOT overlap, and no console errors. Foundation host + player tests retained (tokens, woff2 serve+decode, overlay non-interactive/reduce-effects).

## Commands (fresh)
- `npx vitest run tests/unit/ui-theme.test.js tests/unit/grain-overlay.test.js tests/unit/ui-deglass-guard.test.js` => **83 passed** (34 + 9 + 40).
- `npm run build` => **PASS**.
- `npx playwright test tests/e2e/ui-system.spec.ts` => **3 passed** (foundation host, adopted RaceUI HUD, player).

## Scope / invariants
- Edited only reserved paths 3547-3558. Dirty component files got line-local shadow/font edits preserving other-agent WIP (build + e2e confirm they compile and render). Controller invariant held: `/player` de-glassed + tokenised only; no world renderer/heavy overlay; grain overlay pointer-events:none asserted.
- Justified exceptions (unchanged, documented in the guard): debug `PhysicsTuningUI.js`/`BugReportUI.js`; dev tool pages `frontend/weapon-lab`/`car-viewer` (not player chrome, not reserved).

---

# Blocker fix — shared grain overlay wired into the LIVE host (CobaltTiger)

Fixes the BLOCKED-FULL-BEAD finding (GrainOverlay existed but was never attached in production). Reservations 3564 src/host/main.js, 3565 tests/e2e/ui-system.spec.ts, 3566 artifacts. Bead in_progress; NOT closed. Host-only scope (that is where the blocker was); no /player renderer added.

## Wiring (production bootstrap, not a test)
`src/host/main.js`:
- L16 `import { GrainOverlay } from '/static/js/ui/GrainOverlay.js';`
- After `window.game = game`: `const grainOverlay = new GrainOverlay(); grainOverlay.attach();` then `if (GrainOverlay.prefersReducedMotion()) grainOverlay.setEnabled(false);` and `window.__sbGrainOverlay = grainOverlay;`
So the running host DOM now contains `.sb-grain-overlay` (appended to `<body>`) with `pointer-events:none` (overlay + CSS), reduce-effects/`prefers-reduced-motion` aware. Confirmed compiled into the production bundle: `grep -rl "__sbGrainOverlay" dist/assets/*.js` => `dist/assets/host-*.js`.

## e2e strengthened (fails without live wiring)
New `tests/e2e/ui-system.spec.ts` test: after `/host` boot (waitForSelector #room-code-display), asserts — WITHOUT any test injection — that `document.querySelectorAll('.sb-grain-overlay').length >= 1`, `window.__sbGrainOverlay` exists, computed `pointer-events:none` + `position:fixed` + `aria-hidden=true`, and that `setEnabled(false)` hides the LIVE overlay (`display:none`). Kept the RaceUI HUD tokenized/de-glassed/text-fit/no-overlap test and the player controller test.

## Commands (fresh, by me)
- `npx vitest run tests/unit/ui-theme.test.js tests/unit/grain-overlay.test.js tests/unit/ui-deglass-guard.test.js` => PASS, 83 tests (3 files).
- `npm run build` => PASS, `✓ built in 2.66s`; wiring present in dist/assets/host-*.js.
- `npx playwright test tests/e2e/ui-system.spec.ts` => 4 passed (was 3): the new live-overlay test + foundation + RaceUI HUD + player controller. Ran from a clean server on freshly-built production dist.
- Source scan: `grep -nE "GrainOverlay|__sbGrainOverlay|attach\(\)" src/host/main.js` => import + `new GrainOverlay()` + `attach()` in the product bootstrap (not test).

## Scope / role
- Only reserved paths changed: src/host/main.js (M), tests/e2e/ui-system.spec.ts, artifacts. No /player renderer or heavy overlay added; player role remains controller/HUD-only (player e2e still green).
