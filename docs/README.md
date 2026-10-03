# Docs index

Joystick Jammers is being rebuilt as **0.2**. Start here:

| Doc | What it is |
|---|---|
| [`policies/owner-direction-2026-09-29.md`](policies/owner-direction-2026-09-29.md) | **Normative rules** (R1–R94 plus the dated 2026-10 rulings, short form). Overrides everything else, including older docs and beads. |
| [`plans/v0.2-playtest-1-plan.md`](plans/v0.2-playtest-1-plan.md) | **What we're building now, and the bead source:** Playtest 1 (the Minimum build), then the derby, items and extras drops, the full test and the 0.2 release: scope, architecture, protocols, task graph. |
| [`plans/v0.2-playtest-1-bead-map.md`](plans/v0.2-playtest-1-bead-map.md) | Every plan task and requirement mapped to its bead ID, so omissions show. |
| [`plans/v0.2-revamp-plan-2026-09-28.md`](plans/v0.2-revamp-plan-2026-09-28.md) | Master plan: rulings, design and Full-tier cuts. Design reference. |
| [`plans/v0.2-experience-direction.md`](plans/v0.2-experience-direction.md) | Website/host/controller/game design brief ("Outback comic motorsport festival"). |
| [`plans/ux-study-2026-09-29/`](plans/ux-study-2026-09-29/README.md) | UX concept study and flow contracts behind master plan §10.6a. |
| [`plans/BEAD-DEFINITION-OF-DONE.md`](plans/BEAD-DEFINITION-OF-DONE.md) | How a bead is specified and closed. |
| [`process/bead-workflow.md`](process/bead-workflow.md) | How a session takes a bead to closed (Physical Soccer's model: close on green CI, verifier on call), the solo → 2 → 4 worker modes and the hand-crank commands. |
| [`playtests/owner-checklists.md`](playtests/owner-checklists.md) | The owner's to-do list for each gate and preview. |

Plan review history (GPT Pro rounds) lives in `.apr/`.

## The 0.1 game

0.1 still runs in production from `main`. Its code and docs were removed from this branch on
2026-10-02 (R87). Read any of it with the tag:

```bash
git show v0.1-final:static/js/resources/SpawnAllocator.js
git ls-tree -r --name-only v0.1-final -- tests/
```

The Playtest-1 plan §14 lists the 0.1 test cases worth re-expressing as 0.2 scenarios. Nothing is
ported as code.

## Removed docs

| Removed | When | Recover from | Superseded by |
|---|---|---|---|
| 0.1 contracts (`docs/contracts/*`: debug lab, geometry kernel, join routes, socket protocol, telemetry) and deployment notes (`docs/deployment/*`) | 2026-10-02 | `v0.1-final` | Playtest-1 plan §5, §12; master §13, §16, §17.3 |
| 0.1 reports (`docs/reports/*`), `docs/images/gameplay-jammers.gif` | 2026-10-02 | `v0.2-pre-cleanup` (reports), `v0.1-final` (gif) | — |
| `docs/JOYSTICK_JAMMERS_ART_PIPELINE.md` (Blender-centred pipeline) | 2026-10-02 | `v0.2-pre-cleanup` | R81 code-built method; master §12; `lowpoly-model-from-refs` skill |
| `docs/plans/ntm-bead-swarm-operations-2026-06-29.md`, `.ntm/prompts/*` (fresh-validator swarm) | 2026-10-02 | `v0.2-pre-cleanup` | `process/bead-workflow.md` |
| `docs/process/code-first-batch-verify.md` (code-first/batch-verify waves) | 2026-10-03 | this branch's history | `process/bead-workflow.md` |
| `docs/design-brief.md`, `docs/design/*` (neon → lo-fi retro direction) | 2026-09-29 | `bbadc3e` | Master §12, `v0.2-experience-direction.md` |
| `docs/plans/feedback-design-pass.md`, `docs/plans/gaps/*` | 2026-09-29 | `bbadc3e` | Master §4–§8 |
| `docs/plans/game-modes-and-flows.md`, `user-flows/*`, `captains-calls-*`, `architecture-findings-*`, `around-couch-*` | 2026-09-29 | `bbadc3e` | Master §3, §10, §13 |
| `docs/plans/asset-*`, `per-model-game-readiness-*`, `map-authoring-and-procedural-generation-*`, `controller-input-research-*`, `sound-design-pipeline-research-*`, `research-brief-*`, `responsive-sizing-*`, `steering-authority-196.6.md`, `feedback-captured-*` | 2026-09-29 | `bbadc3e` | Master §4, §7, §11, §12, §14 |
| `docs/WHEELIE_DESIGN_INTENT.md`, `specs/*`, `docs/contracts/camera-cluster-kernel.md`, `GAME_IMPROVEMENT_IDEAS.md`, `IDEAS_NEEDING_REFINEMENT.md` | 2026-09-29 | `bbadc3e` | Master §4.2, §6, §8–§10, §12, §17 |

Useful research in removed docs (sound pipeline, controller input research, per-model balance, map
authoring) is background worth reading when working on the matching 0.2 task; never treat it as
instructions.
