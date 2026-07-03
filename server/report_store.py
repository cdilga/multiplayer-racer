"""Central bug-report store (br-captain-call-architecture-hardening-woq.4).

The PUBLIC side of the bug-report pipeline: sanitize + validate + append reports
to a bounded ndjson store. This module NEVER invokes `br`, `gh`, a shell, or any
local maintainer tool — that boundary is enforced by test_report.py's static
guard. The trusted local drainer (triage.py) is the only place that promotes
stored reports into Beads.
"""

import json
import os
import re
import time

# Allowlisted top-level fields a browser may submit. Anything else is dropped.
ALLOWED_FIELDS = (
    'clientReportId', 'description', 'role', 'mode', 'roomCode', 'buildId',
    'seed', 'tuningHash', 'ruleset', 'topology', 'severity', 'consoleTail',
    'runContext', 'replayExcerpt', 'mapValidation', 'spawnDiagnostics',
    'trackResolution', 'userAgent', 'screenshot',
)

# Keys whose VALUES are secrets and must never be stored (recursive scrub).
SECRET_KEY_RE = re.compile(r'(token|password|secret|authorization|cookie|api[_-]?key)', re.IGNORECASE)
REDACTED = '[REDACTED]'

MAX_DESCRIPTION = 4000
MAX_CONSOLE_TAIL = 20000
MAX_SCREENSHOT_BYTES = 512 * 1024          # 512 KB cap; oversized screenshots are dropped
MAX_TOTAL_PAYLOAD_BYTES = 1024 * 1024      # 1 MB request cap
MAX_STORE_ROWS = 10000                     # bounded store (ring-trim oldest)

ALLOWED_SEVERITIES = ('low', 'medium', 'high', 'critical')


def scrub_secrets(value):
    """Recursively redact any key whose name looks like a secret."""
    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            if isinstance(key, str) and SECRET_KEY_RE.search(key):
                out[key] = REDACTED
            else:
                out[key] = scrub_secrets(val)
        return out
    if isinstance(value, list):
        return [scrub_secrets(v) for v in value]
    return value


def _truncate(text, limit):
    if not isinstance(text, str):
        return text
    return text if len(text) <= limit else text[:limit]


def sanitize_report(payload):
    """Allowlist fields, scrub secrets, cap sizes, drop an oversized screenshot.

    Returns a dict safe to persist. Never raises on malformed input.
    """
    if not isinstance(payload, dict):
        return {}
    cleaned = {}
    for field in ALLOWED_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if field == 'description':
            cleaned[field] = _truncate(value, MAX_DESCRIPTION)
        elif field == 'consoleTail':
            cleaned[field] = _truncate(value if isinstance(value, str) else json.dumps(value), MAX_CONSOLE_TAIL)
        elif field == 'screenshot':
            # Drop (don't store) an oversized screenshot; record that we did.
            if isinstance(value, str) and len(value) <= MAX_SCREENSHOT_BYTES:
                cleaned[field] = value
            else:
                cleaned['screenshotDropped'] = True
        elif field == 'severity':
            cleaned[field] = value if value in ALLOWED_SEVERITIES else 'medium'
        else:
            cleaned[field] = scrub_secrets(value)
    # Whole-record scrub as a belt-and-braces pass (nested secrets in runContext etc.).
    return scrub_secrets(cleaned)


def validate_report(payload):
    """(ok, reason). A report needs a description and must be within the size cap."""
    if not isinstance(payload, dict):
        return False, 'invalid_payload'
    try:
        size = len(json.dumps(payload))
    except (TypeError, ValueError):
        return False, 'unserializable'
    if size > MAX_TOTAL_PAYLOAD_BYTES:
        return False, 'too_large'
    description = payload.get('description')
    if not isinstance(description, str) or not description.strip():
        return False, 'missing_description'
    return True, None


def is_honeypot(payload):
    """A filled hidden 'website' field means a bot; silently drop such submissions."""
    return bool(isinstance(payload, dict) and str(payload.get('website') or '').strip())


def append_report(payload, store_path, *, now=None, client_ip=None):
    """Sanitize + append one report as an ndjson row. Returns the stored row.

    The store is bounded to MAX_STORE_ROWS (oldest rows trimmed).
    """
    now = time.time() if now is None else now
    cleaned = sanitize_report(payload)
    row = {
        'receivedAt': round(now, 3),
        'clientReportId': cleaned.get('clientReportId') or f'r-{int(now * 1000)}',
        'clientIpHash': _hash_ip(client_ip),
        'report': cleaned,
    }
    os.makedirs(os.path.dirname(store_path) or '.', exist_ok=True)
    with open(store_path, 'a', encoding='utf-8') as handle:
        handle.write(json.dumps(row, sort_keys=True) + '\n')
    _trim_store(store_path)
    return row


def _hash_ip(client_ip):
    if not client_ip:
        return None
    import hashlib
    return hashlib.sha256(str(client_ip).encode('utf-8')).hexdigest()[:16]


def _trim_store(store_path):
    try:
        with open(store_path, 'r', encoding='utf-8') as handle:
            lines = handle.readlines()
    except OSError:
        return
    if len(lines) <= MAX_STORE_ROWS:
        return
    with open(store_path, 'w', encoding='utf-8') as handle:
        handle.writelines(lines[-MAX_STORE_ROWS:])


def read_reports(store_path):
    """Read all stored report rows (drainer/test helper)."""
    rows = []
    try:
        with open(store_path, 'r', encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return rows
