Reread `AGENTS.md` and the relevant parts of `README.md` now. Then recover your exact working
state before touching files.

Recovery steps:

1. Register/check in with Agent Mail for this project and read recent messages in your current bead
   thread. Prefer MCP tools; use the `am` CLI if MCP tools are not exposed. If both are unavailable,
   say so in NTM output and stop before edits until the coordinator repairs the lane or gives an
   explicit fallback.
2. Run `git status --short` and identify which changes are yours versus pre-existing or other-agent
   changes.
3. If you were working a bead, run `br show <bead-id>` and restate its acceptance criteria.
4. Check your file reservations. Renew them if you are still actively editing; release them if not.
5. Re-run or inspect the latest evidence before claiming anything is ready.
6. If you are unsure whether your state is complete, ask for a fresh validator or coordinator
   dispatch rather than closing the bead.

Reminder: implementation complete is not bead done. A bead closes only after convincing evidence and
a separate fresh validator PASS.

Current invariants after recovery: late joins are allowed in every mode/phase but cannot create
unfair wins or mutate locked results; race needs a finish-grace/DNF timer; derby needs an
anti-stalemate/tiebreak rule; known and random maps share recorded seed/recipe validation.
