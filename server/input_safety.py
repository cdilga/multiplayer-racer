"""Input-safety helpers for seat control ownership and abuse controls (3xv.4).

Pure, dependency-light validators shared by the Socket.IO handlers in app.py so
the server enforces ONE canonical contract for untrusted controller payloads:

- ``validate_finite_controls`` — drop non-finite (NaN/Inf) controls and clamp ranges
- ``canonicalize_name`` / ``validate_appearance`` — server-canonical display schema
- ``resolve_weapon_id`` — whitelist wire weapon ids (unknown -> None)
- ``RateLimiter`` — deterministic per-key cooldown (fire/reset/name spam)

Kept import-clean so server tests and the handlers agree on one contract; the JS
mirror for the client + integration tests lives in
``static/js/engine/controllerValidation.js``.
"""

import math
import re
import time
import unicodedata

# Canonical weapon ids the server is willing to forward. Anything else is
# dropped so a client cannot smuggle an arbitrary/unknown weapon id over the
# wire (README lists these eight pickups).
WEAPON_WHITELIST = frozenset({
    'missile', 'mine', 'boost', 'oil_slick',
    'sniper', 'shield', 'emp', 'flamethrower',
})

DEFAULT_COLOR = '#4cc9f0'
DEFAULT_NAME = 'Player'
NAME_MAX_LENGTH = 20

_HEX_COLOR_RE = re.compile(r'#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})')

_CONTROL_RANGES = {
    'steering': (-1.0, 1.0),
    'acceleration': (0.0, 1.0),
    'braking': (0.0, 1.0),
}


def validate_finite_controls(controls):
    """Return a clamped ``{steering, acceleration, braking}`` dict, or ``None``.

    Rejects the whole update if any axis is non-numeric or non-finite (NaN/Inf) —
    a poisoned axis must not reach physics. Missing axes default to 0. Finite
    values are clamped to their range.
    """
    if not isinstance(controls, dict):
        return None
    out = {}
    for key, (lo, hi) in _CONTROL_RANGES.items():
        raw = controls.get(key, 0)
        try:
            val = float(raw)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(val):
            return None
        out[key] = max(lo, min(hi, val))
    return out


def canonicalize_name(raw, *, max_length=NAME_MAX_LENGTH, default=DEFAULT_NAME):
    """Server-canonical display name.

    NFKC-normalize, drop Unicode control/format chars (category starting with
    'C'), collapse internal whitespace, trim, and cap length. Falls back to
    ``default`` when nothing usable remains. Never returns markup-bearing control
    characters; the safe *rendering* contract (textContent) is enforced client
    side, this guarantees the canonical *value* is well-formed.
    """
    if not isinstance(raw, str):
        return default
    normalized = unicodedata.normalize('NFKC', raw)
    cleaned = ''.join(ch for ch in normalized if not unicodedata.category(ch).startswith('C'))
    cleaned = ' '.join(cleaned.split())
    cleaned = cleaned[:max_length].strip()
    return cleaned or default


def validate_color(raw, *, default=DEFAULT_COLOR):
    """Accept only ``#rgb`` / ``#rrggbb`` hex; anything else coerces to default.

    No arbitrary CSS strings ever reach a style/attribute sink.
    """
    if isinstance(raw, str):
        candidate = raw.strip()
        if _HEX_COLOR_RE.fullmatch(candidate):
            return candidate.lower()
    return default


def validate_appearance(raw):
    """Canonical ``{name, color}`` appearance schema from an untrusted payload."""
    data = raw if isinstance(raw, dict) else {}
    return {
        'name': canonicalize_name(data.get('name')),
        'color': validate_color(data.get('color')),
    }


def resolve_weapon_id(raw):
    """Return the canonical whitelisted weapon id, or ``None`` if not allowed."""
    if not isinstance(raw, str):
        return None
    key = raw.strip().lower()
    return key if key in WEAPON_WHITELIST else None


class RateLimiter:
    """Minimal per-key cooldown limiter on a monotonic clock.

    ``allow(key, now)`` returns True at most once per ``min_interval`` seconds
    per key. Deterministic for tests: pass an explicit ``now`` (or inject a
    ``clock``) instead of relying on wall time.
    """

    def __init__(self, min_interval, *, clock=None):
        self.min_interval = float(min_interval)
        self._last = {}
        self._clock = clock or time.monotonic

    def allow(self, key, now=None):
        current = self._clock() if now is None else float(now)
        last = self._last.get(key)
        if last is not None and (current - last) < self.min_interval:
            return False
        self._last[key] = current
        return True

    def reset(self, key=None):
        if key is None:
            self._last.clear()
        else:
            self._last.pop(key, None)
