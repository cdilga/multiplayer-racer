First read `AGENTS.md` and `README.md` completely and carefully. Keep the project-specific rules in
front of you while working, especially:

- Register with MCP Agent Mail for project key `/Users/cdilga/Documents/dev/multiplayer-racer`.
- Use the exact agent name assigned to your pane; if none was assigned, register with an
  auto-generated name and announce it.
- Check Agent Mail before claiming work and after every meaningful edit/test cycle.
- Reserve files before editing, with narrow path patterns, and release reservations when finished.
- Use `br`, not `bd`; use `bv --robot-triage`, `bv --robot-next`, or `bv --robot-plan`, never bare
  `bv`.
- The Local-mode host renders the 3D world. Phones and keyboards are controllers with light HUDs.
  Remote mode is the exception where each participant may render their own viewer and must degrade
  gracefully.

Then orient yourself:

1. Run `git status --short` and note existing dirty files. Do not revert unfamiliar changes.
2. Run `br ready --json` and `bv --robot-plan` or `bv --robot-next`.
3. Read the bead you plan to work on with `br show <id>`.
4. Check related docs/plans/tests before editing.
5. If the bead touches vehicle models, model imports, vehicle selection assets, car-model visual
   polish, or balance/model QA, read and follow the required project skills in `.claude/skills/`.

Completion policy:

- A worker may only mark a bead "ready for validation" after implementation, self-review, and
  evidence collection.
- A bead may only be closed after a fresh validator independently checks the diff, the test
  evidence, and the relevant edge cases, then posts a PASS decision in the bead or Agent Mail
  thread.
- If evidence is weak, missing, hand-wavy, or impossible to reproduce, do not close the bead.

Work philosophy:

Fit each bead elegantly into the broader whole. Update adjacent tests, docs, debug tools, fixtures,
or follow-up beads when needed. Do not stop at the bead title if that leaves a brittle or incoherent
system, but also do not make unrelated rewrites.
