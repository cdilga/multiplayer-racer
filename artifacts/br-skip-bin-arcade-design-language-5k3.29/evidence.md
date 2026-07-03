# br-skip-bin-arcade-design-language-5k3.29 evidence

Agent: BlueLake
Date: 2026-07-02

## Scope

- Host-only loading screen slice.
- Reserved paths: `frontend/host/index.html`, `src/host/main.js`, `tests/e2e/loading-overlay.spec.ts`, `artifacts/br-skip-bin-arcade-design-language-5k3.29/**`.
- Avoided player/server/LobbyUI/join-route paths reserved by NobleBay for woq.11.

## Changes

- Replaced generic spinner loading UI with Skip Bin Arcade in-language camcorder/car-assembly state.
- Preserved nonblocking startup controller, show delay, timeout, skip action, and test hooks.
- Added progress pips driven by `data-loading-step`.
- Added `prefers-reduced-motion: reduce` handling for loading animations.
- Extended Playwright coverage for visible in-language state, auto-clear, keyboard skip, timeout error, and reduced motion.

## Commands

- `npm run build` PASS
- `npx playwright test tests/e2e/loading-overlay.spec.ts` PASS, 4 passed

## Browser evidence

- `loading-overlay-visible.png`: visible overlay with "Camcorder warming", "Spinning up the physics tape...", Step 2 of 5, car/camcorder assembly art, and skip control.
- `loading-overlay-reduced-motion.png`: same in-language overlay under reduced motion.
- `loading-overlay-normal.json`: roomCode `GHTT`, elapsedMs `2731`, wasShown `true`, completed `true`, timedOut `false`, loadingVisible `false`, errorVisible `false`, lastText `Rolling to the lobby...`, loadingStepNumber `5`.
- `loading-overlay-reduced-motion.json`: carAnimation `none`, trackAnimation `none`.

## Source scan notes

- No CDN/font imports added.
- No requestAnimationFrame or per-frame loading loop added.
- Existing host debug console statements and existing debug `setInterval` remain outside this loading-screen slice.
