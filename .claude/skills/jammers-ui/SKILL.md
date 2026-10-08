---
name: jammers-ui
description: Operate Joystick Jammers 0.2's real UI the way players do - the host on a TV or laptop, phones joining through the Join page in portrait and landscape - on a live preview or a local build, reading state from the pages' own surfaces (window.__jjNet, __jjRoom, __jjController, __jjTest) and capturing each state (lobby, join, joined, ready, race, results) at real device sizes. Use when a bead changes the host screens, the controller, the join flow or anything a player sees and needs it exercised end to end, when you need screenshots of real game states (not mocks) for a self-review, or when checking a preview by hand before a playtest.
---

# Jammers UI (the real pages, at real sizes)

The pages are the product: `B/host` (the TV), `B/j/<CODE>` and `B/c` (the phone controller), `B/` (landing). Drive them
in Playwright with the pages' own state surfaces instead of guessing from pixels. Sizes that matter (owner's devices,
`docs/process/visual-self-review.md`): TV 1920x1080, laptop 1366x768, phone portrait 412x915 and landscape 915x412,
small phone 375x667. The UI states the screens must handle are the tokens and states in `art/ui/` (accepted set
`art/ui/accepted/2026-10-07/`) and the controller states in `web/controller/src/app/` (`ready-to-join`, `joining`,
`playing`, plus host phases `Lobby`, `Preparing`, `Countdown`, `Running`, `Intermission`).

**Distilled from** steps repeated in two closed beads: **P1-C01** (landing, Host and Join pages served by jj-server and
opened at phone and TV sizes) and **P1-R07** (host HUD, lobby and results driven through a real room at TV, laptop and
phone sizes). The journeys (`web/tests/journeys/`, JN1/JN3) and the public smoke (`web/tests/smoke/smoke-flow.mjs`) are
the tested callers; copy their waits, not their assertions.

## Worked example: a UI tour on the live preview (eris, about 30 s)

```bash
scripts/remote/eris.sh --run ui-demo 'node .claude/skills/jammers-ui/ui-tour.mjs https://jammers-preview.dilger.dev/p/v02-eceaeeb8/ $JJ_RUN_DIR/tour'
scp 'eris:Work/runs/ui-demo/tour/*.png' <a scratch dir>/    # then Read them
```

`ui-tour.mjs` (beside this file) opens the host at 1920x1080 with `?room&test=live`, waits for `__jjNet.code()` and
the Lobby, joins Davo on a 412x915 phone and Shazza on a 915x412 phone through the real Join form, readies both and waits
for `Running`. Stated result: nine `captured …png` lines (`tv-1920x1080-lobby-empty`, `phone-412x915-join`,
`phone-412x915-joined`, `phone-915x412-join`, `phone-915x412-joined`, `tv-1920x1080-lobby-two`, `tv-1920x1080-race`,
`phone-412x915-race`, `phone-915x412-race`) and `ui-tour: PASS`. The race capture shows two tiles (#1 Davo red, #2
Shazza blue, "1st Lap 1/3"), the footer with the room code and QR; the portrait phone shows its HUD with "Turn
sideways" over the sticks (portrait is the fallback, landscape the intended grip); the landscape "joined" capture shows
the first-run tutorial card ("STEP 1 OF 7 / STEER") over the sticks, which is the controller's real first state.

Previews retire (Latest and the three newest stay); if the page 410s, change the preview id to a live one (the index at https://jammers-preview.dilger.dev/ lists them). For a
local build, serve it with `web/landing/tests/lib/site.mjs` (`build` + `serve`) and pass that base.

Notes for the run: `eris.sh` syncs eris's clean clone to your **pushed** HEAD (uncommitted Mac changes never reach it;
it may print `RU_SYNC=skipped (runs in progress …)`, which is fine). The single quotes keep `$JJ_RUN_DIR` for eris
(`~/Work/runs/<id>`); make the scratch dir before `scp`ing into it.

## Rules

- Browsers run on eris (or CI), not the Mac.
- Close every browser context you open in a multi-step script: a live host keeps rendering and starves the next one
  (`docs/learnings/ci.md`, run 1547).
- Read state from the surfaces; a screenshot is for a person to look at, not for asserting.

## Traps

`docs/learnings/ui.md`.
