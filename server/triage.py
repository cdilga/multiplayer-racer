"""Trusted local bug-report drainer (br-captain-call-architecture-hardening-woq.4).

Reads the central report store, fingerprints + dedupes reports, maps severity to
a Beads priority, and (idempotently) creates/comments Beads via `br` — optionally
mirroring selected reports to `gh`. This is a MAINTAINER tool: it is never
imported by the browser bundle or the public Flask request path (which must never
shell out to br/gh). Run it locally: `python server/triage.py [--apply]`.
"""

import argparse
import hashlib
import json
import os
import subprocess

try:
    from report_store import read_reports
except ImportError:  # pragma: no cover - package import path
    from server.report_store import read_reports

# Deterministic severity -> Beads priority (0 highest).
SEVERITY_PRIORITY = {
    'critical': 0,
    'high': 1,
    'medium': 2,
    'low': 3,
}
DEFAULT_PRIORITY = 2


def fingerprint(report):
    """Stable fingerprint for dedupe: build + mode + track + normalized description.

    Two reports of the same problem on the same build collapse to one Bead.
    """
    r = report.get('report', report) if isinstance(report, dict) else {}
    parts = [
        str(r.get('buildId') or ''),
        str(r.get('mode') or r.get('ruleset') or ''),
        str((r.get('trackResolution') or {}).get('resolved') or r.get('roomCode') or ''),
        _normalize_desc(r.get('description') or ''),
    ]
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:16]


def _normalize_desc(text):
    return ' '.join(str(text).lower().split())[:120]


def severity_to_priority(severity):
    return SEVERITY_PRIORITY.get(str(severity or '').lower(), DEFAULT_PRIORITY)


def _load_state(state_path):
    try:
        with open(state_path, 'r', encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {'processed': {}}


def _save_state(state_path, state):
    os.makedirs(os.path.dirname(state_path) or '.', exist_ok=True)
    with open(state_path, 'w', encoding='utf-8') as handle:
        json.dump(state, handle, sort_keys=True, indent=2)


def plan_drain(store_path, state_path):
    """Compute the drain plan without side effects (idempotent).

    Returns a list of actions: {'action': 'create'|'comment', 'fingerprint', 'priority',
    'count', 'reportSample'}. Reruns against an unchanged state yield an empty plan
    for already-processed fingerprints.
    """
    state = _load_state(state_path)
    processed = state.get('processed', {})
    rows = read_reports(store_path)

    grouped = {}
    for row in rows:
        fp = fingerprint(row)
        grouped.setdefault(fp, []).append(row)

    plan = []
    for fp, group in sorted(grouped.items()):
        sample = group[0].get('report', {})
        priority = min(severity_to_priority(g.get('report', {}).get('severity')) for g in group)
        if fp in processed:
            # Already has a Bead: only a comment if new occurrences arrived.
            if len(group) > processed[fp].get('count', 0):
                plan.append({'action': 'comment', 'fingerprint': fp, 'priority': priority,
                             'count': len(group), 'reportSample': sample})
        else:
            plan.append({'action': 'create', 'fingerprint': fp, 'priority': priority,
                         'count': len(group), 'reportSample': sample})
    return plan


def apply_drain(store_path, state_path, *, dry_run=True, mirror_github=False, runner=None):
    """Execute the plan. In dry_run mode NO br/gh calls happen (returns the plan).

    `runner` is an injectable command runner (list[str] -> None) for tests; defaults
    to subprocess. Updates state so reruns are idempotent (no duplicate Beads).
    """
    run = runner if runner is not None else _default_runner
    plan = plan_drain(store_path, state_path)
    state = _load_state(state_path)
    processed = state.setdefault('processed', {})
    executed = []

    for item in plan:
        fp = item['fingerprint']
        title = _title_for(item['reportSample'], fp)
        if not dry_run:
            if item['action'] == 'create':
                run(['br', 'create', title, '-p', str(item['priority']), '-t', 'bug',
                     '--label', 'from-bug-report'])
            else:
                run(['br', 'comments', 'add', '--author', 'triage',
                     processed.get(fp, {}).get('beadId', fp),
                     f"New occurrence(s): now {item['count']} report(s) with fingerprint {fp}."])
            if mirror_github:
                run(['gh', 'issue', 'create', '--title', title, '--body', f'Auto-mirrored bug report {fp}'])
        processed[fp] = {'count': item['count'], 'priority': item['priority']}
        executed.append({**item, 'title': title, 'dryRun': dry_run, 'mirrored': bool(mirror_github)})

    if not dry_run:
        _save_state(state_path, state)
    return executed


def _title_for(report_sample, fp):
    desc = _normalize_desc(report_sample.get('description') or 'bug report')
    mode = report_sample.get('mode') or report_sample.get('ruleset') or 'game'
    return f'[bug-report:{fp}] {mode}: {desc[:80]}'


def _default_runner(cmd):  # pragma: no cover - exercised only in real (non-dry) runs
    subprocess.run(cmd, check=False)


def main(argv=None):  # pragma: no cover - CLI entry
    parser = argparse.ArgumentParser(description='Drain the central bug-report store into Beads.')
    here = os.path.dirname(__file__)
    parser.add_argument('--store', default=os.path.join(here, '..', '.reports', 'reports.ndjson'))
    parser.add_argument('--state', default=os.path.join(here, '..', '.reports', 'triage-state.json'))
    parser.add_argument('--apply', action='store_true', help='Actually create/comment Beads (default: dry-run).')
    parser.add_argument('--mirror-github', action='store_true')
    args = parser.parse_args(argv)
    result = apply_drain(args.store, args.state, dry_run=not args.apply, mirror_github=args.mirror_github)
    print(json.dumps({'actions': result}, indent=2))
    return 0


if __name__ == '__main__':  # pragma: no cover
    raise SystemExit(main())
