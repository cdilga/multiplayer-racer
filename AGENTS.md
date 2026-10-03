# Agent Instructions

This repository uses `br` (Beads Rust) for task tracking and `bv` for graph-aware triage.

> `CLAUDE.md` is a symlink to this file. Claude Code and other agent tools read the same instructions.

## ⚠️ Owner direction: read first, overrides everything below

Joystick Jammers is being rebuilt as **0.2** on the `v0.2-revamp` branch. Precedence:
**owner ruling → master plan → Playtest-1 plan → beads → code.** A bead, old test or older doc can't
override a ruling; flag the conflict instead of changing the ruling.

| Doc | Role |
|---|---|
| `docs/policies/owner-direction-2026-09-29.md` | **Normative rules** (R1–R94, short form). |
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

## Where we are now (2026-10-03)

- **Phase:** building **Playtest 1**: the new stack (Rust server, WebRTC/TURN controllers, Rust/WASM
  sim in a host worker) plus one car (the Cruz Missile) racing generated four-biome tracks. Scope,
  architecture, protocols and the task graph are in `docs/plans/v0.2-playtest-1-plan.md`. A design
  POC (§3a, owner-gated) settles the UI look, grid layouts and phone controller first; the UI tasks
  wait for its verdict, everything else runs in parallel.
- **Code:** the 0.2 code doesn't exist yet. The first bead (P1-F01) creates the Rust workspace and
  `web/` packages. The 0.1 game was **removed from this branch** (R87); it still runs in production
  from `main`. Read old code with `git show v0.1-final:<path>`, as evidence only. Never restore it.
- **Infra:** `https://jammers-preview.dilger.dev/` is live (placeholder index until P1-D03/D05);
  coturn runs on TrueNAS. Audio is generated on **eris** (GPU box: `ssh eris`, workspace
  `~/Work/dev/jammers-audio`), never in this repo (R89).
- **Tracker:** the 95 Playtest-1 beads are cut from the plan's §15 using its §15.0 template; each
  carries `external_ref = P1-XXX`, and `docs/plans/v0.2-playtest-1-bead-map.md` maps every plan
  requirement to its beads. The pre-0.2 beads were removed from the tracker on 2026-10-03 (read them
  with `git show 0a165ef:.beads/issues.jsonl`; never resume them). Beads close on CI,
  emulators and Playwright; the owner playtests the lot (P1-Q02 checklist) and failures come back as
  bug beads.
- **Machines (R93):** the working tree, `br` and Agent Mail live on the Mac. Compute goes wherever
  there's spare CPU: RCH workers (devbox, a VM on triton, and eris when it's on), the Mac, and the shared Gitea
  runners on TrueNAS. Only hardware facts pin work to a machine (plan §15.2). Gitea (`tea`, login
  `gitea-lan`) is primary; GitHub is a passive mirror.
- **Canonical vehicle evidence:** `spikes/art-pipeline/J-cruze-lowpoly/` (see `spikes/README.md` for
  which spikes are canonical and which are reference only).

### Repository map

| Path | What |
|---|---|
| `docs/` | Policy, plans, process (`docs/README.md` is the index) |
| `crates/`, `web/`, `tools/` | 0.2 code (created by P1-F01 onwards) |
| `art/` | References, style, vehicle sources, contracts; `art/audio/v0.1-music/` is the vibe reference for regenerated music (R13) |
| `spikes/` | Evidence from art/model spikes; nothing imports from here at runtime |
| `.beads/`, `scripts/beads/` | Tracker, its policy and canary, and the local lane runner |
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

- **One shared working tree.** Never create git worktrees or extra clones for agents (they caused an
  integration nightmare). All agents edit the same tree and coordinate through native Claude
  messaging and Agent Mail file reservations. Remote per-run directories are only for outputs,
  browser profiles and server state, never code. eris keeps a clean clone kept in sync by `ru` (Jeffrey
  Emanuel's Repo Updater) from pushed commits; nobody edits there (`scripts/remote/eris.sh` runs things in it).
- Register with MCP Agent Mail at the start of every session using this project key:
  `/Users/cdilga/Documents/dev/multiplayer-racer`
- Use the exact Agent Mail name assigned in your prompt. If no name was assigned, register with an
  auto-generated name and announce it. Commits need `AGENT_NAME=<your Agent Mail name>` (pre-commit guard).
- With other agents running: check Agent Mail before claiming work, reserve files before editing
  (specific paths or globs, not the whole repo), and announce claims, blockers and completion in a
  thread named after the bead ID. **Solo, skip reservations and announcements**; register only for the
  commit guard.
- **NTM launches workers again** (owner, 2026-10-03, amends R91): native Claude Code sessions, or NTM
  panes, including **OMP workers on GLM-5.3 at max thinking**
  (`ntm spawn multiplayer-racer --omp=N:zai/glm-5.3:max`). Never pass `--worktrees`. OMP workers have no
  MCP or Claude hooks: they use the `am` CLI for Agent Mail and follow the hooks' rules by hand
  (`docs/process/bead-workflow.md`, "OMP workers"). Agent Mail stays for file reservations and the commit
  guard.
- **No agent cap, no roles (R93).** Run as many agents as the work and machines support. Agents are
  fungible generalists: nobody owns a track; everyone picks the most useful ready work with
  `bv --robot-triage`. Coupled systems (transport, sim, renderer) stay safe through narrow Agent Mail
  file reservations, not assigned owners.
- **Operating modes** (owner, 2026-10-03): **solo → 2 workers → 4 workers**, each step when the owner is
  happy. **Solo:** one session (`JJ_ROLE=solo`) does the whole lot while the owner watches and cranks it
  with `next`, `goal: …`, `verify` and `status`. **With workers:** each worker closes its own beads on
  green CI, and a **verifier on call** handles hand-offs, red CI and evidence closes. The verifier runs
  **on demand only** (no timers or `/loop`), so it costs nothing when work stops. Any session that
  verifies **must register with Remote Control** (`claude --remote-control <name>`, or `/remote-control`
  in a running session) so the owner can watch. Models: solo and workers on Opus 5.5 at medium effort,
  delegating mechanical work to Sonnet 5.5 subagents; the verifier on Sonnet 5.5. Start commands and the
  crank table: `docs/process/bead-workflow.md`. NTM and Agent Mail can take over parts later.
- **Lean by default** (owner, 2026-10-03): no routine review rounds (CI and the bead's tests are the check);
  the bead is the contract, so don't read the whole plan, only the sections a bead cites; keep command
  output small (focused tests, long logs to files); a bead that proves bigger than one session is
  split into child beads (`br create --parent <id>`) with its acceptance moved over verbatim.
- **Token hygiene** (owner, 2026-10-03):
  - **Plans:** read them only through `scripts/plan-ref.sh`: a task (`P1-N03`), a section (`13b.2`),
    `--master 10.6`/`V2-16`, `--rulings R93`, or `--toc`. `br show <id>` is the contract and the bead map
    is the requirement index. Never cat, sed or grep the plan files.
  - **Tools:** use Read, Grep, Glob and Edit for files and logs; the shell is for running things.
    Commands start in the repo root, so don't prefix them with `cd` to it.
  - **Environment:** Claude Code sessions get the pinned Node from a SessionStart hook
    (`.claude/hooks/session-env.sh`), so don't source nvm. Rust follows `rust-toolchain.toml`. Tools
    read their secrets from `~/.config/jammers/*.env` themselves; never source those files into a shell.
    Version checks are `scripts/doctor.sh`, run by CI and at machine setup, not mid-session.
  - **Memory:** durable notes go in Claude Code's project memory: one fact per file plus the `MEMORY.md`
    index, written with Write or Edit. `cm` isn't used in this project.
- Don't sit idle waiting for consensus. If a ready bead is unclaimed and you can make progress, claim
  it, reserve files, announce, and start.

## Beads (Physical Soccer's model)

`docs/process/bead-workflow.md` is the loop; `.beads/policy.yaml` enforces the close rules.

- Use `br` 0.7.4 or newer, not `bd`. Find work with `br ready --json` (it includes `rework` beads
  returned to you) or `bv --robot-next`. Never run bare `bv`: it launches an interactive TUI.
- Claim with `br update <id> --claim --actor <AgentMailName>`; the bead must have acceptance criteria.
  A session may work one bead or a **goal** spanning several (R93): claim each as you start it.
- **Full development loop** (owner ruling 2026-10-02): run servers, multi-controller/device sessions,
  emulators, `jj` probes, debuggers, captures, and the scenarios and journeys for your area; iterate on
  mechanics or models until they work. Before committing, check the paths you changed (affected crates
  through RCH, the specs and scenarios you touched); leave the workspace-wide matrix to CI unless you
  changed a shared contract (`jj-types`, `jj-protocol`, `jj-map`, the `jj-sim` core).
- Commit with the P1 ID and bead ID, then **close your own bead with one command**:
  `scripts/beads/close.sh <id> --tests "AC1: <test> AC2: <test> …"`. It pushes the commit and its LFS
  objects, waits for green CI (`scripts/ci-status.sh --wait`), ticks the acceptance boxes, records the
  `batch_verify` gate and closes with the run as the receipt. A red lane on your change is yours to fix.
  `--pending` hands off to the verifier instead (`batch_pending`). `--receipt docs/evidence/<P1-ID>/<file>`
  covers owner, deploy-repo and hardware evidence, and every close before CI exists (P1-D01, P1-F02):
  the receipt is a committed record of the commands and their output.
- `br sync --flush-only` exports the DB to `.beads/issues.jsonl` (mutations usually auto-flush). More
  `br`/`bv` usage: `br robot-docs guide`, `br <cmd> --help`, `bv --help` (robot flags only).
- Each bead carries its task's contract, acceptance and evidence from the Playtest-1 plan §15, plus the
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
- **Builds:** Rust goes through RCH (`rch exec -- cargo …`), which spreads it across the RCH workers
  (devbox on triton, eris when it's on); `scripts/remote/eris.sh` runs anything else on eris. Use the
  Mac's CPU too: per-crate local builds, Vite, Playwright and the emulators are fine within the
  15 GiB `target/` budget. The one Mac rule is disk, not CPU: no workspace-wide cargo on the Mac
  itself (a whole-workspace local build once filled a Mac's disk; the hook blocks it).
- **Tests:** follow Physical Soccer's shape: scenario banks (versioned fixtures replayed bit for bit,
  asserting outcome envelopes and stating known gaps) and Playwright journeys (real host + controller
  contexts through the real join path). Unit tests only where the unit is the lowest level that shows
  the behaviour.
- **Working method:** plan §13a–§13b: see state as data, set it up, step/replay, assert with fixtures;
  reach the game through the `jj` CLI; a session works one bead or a goal of several, and rereads
  AGENTS.md after a context compaction; name what you reuse; repair
  beads reproduce first; stop after 2–3 identical remote failures and reproduce locally; record traps
  in `docs/learnings/<area>.md`. Every feature earns its keep: add a tool, flag or helper only when a
  named task needs it now. Never block on the owner: proceed on the best evidence-backed candidate and
  let playtests judge it. The two exceptions are gates the owner set: the design POC verdict
  (G-DESIGN, plan §3a), which the UI tasks wait for, and the Playtest-1 qualification.

## Code rules

- Preserve user and other-agent changes. Don't revert unfamiliar edits.
- Keep file reservations narrow and release them when done.
- **Commit and push freely** (owner, 2026-10-03). Every session commits, pushes and closes its own work
  as it goes: solo, worker and verifier alike. There's no separate committer and no asking.
  - It's one shared tree, so anything else that's ready gets committed too: files another session left
    behind, tracker exports, docs. Give it its own commit saying what it is. Leave only work that's
    visibly mid-edit (it doesn't build, or a test it touches fails).
  - Mechanics: stage specific paths, and commit with `git commit -- <paths>` so half-staged work elsewhere
    stays out. `AGENT_NAME` is set by the start commands; it's needed for the commit guard and the
    pre-push hook.
  - `git push` doesn't upload LFS objects here: run `git lfs push --all <remote> <branch>` afterwards.
  - Only force-pushing or rewriting pushed history needs the owner.
  - Never `git add -A`: local MCP configs hold an Agent Mail token, and personal files
    (`.claude/skills/idea-engine/`, `.claude/workflows/idea-engine.mjs`) must stay out of this public repo.
