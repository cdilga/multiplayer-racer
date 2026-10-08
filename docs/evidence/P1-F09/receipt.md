<!-- evidence
bead: br-p1-f09-8p1
id: P1-F09
covers: AC1 AC2 AC3
observer: BrownCreek
date: 2026-10-08
build: game 5dad71c (skills in faee6fa and the follow-up commit)
-->
# P1-F09 receipt

## AC1: each of the four skills names its two closed beads, calls jj or the harness, links its learnings

| Skill | Distilled from (closed) | Calls | Learnings |
|---|---|---|---|
| `.claude/skills/jammers-game-probe/` | P1-S03 (feel bank), P1-S09 (skill-payoff duels) | `jj --help`, `jj sim --help`, `jj sim` modes; `window.__jjTest` via `web/tests/smoke/smoke-flow.mjs` | `docs/learnings/sim.md`, `procgen.md` |
| `.claude/skills/jammers-visual-review/` | P1-U03 (phone mocks), P1-R07 (host HUD, lobby, results) | `art/ui/lib/live-check.mjs --help`; `docs/process/visual-self-review.md` | `docs/learnings/ui.md`, `render.md` |
| `.claude/skills/jammers-ui/` | P1-C01 (landing, Host, Join pages), P1-R07 | its `ui-tour.mjs` over the pages' surfaces (`__jjNet`, `__jjRoom`, `__jjController`); the journeys and smoke flow as callers | `docs/learnings/ui.md` |
| `.claude/skills/jammers-emulators/` | P1-F08 (emulator lane), P1-C03 (join/claim/resume driven on the Android emulator) | `lanes.mjs`, `matrix.mjs`, `scripts/emulators/lane.mjs` / `drive.mjs` | `docs/learnings/emulators.md` |

## AC2: each worked example runs as written on the current build (one fresh-agent transcript per skill)

`fresh-agent-runs.md`: four fresh agents, game 5dad71c on eris, each matched its skill's stated result; their notes
for newcomers were folded back into the skills.

## AC3: `.agents/skills` links to the same files

`.agents/skills -> ../.claude/skills` (a symlink committed in faee6fa): `ls .agents/skills/` lists the same skill
directories as `.claude/skills/`.
