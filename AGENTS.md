# Agent Instructions

This repository uses `br` (Beads Rust) for task tracking and `bv` for graph-aware triage.

> `CLAUDE.md` is a symlink to this file — Claude Code and other agent tools read the same instructions.

## ⚠️ 0.2 owner direction — read first, overrides everything below

Joystick Jammers is being rebuilt as **0.2**. The plan is `docs/plans/v0.2-revamp-plan-2026-09-28.md`
and the normative rules are in **`docs/policies/owner-direction-2026-09-29.md`**. Precedence:
**owner ruling → v0.2 plan → reconciled beads → existing code/docs**. A bead, old test or older section
of this file cannot override a ruling; flag the conflict instead of changing the ruling.

Most important rules:

- **No arbitrary gameplay-count caps anywhere** (players, seats, controllers, tiles, cars, live debris).
  No temporary/MVP limits, queues or truncated arrays. Test cohort sizes are samples, not limits.
- Debris stays **dynamic** for the round: never static, merged, deleted or count-budgeted.
- **Rust** game server (day 0) and Rust/WASM simulation core; no Python game server, no Tokio.
- Completely **separate from Physical Soccer**: borrow ideas, never code or dependencies.
- Two-stick controls; no tap-to-fire or accelerometer boost; one player per phone touchscreen.
- No runtime CDNs; all runtime assets/libraries are self-hosted. Cloudflare STUN/TURN is the
  explicitly approved initial connectivity service (R79), with self-hosted TURN considered later.

Superseded plans/design docs were removed on 2026-09-29 (recoverable from git; see `docs/README.md`).
The **Development Guide** sections below describe the **0.1 codebase** and are labelled as such.
Where anything conflicts with the policy, the policy wins for 0.2 work.

## Architecture (roles) — read before reasoning about rendering/perf

- **The host renders the full 3D world** on its screen: usually a laptop driving a TV, but any GPU
  phone or laptop at any resolution/aspect. It owns the simulation (0.2: Rust/WASM `jj-sim` in a
  worker), room authority, scores and rendering. Rendering budgets for many cars/tiles are a **host**
  concern, and they never become player caps.
- **Phones, pads, keyboards and hubs are *controllers*, not renderers.** They send input and show a
  light HUD. Controller routes never download the world renderer or simulation.
- **The Rust server** serves bundles and establishes/authenticates rooms and WebRTC signalling;
  controllers exchange gameplay with the browser host over WebRTC, preferably directly on LAN,
  with Cloudflare STUN/TURN initially. No per-input Rust forwarding, media SFU, mandatory WSS
  gameplay fallback or coturn deployment prerequisite (R77/R79, §13.3).
- **Efficient controls from day one:** compact binary input, fair hub batching on one connection
  per browser endpoint, fresh queues and two semantic channels; measure actual bytes/packets and
  input age. No participant/source caps or custom FEC prerequisite (R80, §13.3a).
- **One screen first:** Minimum/Full prioritise one excellent shared display. Remote viewers and
  extra displays are a high-effort, low-near-term-reward project requiring **explicit owner approval
  at G-SCREENS before implementation or replication spikes**. Playtests, new arenas/modes/themes
  and release do not unlock it or depend on it. Offline/LAN play remains deferred (R78, §6.6).

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

## Beads (code-first / batch-verify)

`.beads/policy.yaml` enforces this workflow. Read `docs/process/code-first-batch-verify.md` before
your first claim.

- Use `br` 0.7.1 or newer, not `bd`.
- Find ready work with `br ready --json` (it includes `rework` beads returned to you) and graph
  priorities with `bv --robot-triage` or `bv --robot-next`. Never run bare `bv`: it launches an
  interactive TUI.
- Claim with `br update <id> --claim --actor <AgentMailName>`. You can hold one claimed bead at a time,
  and the bead must have acceptance criteria.
- **Workers never close, delete, reopen or gate beads, and never run test suites or full builds.**
  Write the code and its tests, run at most a syntax gate (`cargo check -p <crate>`, `npm run build`,
  `tsc --noEmit`), and commit with the bead ID. Then run
  `br update <id> --status batch_pending --transition-comment "commit:<sha> <test that covers each acceptance item>"`
  and take the next bead.
- The batch verifier runs the tests once per wave (`scripts/beads/batch-verify.sh`). It closes green
  beads with a `receipt:` reference, or returns failures to the same assignee as `rework` with the
  failing assertion.
- Pre-0.2 beads were closed on 2026-09-30 (label `superseded-v0_1`). Don't reopen them to implement
  0.1 scope.

## Current High-Level Goal

Build **Joystick Jammers 0.2** per `docs/plans/v0.2-revamp-plan-2026-09-28.md`, starting with the
**Minimum build** (plan §18.0): Rust server + Rust/WASM core, two-stick controls, identity and
drop-in, dynamic grid + Overview, one Blender-made car, Race on a procedural Red Centre track,
autopilot, end-of-round highlights and auto-next, and scripted isolated previews. The older
`beads-polishing` goals and epic are 0.1 work; don't pick them up unless a bead is reconciled to 0.2.

## Skills

- **`game-model-prep`** (`.claude/skills/game-model-prep/`) — engine-generic pipeline for making a
  vehicle model good to play and balanced (normalize → rig → collider/CoM → balance → destruct →
  color → visual QA). Use for any add/replace/re-rig/re-tune/balance of a car/kart model, debris
  setup, "wheels orbit / car flips / looks wrong" debugging, or automated model QA. Symlinked into
  `~/.codex/skills/` and `~/.copilot/skills/` (run `.claude/skills/game-model-prep/install.sh`).
- **`vehicle-model-validation`** (`.claude/skills/vehicle-model-validation/`) — the JJ acceptance
  gate (Stage H) + project adapter for the above. Run it before closing any per-model bead.
- These skills' project adapters still describe 0.1 JS/GLB conventions; for 0.2 the asset contract in
  plan §12.3–§12.4 wins where they differ.

## Code Rules

- Preserve user and other-agent changes. Do not revert unfamiliar edits.
- Keep file reservations narrow and release them when done.
- Avoid per-frame/per-tick logging. Use overlays, tests, screenshots, or targeted one-time logs.
- Use npm-bundled dependencies; do not add CDN imports.
- Do not commit or push unless the human coordinator explicitly asks for commits.

---

# Development Guide (0.1 codebase)

> Everything from here to the Beads section describes the **current 0.1 code** (Flask/Socket.IO,
> JS simulation, Vite `dist/`). It stays valid for maintaining 0.1 until 0.2 replaces it. For 0.2 work,
> follow the plan: Rust workspace, RCH for heavy builds, Rust/WASM core, self-hosted dependencies.

## Environment Setup
- **Versions are pinned in-repo:** Python via `.python-version` (holds the env name
  `multiplayer-racer`, so pyenv-virtualenv auto-activates on `cd`), Node via `.nvmrc`
  (`18.20.8`) + `engines` in `package.json`. `cd` into the repo and the version
  managers select the right Python + Node automatically.
- One-time bootstrap: `pyenv install 3.11.7 && pyenv virtualenv 3.11.7 multiplayer-racer`;
  `nvm install`. If auto-activate isn't set up, fall back to `pyenv activate multiplayer-racer`.
- Activating the venv must happen before running the server or any Python commands.
- An upgrade to the latest Python/Node/deps is tracked as `br-upgrade-toolchain-latest-wzw1`.

## Server & Dev Commands
- **Everyday dev (recommended):** `npm run dev:local` — Vite auto-rebuilds `dist/` on
  save AND Flask auto-restarts on `.py` changes (one command, both layers hot).
- **Live playtests with phones:** `npm run play:local` — same, but Flask reload is OFF
  (`FLASK_DEBUG=0`). Room state is in-memory, so an auto-restart mid-game wipes the room
  and drops every player; `play:local` keeps the server stable so backend restarts are
  deliberate (between rounds), not on every save.
- Run server only: `python server/app.py`
- Python syntax check: `python -m py_compile server/app.py`
- Run IP detection test: `python server/test_ip_detection.py`
- Install dependencies: `npm install` and `pip install -r requirements.txt`

## Build System - CRITICAL

This project uses **Vite** for bundling JavaScript. The Flask server serves from `dist/` if it exists (production mode).

### ALWAYS Rebuild After Code Changes
The easiest path is to run `npm run dev:local` (or `npm run play:local`), which keeps
`dist/` rebuilt on every save via `vite build --watch`. For a one-off:
```bash
npm run build   # Rebuild dist/ folder
```

**If you modify ANY JavaScript in `static/js/`**, `dist/` must be rebuilt before testing in the browser (the watch scripts do this automatically). The server serves from `dist/` which contains the built/bundled code.

### Detecting Stale dist/ Folder
If you see unexpected behavior:
1. Check if `dist/` exists and when it was last modified
2. Compare timestamps: `ls -la dist/js/ static/js/`
3. Delete and rebuild: `rm -rf dist && npm run build`

### Quick Validation
```bash
# Check if dist matches source
curl -s http://localhost:8000/static/js/GameHost.js | grep "your new function"
```

## Testing

### Running Tests
- Run all tests: `npm test`
- Run E2E tests: `npx playwright test tests/e2e`
- Run game mode tests: `npx playwright test tests/e2e/game-modes.spec.ts`
- Run tests with UI: `npm run test:ui`
- Run tests headed (visible browser): `npm run test:headed`

### Manual Testing URLs
- Open host interface: `http://localhost:8000/`
- Test car models: `http://localhost:8000/test/car`
- Manual testing via multiple browsers/devices

### E2E Test Files
- `full-game.spec.ts` - Core 4-player game flow (runs in CI)
- `game-modes.spec.ts` - Procedural race + derby modes, weapon pickups, visuals
- `game-flow.spec.ts` - Player join/leave, controls
- `car-movement.spec.ts` - Vehicle physics tests

## Development Workflow (TDD)

**Always follow this Test-Driven Development loop:**

```
1. Write Test (that fails)
   └─→ npm test -- --grep "your test name"

2. Verify Test Fails
   └─→ Confirm the test fails for the right reason

3. Implement Logic
   └─→ Write minimal code to make the test pass

4. Run Tests
   └─→ npm test

5. Check Visuals (if UI-related)
   └─→ npm run test:headed
   └─→ Manually verify in browser if needed

6. All Tests Pass in CI
   └─→ Push changes, verify GitHub Actions pass
```

### Example Workflow

```bash
# 1. Start the dev stack (auto-rebuild + auto-restart)
npm run dev:local

# 2. Write your test in tests/e2e/
# 3. Run specific test to see it fail
npx playwright test --grep "should reset car to spawn position"

# 4. Implement the feature in static/js/  (dev:local rebuilds dist/ automatically)
# 5. Run tests again
npx playwright test --grep "your test"

# 6. Visual verification
npm run test:headed

# 7. Push and verify CI
git push origin your-branch
```

### Key Principles
- **Red-Green-Refactor**: Write failing test → Make it pass → Clean up
- **Test first**: Don't write implementation code without a failing test
- **Small increments**: Each test should verify one specific behavior
- **CI is truth**: Local passing isn't enough - CI must pass

## Dependency Management - CRITICAL

**NEVER use CDN links for dependencies. ALL dependencies MUST be installed via NPM and bundled.**

### Why This Matters
- CDN imports break tests and make them slow/flaky
- CDN imports bypass our bundling tooling
- CDN imports create network dependencies during development
- CDN imports make offline development impossible

### The Rule
```
❌ WRONG - Never do this:
"three": "https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js"
"@dimforge/rapier3d-compat": "https://cdn.skypack.dev/@dimforge/rapier3d-compat"

✅ CORRECT - Always do this:
npm install three @dimforge/rapier3d-compat
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
```

### If You Need a New Dependency
1. `npm install <package-name>`
2. Import it normally in your JavaScript/TypeScript
3. Let the bundler handle it
4. **NEVER** add CDN URLs to import maps or script tags

### Existing CDN References
If you encounter existing CDN references in the codebase, **convert them to NPM packages** rather than perpetuating the pattern.

### DO NOT Use Test-Time CDN Interception
**NEVER** intercept CDN requests in tests as a workaround. Route interception is a broken band-aid that:
- Still makes network requests (slow)
- Can fail intermittently
- Doesn't fix the root cause

The ONLY acceptable fix is removing CDN dependencies and using NPM + bundling.

## Code Style Guidelines
- **Python**: Follow PEP 8 conventions
  - 4-space indentation
  - Use descriptive variable names
  - Add docstrings for functions and classes
  - Proper error handling with try/except

- **JavaScript**:
  - 4-space indentation
  - Use camelCase for variables and functions
  - Group related functions together
  - Use constants for configuration values
  - Comment complex logic and physics calculations

- **Error Handling**:
  - Log errors with appropriate levels
  - Provide user-friendly error messages
  - Fail gracefully with fallbacks when possible

- **Logging - CRITICAL**:
  - **Default to NO logging.** Only log when genuinely necessary.
  - **Per-tick logging is NEVER useful** - even for debugging. 60 logs/sec is unreadable and tanks performance. If you need per-frame data, use Playwright screenshots or the debug overlay UI.
  - CI will fail if log count matches tick count (see `console-errors.spec.ts`)
  - Acceptable: errors, one-time init messages, user-triggered events
  - Unacceptable: logging in update(), render(), step(), or any per-frame method
  - **For debugging: prefer Playwright** - use `npm run test:headed` with screenshots/recordings. Remove any debug logs before committing.

## Architecture (0.1)
- Server: Flask + Socket.IO (Python) — replaced by the Rust server in 0.2
- Frontend: Three.js for 3D rendering
  - Host will host a game on a big screen
  - Player gives a controller interface to mobile devices
- Communication: Real-time via WebSockets

## Physics Implementation (Rapier 3D)

> **0.2:** vehicle physics moves to Rust (`jj-sim`, native `rapier3d`, 120 Hz game time), starting
> with Rapier's raycast vehicle controller. The controller may be changed with evidence if it can't
> deliver a required affordance (plan §7.1). The principles below (use the proper API, never scale
> forces ×1000, find root causes) still apply; the JS code pattern is 0.1.

### IMPORTANT: Use Rapier's Built-in Vehicle Controller

Rapier has a dedicated `DynamicRayCastVehicleController` class for vehicle physics.
**DO NOT** manually apply suspension forces with `addForceAtPoint()` - this is error-prone and causes instability (cars flying upward).

### Correct Implementation Pattern

```javascript
// 1. Create vehicle controller (once, during setup)
const vehicleController = world.createVehicleController(chassisRigidBody);

// 2. Add wheels with proper configuration
vehicleController.addWheel(
    {x: -1, y: 0, z: 1.5},    // Position relative to chassis
    {x: 0, y: -1, z: 0},       // Suspension direction (DOWN)
    {x: -1, y: 0, z: 0},       // Axle axis
    0.8,                        // Suspension rest length
    0.3                         // Wheel radius
);

// 3. Configure suspension for each wheel
vehicleController.setWheelSuspensionStiffness(wheelIndex, 24.0);
vehicleController.setWheelFrictionSlip(wheelIndex, 1000.0);

// 4. In game loop - set controls then update
vehicleController.setWheelEngineForce(0, engineForce);
vehicleController.setWheelEngineForce(1, engineForce);
vehicleController.setWheelSteering(0, steeringAngle);
vehicleController.setWheelSteering(1, steeringAngle);
vehicleController.setWheelBrake(2, brakeForce);
vehicleController.setWheelBrake(3, brakeForce);

// 5. Update vehicle physics (BEFORE world.step())
vehicleController.updateVehicle(deltaTime);
world.step();
```

### Key References
- Official Rapier docs: https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html
- Three.js example: https://threejs.org/examples/physics_rapier_vehicle_controller.html

### Common Mistakes to Avoid
1. **Don't** manually calculate suspension forces - Rapier does this correctly
2. **Don't** use `addForceAtPoint()` for vehicle physics - causes instability
3. **Don't** call `world.step()` before `vehicleController.updateVehicle()`
4. **Do** use reasonable mass (10-50 units for arcade feel)
5. **Do** set friction slip high enough for grip (500-1000)

### Debugging Physics Issues - IMPORTANT
**NEVER multiply/divide values by 1000x to "make it work"**

If physics isn't working (car not moving, flying away, etc):
- Don't just multiply force values by large numbers - this masks the real problem
- Don't scale parameters randomly hoping something works
- **DO** investigate the root cause: wrong API usage, order of operations, missing setup
- **DO** check if you're using the correct Rapier API for the task
- **DO** look for fundamental architectural issues (dead code, conflicting systems)
- **DO** read official documentation and examples

Example: If car won't move with engineForce=100, changing to 100000 won't fix it if
the fundamental problem is that forces aren't being applied correctly or the vehicle
controller isn't being used at all.

## Architecture Vision

0.2 architecture is defined in `docs/plans/v0.2-revamp-plan-2026-09-28.md` §13: a Rust workspace
(`jj-types`, `jj-protocol`, `jj-input`, `jj-session`, `jj-sim`, `jj-procgen`, `jj-contracts`,
`jj-relay`/`jj-net`, `jj-server`, `jj-store`, `jj-tools`), with thin browser adapters for input,
transport, UI and Three.js rendering. Principles that carry over: data over code (versioned
profiles/cards/map documents), single responsibility, event-driven communication, and thin
orchestrators. The old `static/js/` target structure is 0.1.

## Claude Agents

Specialized agents are available in the `agents/` directory. Invoke them when facing domain-specific challenges.

### Architect Agent
**Location:** `agents/architect/AGENT.md`

Call upon the Architect when facing:
- Module organization questions ("Where should this code go?")
- Decomposition guidance ("This file is too big")
- Integration patterns ("How should these systems communicate?")
- Data vs code decisions ("Should this be configurable?")
- Refactoring guidance ("This feels hacky")

The Architect ensures artisan-quality abstractions that are elegant, maintainable, and a joy to work with.

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
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

<!-- end-bv-agent-instructions -->
