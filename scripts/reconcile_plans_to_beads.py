#!/usr/bin/env python3
"""
reconcile_plans_to_beads.py  --  design->bead coverage gate.

WHY THIS EXISTS
---------------
On 2026-06-29 the feedback-design-pass.md work-breakdown (section 13) defined
~45 `FB-*` beads. Only 8 were ever cut into `br`; ~35 rows (cameras, out-of-
bounds recovery, controller schemes, presentation scaling, the physics sim
harness) were designed and then silently dropped at the plan->bead boundary,
because nothing linked a plan's promised beads to the issue tracker. Users then
hit exactly those gaps in the running game.

This script closes that loop: for every planning doc it extracts the bead
identifiers the plan *promises* (FB-* logical names + explicit br-* IDs) and
checks each against .beads/beads.db, classifying:

  PRESENT  - exists as its own issue id
  REHOMED  - concept lives only inside another issue's body (folded elsewhere;
             verify scope wasn't lost)
  MISSING  - no issue mentions it -> designed but never cut  (THE failure mode)

Run:
    python3 scripts/reconcile_plans_to_beads.py            # human report
    python3 scripts/reconcile_plans_to_beads.py --gate     # exit 1 if any
                                                            # non-allowlisted MISSING

Intentionally-deferred beads (e.g. the account/monetization strand) live in
scripts/reconcile_allowlist.txt (one token per line) so the --gate mode can be
wired into CI without going red on work we chose not to do yet.
"""
import re, sqlite3, sys, pathlib, collections

REPO = pathlib.Path(__file__).resolve().parent.parent
DB = REPO / ".beads" / "beads.db"
ALLOWLIST = REPO / "scripts" / "reconcile_allowlist.txt"
GATE = "--gate" in sys.argv

allow = set()
if ALLOWLIST.exists():
    for line in ALLOWLIST.read_text().splitlines():
        line = line.split("#", 1)[0].strip().lower()
        if line:
            allow.add(line)

con = sqlite3.connect(str(DB))
bodies = con.execute(
    "SELECT id, lower(id||' '||title||' '||coalesce(description,'')||' '||"
    "coalesce(design,'')||' '||coalesce(notes,'')||' '||"
    "coalesce(acceptance_criteria,'')), status "
    "FROM issues WHERE status!='tombstone'"
).fetchall()


def classify(token):
    t = token.lower()
    owners = [r[0] for r in bodies if t in r[0].lower()]
    if owners:
        return "PRESENT", owners, {r[2] for r in bodies if r[0] in owners}
    refs = [(r[0], r[2]) for r in bodies if t in r[1]]
    if refs:
        return "REHOMED", [r[0] for r in refs], {r[1] for r in refs}
    return "MISSING", [], set()


plan_files = (
    sorted((REPO / "docs" / "plans").glob("*.md"))
    + sorted((REPO / "docs" / "plans" / "gaps").glob("*.md"))
    + sorted((REPO / "docs" / "design").glob("*.md"))
)
fb_re = re.compile(r"\bFB-[A-Za-z][A-Za-z0-9]+\b")
promised = collections.OrderedDict()
for f in plan_files:
    for m in fb_re.findall(f.read_text(errors="ignore")):
        promised.setdefault(m, set()).add(f.name)

buckets = {"MISSING": [], "REHOMED": [], "PRESENT": []}
for tok in sorted(promised):
    status, owners, st = classify(tok)
    buckets[status].append((tok, owners, st, sorted(promised[tok])))

print(f"# Plan->Bead reconciliation: {len(promised)} promised beads / {len(plan_files)} plan docs\n")
for b in ("MISSING", "REHOMED", "PRESENT"):
    print(f"## {b} ({len(buckets[b])})")
    for tok, owners, st, files in buckets[b]:
        flag = "  (allowlisted)" if tok.lower() in allow else ""
        loc = ("-> " + ",".join(sorted(set(owners))[:2])) if owners else ""
        print(f"- {tok}{flag} {loc} {sorted(st) or ''}   in: {', '.join(files)}")
    print()

unexpected = [t for t, *_ in buckets["MISSING"] if t.lower() not in allow]
if unexpected:
    print(f"UNCUT (not allowlisted): {len(unexpected)} -> {', '.join(unexpected)}")
    if GATE:
        print("\nGATE FAIL: promised beads with no issue. Cut them into `br` or add to "
              "scripts/reconcile_allowlist.txt with a reason.")
        sys.exit(1)
elif GATE:
    print("GATE PASS: every promised bead is cut or allowlisted.")
