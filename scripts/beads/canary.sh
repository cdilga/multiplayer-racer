#!/usr/bin/env bash
# Enforcement canary for the code-first / batch-verify policy (.beads/policy.yaml).
#
# Policy files are claims until canaried. This script copies the repo's
# policy.yaml into a throwaway br workspace and attempts every illegal move the
# doctrine forbids (and the legal path it allows), then checks br actually
# refused or allowed each one. It never touches the real tracker.
#
# Run after editing .beads/policy.yaml, after upgrading br, and at swarm start:
#   scripts/beads/canary.sh
# Exit 0 = every expectation held. Full br output is printed, never silenced.
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
POLICY="$REPO/.beads/policy.yaml"
[[ -f "$POLICY" ]] || { echo "canary: missing $POLICY" >&2; exit 2; }

WS=$(mktemp -d "${TMPDIR:-/tmp}/br-canary.XXXXXX")
cd "$WS" || exit 2
unset BR_AGENT_NAME BR_HARNESS BR_MODEL BR_SESSION
br init --prefix cn -q >/dev/null || { echo "canary: br init failed" >&2; exit 2; }
cp "$POLICY" .beads/policy.yaml

echo "canary: br $(br --version | awk '{print $2}') against $POLICY"
echo "canary: workspace $WS"
echo

pass=0 fail=0
report() { # status desc detail
    printf '%-4s %s\n' "$1" "$2"
    [[ -n "${3:-}" ]] && printf '       %s\n' "$3"
}
message() { printf '%s' "$1" | grep -o '"message": *"[^"]*' | head -1 | sed 's/"message": *"//' | cut -c1-200; }

# expect_refused <desc> <substring expected in the refusal> -- <br args...>
expect_refused() {
    local desc=$1 want=$2; shift 3
    local out rc
    out=$(br "$@" --json 2>&1); rc=$?
    if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then
        pass=$((pass + 1)); report ok "$desc" "refused: $(message "$out")"
    else
        fail=$((fail + 1)); report FAIL "$desc" "rc=$rc, expected refusal containing '$want'; got: ${out:0:300}"
    fi
}

# expect_allowed <desc> -- <br args...>
expect_allowed() {
    local desc=$1; shift 2
    local out rc
    out=$(br "$@" --json 2>&1); rc=$?
    if [[ $rc -eq 0 ]]; then
        pass=$((pass + 1)); report ok "$desc"
    else
        fail=$((fail + 1)); report FAIL "$desc" "rc=$rc; got: ${out:0:300}"
    fi
}

new_id() { br create "$@" --json 2>/dev/null | jq -r '.id // .created.id // .[0].id'; }
RECEIPT="Verified in canary wave, every acceptance item exercised receipt:.beads/receipts/canary.json"

NOAC=$(new_id "canary: no acceptance criteria")
B=$(new_id "canary: normal bead" --acceptance-criteria '- [ ] behaviour works')
B2=$(new_id "canary: second bead" --acceptance-criteria '- [ ] other behaviour')

echo "## claiming"
expect_refused "claim without acceptance criteria"          "acceptance criteria"   -- update "$NOAC" --claim --actor W1
expect_allowed "worker claims a bead with criteria"                                 -- update "$B" --claim --actor W1
expect_refused "same worker claims a second bead"           "capacity"              -- update "$B2" --claim --actor W1
expect_refused "another worker claims a claimed bead"       "already assigned"      -- update "$B" --claim --actor W2

echo "## closing without verification"
expect_refused "worker closes own bead"                     "cross-validation"      -- close "$B" --actor W1 --reason "$RECEIPT"
expect_refused "other actor skips batch_pending"            "not permitted"         -- close "$B" --actor V --reason "$RECEIPT" --transition-comment x
expect_refused "close via update --status closed"           "br close"              -- update "$B" --status closed --actor V
expect_refused "close with --bypass-policy"                 "allow_bypass: false"   -- close "$B" --actor V --bypass-policy --bypass-reason x --reason "$RECEIPT"
expect_refused "create a bead already closed"               "not permitted"         -- create "canary: born closed" --status closed --actor W1

echo "## hand-off to batch_pending"
expect_refused "batch_pending without hand-off comment"     "transition comment"    -- update "$B" --status batch_pending --actor W1
expect_allowed "batch_pending with hand-off comment"                                -- update "$B" --status batch_pending --actor W1 --transition-comment "commit:abc123 test:tests/canary.rs covers AC1"

echo "## verifier close requirements"
expect_refused "close before batch_verify gate passes"      "batch_verify"          -- close "$B" --actor V --reason "$RECEIPT" --transition-comment "wave green"
expect_allowed "verifier reports batch_verify pass"                                 -- gate report "$B" --gate batch_verify --provider batch-verifier --status pass --to closed --note "run:canary"
expect_refused "close reason without receipt: reference"    "typed references"      -- close "$B" --actor V --reason "Verified in the canary wave with all criteria exercised" --transition-comment "wave green"
expect_refused "close with unchecked acceptance criteria"   "unchecked"             -- close "$B" --actor V --reason "$RECEIPT" --transition-comment "wave green"

echo "## rework loop and stale verdicts"
expect_refused "rework without failure note"                "transition comment"    -- update "$B" --status rework --actor V
expect_allowed "rework with failure note"                                           -- update "$B" --status rework --actor V --transition-comment "FAIL tests/canary.rs:42 expected 3 got 2"
if br ready --json 2>/dev/null | jq -e --arg id "$B" 'any(.[]; .id == $id and .status == "rework")' >/dev/null; then
    pass=$((pass + 1)); report ok "rework bead resurfaces in br ready"
else
    fail=$((fail + 1)); report FAIL "rework bead resurfaces in br ready"
fi
expect_allowed "same worker re-claims rework"                                       -- update "$B" --status in_progress --actor W1
expect_allowed "worker hands off the fix"                                           -- update "$B" --status batch_pending --actor W1 --transition-comment "commit:def456 fixed off-by-one"
expect_allowed "verifier ticks the exercised criteria"                              -- update "$B" --acceptance-criteria '- [x] behaviour works' --actor V
expect_refused "stale PASS from before rework"              "batch_verify"          -- close "$B" --actor V --reason "$RECEIPT" --transition-comment "wave green"
expect_allowed "fresh batch_verify pass for this revision"                          -- gate report "$B" --gate batch_verify --provider batch-verifier --status pass --to closed --note "run:canary-2"
expect_allowed "verifier closes with receipt"                                       -- close "$B" --actor V --reason "$RECEIPT" --transition-comment "wave green"
expect_refused "reopen without a reason"                    "transition comment"    -- reopen "$B" --actor W1

echo "## epics"
E=$(new_id "canary: epic" --type epic)
C=$(new_id "canary: epic child" --parent "$E" --acceptance-criteria '- [ ] c')
expect_refused "force-close epic without batch_verify"      "batch_verify"          -- close "$E" --actor W2 --force --reason "$RECEIPT"
expect_refused "close epic with open children"              "open children"         -- close "$E" --actor V --reason "$RECEIPT"

echo "## known gaps (enforced outside br; informational)"
L=$(new_id "canary: leaf" --acceptance-criteria '- [ ] l')
br update "$L" --claim --actor W3 --json >/dev/null 2>&1
if br delete "$L" --actor W3 --reason canary --json >/dev/null 2>&1; then
    report gap "worker can br delete a claimed bead (tombstone skips gates)" \
        "mitigation: worker hook blocks 'br delete'; verifier audits tombstones each wave"
else
    report info "br now refuses deleting a claimed bead; the hook rule is belt-and-braces"
fi

echo
echo "canary: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
