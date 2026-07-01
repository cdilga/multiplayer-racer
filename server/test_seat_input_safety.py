"""Unit coverage for server-side input safety (3xv.4).

Pure, socket-free tests for server/input_safety.py — the canonical contract the
Socket.IO handlers enforce for untrusted controller payloads: finite control
validation, name/appearance schema, weapon whitelist, and per-key rate limiting.
Mirrors tests/integration/controller-ownership.test.js so client and server agree.

This is a NEW, additive test file (no overlap with the contested
server/test_socket_security.py, which currently has an unrelated
_new_room_state arity regression from the host-token/room-seat lanes).
"""

import math
import unittest

try:
    from input_safety import (
        validate_finite_controls, canonicalize_name, validate_color,
        validate_appearance, resolve_weapon_id, RateLimiter,
        WEAPON_WHITELIST, DEFAULT_COLOR, DEFAULT_NAME,
    )
except ImportError:  # pragma: no cover - import path shim
    from server.input_safety import (
        validate_finite_controls, canonicalize_name, validate_color,
        validate_appearance, resolve_weapon_id, RateLimiter,
        WEAPON_WHITELIST, DEFAULT_COLOR, DEFAULT_NAME,
    )


class FiniteControlsTest(unittest.TestCase):
    def test_clamps_in_range_and_out_of_range(self):
        self.assertEqual(
            validate_finite_controls({'steering': 0.5, 'acceleration': 0.2, 'braking': 0}),
            {'steering': 0.5, 'acceleration': 0.2, 'braking': 0.0},
        )
        self.assertEqual(
            validate_finite_controls({'steering': 5, 'acceleration': 9, 'braking': -3}),
            {'steering': 1.0, 'acceleration': 1.0, 'braking': 0.0},
        )

    def test_drops_non_finite_and_non_numeric(self):
        self.assertIsNone(validate_finite_controls({'steering': float('nan'), 'acceleration': 0, 'braking': 0}))
        self.assertIsNone(validate_finite_controls({'steering': float('inf'), 'acceleration': 0, 'braking': 0}))
        self.assertIsNone(validate_finite_controls({'steering': float('-inf'), 'acceleration': 0, 'braking': 0}))
        self.assertIsNone(validate_finite_controls({'steering': 'left', 'acceleration': 0, 'braking': 0}))
        self.assertIsNone(validate_finite_controls('steering=1'))
        self.assertIsNone(validate_finite_controls(None))

    def test_missing_axes_default_to_zero(self):
        self.assertEqual(validate_finite_controls({}), {'steering': 0.0, 'acceleration': 0.0, 'braking': 0.0})


class AppearanceSchemaTest(unittest.TestCase):
    def test_name_trims_collapses_caps(self):
        self.assertEqual(canonicalize_name('  Ada   Lovelace  '), 'Ada Lovelace')
        self.assertEqual(len(canonicalize_name('a' * 50)), 20)

    def test_name_strips_control_chars_and_defaults(self):
        self.assertEqual(canonicalize_name('hi​there'), 'hithere')  # zero-width space stripped
        self.assertEqual(canonicalize_name('word\tword'), 'wordword')     # tab is a control char
        self.assertEqual(canonicalize_name('   '), DEFAULT_NAME)
        self.assertEqual(canonicalize_name(None), DEFAULT_NAME)
        self.assertEqual(canonicalize_name(12345), DEFAULT_NAME)

    def test_xss_name_kept_as_literal_value(self):
        # The canonical value keeps the characters (harmless as data); the client
        # renders it as literal text (SafeTextRenderer), so nothing executes.
        name = canonicalize_name('<img src=x onerror=alert(1)>')
        self.assertIn('<img', name)

    def test_color_hex_or_default(self):
        self.assertEqual(validate_color('#FFAA00'), '#ffaa00')
        self.assertEqual(validate_color('#abc'), '#abc')
        self.assertEqual(validate_color('red; background:url(x)'), DEFAULT_COLOR)
        self.assertEqual(validate_color('javascript:alert(1)'), DEFAULT_COLOR)
        self.assertEqual(validate_color(None), DEFAULT_COLOR)

    def test_validate_appearance(self):
        self.assertEqual(
            validate_appearance({'name': '  Bo  ', 'color': '#00FF88'}),
            {'name': 'Bo', 'color': '#00ff88'},
        )
        self.assertEqual(validate_appearance('garbage'), {'name': DEFAULT_NAME, 'color': DEFAULT_COLOR})


class WeaponWhitelistTest(unittest.TestCase):
    def test_resolves_whitelisted_case_and_space_insensitive(self):
        for w in WEAPON_WHITELIST:
            self.assertEqual(resolve_weapon_id(w), w)
            self.assertEqual(resolve_weapon_id(f'  {w.upper()} '), w)

    def test_rejects_unknown_or_forged(self):
        self.assertIsNone(resolve_weapon_id('nuke'))
        self.assertIsNone(resolve_weapon_id('missile; drop table'))
        self.assertIsNone(resolve_weapon_id(''))
        self.assertIsNone(resolve_weapon_id(42))
        self.assertIsNone(resolve_weapon_id(None))


class RateLimiterTest(unittest.TestCase):
    def test_allows_once_per_interval_per_key(self):
        clock = {'t': 1000.0}
        rl = RateLimiter(0.5, clock=lambda: clock['t'])
        self.assertTrue(rl.allow('fire'))
        self.assertFalse(rl.allow('fire'))
        clock['t'] = 1000.4
        self.assertFalse(rl.allow('fire'))
        clock['t'] = 1000.5
        self.assertTrue(rl.allow('fire'))

    def test_keys_independent_and_reset(self):
        rl = RateLimiter(1.0)
        self.assertTrue(rl.allow('seat-1:fire', now=0))
        self.assertTrue(rl.allow('seat-2:fire', now=0))
        self.assertFalse(rl.allow('seat-1:fire', now=0.5))
        rl.reset('seat-1:fire')
        self.assertTrue(rl.allow('seat-1:fire', now=0.5))


if __name__ == '__main__':
    unittest.main()
