# br-dim.1 self-review: TV pause flow and grid-player on phone and tablet

Run: `node art/ui/lib/live-check.mjs --local --tv --fullscreen` (Playwright Chromium, local serve of `art/ui`). `--tv` now covers every TV state in `poc/tv/states.js` at 412x915, 915x412, 820x1180 and 1920x1080, and `--fullscreen` rechecks each after a resize. The checker also flags text and controls cut off by the screen edge.

## Looked at
JPGs in this folder, one per state and viewport (`paused_n_8`, `paused_n_8_sub_players`, `_sub_end`, `_sub_disband`, `grid_player`, each at 412x915, 915x412, 820x1180, 1920x1080; `*_after-resize` is the page after a viewport shrink/grow). I opened: paused (412, 915x412, 820, 1920), players (412, 820, 1920), end (412 after resize), disband (412), grid-player (412, 820, 915x412).

Images looked at: `grid_player_1920x1080.jpg`, `grid_player_1920x1080_after-resize.jpg`, `grid_player_412x915.jpg`, `grid_player_412x915_after-resize.jpg`, `grid_player_820x1180.jpg`, `grid_player_820x1180_after-resize.jpg`, `grid_player_915x412.jpg`, `grid_player_915x412_after-resize.jpg`, `paused_n_8_1920x1080.jpg`, `paused_n_8_1920x1080_after-resize.jpg`, `paused_n_8_412x915.jpg`, `paused_n_8_412x915_after-resize.jpg`, `paused_n_8_820x1180.jpg`, `paused_n_8_820x1180_after-resize.jpg`, `paused_n_8_915x412.jpg`, `paused_n_8_915x412_after-resize.jpg`, `paused_n_8_sub_disband_1920x1080.jpg`, `paused_n_8_sub_disband_1920x1080_after-resize.jpg`, `paused_n_8_sub_disband_412x915.jpg`, `paused_n_8_sub_disband_412x915_after-resize.jpg`, `paused_n_8_sub_disband_820x1180.jpg`, `paused_n_8_sub_disband_820x1180_after-resize.jpg`, `paused_n_8_sub_disband_915x412.jpg`, `paused_n_8_sub_disband_915x412_after-resize.jpg`, `paused_n_8_sub_end_1920x1080.jpg`, `paused_n_8_sub_end_1920x1080_after-resize.jpg`, `paused_n_8_sub_end_412x915.jpg`, `paused_n_8_sub_end_412x915_after-resize.jpg`, `paused_n_8_sub_end_820x1180.jpg`, `paused_n_8_sub_end_820x1180_after-resize.jpg`, `paused_n_8_sub_end_915x412.jpg`, `paused_n_8_sub_end_915x412_after-resize.jpg`, `paused_n_8_sub_players_1920x1080.jpg`, `paused_n_8_sub_players_1920x1080_after-resize.jpg`, `paused_n_8_sub_players_412x915.jpg`, `paused_n_8_sub_players_412x915_after-resize.jpg`, `paused_n_8_sub_players_820x1180.jpg`, `paused_n_8_sub_players_820x1180_after-resize.jpg`, `paused_n_8_sub_players_915x412.jpg`, `paused_n_8_sub_players_915x412_after-resize.jpg`.

## Defects found and fixed
- Pause panel was wider than a portrait phone: heading, "This room" column and the Resume/End buttons ran off the right edge. Now `.pause` scrolls vertically inside itself, the card is capped to the screen width, below 1000px the two columns stack into one, buttons wrap, and heading banners size to `min(TV size, vw)`.
- "Players and controllers" heading was cut off at every size, including 1920x1080. It now fits (font clamped to the width); row actions (Sit out, Remove) wrap under the player's name on narrow screens. No row hidden, no player cap.
- End and Disband panels cut off on a phone: fixed by the same width cap and wrapping.
- grid-player: the "layout(N, screen) -> tile" rule was clipped at the panel's right and bottom. On portrait or narrow screens the grid is now on top and the rule sits below it, and the panel scrolls if taller than the screen. Landscape and TV layout unchanged.

## Remaining defects
- 915x412 (phone landscape) pause: the card is taller than the screen, so Players/End/Disband sit below Resume and need a scroll inside the panel. Reachable, not clipped.
- 1920x1080 "Players and controllers": the heading sits close to the top edge (inside the screen, unchanged shape).
- Full `--tv` sweep: lobby, results and intermission still fail the cut-off check at 412x915 and 820x1180 (lobby 412 only). Not this bead's; other beads rebuild those screens. No new failure elsewhere.

## Not covered
- Real phones, real fullscreen API (the resize is a viewport shrink/grow), Safari/WebKit.
- Touch scrolling feel in the pause panel; keyboard/gamepad focus order.
- Other TV states were run by the checker but not individually looked at beyond the pause and grid-player states above.
