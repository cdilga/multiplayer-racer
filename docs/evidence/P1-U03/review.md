# P1-U03 fresh-eyes review: phone controller mocks

**Who/what/when.** Sonnet subagent, fresh context, 2026-10-03. It read all 30 captures in `frames/` (Chromium on the Mac; 375×667, 430×932 and 412×915, portrait and landscape) and `check-report.json`, against GUIDE §4–§11, the bead, plan §11 and M2. Some crops were enlarged to confirm details. No code, bead or commit changes.

**Checker.** 360 layout runs (Chromium and WebKit): 0 overlaps, 0 undersized targets, 0 horizontal scroll. All 18 two-touch runs pass; no external requests. Smallest targets are exactly 48 px with 8 px gaps; text is at least 13 px. The checker exempts transient overlays and ignores vertical overflow, so several defects below pass it.

## By state group

- **In race (idle, touched, preload, cooldown, disabled, autopilot).** Present: DRIVE left, ACTION right, boost meter, cone ready/cooldown, wheelie-preload arc and label, a strip (#12, name, 3rd, Lap 2/3), Identify, camera, Recover and menu. Help, Settings and Leave sit in the menu, away from the thumbs. Disabled greys the sticks with no reason or next action. Autopilot is only a banner.
- **Identify flash.** Full-screen "#12 / That's you on the TV" in the seat colour. Unmistakable.
- **Menu.** Identify first (saffron), then Camera, Recover my car, Help and tutorial, Settings, Leave room (red), Close. Meets the bead; cut off in landscape.
- **Tutorial.** "STEER" coach card with Skip/Next and arrows. Fine in portrait; in landscape it covers the boost meter and the tops of the stick bases.
- **Lobby/READY.** Car card, name, big Ready ("You're ready / Tap again if you need a minute"), "27 of 32 ready", Settings. Clear.
- **Join.** Code field and Scan side by side, plus Join. See defects 4 and 6.
- **Settings.** Matches M2's toggles and exits, but drops M2's stick-legend diagram.
- **§11 states.** All 15 are captured. Failures name a next action (Edit the code, Retry, Use this one, Enter a new code, Open the preview index). Automatic states (Connecting, Joining, Finding a relay, Updating, Host paused) have none, which is acceptable.
- **Edge-safe overlay.** The 24 px band is drawn and the stick zones start exactly at it. **Reach overlay.** See defect 3.

## First look in a dim room

The ink base does not glare; the cream cards on join and §11 screens are the bright areas, as §10 intends. The player finds themselves fast: the sky-blue #12 badge, strip underline, DRIVE knob and Identify button repeat the seat colour. Two knobs on dashed columns read as sticks at once. Nothing says what each stick does outside the tutorial. The 48 px tool row and 64 px big buttons are hittable without looking, but camera, Recover and menu are unlabelled icons.

## Defects, by severity

1. **High: the autopilot banner hides indicators.** On the small iPhone in portrait it covers the whole boost meter and part of the cone. In all landscapes it covers the DRIVE/ACTION tags and half the boost meter. The sticks still look live. `race_stick=autopilot.jpg`.
2. **High: indicators are not next to the sticks.** Boost and cone sit at the top of the ACTION column, about 165 px above the ring in portrait. The meter is about 50 px wide. The preload label sits just under the pulled-down thumb. `race.jpg`, `race_stick=preload.jpg`.
3. **Medium-high: the reach overlay cannot answer the owner's question.** It has no legend. Its corner arcs exclude the idle rings in every frame; portrait rings are about 150 px above them. `race_reach=1.jpg`.
4. **Medium: icons are washed out.** The Scan, dice and Sit out icons are paper on paper (`join.jpg`, `lobby.jpg`, `settings.jpg`). The badge icons on navy circles (warning, flag, stopwatch, wifi-off, pause, phone) are dark on dark (`no-such-game.jpg`, `host-paused.jpg`).
5. **Medium: clipping and fold.**
   - Menu in landscape shows 4 of 7 entries (`menu.jpg`).
   - Save and back to driving is below the fold in all landscape settings frames, and Test these controls is half cut on the small portrait (`settings.jpg`).
   - On the small landscape frame, the join wordmark top, join helper text and lobby Settings button are cut by the screen edge.
6. **Medium: copy.**
   - "game" appears in five states (Join a game, Finding game, No game with code, That game has ended, Join another game). GUIDE §11 says room, not game. Plan §11 itself says "game", so this is an **owner conflict**, not a mock error.
   - "Identify" is used where the guide's verb is "Find my car". "Scan" is used where it says "Scan QR code".
   - "Finding a relay" is jargon.
7. **Low-medium: identity risks, inferred from tokens and CSS and not seen in the captures.** A yellow or orange seat makes the DRIVE knob near-match saffron. The white seat makes the Identify flash a full-screen glare. Playing and Reconnecting show #12 without the colour.
8. **Low: edges and safe areas.** Landscape Identify and menu sit about 12 px from the right edge, inside the 24 px band. Frames show no notch or safe-area insets, though the CSS uses them.

## Verdict

The structure meets the bead and §11. The sticks, strip, Identify flash and all 15 states are legible, in-voice and name next actions. Good enough for the owner's on-phone thumb test. Fix defects 1 to 5 before G-DESIGN. Defect 6 needs an owner ruling on room versus game.

## Round 2 (after fixes)

**Earlier defects**

1. **Autopilot banner: mostly fixed.** It now sits at the bottom of the stick area, and the sticks and indicators dim. Portrait and the large landscape frames are clear. On the small landscape frame it still covers the bottom third of both rings (`race_stick=autopilot.jpg`).
2. **Indicators near the sticks: fixed.** Boost and cone sit above the ACTION home and the wheelie label above the DRIVE ring (`race.jpg`, `race_stick=preload.jpg`). The "Cone ready" label now touches the ring top on the small portrait frame.
3. **Reach overlay: fixed and informative** (`race_reach=1.jpg`). Landscape rings sit in the comfortable band. On the 430×932 and 412×915 portrait frames both home rings sit in the stretch band, and they straddle the two bands on the small portrait. That matters for Fixed-sticks mode.
4. **Icons: mostly fixed.** Scan QR code, the dice, Sit out and the status-badge icons are visible (`join.jpg`, `lobby.jpg`, `settings.jpg`, `no-such-game.jpg`).
5. **Clipping: mostly fixed.** The landscape menu is two columns with all 7 entries (`menu.jpg`). Settings landscape now shows Save in all three frames. The small landscape left column is still cut after Vibration, and Sit out and Leave room show only as slivers on the large landscape frame and are hidden on Android landscape. The small portrait still half-cuts Test these controls (`settings.jpg`).
6. **Copy: partly fixed.** "Scan QR code" now matches and Identify follows the owner ruling. "game" is still in five states pending the owner decision, and "Finding a relay" is unchanged. Confirm GUIDE §11's verb list now says Identify.
7. **Identity: partly fixed.** The cream ACTION knob removes the yellow/orange collision. A white seat (#F4F1EA) would now match it; the white-seat flash glare is unchanged. Both are inferred from the tokens, not visible in the captures.
8. **Edges and safe areas: not fixed** (`race_edges=1.jpg`). Also still open: the tutorial card covers the boost meter and stick tops in landscape (`tutorial.jpg`), and disabled sticks give no reason.

**New defects**

- **Menu icons are dark on navy (medium).** Camera, Recover, Help and Settings lost their light icons, in every frame of `menu.jpg`.
- **The autopilot banner has no `pointer-events:none` (unverified).** On the small landscape frame it overlaps the thumb area, so a thumb landing on it may not take over. Test this with the two-touch run.
- **The reach legend covers the portrait tool row (low)** while the overlay is on.

**Verdict.** The blockers from round one are essentially cleared. Fix the menu icons and the small-landscape banner before the owner's phone test. The landscape tutorial card and the stretch-band home are worth a second look, and room versus game still needs an owner decision.
