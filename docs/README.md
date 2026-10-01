# Docs index

Joystick Jammers is being rebuilt as **0.2**. Start here:

| Doc | What it is |
|---|---|
| [`policies/owner-direction-2026-09-29.md`](policies/owner-direction-2026-09-29.md) | **Normative rules.** Overrides everything else, including older docs and beads. |
| [`plans/v0.2-revamp-plan-2026-09-28.md`](plans/v0.2-revamp-plan-2026-09-28.md) | The 0.2 plan: rulings R1–R76, architecture, systems, milestones and bead-ready cuts. |
| [`plans/v0.2-experience-direction.md`](plans/v0.2-experience-direction.md) | Website/host/controller/game design brief ("Outback comic motorsport festival"). |
| [`plans/BEAD-DEFINITION-OF-DONE.md`](plans/BEAD-DEFINITION-OF-DONE.md) | How a bead is specified and closed. |
| [`plans/ntm-bead-swarm-operations-2026-06-29.md`](plans/ntm-bead-swarm-operations-2026-06-29.md) | Swarm operations (process). |

## Docs that describe the current 0.1 code

These stay because the 0.1 code they describe still exists and runs in production. They are **not**
0.2 direction; each carries a banner. They'll be rewritten or removed as 0.2 replaces the code.

- `contracts/` — debug lab, geometry kernel, join-route matrix, socket protocol manifest, telemetry.
- `deployment/` — cache invalidation and source maps for the current ppaas/Flask deployment.

## Removed on 2026-09-29 (superseded by 0.2)

Removed so agents don't follow outdated direction. They're in git history at commit **`bbadc3e`**:

```bash
git show bbadc3e:docs/design/02-design-language.md     # read one
git checkout bbadc3e -- docs/plans/gaps                # restore a folder locally
```

| Removed | Superseded by |
|---|---|
| `docs/design-brief.md`, `docs/design/*` (neon → lo-fi retro direction, research reports) | Comic/Mad Max direction: plan §12, `v0.2-experience-direction.md` |
| `docs/plans/feedback-design-pass.md`, `docs/plans/gaps/*` (incl. Voronoi/dynamic split, input expansion, derby reliability, remote screens, debris assets) | Plan §4–§8, §6 cameras |
| `docs/plans/game-modes-and-flows.md`, `user-flows/*`, `captains-calls-*`, `architecture-findings-*`, `around-couch-*` | Plan §3, §10, §13 |
| `docs/plans/asset-*`, `per-model-game-readiness-*`, `map-authoring-and-procedural-generation-*`, `controller-input-research-*`, `sound-design-pipeline-research-*`, `research-brief-*`, `responsive-sizing-*`, `steering-authority-196.6.md`, `feedback-captured-*` | Plan §4, §7, §11, §12, §14 |
| `docs/WHEELIE_DESIGN_INTENT.md` | R60 two-stick wheelie (plan §4.2) |
| `specs/*` (derby, colour scheme, visual effects, project direction, testing) | Plan §8–§10, §12, §17 |
| `docs/contracts/camera-cluster-kernel.md` | Voronoi cameras retired (plan §6) |
| `GAME_IMPROVEMENT_IDEAS.md`, `IDEAS_NEEDING_REFINEMENT.md` | Plan §8.5, §9.5, §10.5 roadmap lists |

Useful research in the removed docs (sound pipeline, controller input research, per-model balance,
map authoring) is still worth reading from history when working on the matching 0.2 cut; treat it as
background, never as instructions.
