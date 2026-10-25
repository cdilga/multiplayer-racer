# P1-OPS workflow repair (br-i674)

2026-10-25, owner's Mac, shared main tree; Codex session CalmLynx.

- AC1: start.py builds Claude/Codex/OMP commands with pre-registered identity, shared prompt, JJ_ROLE and pinned Node. Dry-command previews verified without starting provider sessions. mail.py health_check and fetch_inbox reached the running HTTP MCP server. No standalone mail database runtime is opened. Live model sessions were not launched for this check.
- AC2: python3 scripts/agents/test_workflow.py -q: 7 tests pass. Two concurrent callers against a real throwaway Beads tracker produce one repair bead and one owner. An active claim is preserved; a red repair handoff can be resumed by the next agent. Newer running batches supersede old failures. Live read-only pickup identifies run 8912 and its seven failed jobs.
- AC3: the same suite invokes close.sh against isolated real Git repositories. Default handoff never queries CI or ticks acceptance; pending finalization returns immediately; green finalization records gate and receipt. No waits or duplicate dispatches.
- AC4: python3 scripts/hooks/test_publication.py -q: 1 test passes using real commits and the installed Agent Mail matcher. Another author's valid committed reservation can be pushed; a commit conflicting with another holder is refused. scripts/hooks/install.sh installs the adapter. scripts/push.sh pins one SHA under a publication lock and uploads LFS before each Git ref update. R140 and the runbooks describe solo-first, provider-neutral operation.
- AC5: bash -n, Python compilation, git diff --check and scripts/beads/canary.sh pass (37 policy checks). CI runs the portable workflow regressions; the real-Beads race runs where br is installed and skips explicitly in images without it. Publication regression uses the Mac's installed guard and runs locally.

Limits: Claude-only PreToolUse hooks do not become Codex/OMP hooks; shared cargo/delete rules still apply. Existing desktop sessions register once and follow the same pickup/reservation loop. This proves coordination mechanisms; the previously red game CI is the owner's next separately tracked task.
