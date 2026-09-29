#!/usr/bin/env bash
# PreToolUse(Bash) guard for code-first / batch-verify workers.
# Active only when the agent runs with JJ_ROLE=worker (set per NTM worker pane);
# humans and the batch verifier (JJ_ROLE unset or =verifier) are unaffected.
#
# Workers write code + tests and commit; they don't run test suites or full
# builds, and they never close, delete or gate beads. That is Phase 2's job
# (scripts/beads/batch-verify.sh). See docs/process/code-first-batch-verify.md.
[[ ${JJ_ROLE:-} == worker ]] || exit 0

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -n $cmd ]] || exit 0

# Match at a command boundary: start of string or after ; & | ( or a newline.
b='(^|[;&|(]|\n)[[:space:]]*'
deny() {
    echo "worker-guard: blocked for JJ_ROLE=worker: $1" >&2
    echo "Code-first rule: the syntax gate is your maximum (cargo check -p <crate>, npm run build," >&2
    echo "tsc --noEmit). Commit with the bead ID, then move the bead to batch_pending with a" >&2
    echo "hand-off comment. The batch verifier runs tests once for the whole wave." >&2
    exit 2
}

grep -Eq "${b}(npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?test"                <<<"$cmd" && deny "test suites (npm test*)"
grep -Eq "${b}(npx[[:space:]]+)?(playwright|vitest|jest)([[:space:]]|$)"              <<<"$cmd" && deny "test runners (playwright/vitest/jest)"
grep -Eq "${b}(rch[[:space:]]+exec[[:space:]]+--[[:space:]]+)?cargo[[:space:]]+(\+[^[:space:]]+[[:space:]]+)?(test|nextest|bench|build)([[:space:]]|$)" <<<"$cmd" \
    && deny "cargo test/nextest/bench/build (use cargo check -p <crate>)"
grep -Eq "${b}(python3?[[:space:]]+-m[[:space:]]+)?pytest([[:space:]]|$)"              <<<"$cmd" && deny "pytest"
grep -Eq "${b}br[[:space:]]+([^;&|]*[[:space:]])?(close|delete|reopen|gate)([[:space:]]|$)" <<<"$cmd" && deny "br close/delete/reopen/gate (verifier only)"
grep -Eq "${b}br[[:space:]]+epic[[:space:]]+close-eligible"                          <<<"$cmd" && deny "br epic close-eligible (verifier only)"
grep -Eq "${b}br[[:space:]][^;&|]*--status[=[:space:]]+(closed|tombstone)"           <<<"$cmd" && deny "closing via br update (verifier only)"
grep -Eq "batch-verify\.sh"                                                          <<<"$cmd" && deny "scripts/beads/batch-verify.sh (verifier only)"
exit 0
