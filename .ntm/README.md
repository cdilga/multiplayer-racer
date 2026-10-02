# NTM swarm

The 0.1-era swarm prompts (fresh-validator workflow) were removed on 2026-10-02 (recover from
`v0.2-pre-cleanup:.ntm/prompts/` if you need the wording). The 0.2 workflow is **code-first / batch-verify**:
`docs/process/code-first-batch-verify.md` describes the worker and verifier loops, roles and
enforcement. Write new bootstrap/worker/verifier prompts here when the 0.2 swarm starts, and keep the
swarm at five panes or fewer (AGENTS.md).

Runtime/session artefacts in this directory are gitignored (`.ntm/.gitignore`).
