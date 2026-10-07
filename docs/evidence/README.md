# Evidence

Each bead's evidence lives in `docs/evidence/<P1-ID>/` (receipts, captures, self-review). A receipt names what it ran on, honestly.

## Lane labels (plan §13.1)

A result carries the label of the lane that produced it; a lane that didn't run is reported as unavailable with the reason, never
claimed. `web/tests/journeys/harness/lanes.mjs` prints the inventory for the machine it runs on, and
`scripts/beads/batch-verify.sh run --matrix milestone` records each lane's label and machine in
`docs/evidence/P1-F10/matrix-<host>-<tier>.json`.

| Label | What it is | Not |
|---|---|---|
| Chromium (linux or darwin, Playwright) | Playwright's Chromium: host and controllers; SwiftShader WebGL unless `JJ_CHROMIUM_GPU` says otherwise (`1`: eris's RTX 2080 Super over ANGLE/Vulkan, headless) | a real GPU headed browser |
| WebKit (Playwright) | Playwright's WebKit build: controller journeys | Safari |
| Firefox (Playwright) | milestone only | |
| iOS Simulator | Mobile Safari in the simulator on the Mac | an iPhone |
| Android emulator | Chrome in the AVD on eris (KVM) | an Android phone |
| macOS Chrome headed (real GPU) | the perf receipt and judged captures, on the Mac, run by the owner | an unattended lane |
| macOS Safari, Windows, real phones, pads and the TCL | no lane: the owner checks them in Q02 | |

Rules: Playwright WebKit is "WebKit", never "Safari". A simulator or emulator run is never a "device". An auto-lowered render
(R111) is marked as such and doesn't count as native. A number copied from elsewhere is a reference until measured.

## Machines

- **eris** (Linux, i5-12400, RTX 2080 Super, KVM): WebRTC journeys, the Android emulator, GPU-backed headless Chromium.
- **the Mac** (Apple M1 Pro): the iOS Simulator and headed macOS Chrome. Playwright browsers on the Mac can't complete a loopback
  WebRTC connection (the matrix's probe records it), so WebRTC journeys run on eris; keep the Mac light.

## Evidence records and the evidence close (P1-F02, plan §15.0)

Per-bead evidence lives in `docs/evidence/<P1-ID>/` (or the bead id for beads without one): captures, logs, receipts.
A bead that closes on evidence rather than CI (`ev:owner`, `ev:deploy-repo`, `ev:hardware`, or any close before CI
existed) cites one **evidence record**: a committed Markdown file in its directory whose first lines are this header.

```
<!-- evidence
bead: br-p1-d07-h8j
id: P1-D07
covers: AC1 AC2 AC3 AC4
observer: BrownCreek
date: 2026-10-07
build: v02-eceaeeb8
external: jammers-deploy d2cabdd..364753f, run 1714
-->
```

| Field | Required | Meaning |
|---|---|---|
| `bead` | yes | the bead being closed; must be the bead the close names |
| `id` | yes | its `external_ref` (P1-ID); must match the directory |
| `covers` | yes | every acceptance item, as `AC1 AC2 …` in the order `br show` lists them; none may be missing |
| `observer` | yes | who ran or watched it (an agent's Agent Mail name, or `owner`) |
| `date` | yes | `YYYY-MM-DD` |
| `build` | one of these | the game commit, preview id or build the evidence is about |
| `external` | for `ev:deploy-repo` | the other repo's commit range (`<repo> <a>..<b>`) and its CI or publish run; a deploy-repo record needs no game-repo commit |

The body says, per acceptance item, the command that was run and its real output (or the file holding it), the
machine and the browser. Label honestly (AGENTS.md "Evidence"): WebKit is not Safari, an emulator is not a device.

### Closing on a record

```bash
scripts/beads/batch-verify.sh close <bead> --evidence docs/evidence/<P1-ID>/<file>.md
```

checks the record (`scripts/beads/evidence-check.py`) and then closes through `scripts/beads/close.sh --receipt`,
which records `receipt:<file>`. A record is refused when it is:

- **uncommitted** (untracked, or changed since HEAD);
- **malformed** (no header, an unknown field, a bad date);
- for the **wrong bead** (`bead`/`id` don't match the close, or the file isn't in the bead's directory);
- **incomplete** (an acceptance item missing from `covers`, no `build`/`external`, or an `ev:deploy-repo` bead
  without an `external` commit range and run).

Manual evidence is never recorded as a suite pass: the gate note says `evidence:<file>`, not a CI run.

### Who may change a bead's evidence

The `commit-msg` hook (`scripts/hooks/commit-msg`, installed by `scripts/hooks/install.sh`) rejects a commit that
changes `docs/evidence/<ID>/` unless its message names `<ID>` (or its base, `P1-C05` for `P1-C05.2`) or starts a line
with `Recapture:` (a deliberate re-capture of someone else's evidence, saying why).
