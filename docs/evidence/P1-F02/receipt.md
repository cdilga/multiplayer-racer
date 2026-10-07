<!-- evidence
bead: br-p1-f02-ntg
id: P1-F02
covers: AC1 AC2 AC3 AC4 AC5 AC6
observer: BrownCreek
date: 2026-10-08
build: game 1d575a2 (CI run 1892 at 2055da7 ran the shared lane scripts)
-->
# P1-F02 receipt

The contract was aligned with the CI that exists on 2026-10-08 (the bead's notes say how): lanes are the planner's
selection (`scripts/ci/plan.mjs`), not per-lane workflows with path filters. `docs/infra/ci.md` is the reference.

## AC1: the planner's lanes for jj-protocol, jj-sim, web/ and tools/vehicles; jobs print them; ci-status reports them

`plan-cases.txt`, the function every CI job runs as its first step:

    --changed crates/jj-protocol/src/lib.rs -> lanes rust, scenarios, wasm-parity, web, e2e, image (11 crates)
    --changed crates/jj-sim/src/lib.rs      -> lanes rust, scenarios, wasm-parity, web, e2e, image (6 crates)
    --changed web/host/src/main.ts          -> lanes web, e2e, image
    --changed tools/vehicles/bake.mjs       -> lanes tools

A real run: `scripts/ci-status.sh 2055da7` (run 1892) prints the jobs and `lanes    rust, scenarios, wasm-parity, web,
e2e, tools, image` (read from the rust-lint job's `selected:` line) above the run URL. Making these dry runs found
that the planner read no dependencies from the workspace's `jj-x.workspace = true` lines, so a crate change selected
only itself (fixed in 1548539).

## AC2: batch-verify.sh plan picks the same lanes for the same ranges

`plan-cases.txt`: `batch-verify.sh plan --base <a> --head <b>` calls the same planner (`plan.mjs --base --head`), e.g.
`98a3b77` -> `lanes: e2e`, `5abeb4e` -> `lanes: rust,wasm-parity,web,e2e,image`, `1d575a2` -> `lanes: checks only`.

## AC3: close.sh closes beads on green CI, naming each AC's test, with receipt:<run url>

The existing closes: 101 closed beads carry `receipt:http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/<n>`
with per-AC test names (e.g. br-awxz.1, br-dim.1 on run 1207; br-dim.10 on run 1102), all through
`scripts/beads/close.sh`.

## AC4: batch-verify.sh run's revision-bound receipt, and close from it

`wave-001.json` (also `.beads/receipts/wave-001.json`): `scripts/beads/batch-verify.sh run --base 1d575a2~1
--allow-dirty` planned `lanes checks only`, ran them on eris through `scripts/remote/eris.sh` at the pushed head
1d575a2 (`checks exit 0 5 s on eris`, log `wave-001-checks.log.txt`); the receipt holds base, head, tree, the dirty
inventory (107 tracked paths in the Mac's shared tree, which eris never sees), toolchain and lockfile hashes, each
lane's machine, exit and seconds, and the commands. The throwaway bead br-b4bb (batch_pending, its commit 1d575a2 in
range) then closed with `batch-verify.sh close br-b4bb --receipt .beads/receipts/wave-001.json`:
`Verified green in wave-001 at commit:1d575a2… receipt:.beads/receipts/wave-001.json`.

## AC5: evidence close rejects bad records and accepts a deploy-repo record

`canary.txt`, section "evidence records": `scripts/beads/evidence-check.py` accepts a deploy-repo record with no
game-repo commit and refuses an uncommitted, a malformed, a wrong-bead, an incomplete (`covers lacks AC2`) and a
range-less deploy-repo record. `batch-verify.sh close <bead> --evidence <record>` runs it before `close.sh --receipt`.
The schema is in `docs/evidence/README.md`; this file carries it.

## AC6: the canary, and the evidence commit-msg hook

`canary.txt`: `canary: 37 passed, 0 failed`, including "commit-msg rejects an unnamed change to another bead's
evidence", "accepts a message naming the bead" and "accepts a deliberate Recapture:". The hook is installed in the
Mac's clone (`scripts/hooks/install.sh`).
