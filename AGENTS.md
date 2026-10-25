# Agent Instructions

This repository uses `br` (Beads Rust) for task tracking and `bv` for graph-aware triage.

> `CLAUDE.md` is a symlink to this file. Claude Code and other agent tools read the same instructions.

## ⚠️ Owner direction: read first, overrides everything below

Joystick Jammers is being rebuilt as **0.2**, developed on `main` (the `v0.2-revamp` branch until 2026-10-21). Precedence:
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
- **Rust** game server (day 0, Asupersync, no Tokio) and Rust/WASM simulation core. Asupersync's licence is
  **approved by the owner, absolutely and finally (R112)**, and since R115 (2026-10-07) every
  Jeffrey Emanuel licence is accepted and any agent may read, build and test Asupersync like any other dependency.
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
- **Code:** the 0.2 Rust workspace and `web/` packages are on `main`. The 0.1 game was **removed** (R87); production has run 0.2 since 2026-10-19 and
  `main` carries 0.2 since 2026-10-21. Read old code with `git show v0.1-final:<path>`, as evidence only. Never restore it.
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

- **One shared working tree.** No worktrees or extra clones. All providers coordinate through Agent Mail
  and narrow file reservations. Remote directories are for outputs/profiles/server state, never edited code.
- **Provider-neutral sessions (owner, 2026-10-25, R140).** Claude Code, Codex and optional OMP GLM sessions
  follow the same loop. Solo is the default; the owner may start a few concurrent sessions when useful.
  No permanent coordinator, verifier or deploy session is required. A dedicated deploy session is optional.
  Start with `python3 scripts/agents/start.py claude`, `… codex`, or `… omp`; add
  `--mode worker` before the provider when joining other sessions. Models can be passed after `--`.
  The launcher registers a fresh Agent Mail identity, exports `AGENT_NAME`/`JJ_ROLE`, pins Node and
  sends the same startup instructions. Never reuse another live session's identity.
- **Agent Mail:** project key `/Users/cdilga/Documents/dev/multiplayer-racer`. Native MCP tools or
  `python3 scripts/agents/mail.py TOOL 'JSON'` reach the running server. The standalone `am` database
  CLI conflicts with the server's activity lock; it is not a fallback. Never print local MCP credentials.
  Existing sessions register once and prefix commits/pushes with their assigned `AGENT_NAME`.
- **With other sessions active:** check inbox before claiming; reserve specific paths before editing;
  announce claims/blockers/completion in a bead-ID thread. Solo skips reservations and announcements.
  A model's native messages only reach its own helpers; use Agent Mail between independent sessions.
- **Before every new bead:** reread this file, check inbox, then run
  `AGENT_NAME=<name> python3 scripts/ci/pickup.py --claim`. A failed batch has one repair bead.
  The first available agent claims it and fixes CI before taking fresh feature work. If another agent
  owns the repair, continue disjoint game work. Never steal an active claim or abandon the current bead
  merely because CI turned red. If the check fails, report it; do not assume CI is green.
- **NTM is optional.** Use `--no-recovery --no-cass-context`, never `--worktrees`. All panes must use
  the same bootstrap/identity/mail rules; see `docs/process/bead-workflow.md` for mixed-provider commands.
- **Helpers:** permitted inside a claimed bead when faster, with disjoint files and parent reservations.
  Helpers do not claim beads, mutate the tracker, commit or push. The parent verifies their work.
  Claude Remote Control is optional visibility, never a requirement for Codex/OMP verification.
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
  - **Memory:** shared durable facts go in `docs/learnings/<area>.md`; provider-local memory is optional.
    Never rely on another provider reading private session memory. `cm` isn't used in this project.
- Don't sit idle waiting for consensus. If a ready bead is unclaimed and you can make progress, claim
  it, reserve files, announce, and start.

## CI: next available agent owns the repair (owner, 2026-10-25, R140)

This supersedes the permanent Haiku deploy worker, provider/model restrictions and two-session rule
from 2026-10-17. Keep the lessons from the earlier CI churn: no diagnostic pushes, one repair owner,
previews independent of green, focused reproduction, and bounded red time.

1. **Check at bead boundaries.** `python3 scripts/ci/pickup.py --claim` checks Gitea once and
   deduplicates/atomically claims a P0 `ci:repair` bead for the latest failed branch batch.
   Any provider can own it. Other agents continue their own game work.
2. **Fix forward.** Read the failed jobs and assertions, reproduce locally or on eris, then push the
   actual fix. Do not bounce every red lane to authors or let several agents debug the same batch.
   Ask the author for context when useful; repair ownership stays explicit in Beads.
3. **Batches.** A push starts CI. A running batch finishes; intervening pushes fold into the next.
   Do not dispatch repeatedly for an unchanged commit. An infrastructure-killed job can be rerun once
   after its cause is understood. No diagnostic pushes or polling loops.
4. **Previews.** Publish every built image, red or green; record its smoke result. A day without a
   playable preview is P0. The repair owner handles this during the repair; solo handles it itself.
5. **Red budget.** After 2 hours or 2 consecutive red batches, stop speculative patching and triage.
   A quarantined test needs a P0 bead with the test, cause, owner and restoration condition; a timing
   change needs measured evidence. Never weaken gameplay requirements or claim an unmet acceptance.
6. **Finish locally, keep moving.** `scripts/beads/close.sh <id> --tests "AC1: …"` pushes and defaults
   to `batch_pending`. It never waits. At the next boundary inspect pending handoffs; close green ones
   with `--finalize --commit <handoff-sha>` and their recorded tests. This checks CI once, without
   dispatching or waiting. A red repair handoff is resumed by the next available agent.
7. **Small by default.** Usually one session does everything. Add sessions only when the owner wants
   them, with narrow reservations and an explicit repair claim. No permanent model-specific roles.

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
- Commit with the P1 ID and bead ID, then hand off:
  `scripts/beads/close.sh <id> --tests "AC1: <test> AC2: <test> …"` (defaults to `batch_pending`;
  `--pending` remains accepted). No session waits on CI.
  `--finalize --commit <handoff-sha>` closes only when a containing CI run is green, checking once.
  `--receipt docs/evidence/<P1-ID>/<file>` covers committed owner/deploy/hardware evidence.
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
- **Visual self-review** (owner, 2026-10-04): any bead whose outcome you can see (label `visual`) runs the loop in
  `docs/process/visual-self-review.md` before it goes to review or closes: capture phones/TV/full-screen/states with
  `node art/ui/lib/live-check.mjs`, **look at every screenshot**, fix, repeat, and commit
  `docs/evidence/<P1-ID>/self-review.md`. Blank panels, overlaps and broken images reaching the owner are your bug.
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
  - Commit your reviewed paths. Another session's files require an explicit handoff before you commit
    them; never infer readiness from a dirty tree. Tracker exports can be committed with your next change.
  - Mechanics: stage specific paths, and commit with `git commit -- <paths>` so half-staged work elsewhere
    stays out. `AGENT_NAME` is set by the start commands; it's needed for the commit guard and the
    pre-push hook.
  - Use `scripts/push.sh`: it serializes publication, pins one SHA for both remotes, and uploads LFS
    first. The pre-push guard checks each commit's Agent trailer against reservations, not its pusher.
  - Only force-pushing or rewriting pushed history needs the owner.
  - Never `git add -A`: local MCP configs hold an Agent Mail token, and personal files
    (`.claude/skills/idea-engine/`, `.claude/workflows/idea-engine.mjs`) must stay out of this public repo.
