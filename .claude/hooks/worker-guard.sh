#!/usr/bin/env bash
# PreToolUse(Bash) guard for code-first / batch-verify workers.
# Active only when the agent runs with JJ_ROLE=worker; humans and the batch verifier
# (JJ_ROLE unset or =verifier) are unaffected.
#
# Workers get the full development loop (owner ruling 2026-10-02): servers, builds, focused tests,
# e2e journeys, scenario runs, emulators, probes and visual iteration for their own area. What they
# don't run is the batched verification (workspace-wide test runs, whole Playwright suites,
# batch-verify.sh), and they never close, delete, reopen or gate beads.
# See docs/process/code-first-batch-verify.md.
[[ ${JJ_ROLE:-} == worker ]] || exit 0

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -n $cmd ]] || exit 0

# Match at a command boundary: start of string or after ; & | ( or a newline.
b='(^|[;&|(]|\n)[[:space:]]*'
deny() {
    echo "worker-guard: blocked for JJ_ROLE=worker: $1" >&2
    echo "Workers run focused checks for their own area (one crate with -p, one spec file or --grep," >&2
    echo "one scenario, jj probes, servers, emulators). The batch verifier runs the full suites once per" >&2
    echo "wave. Commit with the bead ID, then move the bead to batch_pending with a hand-off comment." >&2
    exit 2
}

# Batched verification: whole-workspace test runs (local, RCH or eris) and whole suites.
grep -Eq "(cargo[[:space:]]+(\+[^[:space:]]+[[:space:]]+)?(test|nextest)([[:space:]][^;&|]*)?[[:space:]]--(workspace|all)([[:space:]=]|$))" <<<"$cmd" \
    && deny "workspace-wide cargo test (the batch verifier runs it)"
grep -Eq "${b}(npx[[:space:]]+)?playwright[[:space:]]+test([[:space:]]+-[^[:space:]]*)*[[:space:]]*($|[;&|)])" <<<"$cmd" \
    && deny "the whole Playwright suite (pass a spec file or --grep)"
grep -Eq "${b}(npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?test(:[a-z0-9-]+)?[[:space:]]*($|[;&|)])" <<<"$cmd" \
    && deny "a whole test suite via the package manager (pass a file or filter after --)"
# Workspace-wide cargo on the Mac itself fills its disk; per-crate local work is fine.
grep -Eq "${b}cargo[[:space:]]+(\+[^[:space:]]+[[:space:]]+)?(check|build|clippy)([[:space:]][^;&|]*)?[[:space:]]--(workspace|all)([[:space:]=]|$)" <<<"$cmd" \
    && deny "workspace-wide local cargo on the Mac (use rch exec -- cargo … or scripts/remote/eris.sh)"
# Tracker transitions that belong to the verifier.
grep -Eq "${b}br[[:space:]]+([^;&|]*[[:space:]])?(close|delete|reopen|gate)([[:space:]]|$)" <<<"$cmd" && deny "br close/delete/reopen/gate (verifier only)"
grep -Eq "${b}br[[:space:]]+epic[[:space:]]+close-eligible"                          <<<"$cmd" && deny "br epic close-eligible (verifier only)"
grep -Eq "${b}br[[:space:]][^;&|]*--status[=[:space:]]+(closed|tombstone)"           <<<"$cmd" && deny "closing via br update (verifier only)"
grep -Eq "batch-verify\.sh"                                                          <<<"$cmd" && deny "scripts/beads/batch-verify.sh (verifier only)"
exit 0
