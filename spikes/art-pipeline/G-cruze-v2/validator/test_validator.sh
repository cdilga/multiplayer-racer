#!/usr/bin/env bash
# Regenerates the good/broken fixtures and runs validate_asset.py against each, checking:
#   - the good asset exits 0
#   - every broken fixture exits 1 AND its expected rule_id appears among the FAIL lines
# Prints a PASS/FAIL table and exits 1 if any check failed.
set -u
cd "$(dirname "$0")"

PY=python3
FIX_DIR="fixtures"
GOOD_DIR="$FIX_DIR/good"
BROKEN_DIR="$FIX_DIR/broken"

echo "== regenerating fixtures =="
"$PY" "$FIX_DIR/build_good_asset.py" "$GOOD_DIR" || { echo "FAILED to build good fixture"; exit 1; }
"$PY" make_broken_fixtures.py "$GOOD_DIR" "$BROKEN_DIR" || { echo "FAILED to build broken fixtures"; exit 1; }
echo

overall_fail=0
printf "%-38s %-8s %-24s %-6s %s\n" "FIXTURE" "EXIT" "EXPECTED RULE" "FOUND" "RESULT"
printf "%-38s %-8s %-24s %-6s %s\n" "--------------------------------------" "--------" "------------------------" "------" "------"

check_one() {
    local name="$1" dir="$2" expect_rule="$3" want_exit="$4"
    local out exit_code found="-"
    out="$("$PY" validate_asset.py "$dir" 2>&1)"
    exit_code=$?
    local result="PASS"
    if [ "$exit_code" != "$want_exit" ]; then
        result="FAIL(exit $exit_code != $want_exit)"
    fi
    if [ -n "$expect_rule" ]; then
        if echo "$out" | grep -qE "^FAIL ${expect_rule} "; then
            found="yes"
        else
            found="no"
            result="FAIL(rule not seen)"
        fi
    fi
    printf "%-38s %-8s %-24s %-6s %s\n" "$name" "$exit_code" "${expect_rule:-'(none)'}" "$found" "$result"
    if [[ "$result" != "PASS" ]]; then
        overall_fail=1
        echo "  --- validator output for $name ---"
        echo "$out" | sed 's/^/  /'
        echo "  -----------------------------------"
    fi
}

check_one "good" "$GOOD_DIR" "" 0

FIXTURE_LIST="$(mktemp)"
trap 'rm -f "$FIXTURE_LIST"' EXIT

python3 - "$BROKEN_DIR/expected.json" > "$FIXTURE_LIST" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
for name, entry in sorted(d.items()):
    print(f"{name}\t{entry['rule_id']}")
PYEOF

while IFS=$'\t' read -r name rule_id; do
    [ -z "$name" ] && continue
    check_one "$name" "$BROKEN_DIR/$name" "$rule_id" 1
done < "$FIXTURE_LIST"

echo
if [ "$overall_fail" = "0" ]; then
    echo "ALL CHECKS PASSED"
else
    echo "SOME CHECKS FAILED (see output above)"
fi
exit "$overall_fail"
