# Optional CI/deploy maintenance

Owner 2026-10-25 (R140): a permanent deploy worker is optional. Claude, Codex or OMP may do this;
solo handles it at task boundaries. No hardcoded agent names, model requirement, Remote Control gate
or timer. The next available agent claims failed CI through `python3 scripts/ci/pickup.py --claim`.

1. Check pickup once. If it assigns a repair, read its failed job links, reproduce, fix forward and
   publish the fix. If another session owns it, continue other work; don't debug the same batch.
2. A push already starts CI. Do not dispatch when nothing changed. Use scripts/ci/run.sh only for an
   explicit full check or a missing run after verifying that no queued/running run covers the push.
   Retry an infrastructure-killed job only after diagnosing the cause; no diagnostic pushes.
3. Every built image gets a preview, red or green. Dispatch deploy-previews.yml with `--from-run <run>`
   if that built run has no preview. Record the smoke outcome. See docs/process/preview-publishing.md.
4. For pending beads, read their handoff comments and use the exact commit/tests:
   `scripts/beads/close.sh <id> --tests "<tests>" --finalize --commit <sha>`.
   It checks green once; no waiting or dispatch. CI red on the batch becomes one claimable repair,
   not a blanket rework assignment for every bead in it.
5. After 2 hours/2 red batches, triage deliberately under AGENTS.md's red budget. Preserve gameplay
   requirements. A quarantine needs a P0 bead naming test, cause, owner and restoration condition.
6. Report briefly and return to useful work or end the requested task. No perpetual deploy loop is required.
