#!/usr/bin/env python3
"""Check an evidence record against docs/evidence/README.md before an evidence close (P1-F02).

  python3 scripts/beads/evidence-check.py <bead> <record.md> [--bead-json <file>]

Exit 0 and print `evidence: OK …` when the record may close the bead; exit 1 and print every reason otherwise.
--bead-json takes `br show <bead> --json` output from a file (the canary's fixtures); otherwise br is asked.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

FIELDS = {"bead", "id", "covers", "observer", "date", "build", "external"}


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__.strip())
        return 2
    bead_id, record = args[0], Path(args[1])
    bead_json = args[args.index("--bead-json") + 1] if "--bead-json" in args else None
    repo = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip())
    problems: list[str] = []

    if bead_json:
        bead = json.loads(Path(bead_json).read_text())
    else:
        r = subprocess.run(["br", "show", bead_id, "--json"], capture_output=True, text=True, cwd=repo)
        if r.returncode != 0:
            print(f"evidence: REFUSED no bead {bead_id}")
            return 1
        bead = json.loads(r.stdout)
    if isinstance(bead, list):
        bead = bead[0]
    ext = bead.get("external_ref") or bead_id
    labels = bead.get("labels") or []
    items = re.findall(r"^- \[[ x]\]", bead.get("acceptance_criteria") or "", re.M)

    path = record.resolve() if record.is_absolute() else (Path.cwd() / record).resolve()
    if not path.is_file():
        print(f"evidence: REFUSED {record} does not exist")
        return 1
    rel = path.relative_to(repo).as_posix() if path.is_relative_to(repo) else str(path)

    # Committed, unchanged since HEAD.
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", rel], capture_output=True, cwd=repo).returncode == 0
    if not tracked:
        problems.append("uncommitted: the record is not tracked by git (commit it first)")
    elif subprocess.run(["git", "diff", "--quiet", "HEAD", "--", rel], cwd=repo).returncode != 0:
        problems.append("uncommitted: the record changed since HEAD (commit the change)")

    # The bead's own directory.
    if not (rel.startswith(f"docs/evidence/{ext}/") or rel.startswith(f"docs/evidence/{bead_id}/")):
        problems.append(f"wrong bead: {rel} is not under docs/evidence/{ext}/")

    text = path.read_text()
    m = re.match(r"\s*<!--\s*evidence\s*\n(.*?)-->", text, re.S)
    if not m:
        problems.append("malformed: no `<!-- evidence … -->` header at the top")
        header = {}
    else:
        header = {}
        for line in m.group(1).splitlines():
            if not line.strip():
                continue
            k, sep, v = line.partition(":")
            k = k.strip()
            if not sep or k not in FIELDS:
                problems.append(f"malformed: header line `{line.strip()}` (fields: {', '.join(sorted(FIELDS))})")
                continue
            header[k] = v.strip()
        for k in ("bead", "id", "covers", "observer", "date"):
            if not header.get(k):
                problems.append(f"incomplete: no `{k}`")
        if header.get("date") and not re.fullmatch(r"\d{4}-\d\d-\d\d", header["date"]):
            problems.append(f"malformed: date `{header['date']}` is not YYYY-MM-DD")
        if header.get("bead") and header["bead"] != bead_id:
            problems.append(f"wrong bead: the record is for {header['bead']}, not {bead_id}")
        if header.get("id") and header["id"] != ext:
            problems.append(f"wrong bead: the record's id {header['id']} is not {ext}")
        covered = set(re.findall(r"AC(\d+)", header.get("covers", "")))
        missing = [f"AC{i}" for i in range(1, len(items) + 1) if str(i) not in covered]
        if missing:
            problems.append(f"incomplete: covers lacks {' '.join(missing)} ({len(items)} acceptance items)")
        if not header.get("build") and not header.get("external"):
            problems.append("incomplete: neither `build` nor `external` says what the evidence is about")
        if "ev:deploy-repo" in labels:
            ex = header.get("external", "")
            if not re.search(r"[0-9a-f]{7,}\.\.[0-9a-f]{7,}", ex) or not re.search(r"\brun\b", ex):
                problems.append("incomplete: an ev:deploy-repo record needs `external: <repo> <a>..<b>, run <n>`")

    if problems:
        print(f"evidence: REFUSED {rel} for {bead_id}")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"evidence: OK {rel} closes {bead_id} ({ext}; {header.get('covers')}; observer {header.get('observer')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
