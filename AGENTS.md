# Agent Instructions

This repository uses `br` (Beads Rust) for task tracking and `bv` for graph-aware triage.

> `CLAUDE.md` is a symlink to this file. Claude Code and other agent tools read the same instructions.

## ⚠️ Owner direction: read first, overrides everything below

Joystick Jammers is being rebuilt as **0.2** on the `v0.2-revamp` branch. Precedence:
**owner ruling → master plan → Playtest-1 plan → beads → code.** A bead, old test or older doc can't
override a ruling; flag the conflict instead of changing the ruling.

| Doc | Role |
|---|---|
| `docs/policies/owner-direction-2026-09-29.md` | **Normative rules** (R1–R87, short form). |
| `docs/plans/v0.2-playtest-1-plan.md` | **What we're building now** and the bead source: Playtest 1 (the Minimum build). |
| `docs/plans/v0.2-revamp-plan-2026-09-28.md` | Master plan and design reference up to Full 0.2. |
| `docs/plans/v0.2-experience-direction.md` | Website/host/controller/game design brief. |

Most important rules:

- **No arbitrary gameplay-count caps anywhere** (players, seats, controllers, tiles, cars, live debris).
  No temporary/MVP limits, queues or truncated arrays. Test cohort sizes are samples, not limits.
- Debris stays **dynamic** for the round: never static, merged, deleted, expired or count-budgeted.
- **Rust** game server (day 0, Asupersync, no Tokio) and Rust/WASM simulation core.
- Completely **separate from Physical Soccer**: borrow ideas, never code or dependencies.
- Two-stick controls; no tap-to-fire or accelerometer boost; one player per phone touchscreen.
- No runtime CDNs; all runtime assets/libraries are self-hosted. Cloudflare STUN/TURN is the
  explicitly approved connectivity service (R79).
- Vehicles are **code-built** from reference sheets (R81); damage is **intact → loose → detached**,
  no denting (R86).
- **Host recovery is deferred** (R84): a dead host ends the room.
- **Previews never freeze** (R85): a playtest is a pinned rainbow preview; development continues.
- **Validation in the loop** (R90): every part of the game must be introspectable as data, settable,
  steppable/replayable and fixture-testable by agents. How is your call; that it exists is not
  optional (Playtest-1 plan §13a).
- **TURN** (R88): self-hosted coturn at `turn.dilger.dev` first, Cloudflare TURN as fallback; only TURN
  has a WAN hole, everything else rides Cloudflare tunnels (`docs/infra/turn-and-previews.md`).

## Where we are now (2026-10-02)

- **Phase:** building **Playtest 1**: the new stack (Rust server, WebRTC/TURN controllers, Rust/WASM
  sim in a host worker) plus one car (the Cruz Missile) racing generated four-biome tracks. Scope,
  architecture, protocols and the task graph are in `docs/plans/v0.2-playtest-1-plan.md`.
- **Code:** the 0.2 code doesn't exist yet. The first bead (P1-F01) creates the Rust workspace and
  `web/` packages. The 0.1 game was **removed from this branch** (R87); it still runs in production
  from `main`. Read old code with `git show v0.1-final:<path>`, as evidence only. Never restore it.
- **Infra:** `https://jammers-preview.dilger.dev/` is live (placeholder index until P1-D03/D05);
  coturn runs on TrueNAS. Audio is generated on **eris** (GPU box: `ssh eris`, workspace
  `~/Work/dev/jammers-audio`), never in this repo (R89).
- **Tracker:** the 0.2 beads are cut from the Playtest-1 plan §15 using its §15.0 template. Pre-0.2
  beads were closed on 2026-09-30 (`superseded-v0_1`); don't reopen them. Beads close on CI,
  emulators and Playwright; the owner playtests the lot (P1-Q02 checklist) and failures come back as
  bug beads.
- **Machines:** the working tree, `br` and Agent Mail live on the Mac; builds, tests and browsers run
  on eris (plan §15.2). Gitea (`tea`, login `gitea-lan`) is primary; GitHub is a passive mirror.
- **Canonical vehicle evidence:** `spikes/art-pipeline/J-cruze-lowpoly/` (see `spikes/README.md` for
  which spikes are canonical and which are reference only).

### Repository map

| Path | What |
|---|---|
| `docs/` | Policy, plans, process (`docs/README.md` is the index) |
| `crates/`, `web/`, `tools/` | 0.2 code (created by P1-F01 onwards) |
| `art/` | References, style, vehicle sources, contracts; `art/audio/v0.1-music/` is the vibe reference for regenerated music (R13) |
| `spikes/` | Evidence from art/model spikes; nothing imports from here at runtime |
| `.beads/`, `scripts/beads/` | Tracker and the batch-verify tooling |
| `.claude/skills/`, `.claude/agents/`, `.claude/hooks/` | Project skills, agents, the worker guard hook |
| `package.json` (root) | Tooling only: the spikes and skills import three/Playwright from root `node_modules` |

## Architecture (roles): read before reasoning about rendering/perf

- **The host renders the full 3D world** on its screen: usually a laptop driving a TV, but any GPU
  phone or laptop at any resolution/aspect. It owns the simulation (Rust/WASM `jj-sim` in a worker),
  room authority, scores and rendering. Rendering budgets for many cars/tiles are a **host**
  concern, and they never become player caps.
- **Phones, pads, keyboards and hubs are *controllers*, not renderers.** They send input and show a
  light HUD. Controller routes never download the world renderer or simulation.
- **The Rust server** serves bundles and creates/resolves rooms, relays WebRTC signalling and issues
  TURN credentials. Controllers exchange gameplay with the browser host over WebRTC, directly on the
  LAN where possible, through Cloudflare TURN otherwise. No per-input Rust forwarding, media SFU,
  mandatory WSS gameplay fallback or coturn prerequisite (R77/R79).
- **Efficient controls from day one:** compact binary input, fair batching on one connection per
  browser endpoint, fresh queues and two semantic channels; measure actual bytes/packets and input
  age. No participant/source caps or custom FEC prerequisite (R80).
- **One screen first:** extra displays require **explicit owner approval at G-SCREENS** before any
  implementation or replication spike (R78).

## Coordination

- Register with MCP Agent Mail at the start of every session using this project key:
  `/Users/cdilga/Documents/dev/multiplayer-racer`
- Use the exact Agent Mail name assigned in your prompt. If no name was assigned, register with an
  auto-generated name and announce it. Commits need `AGENT_NAME=<your Agent Mail name>` (pre-commit guard).
- Check Agent Mail before claiming work and after each meaningful edit/test cycle.
- Reserve files with Agent Mail before editing. Use specific paths or globs, not the whole repo.
- Announce bead claims, file reservations, blockers, and completion in a thread named after the bead ID.
- **NTM is paused (R91).** Run multi-agent work as native Claude Code agents with native messaging
  (SendMessage); keep it to at most five agents including the coordinator. Agent Mail stays for
  file reservations and the commit guard.
- Don't sit idle waiting for consensus. If a ready bead is unclaimed and you can make progress, claim
  it, reserve files, announce, and start.

## Beads (code-first / batch-verify)

`.beads/policy.yaml` enforces this workflow. Read `docs/process/code-first-batch-verify.md` before
your first claim.

- Use `br` 0.7.1 or newer, not `bd`.
- Find ready work with `br ready --json` (it includes `rework` beads returned to you) and graph
  priorities with `bv --robot-triage` or `bv --robot-next`. Never run bare `bv`: it launches an
  interactive TUI.
- Claim with `br update <id> --claim --actor <AgentMailName>`. You can hold one claimed bead at a
  time, and the bead must have acceptance criteria.
- **Workers never close, delete, reopen or gate beads, and never run test suites or full builds.**
  Write the code and its tests, run at most a syntax gate (`cargo check -p <crate>`, `npm run build`,
  `tsc --noEmit`), and commit with the bead ID. Then run
  `br update <id> --status batch_pending --transition-comment "commit:<sha> <test that covers each acceptance item>"`
  and take the next bead.
- The batch verifier runs the tests once per wave (`scripts/beads/batch-verify.sh`). It closes green
  beads with a `receipt:` reference, or returns failures to the same assignee as `rework` with the
  failing assertion. (Its suite table still needs the 0.2 layout: bead P1-F02.)
- Each bead copies its task's contract, acceptance and evidence from the Playtest-1 plan §15, plus the
  anti-narrowing clause from `docs/plans/BEAD-DEFINITION-OF-DONE.md`.

## Skills

- **`lowpoly-model-from-refs`** (`.claude/skills/lowpoly-model-from-refs/`): **the canonical vehicle
  modelling method (R81)**: per-tier reference sheets → silhouette masks → three.js model script →
  IoU score + optimiser → bake to contract. Use it for any new or redone roster vehicle.
- **`vehicle-model-validation`** (`.claude/skills/vehicle-model-validation/`): the 0.2 acceptance gate.
  Run it before calling any vehicle model, LOD, damage-part, paint/identity, sidecar, loader or
  in-game vehicle-rendering task done.
- **`game-model-prep`** (`.claude/skills/game-model-prep/`): engine-generic background (rigging,
  collider fit, visual QA). Its debris-lifetime advice defers to project policy; JJ debris persists.
- **`threejs-primitive-modelling`**: the Spike H/I method; reference only for vehicles since R81.
- Agents: `.claude/agents/architect.md` (module boundaries, data vs code, decomposition) and
  `.claude/agents/documentor.md`.

## Engineering principles

- **Physics:** use Rapier's vehicle controller and APIs as documented for the pinned version. Never
  multiply/divide values by large factors "to make it work"; find the root cause (wrong API, units,
  order of operations, missing setup). Sustained forces integrate with `dt` once; impulses apply once.
- **Dependencies:** everything bundled and self-hosted. No CDN imports, import maps to CDNs, remote
  fonts, or test-time CDN interception (R70).
- **Logging:** default to none. Never log per frame or per tick; use overlays, receipts, captures or
  one-time logs.
- **Data over code:** profiles, rules, maps and asset contracts are versioned data with validators.
- **Evidence:** behavioural acceptance in the running game, not just unit assertions; receipts name
  hardware, browser, build and cohort. Label honestly: Playwright WebKit is "WebKit", not Safari; a
  simulator/emulator run is not a device; a number copied from a spike or another codebase is a
  reference until measured. Per-bead evidence goes in `docs/evidence/<P1-ID>/`.
- **Builds:** never run bare `cargo` on the Mac for Linux-capable work; use `rch exec -- cargo …` or
  `scripts/remote/eris.sh` (a bare `cargo check` once filled a Mac's disk). Mac-only lanes (emulators,
  Mac GPU captures) are the exception.
- **Working method:** plan §13a–§13b: see state as data, set it up, step/replay, assert with fixtures;
  reach the game through the `jj` CLI; one bead per fresh agent session; name what you reuse; repair
  beads reproduce first; stop after 2–3 identical remote failures and reproduce locally; record traps
  in `docs/learnings/<area>.md`.

## Code rules

- Preserve user and other-agent changes. Don't revert unfamiliar edits.
- Keep file reservations narrow and release them when done.
- Don't commit or push unless the human coordinator explicitly asks (bead workers commit per the
  code-first doc). `git push` doesn't upload LFS objects here: run `git lfs push --all <remote> <branch>`
  afterwards. Never `git add -A`: local MCP configs hold an Agent Mail token, and personal files
  (`.claude/skills/idea-engine/`, `.claude/workflows/idea-engine.mjs`) must stay out of this public repo.

<!-- bv-agent-instructions-v2 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking and [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (`bv`) for graph-aware triage. Issues are stored in `.beads/` and tracked in git.

### Using bv as an AI sidecar

bv is a graph-aware triage engine for Beads projects (.beads/beads.jsonl). Instead of parsing JSONL or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). `br` handles creating, modifying, and closing beads.

**CRITICAL: Use ONLY --robot-* flags. Bare bv launches an interactive TUI that blocks your session.**

#### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns everything you need in one call:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command

# Token-optimized output (TOON) for lower LLM context usage:
bv --robot-triage --format toon
```

Before claiming, verify current state with `br show <id> --json` or `br ready --json`. `recommendations` can include graph-important blocked or assigned work; only `quick_ref.top_picks` and non-empty `claim_command` fields represent claimable work.

#### Other bv Commands

| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with unblocks lists |
| `--robot-priority` | Priority misalignment detection with confidence |
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions, cycle breaks |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |

#### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank scores
```

### br Commands for Issue Management

```bash
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --claim --actor <AgentMailName>
br update <id> --status batch_pending --transition-comment "commit:<sha> ..."
br sync --flush-only  # Export DB to JSONL
```

Closing is the batch verifier's job (`scripts/beads/batch-verify.sh close`), never a worker's.

### Workflow Pattern

1. **Triage**: Run `bv --robot-triage` to find the highest-impact actionable work
2. **Claim**: `br update <id> --claim --actor <AgentMailName>`
3. **Work**: Write the code and its tests, run the syntax gate only, and commit with the bead ID
4. **Hand off**: `br update <id> --status batch_pending --transition-comment "commit:<sha> ..."`
5. **Verify** (batch verifier only): `scripts/beads/batch-verify.sh run`, then `close` or `rework`
6. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

```bash
git status              # Check what changed
git add <files>         # Stage specific files (never -A)
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit with the bead ID (AGENT_NAME set)
# Push once per wave (verifier), then: git lfs push --all <remote> <branch>
```

<!-- end-bv-agent-instructions -->
