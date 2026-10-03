#!/usr/bin/env bash
# The one way to read the plans: print only what you ask for (P1-F04). Never cat, sed or grep the plan files.
#   scripts/plan-ref.sh P1-N03 [F06 …]          a task's §15 block plus every plan section it cites (P1- optional)
#   scripts/plan-ref.sh 13b.2 [§3a …]           Playtest-1 plan sections by number
#   scripts/plan-ref.sh --master 10.6 V2-16     master plan sections and register rows
#   scripts/plan-ref.sh --rulings R93 R85       owner rulings (docs/policies/owner-direction-2026-09-29.md)
#   scripts/plan-ref.sh --direction 2           experience direction sections
#   scripts/plan-ref.sh [--master|…] --toc      a document's section IDs and titles
set -euo pipefail
doc=plan toc=() ids=()
for a in "$@"; do
    case $a in
        --master|--direction|--rulings) doc=${a#--} ;;
        --toc) toc=(--toc) ;;
        -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
        *) ids+=("$a") ;;
    esac
done
if [[ ${#toc[@]} -eq 0 && ${#ids[@]} -eq 0 ]]; then sed -n '2,8p' "$0" >&2; exit 2; fi
exec python3 "$(dirname "$0")/reconcile_plans_to_beads.py" --doc "$doc" ${toc[@]+"${toc[@]}"} --plan-ref ${ids[@]+"${ids[@]}"}
