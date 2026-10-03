#!/usr/bin/env python3
"""reconcile_plans_to_beads.py: the plan -> bead coverage gate (P1-F04).

WHY THIS EXISTS
---------------
In 0.1, ~35 designed feedback rows were dropped at the plan -> bead boundary because nothing linked a
plan's tasks to the tracker; players then hit exactly those gaps. For 0.2 every Playtest-1 task in
`docs/plans/v0.2-playtest-1-plan.md` §15 carries an ID (`**P1-XXX · title**`, epic children included,
e.g. `- **P1-S04a · …**`), and every bead cut from it carries `external_ref = P1-XXX`. This script
matches the two:

  PRESENT  a §15 task with at least one live bead
  MISSING  a §15 task with no bead (designed but never cut: THE failure mode)
  ORPHAN   a bead whose P1 ref is no longer a §15 task (renamed or removed from the plan)

Beads without a P1 ref (bug beads from playtests, process beads) are counted, not judged.

Usage:
    scripts/reconcile_plans_to_beads.py                  report against the live tracker (br)
    scripts/reconcile_plans_to_beads.py --gate           exit 1 on any un-allowlisted MISSING/ORPHAN
    scripts/reconcile_plans_to_beads.py --jsonl FILE     read beads from a JSONL copy instead of br
    scripts/reconcile_plans_to_beads.py --json           machine-readable report
    scripts/reconcile_plans_to_beads.py --plan-ref ID…   print tasks' §15 blocks and the plan
                                                         sections they cite, or sections (13b.2),
                                                         rulings (R93) and register rows (V2-16)
                                                         from --doc plan|master|direction|rulings;
                                                         --toc lists a document's section IDs
                                                         (all through scripts/plan-ref.sh)

Intentional deferrals go in scripts/reconcile_allowlist.txt, one ID per line with a reason.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PLAN = REPO / "docs" / "plans" / "v0.2-playtest-1-plan.md"
ALLOWLIST = REPO / "scripts" / "reconcile_allowlist.txt"
DOCS = {
    "plan": PLAN,
    "master": REPO / "docs" / "plans" / "v0.2-revamp-plan-2026-09-28.md",
    "direction": REPO / "docs" / "plans" / "v0.2-experience-direction.md",
    "rulings": REPO / "docs" / "policies" / "owner-direction-2026-09-29.md",
}

TASK_RE = re.compile(r"^(?:- )?\*\*(P1-[A-Z]+\d+[a-z]?) · ")
HEADING_RE = re.compile(r"^(#{2,4}) (\S+?)\.? ")
ROW_ID_RE = re.compile(r"^(R\d+|V2-\d+[a-z]?)$")  # a ruling (R93) or a master-plan register row (V2-16)
# A plan-local section citation: §5.3, §13b.2, §3a, §15.0. "master §…" / "experience direction §…"
# point at other documents and are skipped.
CITE_RE = re.compile(r"(?<![\w])(master |direction |brief )?§(\d+[a-z]?(?:\.\d+[a-z]?)?)")


def plan_lines() -> list[str]:
    return PLAN.read_text(encoding="utf-8").splitlines()


def section15(lines: list[str]) -> tuple[int, int]:
    start = next(i for i, l in enumerate(lines) if l.startswith("## 15. "))
    end = next(i for i, l in enumerate(lines) if i > start and l.startswith("## ") and not l.startswith("## 15"))
    return start, end


def plan_tasks(lines: list[str]) -> dict[str, int]:
    """P1 ID -> line index of its §15 heading."""
    start, end = section15(lines)
    tasks: dict[str, int] = {}
    for i in range(start, end):
        m = TASK_RE.match(lines[i])
        if m:
            tasks.setdefault(m.group(1), i)
    return tasks


def load_beads(jsonl: str | None) -> list[dict]:
    if jsonl:
        rows = [json.loads(l) for l in pathlib.Path(jsonl).read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        out = subprocess.run(
            ["br", "list", "--status", "all", "--limit", "0", "--json"],
            cwd=REPO, check=True, capture_output=True, text=True,
        ).stdout
        data = json.loads(out)
        rows = data["issues"] if isinstance(data, dict) else data
    return [r for r in rows if r.get("status") != "tombstone" and not r.get("deleted_at")]


def load_allowlist() -> dict[str, str]:
    allow: dict[str, str] = {}
    if ALLOWLIST.exists():
        for line in ALLOWLIST.read_text(encoding="utf-8").splitlines():
            tok, _, reason = line.partition("#")
            tok = tok.strip()
            if tok:
                allow[tok] = reason.strip()
    return allow


def reconcile(jsonl: str | None) -> dict:
    tasks = plan_tasks(plan_lines())
    beads = load_beads(jsonl)
    by_ref: dict[str, list[str]] = {}
    unreferenced = 0
    for b in beads:
        ref = (b.get("external_ref") or "").strip()
        # A split bead's children carry P1-XXX.N (external refs are unique in br); they count for P1-XXX.
        m = re.fullmatch(r"(P1-[A-Z]+\d+[a-z]?)(?:\.\d+)?", ref)
        if m:
            by_ref.setdefault(m.group(1), []).append(b["id"])
        else:
            unreferenced += 1
    present = {t: sorted(by_ref[t]) for t in tasks if t in by_ref}
    missing = [t for t in tasks if t not in by_ref]
    orphan = {r: sorted(ids) for r, ids in by_ref.items() if r not in tasks}
    allow = load_allowlist()
    failing = [t for t in missing if t not in allow] + [r for r in orphan if r not in allow]
    return {
        "plan": str(PLAN.relative_to(REPO)),
        "tasks": len(tasks),
        "beads": len(beads),
        "present": present,
        "missing": missing,
        "orphan": orphan,
        "unreferenced": unreferenced,
        "allowlisted": {k: v for k, v in allow.items() if k in missing or k in orphan},
        "failing": failing,
    }


def print_report(r: dict, gate: bool) -> None:
    print(f"# Plan -> bead reconciliation: {r['tasks']} §15 tasks, {r['beads']} beads ({r['plan']})\n")
    print(f"PRESENT  {len(r['present'])}")
    multi = {t: ids for t, ids in r["present"].items() if len(ids) > 1}
    for t, ids in multi.items():
        print(f"  {t}: {len(ids)} beads ({', '.join(ids)})")
    print(f"MISSING  {len(r['missing'])}")
    for t in r["missing"]:
        note = f"  (allowlisted: {r['allowlisted'][t]})" if t in r["allowlisted"] else ""
        print(f"  {t}{note}")
    print(f"ORPHAN   {len(r['orphan'])}")
    for t, ids in r["orphan"].items():
        note = f"  (allowlisted: {r['allowlisted'][t]})" if t in r["allowlisted"] else ""
        print(f"  {t}: {', '.join(ids)}{note}")
    print(f"beads without a P1 ref (not judged): {r['unreferenced']}")
    if gate:
        if r["failing"]:
            print(f"\nGATE FAIL: {', '.join(r['failing'])}. Cut the missing tasks into br (or fix the orphans' "
                  "refs), or allowlist them with a reason in scripts/reconcile_allowlist.txt.")
        else:
            print("\nGATE PASS: every §15 task has a bead and every P1 bead names a §15 task.")


def section_block(lines: list[str], ref: str) -> list[str] | None:
    """The plan section for a citation like 5.3, 13b.2, 3a or 15.0."""
    for i, l in enumerate(lines):
        m = HEADING_RE.match(l)
        if m and m.group(2).rstrip(".") == ref:
            level = len(m.group(1))
            j = i + 1
            while j < len(lines):
                n = HEADING_RE.match(lines[j])
                if n and len(n.group(1)) <= level:
                    break
                j += 1
            return lines[i:j]
    return None


def table_rows(lines: list[str], ref: str) -> list[str]:
    """Table rows whose first cell is exactly ref (a ruling like R93, a register row like V2-16)."""
    return [l for l in lines if re.match(rf"^\|\s*\**{re.escape(ref)}\**\s*\|", l)]


def doc_ref(doc: str, ref: str) -> bool:
    """Print one section, ruling or register row of a document; False when it isn't there."""
    ref = ref.lstrip("§")
    if doc == "rulings" and re.match(r"^R\d+$", ref):
        # The numbered ruling lives in the master plan's rulings table; the owner-direction policy's topic
        # rows that cite it carry the short form.
        master = DOCS["master"].read_text(encoding="utf-8").splitlines()
        policy = DOCS["rulings"].read_text(encoding="utf-8").splitlines()
        block = table_rows(master, ref) + [l for l in policy if l.startswith("|") and re.search(rf"\b{ref}\b", l)]
        path = DOCS["master"] if table_rows(master, ref) else DOCS["rulings"]
    else:
        path = DOCS[doc]
        lines = path.read_text(encoding="utf-8").splitlines()
        block = table_rows(lines, ref) if ROW_ID_RE.match(ref) else section_block(lines, ref)
    if not block:
        print(f"plan-ref: no {ref} in {path.relative_to(REPO)} (scripts/plan-ref.sh --toc lists the sections)",
              file=sys.stderr)
        return False
    print(f"===== {ref} ({path.relative_to(REPO)}) =====")
    print("\n".join(block).rstrip())
    print()
    return True


def toc(doc: str) -> int:
    """Every section heading with its ID and line, so a section can be asked for by ID."""
    path = DOCS[doc]
    for i, l in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = HEADING_RE.match(l)
        if m:
            print(f"{i:6d}  {'  ' * (len(m.group(1)) - 2)}{l.lstrip('#').strip()}")
    return 0


def plan_ref(ids: list[str], doc: str = "plan") -> int:
    if doc != "plan":
        return 0 if all([doc_ref(doc, r) for r in ids]) else 1
    lines = plan_lines()
    tasks = plan_tasks(lines)
    start, end = section15(lines)
    order = sorted(tasks.values())
    status = 0
    for raw in ids:
        if raw.startswith("§") or raw[:1].isdigit():
            status |= 0 if doc_ref("plan", raw) else 1
            continue
        tid = raw if raw.startswith("P1-") else f"P1-{raw}"
        if tid not in tasks:
            print(f"plan-ref: {tid} is not a §15 task in {PLAN.relative_to(REPO)}", file=sys.stderr)
            status = 1
            continue
        i = tasks[tid]
        nxt = [k for k in order if k > i]
        j = nxt[0] if nxt else end
        # Stop at an intervening heading (### group) too.
        for k in range(i + 1, j):
            if lines[k].startswith("#"):
                j = k
                break
        block = lines[i:j]
        while block and not block[-1].strip():
            block.pop()
        print(f"===== {tid} (plan line {i + 1}) =====")
        print("\n".join(block))
        cited: list[str] = []
        for m in CITE_RE.finditer("\n".join(block)):
            if m.group(1):
                continue
            ref = m.group(2)
            if ref not in cited:
                cited.append(ref)
        for ref in cited:
            sec = section_block(lines, ref)
            if sec is None:
                print(f"\n===== §{ref}: no such section in the plan =====")
                continue
            print(f"\n===== §{ref} =====")
            print("\n".join(sec).rstrip())
        print()
    return status


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--jsonl", help="read beads from this JSONL copy instead of br")
    ap.add_argument("--plan-ref", nargs="*", metavar="ID")
    ap.add_argument("--doc", choices=sorted(DOCS), default="plan")
    ap.add_argument("--toc", action="store_true")
    a = ap.parse_args()
    if a.toc:
        return toc(a.doc)
    if a.plan_ref:
        return plan_ref(a.plan_ref, a.doc)
    r = reconcile(a.jsonl)
    if a.json:
        print(json.dumps(r, indent=2))
    else:
        print_report(r, a.gate)
    return 1 if a.gate and r["failing"] else 0


if __name__ == "__main__":
    sys.exit(main())
