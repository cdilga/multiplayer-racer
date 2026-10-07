# CI: what runs, where, and why it's fast

`.gitea/workflows/ci.yml` (the lanes `scripts/ci-status.sh` and `scripts/beads/close.sh` read) and
`.gitea/workflows/gpu.yml` (the GPU journeys; never a lane). Runners and the job image: `docs/infra/ci-runners.md`.

## Shape of a run

```
plan ─┬─ rust-lint            fmt, check (native + wasm), clippy, jj validate x3, no-tokio, cargo deny
      ├─ rust-test            nextest (opt-level 1, all binaries in parallel), doc tests, wasm parity
      ├─ build ── browser 1..16   one file per slot when there are enough slots, longest first
      └─ image                jj-server image, two-preview smoke, push
checks                        (no plan needed) tokens, grid, cues, engine bundle, look recipes, maps, vehicle bake
```

- **plan** (`scripts/ci/plan.mjs`) finds the newest first-parent ancestor whose `CI / …` statuses all passed and diffs
  from it, so a run replaced while waiting, or a red run, loses nothing: its changes are still in the next diff. It
  prints one line like
  `selected: rust(jj-server); browser (9 in 9 slots, longest ~295 s): landing, backoff, transport, …; gpu: …`.
- **Selection rules** (first match wins; a path no rule knows selects everything):
  - docs, spikes, `.beads`, `.claude`, Markdown, `art/{audio,references,style,ui/poc}`, offline tools: nothing beyond
    the always-on `checks` job.
  - CI's own files, the Cargo workspace files, `.nvmrc`, the root and web lockfiles, `maps/`, `assets/`, `scenarios/`,
    `art/vehicles/`, `art/contracts/`, `scripts/build-host-wasm.sh`: **everything**.
  - a crate: that crate and every crate that depends on it (nextest `-p` each). A crate in the browser builds' closure
    (jj-wasm-host/-input/-procgen and jj-tools, which is most of them) also selects every browser suite; jj-server
    alone selects what serves through it (landing, transport, journeys, the SSE soak, the image).
  - a test file alone: just that file. A suite's `lib/`, fixtures or harness: that whole suite.
  - `web/host/**`, `web/controller/**`: every host test, transport test and journey, landing, the image (not the UI
    kit). `web/landing/**`: landing, transport, journeys, image. `web/shared/**`, `art/ui/**` and the rest of `web/`:
    every browser suite.
- **build** (`scripts/ci/build-web.sh`) is keyed by a hash of its inputs (every tracked file except docs, tests and
  tooling no build reads). A key already in the host's `/cargo-cache/jj-prebuilt/` is reused, so test-only pushes
  never rebuild. The tarball (node_modules, `web/dist`, `web/dist-test`, the four wasm-bindgen packages, `jj` and
  `jj-server`) goes to the browser slots as the `web-build` artifact (`upload-artifact@v3`; v4 refuses non-github.com
  servers).
- **browser** is a static 16-slot matrix (Gitea 1.27 can't expand a matrix from job outputs: such a job waits forever).
  plan packs the targets longest first onto the least-loaded slot using `scripts/ci/durations.json`; unused slots
  are skipped by the job's `if`. Inside a slot files run one at a time (`scripts/ci/run-slot.mjs`), each with the
  env its suite always had, and each prints a `slot-timing:` line. Refresh `durations.json` from those lines when
  tests grow.
- **The full matrix** (`--full`: every crate, every browser file, the 300 s SSE soak) runs on the nightly schedule
  (01:17 AEST) and on `workflow_dispatch`. A push runs the 20 s soak smoke. Run it before a batch close with
  `tea api --login gitea-lan -X POST /repos/cdilga/multiplayer-racer/actions/workflows/ci.yml/dispatches -d '{"ref":"v0.2-revamp"}'`.

## A bead's close

`close.sh` waits for the lanes on the bead's commit. Selection keeps that honest: the run on that commit diffs from the
last green ancestor, so it covers every path the bead changed (and anything else not yet green). If the lead wants the
full matrix before a batch close, dispatch it (above) and wait for that run.

## Timings

See the report in `docs/learnings/ci.md` for measured before/after numbers.
