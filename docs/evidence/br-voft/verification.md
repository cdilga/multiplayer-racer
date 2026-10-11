# br-voft classification boundary repair

CI3393 browser slot2 captured a two-round journey failure: result places [1,2,3,3] instead of [1,2,3,4]. The master plan §10.12 allows genuine exact ties, but orders same-tick finishes by crossing fraction and unfinished entrants by legal progress high-water mark and the tick that reached it.

Root cause: the host built each session entrant from a display standing, forced every finish fraction to zero, used current progress instead of its high-water mark, and substituted the current simulation tick for every progress tick. The authoritative simulation already retained all three values. This could create artificial ties and discard unfinished progress after reversing.

The host now reads CarRace directly and preserves finish fraction, best_progress_mm and best_progress_tick at the session classification boundary. It also avoids repeatedly building/sorting all standings for each entrant. No simulation physics or wire format changed.

Focused boundary fixture: five entrants, two identical exact finish times, a later fraction within the same tick, and two equal-progress unfinished entrants whose high-water ticks differ. Session output is [1,1,3,4,5], with equal points for the exact tie. Missing-car/late entrant flags remain covered.

The browser journey now checks valid competition ranks and every entrant classified once across two real autoplay rounds. It still requires both rounds to cross the real finish line and reach Intermission without host clicks; no finish shortcut was added.

Validation:
- RCH on eris: `cargo test -p jj-wasm-host race_classification`, focused fixture passed.
- RCH on eris: `cargo test -p jj-wasm-host`, all44 tests passed,0 failures (4.17s test execution).
- Testing WASM built through RCH and generated with wasm-bindgen.
- Chromium151 on Mac arm64 with software WebGL, actual Rust server: `node --test web/tests/journeys/g01-two-rounds.test.mjs` passed two consecutive four-entrant rounds.
- CI receipt is recorded by close.sh after green CI.

Reuse: simulation CarRace facts, session classifier and its existing exact-tie rules, real round journey. Four entrants is a test cohort, never a gameplay cap.
