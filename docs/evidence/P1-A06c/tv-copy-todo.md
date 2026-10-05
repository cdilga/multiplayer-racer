# TV and host copy where an owner term fits (br-ennm, not edited here)

`art/ui/poc/tv/**` and `web/host/**` were out of bounds for this bead. Each line below names where a term from
`docs/copy/australianisms.md` fits, with proposed text. Plain words stay beside the slang (R114, no disclaimers).

| Where | Now | Proposed | Term (doc row) |
|---|---|---|---|
| (new) TV tile/centre message when a car is out of bounds; no such line exists in `art/ui/poc/tv/main.js` yet. Same slot as the wreck word at `art/ui/poc/tv/main.js:112` (`hud-centre`), and the host HUD when the sim reports `car.out_of_bounds` | none | `Out past whoop whoop!` with the small line `Drive back onto the track` | out past whoop whoop |
| `art/ui/poc/tv/main.js:112` wreck word beside the 3 s back-in countdown, only when the cause is a car leaving the track (not a flip) | `Wrecked!` | `Gone walkabout!` (keep `Back in 3 seconds`) | going walkabout |
| `art/ui/poc/tv/main.js:889` highlight reel label for the photo-finish clip | `Closest finish` | `Fair dinkum finish` | fair dinkum |
| `art/ui/poc/tv/main.js:740` lobby footer caption | `Late joiners welcome` | `Late joiners welcome, blokes and sheilas` (optional; fits the doc's group-address row) | blokes, sheilas |
| round-complete screen (`roundScreen()`, `art/ui/poc/tv/main.js:805` onwards): a thank-you line above the Next round actions (none today) | none | `Cheers for racing!` | cheers |
| `art/ui/poc/tv/main.js:174`, `:184` join caption `Scan to join` | `Scan to join` | leave as is: information, not flavour | (none) |
| `web/host/src` HUD | no player-facing strings yet (only `world.ts` surface names such as `off-track`, which are data ids, not copy) | when the host gets an out-of-bounds or recover toast, use the OOB row above; the announcer cue ids are `off-course-1..4` | out past whoop whoop, going walkabout |

Not proposed: `nah` or `yeah nah` on any TV or host line (they carry information there), and `the institution`, `servo`, `arvo`
beyond signs and cues (TV chrome has no scenery text).
