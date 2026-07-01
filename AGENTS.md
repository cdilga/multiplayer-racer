# Agent Instructions

This repository uses `br` (Beads Rust) for task tracking and `bv` for graph-aware triage.

## Architecture (roles) — read before reasoning about rendering/perf

- **The host renders the full 3D world** on the big screen (a laptop/desktop driving a TV).
  Performance budgets for rendering N cars (instancing, LOD, splitscreen, bloom) are a **host**
  concern.
- **Phones and keyboards are *controllers*, not renderers** — they send input and show a light HUD
  only. A phone does **not** run the world visualisation in Local mode; "whatever the controller
  device can do is fine."
- **Remote mode** is the exception: each participant renders their *own* viewer on their *own*
  device (which may be weak) — degrade gracefully there, never gate on it. See
  `docs/plans/game-modes-and-flows.md` §3 (roles) and `docs/plans/feedback-design-pass.md`.

## Project-Scoped Skills

- Use `.claude/skills/vehicle-model-validation/SKILL.md` before calling any vehicle model import,
  replacement, normalization, catalog/manifest entry, vehicle selection asset, or car-model visual
  polish done. This skill requires deriving the active requirements first, then providing visual
  evidence, screenshots, and relevant test/check output separate from gameplay tuning.

## Coordination

- Register with MCP Agent Mail at the start of every session using this project key:
  `/Users/cdilga/Documents/dev/multiplayer-racer`
- Use the exact Agent Mail name assigned in your prompt. If no name was assigned, register with an auto-generated name and announce it.
- Check Agent Mail before claiming work and after each meaningful edit/test cycle.
- Reserve files with Agent Mail before editing. Use specific paths or globs, not the whole repo.
- Announce bead claims, file reservations, blockers, and completion in a thread named after the bead ID.
- Keep NTM swarms small: target at most five panes total, including the user pane. Reuse or replace
  idle panes for worker, validator, and release-manager roles instead of adding more agents.
- Do not sit idle waiting for consensus. If a ready bead is unclaimed and you can make progress, claim it, reserve files, announce, and start.

## Beads

- Use `br`, not `bd`.
- Find ready work with `br ready --json` and graph priorities with `bv --robot-triage` or `bv --robot-next`.
- Never run bare `bv`; it launches an interactive TUI. Always use robot flags.
- Claim work with `br update <id> --status in_progress --assignee <AgentName>`.
- Close work only when the implementation is done, tests/builds relevant to the change pass, and you have posted a completion note.
- For the current polishing swarm, prefer beads under the `beads-polishing` label.

## Current High-Level Goal

Polish Joystick Jammers around:

- player identity/readability
- phone controller speed and reconnect confidence
- map and arena reliability
- first-run tutorial/onboarding
- steering, wheelies, boost, and stunt payoff
- host/client performance under multiplayer input load

The main epic is `br-beads-polishing-wheelie-handling-vxv`.

## Development Commands

- Install dependencies: `npm install` and `pip install -r requirements.txt`
- Build frontend: `npm run build`
- Unit/integration tests: `npm test`
- E2E core flow: `npm run test:e2e`
- Python syntax check: `python -m py_compile server/app.py`
- Run server: `python server/app.py`

The Flask server serves from `dist/` when it exists. If you change JavaScript or CSS that is browser-tested, run `npm run build` before browser/E2E verification.

## Code Rules

- Preserve user and other-agent changes. Do not revert unfamiliar edits.
- Keep file reservations narrow and release them when done.
- Avoid per-frame/per-tick logging. Use overlays, tests, screenshots, or targeted one-time logs.
- Use npm-bundled dependencies; do not add CDN imports.
- Do not commit or push unless the human coordinator explicitly asks for commits.

## Skills

- **`game-model-prep`** (`.claude/skills/game-model-prep/`) — engine-generic pipeline for making a
  vehicle model good to play and balanced (normalize → rig → collider/CoM → balance → destruct →
  color → visual QA). Use for any add/replace/re-rig/re-tune/balance of a car/kart model, debris
  setup, "wheels orbit / car flips / looks wrong" debugging, or automated model QA. Symlinked into
  `~/.codex/skills/` and `~/.copilot/skills/` (run `.claude/skills/game-model-prep/install.sh`).
- **`vehicle-model-validation`** (`.claude/skills/vehicle-model-validation/`) — the JJ acceptance
  gate (Stage H) + project adapter for the above. Run it before closing any per-model bead.
- Per-model plan: `docs/plans/per-model-game-readiness-and-balance-2026-06-28.md`.

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
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export DB to JSONL
```

### Workflow Pattern

1. **Triage**: Run `bv --robot-triage` to find the highest-impact actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

<!-- end-bv-agent-instructions -->
