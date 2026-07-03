# br-skip-bin-arcade-design-language-5k3.14 — P2.4 Leader marker + danger styling

**Agent:** CobaltTiger · **Status:** READY for fresh validation (NOT closed) · Date: 2026-07-02

## Acceptance → proof

| Acceptance | Implementation | Proof |
|---|---|---|
| Leader marker **unmistakable** | Host overlay tags `racePosition===1` (or `vehicle.isLeader`) as `is-leader`; new CSS gives it a gold 👑 crown + gold sticker ring/chevron | unit + e2e + screenshot |
| Shrinking-arena wall pulses **DANGER red** | DerbySystem default warningColor → `#FF2E2E`; all 4 derby arena JSONs → `#FF2E2E`; existing sin() glow already pulses | unit + e2e |
| **Low-health pulse** | RaceUI `.health-bar-item.tier-low .health-seg.is-lit` runs `@keyframes health-low-pulse` (brightness throb) | unit + e2e + screenshot |
| Preserve Local host-renderer / controller split | All logic runs on the host overlay/HUD only; players remain controller-HUD | e2e asserts on hostPage only; no player-render change |

## Files changed (all additive / data-value only)
- `static/js/ui/VehicleIdentityOverlay.js` — compute `isLeader`, stage it, `is-leader` class toggle in `_applyMarker`, `leader` in `getDebugSnapshot`, `.is-leader` CSS (gold crown/ring).
- `static/js/systems/DerbySystem.js` — warningColor defaults `#FF4444`→`#FF2E2E` (init, config fallback, hex fallback).
- `static/js/ui/RaceUI.js` — low-health pulse CSS on `tier-low` lit segments.
- `static/assets/tracks/derby-{arena,bowl,coliseum,dunes}.json` — `warningColor` → `#FF2E2E` (DANGER red for the shrink-warning signal, per Skip Bin Arcade loud-palette rule).
- `tests/unit/leader-danger-styling.test.js` (new), `tests/e2e/leader-danger-styling.spec.ts` (new).

## Test evidence

### Unit — `npx vitest run tests/unit/leader-danger-styling.test.js`
7 passed: leader flagged for racePosition 1 (and explicit isLeader), gold-crown style injected (`\1F451` + `#FFD23E`), DerbySystem defaults `#FF2E2E`/`0xFF2E2E`, wall glows DANGER on every child mesh + intensity oscillates, RaceUI low-health pulse keyframes+animation present.

Non-regression: `own-car-marker` (6), `derby-wall-shrink` (11), `race-health-bars` — 27 passed.

### Build — `npm run build`
Clean; dist/assets/tracks/*.json carry `#FF2E2E`.

### E2E — `npx playwright test tests/e2e/leader-danger-styling.spec.ts`
2 passed. Runtime diagnostics (built bundle, host page only):
```
[5k3.14] leaderState={"leaderCount":1,"total":2} lowHealth={"tierLow":true,"animationName":"health-low-pulse"}
[5k3.14] danger={"present":true,"warningColor":"#FF2E2E","warningHex":16723502}   # 16723502 == 0xFF2E2E
```
Non-regression: `game-flow.spec.ts -g "host markers"` — 2 passed.

### Screenshots (`screenshots/`)
- `5k3.14-leader-marker.png` — leader "LeadOne" (pos 1) shows 👑 + gold border/chevron; "LeadTwo" plain. Unmistakable.
- `5k3.14-low-health.png` — near-dead car HUD bar in tier-low red with pulse.
- `5k3.14-danger-wall.png` — derby with DANGER-red shrink wall active.

## Coordination notes
- Agent Mail reads/ACK working; **file-reservation and mail-send hit the mailbox exclusive-lock** intermittently — retried; declaring scope here + on the bead thread as fallback.
- Scope avoided StormyMill's 5k3.26 files (GameHost.js / LobbyUI.js) — untouched.
- Bead left OPEN for fresh validation by a separate agent.
