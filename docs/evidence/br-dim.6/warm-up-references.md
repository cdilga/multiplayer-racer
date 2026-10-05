# Remaining references to the warm-up yard / warm-up lobby (br-dim.6)

Made with `grep -rniI "warm-up\|warmup\|warm up" docs art` over md, js, html, mjs and css (this folder excluded), after br-dim.6 removed the warm-up yard from the TV POC: the `lobby` state no longer uses the `warmup` world mode (the mode, its camera rig and the roster code are deleted from `art/ui/poc/tv/`) and its README row, `states.js` group and `capture-rounds.mjs` checks are rewritten. Owner ruling: R110 (`docs/policies/owner-direction-2026-09-29.md:132`): the lobby shows a generic non-interactive background of the upcoming track and every player on one screen, with no warm-up drive. Section A is what to mark superseded; the plan sections that define the lobby warm-up behaviour (plan §9 and tasks G01, C06, G04, S05) are the ones to reconcile with R110.

## Live docs, plans and design pages that still describe the warm-up yard / drive (mark superseded by R110) (27)

- `docs/plans/v0.2-playtest-1-plan.md:17`: > data and failure handling (§17.1 T43–T64), with the gaps closed in place (lobby warm-up, room
- `docs/plans/v0.2-playtest-1-plan.md:64`: the in-page scanner) and are driving within ~20 s: a warm-up lap in the lobby, or at the tail of
- `docs/plans/v0.2-playtest-1-plan.md:105`: | Round loop | Lobby with a warm-up drive (§9), Ready + host force-start warning, countdown, race, results, highlight reel, auto-next, End/Disband | R31, R38, R50, R57 |
- `docs/plans/v0.2-playtest-1-plan.md:238`: | 6 | The lobby at 2, 8, 16 and **32** players, with the warm-up behind it, plus the rule for larger N | No caps: the lobby has to show any N clearly, and 32 is the owner's test case |
- `docs/plans/v0.2-playtest-1-plan.md:253`: - **Lobby:** the warm-up drive behind the QR and player strip (§9).
- `docs/plans/v0.2-playtest-1-plan.md:923`: a **warm-up**: every claimed seat free-drives its car on the greybox loop in its own tile. This is
- `docs/plans/v0.2-playtest-1-plan.md:925`: progress, lap or score. The warm-up lets a newcomer drive within seconds and meet the tutorial
- `docs/plans/v0.2-playtest-1-plan.md:1528`: - the **lobby** with the warm-up behind it at 2, 8, 16 and 32 players, plus the rule for larger N
- `docs/plans/v0.2-playtest-1-plan.md:2350`: that seat (`jj-input`), shown on the seat's tile and on the controller, in the lobby warm-up (§9) or
- `docs/plans/v0.2-playtest-1-plan.md:2352`: Acceptance: a scripted newcomer controller in the lobby warm-up is prompted through each control
- `docs/plans/v0.2-playtest-1-plan.md:2501`: boost; OOB/stuck → recovery (S05); no round director yet. The free drive becomes the Lobby warm-up
- `docs/plans/v0.2-playtest-1-plan.md:2514`: Contract: §9; wraps G04's free drive as the Lobby warm-up and adds the director's phases around
- `docs/plans/v0.2-playtest-1-plan.md:2519`: a 1-lap round → results → intermission → next round starts); lobby warm-up cars give way to the
- `docs/plans/v0.2-playtest-1-plan.md:2520`: start grid at Countdown and the warm-up's debris doesn't carry into the round; four controllers play
- `docs/plans/v0.2-playtest-1-plan.md:3028`: | T48 | §1 says friends are "driving within ~20 s", but the lobby had no car and G01 "replaced" free drive | Lobby warm-up: G04's free drive is kept as the lobby, and the tutorial prompts run there (§9, G01, C06) | DEFAULT (§3a) |
- `docs/plans/v0.2-playtest-1-plan.md:3212`: journey (host a room, join by QR/code/scanner, warm-up and race, Identify, late join, dropout and
- `docs/plans/v0.2-playtest-1-plan.md:3219`: (§4.4, M08a, F07); lobby warm-up (§9, G01, C06; Q-L1) and the corrected phase order; the controller
- `docs/plans/v0.2-playtest-1-bead-map.md:31`: | P1-U02.4 | `br-p1-u02-8u4.3` | TV mocks rework: warm-up/lobby, intermission highlights, end of round (POC round 1) | POC | P1 | on:any | ev:ci | U01.3 |
- `docs/plans/v0.2-playtest-1-bead-map.md:189`: | `DEC:lobby-warmup` | §3a | Lobby = warm-up drive behind QR + strip | bead | U02 |
- `docs/plans/v0.2-playtest-1-bead-map.md:340`: | `§9-lobby-warmup` | §9 | Lobby warm-up drive | bead | G01 |
- `docs/playtests/owner-checklists.md:37`: - [ ] **D2 Race:** lobby warm-up, Ready / Start now, a race, results, next round on its own; Identify from the phone's button and its menu, a pad's View/Select and a keyboard's Identify key (your number flashes big in your colour on the TV and your phone); a late joiner; a phone dropping out and back.
- `docs/playtests/poc-2026-10-03.md:74`: - **POC1-15** Rethink the **lobby / warm-up**: the cars can't be seen now. Perhaps generic footage; decide how a warm-up
- `art/ui/poc/index.html:57`: <h2><span class="n">6</span> The warm-up (lobby) <span class="status ready">ready</span></h2>
- `art/ui/poc/index.html:58`: <p class="why"><b>Round 2:</b> joining drops your car straight into the warm-up yard, where you can drive and Cooee at once to find yourself; the TV shows the yard from the Overview camera with every car on its ring and a nameplate while there's room for them, the join card at the top right, the roster under it, and Start race. <i>Why: you couldn't see the cars; now they are th …
- `art/ui/poc/motion/reel.js:269`: <div class="warmup"><span class="chip choosing">Warm-up: drive around while everyone joins</span></div>
- `art/ui/frames/README.md:9`: | `lobby-32.webp` | The TV lobby at 32 players: QR and room code, the roster in four columns with Ready ticks and "choosing…", the Start race button, the painted warm-up behind the chrome |
- `art/ui/GUIDE.md:261`: | Lobby | The warm-up drive behind the QR and the player strip | Players are already driving while friends join |

## Historical evidence from earlier POC rounds (dated records: add a superseded note, do not rewrite) (25)

- `docs/evidence/P1-U01/style-frames-review.md:41`: - **Invented text:** lobby plate "LOBBY · WARM-UP / Practice loop active · Red Dirt Track" (top left) and the "PRACTICE LOOP →" sign. H4's "OUTBACK DRIVES BRING PEOPLE TOGETHER" sign (lobby top right) is carried over. "R007" still reads as R-zero-zero-7.
- `docs/evidence/P1-U01/style-frames-review.md:61`: 7. Lobby: unrequested text (warm-up plate, practice sign) and the H4 slogan sign; "R007" ambiguity.
- `docs/evidence/P1-N07b/README.md:19`: - **Driving.** `driving()` gives Lobby free-drive (the warm-up), Racing while a round runs, and Held otherwise.
- `docs/evidence/P1-U02/review.md:40`: - The warm-up drive shows no cars in any capture (`lobby_n=*.jpg`).
- `docs/evidence/P1-U02/review.md:76`: 9. Lobby: ✓ / … marks **fixed** (`lobby_n=32.jpg`). Warm-up cars are **partly** there: a car is now visible, but cropped behind the QR panel, with unexplained dark and blue blocks (`lobby_n=8.jpg`, `lobby_n=32.jpg`). ~200 px of unused panel height at 32 remains.
- `docs/evidence/P1-U02/review.md:103`: 9. Lobby warm-up: **not fixed**. No car or pack is visible in `lobby_n=8/32/140.jpg`, only track bands, while the caption says "drive around while everyone joins".
- `docs/evidence/P1-U02.4/README.md:1`: # P1-U02.4: TV warm-up, end of round and intermission
- `docs/evidence/P1-U02.4/README.md:15`: | **Warm-up** (the lobby) | **How a warm-up works:** joining drops your car straight into the warm-up yard (the derby bowl) beside everyone else's. You can drive and Cooee at once, so you find your car by moving it, and you tap Ready on your phone. The host starts the race; late joiners keep dropping in. **On the TV:** the yard from the Overview camera (R107's smooth rig), each …
- `docs/evidence/P1-U02.4/README.md:23`: shot, each wide view with its own camera) and the warm-up yard.
- `docs/evidence/P1-U02.4/README.md:29`: | POC1-15: the warm-up is reworked with a worked proposal for how it works, at 2, 8, 16 and 32 players, in the new language | The proposal is above (and in `art/ui/poc/tv/README.md`). Every seat's car is inside the yard view at 2, 8, 16, 32, 48 and 140 players; plates per the rule above (2, 8, 16, 32 plates; none at 48 and 140) (`report.json` `carsInYard`, `plates`). The yard t …
- `docs/evidence/P1-U02.4/README.md:43`: | 1. Warm-up plates sit on cars and each other from 16 up | Plates: badge, name and tick up to 12; badge only up to 32; none past 32. A plate moves up one step at most where two overlap, then overlaps at its car. The Ready tick is teal (it was dark green on navy) |
- `docs/evidence/P1-U02.4/README.md:44`: | 2. Warm-up cars tiny at 2 and 8 | The yard is smaller for small rooms and its camera may frame closer (22 m against the derby's 120 m): at 2 players each car is about 130 px long |
- `docs/evidence/P1-U02.4/README.md:54`: | Not taken | The review's "totals column": the round's points are round 1's content, and session totals are the game's (P1-R). Burst ticks only frame the warm-up's Start race: the language allows them at most once per screen, and the other screens' primary keeps its saffron outline. The intermission's left side stays the replay's: the replay is the point |
- `docs/evidence/P1-U02.4/review.md:1`: # Fresh-eyes review: warm-up, end of round, intermission (P1-U02.4)
- `docs/evidence/P1-U02.4/review.md:3`: **Verdict.** The three screens are a clear step up on the old ones. The warm-up now shows cars, the intermission fills its footer, and the torn-ink banners, saffron accent words and brushed tags are applied. Underneath, the layout is still a web page: hard-edged rectangles on a rigid row/column grid, a hard rule above the footer, and a web toolbar on the warm-up. Tilt and overl …
- `docs/evidence/P1-U02.4/review.md:5`: ## Warm-up (POC1-15)
- `docs/evidence/P1-U02.4/review.md:6`: Asks: **cars visible: met** (live arena, about 70% of the screen). **A decided warm-up: met** ("Drive around while everyone joins"). **Works at any N: partly.** n=2 and n=8 are fine. n=16 is crowded. n=32 and n=140 are unreadable.
- `docs/evidence/P1-U02.4/review.md:9`: 3. Banner and tags: **met.** WARM-UP has a torn ink banner with a saffron "UP", and the "N PLAYERS" tag is brushed saffron.
- `docs/evidence/P1-U02.4/review.md:33`: 1. **Warm-up n=16 to 140: tags sit on the cars and on each other.** Dusty's tag covers Ash's car, and at 140 the tags hide almost every car and spill past the subtitle strip. Fix: n ≤ 8 gets name + number offset 28 px above the ring. n 9 to 32 gets a 22 px number-only chip. n > 32 gets no tags, only the ring colour and the number on the car roof. The list carries the names. Use …
- `docs/evidence/P1-U02.4/review.md:34`: 2. **Warm-up n=2/8: cars are tiny in an empty field.** Fit the camera to the player bounds with a minimum car size of 200 px at n ≤ 8. Add floor texture and tyre tracks so it is not flat orange. A hero car must clear 30% of the screen.
- `docs/evidence/P1-U02.4/review.md:35`: 3. **Warm-up: the sidebar plus toolbar reads as a web app.** The list panel is about 55% blank at n=2 and 8. The room code and ready count each appear twice (QR card and bottom bar, list header and bottom strip). Fix: size the list to its content, tilt it -1°, let the QR card overlap the arena edge by 40 px, and delete the bottom bar's duplicates.
- `docs/evidence/P1-U02.3/README.md:50`: - Static mode leaves spare cells as plain backdrop. A painted art card there is U02.4's (warm-up and lobby art).
- `docs/evidence/P1-U05.4/README.md:24`: seeded waypoint generator, then replayed into each rig: 30 s after a 2 s warm-up, 16:9.
- `docs/evidence/P1-U05.5/README.md:32`: also carried warm-up), and at 24 tiles by about ±0.5 ms.
- `docs/evidence/P1-U05.5/README.md:40`: | **Fury road** (recommended) | 37.26 / 49.94 (first row, warm-up) | 7.04 / 9.93 | 9.08 / 11.91 |

## Unrelated uses of the word (benchmark / JIT / camera-trace / map-preparation warm-up): leave alone (11)

- `docs/evidence/P1-R01/bench.md:16`: (`host/?bench`, `web/host/src/render/bench.ts`). One InstancedMesh per GLB part. 10 warm-up frames, then 120 timed
- `docs/evidence/P1-R02/bench.md:10`: picked by camera layers. 10 warm-up + 120 timed frames waited to GPU completion; throughput = 120 back-to-back frames.
- `docs/plans/v0.2-revamp-plan-2026-09-28.md:1589`: Ballots close visibly before final map warm-up; stale generation jobs cannot overwrite the winner.
- `docs/plans/v0.2-revamp-plan-2026-09-28.md:1943`: - Preparation includes generation, validation, collider construction, resource upload and shader warm-up.
- `docs/plans/v0.2-revamp-plan-2026-09-28.md:3303`: | `V2-50`, `V2-58` | Canonical geometry/surfaces → route features/fast validator → native/WASM equality; procgen jobs + sim collider readiness + renderer warm-up → atomic preparation integration. | Known failing maps, stale jobs and failed conservative recipe produce specified outcomes. Unblocks Race before six-theme production. |
- `art/ui/poc/tv/world.js:534`: * once, replayed into each), after a `warmupS` settle: acceleration and jerk of the camera path (and when the worst
- `art/ui/poc/tv/world.js:538`: function overviewTrace({ seconds = 30, dt = 1 / 60, aspect = 16 / 9, warmupS = 2, aheadS = 1.5 } = {}) {
- `art/ui/poc/tv/world.js:540`: const total = Math.round((seconds + aheadS) / dt), skip = Math.round(warmupS / dt), ahead = Math.round(aheadS / dt);
- `art/ui/poc/tv/world.js:544`: const out = { seconds, dtS: dt, warmupS, aheadS, cars: cars.length };
- `art/ui/poc/audio/engine/check.mjs:887`: await staticMs(2, st); // warm up
- `art/ui/poc/audio/engine/check.mjs:945`: 'static: N voices held in one fixed state for 10 s (idle = 900 rpm in neutral; cruise = 3500 rpm, half throttle; all layers = every layer live: boost, drift, gravel, damage). The empty-graph render is subtracted. Median of 5 runs after a warm-up.',

## Already handled: this change or R110 itself (listed so nothing is missed) (6)

- `docs/plans/v0.2-playtest-1-plan.md:922`: - **Lobby (SUPERSEDED by R110, 2026-10-04: no warm-up; generic track background and every player on one screen, tutorial on the controller; the warm-up text below is history):** big QR + code and the player strip (number, name, colour, Ready, connection), laid over
- `docs/playtests/owner-checklists.md:18`: - [ ] Lobby at 2, 8, 16 and 32 players: every player on one screen with joining/choosing/ready states, a generic track behind it (R110: no warm-up), the QR sized to the free space, and the rule for bigger rooms.
- `docs/policies/owner-direction-2026-09-29.md:132`: | R110 | **2026-10-04: the lobby has no warm-up drive (reverses the Playtest-1 plan §9 lobby warm-up; no earlier numbered ruling covered it).** The lobby shows a generic, non-interactive background of the upcoming track and **every player on one screen** with joining / choosing / ready states (no cap, any N, any aspect), with the join QR sharing the layout. Consequences: G04's  …
- `art/ui/poc/tv/README.md:33`: | **Lobby** (br-dim.6; replaces the warm-up yard of P1-U02.4) | Nothing to drive: a generic, non-interactive crane view of the upcoming track, and the roster fills the screen so every player is visible at once at any N and aspect. One card per player: seat number, name, state (Joining…, Choosing car…, Ready). Density comes from the race grid's rule (`grid.js` `layoutGrid`, with …
- `art/ui/poc/tv/main.js:714`: // Lobby (br-dim.6, supersedes the warm-up yard of POC1-15). Nothing to drive: the background is a generic, non-interactive
- `art/ui/poc/tv/capture-rounds.mjs:4`: // - lobby (br-dim.6, replaces the warm-up yard): the roster shows every player at once (one card each, none paged);
