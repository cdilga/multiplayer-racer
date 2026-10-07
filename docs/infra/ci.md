# CI: what runs, where, and why it's fast

`.gitea/workflows/ci.yml` (the lanes `scripts/ci-status.sh` and `scripts/beads/close.sh` read) and
`.gitea/workflows/gpu.yml` (the GPU journeys; never a lane). Runners and the job image: `docs/infra/ci-runners.md`.

## Shape of a run

Every job starts at once; there is no plan stage and no build stage in front of the tests.

```
checks          tokens, grid, cues, engine bundle, look recipes, maps, vehicle bake        (always)
rust-lint       fmt, check (native + wasm), clippy, jj validate x3, no-tokio, cargo deny   (if any Rust is selected)
rust-test       nextest (opt-level 1, binaries in parallel), doc tests, wasm parity         (the selected crates)
build           the web build, unless its key is already in the store                      (if any browser test is selected)
browser 1..7    the selected targets, packed longest first; each reads the build from its
                host's cache or the store, waiting for `build` only when the build is new
image           jj-server image, two-preview smoke, push                                    (if its inputs changed)
```

- **Selection** (`scripts/ci/plan.mjs`) is every job's first step and is deterministic, so all jobs agree. It diffs
  HEAD against the head of the newest successful run of this workflow on the branch (one API call), so a run replaced
  while waiting, or a red run, loses nothing: its changes are still in the next diff, and a red suite keeps running
  until it passes. Each job's log prints one line like
  `selected: rust(jj-server); browser (22 files as 29 targets in 7 slots, longest ~254 s): landing, …; gpu: …`.
  Dry-run it: `node scripts/ci/plan.mjs --changed web/host/tests/camera.test.mjs`.
- **Selection rules** (first match wins; a path no rule knows selects everything):
  - docs, spikes, `.beads`, `.claude`, Markdown, `art/{audio,references,style}`, offline tools: nothing beyond the
    always-on `checks` job.
  - CI's own files, the Cargo workspace files, `.nvmrc`, the root and web lockfiles, `maps/`, `assets/`, `scenarios/`,
    `art/vehicles/`, `art/contracts/`, `tools/net/`, `scripts/build-host-wasm.sh`: **everything**.
  - a crate: that crate and every crate that depends on it (nextest `-p` each). A crate in the browser builds' closure
    (jj-wasm-host/-input/-procgen and jj-tools, which is most of them) also selects every browser suite; jj-server
    alone selects what serves through it (landing, transport, journeys, the smoke flow, the SSE soak, the image).
  - a test file alone: just that file. A suite's `lib/`, fixtures or harness: that whole suite.
  - `web/host/**`, `web/controller/**`: every host test, transport test, journey and the smoke flow, landing, the image
    (not the UI kit). `web/landing/**`: landing, transport, journeys, image. `web/shared/**`, `art/ui/**` and the rest
    of `web/`: every browser suite.
  - `scripts/ci/durations.json` and `durations.mjs`: nothing (they move timing, not coverage).
- **Per-test targets** (`scripts/ci/targets.mjs`): a file estimated over 75 s runs as one target per top-level test
  (`file::name`, an anchored `--test-name-pattern`). Names come from the source when every test is a top-level
  `test('literal', …)`; otherwise from earlier runs' logs, plus a `file::*rest` target that skips every known name, so a
  test added since still runs. Files with subtests are never split. A single long test can't be split (JN5, ~250 s).
- **The build** (`scripts/ci/build-web.sh`) is keyed by its inputs (`scripts/ci/build-key.sh`: every tracked file
  except docs, tests and tooling no build reads) and kept in Gitea's generic package registry, package
  `jj-web-build` (`scripts/ci/web-store.sh`, newest 30 versions kept), plus each host's `/cargo-cache/jj-prebuilt/`. A
  stored key is never rebuilt, so test-only pushes build nothing. The tarball holds node_modules, `web/dist`,
  `web/dist-test`, the four wasm-bindgen packages, `jj` and `jj-server`. The store token is the `REGISTRY_PUSH_TOKEN`
  secret (package read/write for cdilga).
- **browser** is a static 7-slot matrix (Gitea 1.27 can't expand a matrix from job outputs) on the `browser` runners
  (4 on triton, 3 on TrueNAS). plan packs targets longest first onto the least-loaded slot using
  `scripts/ci/durations.json`; an unused slot finishes after its plan step. Inside a slot targets run one at a time
  (`scripts/ci/run-slot.mjs`), each printing `slot-timing: <s>s <pass|FAIL> <target>`. Refresh the estimates and the
  learned test names after a full run: `node scripts/ci/durations.mjs <run id>` (commit the JSON; it selects nothing).
- **The full matrix** (every crate, every browser target, the 300 s SSE soak) runs on the nightly schedule (01:17 AEST)
  and on `workflow_dispatch`. A push runs the 20 s soak smoke. Run it before a batch close with
  `tea api --login gitea-lan -X POST /repos/cdilga/multiplayer-racer/actions/workflows/ci.yml/dispatches -d '{"ref":"v0.2-revamp"}'`.

## A bead's close

`close.sh` waits for the lanes on the bead's commit. Selection keeps that honest: the run on that commit diffs from the
last green run, so it covers every path the bead changed (and anything else not yet green). If the lead wants the full
matrix before a batch close, dispatch it (above) and wait for that run.

## While anything is red, every run is a full run

Selection diffs from the last **green** run. Until a run passes, every push diffs from the old green (run 1248 on
2026-10-07) and selects everything: ~8 min on 7 slots at best. A green main, with red bouncing back to its author, is
what makes the typical push fast.

## Timings

See the report in `docs/learnings/ci.md` for measured before/after numbers.
