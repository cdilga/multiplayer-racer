#!/usr/bin/env bash
# PreToolUse(Bash) guard for agent sessions (JJ_ROLE=worker or JJ_ROLE=solo); humans and the verifier
# (JJ_ROLE unset or =verifier) are unaffected.
#
# Physical Soccer's model (owner, 2026-10-03): sessions build, test their own area, push, and close
# their own beads once CI is green; .beads/policy.yaml enforces the close rules (gate pass, receipt,
# every acceptance item ticked). This hook keeps only two things the policy can't:
#   - workspace-wide local cargo on the Mac (it filled a Mac's disk; RCH and per-crate work are fine)
#   - br delete (a tombstone skips every close rule)
# See docs/process/bead-workflow.md.
role=${JJ_ROLE:-}
[[ $role == worker || $role == solo ]] || exit 0

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -n $cmd ]] || exit 0

# Match at a command boundary: start of string or after ; & | ( or a newline.
b='(^|[;&|(]|\n)[[:space:]]*'
deny() {
    echo "worker-guard: blocked for JJ_ROLE=$role: $1" >&2
    echo "See docs/process/bead-workflow.md." >&2
    exit 2
}

if [[ $(uname -s) == Darwin ]]; then
    grep -Eq "${b}cargo[[:space:]]+(\+[^[:space:]]+[[:space:]]+)?(check|build|clippy|test|nextest)([[:space:]][^;&|]*)?[[:space:]]--(workspace|all)([[:space:]=]|$)" <<<"$cmd" \
        && deny "workspace-wide local cargo on the Mac (use rch exec -- cargo … for the workspace, or -p <crate> locally)"
fi
grep -Eq "${b}br[[:space:]]+([^;&|]*[[:space:]])?delete([[:space:]]|$)" <<<"$cmd" && deny "br delete (ask the owner)"
exit 0
