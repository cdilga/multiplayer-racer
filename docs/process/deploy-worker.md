# The deploy worker (owner, 2026-10-17)

One light session (Haiku 5.5) owns CI, previews and `batch_pending` closes, so the bead churner never waits on CI
(AGENTS.md, CI rules 1-9). It does no game work. Start:

```
tmux new-session -d -s multiplayer-racer--deploy -c ~/Documents/dev/multiplayer-racer \
  'JJ_ROLE=worker AGENT_NAME=PurplePrairie claude --dangerously-skip-permissions --model claude-haiku-5-5 --effort medium'
```

then give it `/loop` with: "Reread AGENTS.md and docs/process/deploy-worker.md, then do one deploy round."

## One deploy round (cheap; keep output small, long logs to files)

1. **CI state.** `scripts/ci-status.sh` for `gitea/v0.2-revamp`. Nothing new pushed since the last run and nothing
   running: dispatch one batch with `scripts/ci/run.sh` (one at a time; it folds). A job killed by the runner (OOM,
   SIGKILL, lost runner) gets a rerun of just that job (`tea api` POST `…/actions/jobs/<id>/rerun`), not a new push.
2. **Previews.** Every run whose image built gets a preview, red or green: dispatch the `deploy-previews.yml` workflow
   with mode `--from-run <run>` if the newest built run has no preview yet. Don't message the owner about previews.
3. **Close green hand-offs.** For each bead in `br list --status batch_pending`: `scripts/ci/green-for.py <commit>`
   (the commit and tests are in its hand-off comment). Green: `scripts/beads/close.sh <id> --tests "<its tests>"`.
   Pending: leave it. Red: find the failing assertion and file:line in the run log, put it on the bead as a comment,
   set it to `rework` for its author, and tell the churner in its tmux pane (`multiplayer-racer--maps` today, BrownHill).
4. **Red budget (CI rule 4).** Red for 2 hours or 2 batches: quarantine the blocking test (skip it with a P0 bead naming
   the test, cause and owner) or relax a timing assertion with a stated reason. Escalate anything else to the
   coordinator (AmberSpring) rather than debugging deep yourself; no diagnostic pushes.
5. Report in two or three lines and go idle until the next tick.
