"""
Host Capability Token and Socket Security Tests

Two layers:
  1. TestHostCapabilityTokens - unit tests of _generate/_verify/_check helpers.
     (_check_host_authority reads the Flask `request` proxy, so we patch it with
     an explicit object — a bare patch('...request') makes mock introspect the
     werkzeug LocalProxy and raises "Working outside of request context".)
  2. TestHostAuthoritySocketEnforcement - real Flask-SocketIO test-client tests
     that drive the actual handlers and prove rejection/acceptance end-to-end
     (the project pattern from test_socket_routing.py).
"""

import unittest
import time
from types import SimpleNamespace
from unittest.mock import patch

try:
    from app import (
        app, socketio, game_rooms,
        _generate_host_token, _verify_host_token, _check_host_authority, _new_room_state,
    )
except ImportError:
    from server.app import (
        app, socketio, game_rooms,
        _generate_host_token, _verify_host_token, _check_host_authority, _new_room_state,
    )

# Rate limiters are module-level singletons in the server; import them so the
# seat-input-safety tests below can reset them between cases (3xv.4).
try:
    from app import _fire_rate_limiter, _reset_rate_limiter, _name_rate_limiter
except ImportError:
    from server.app import _fire_rate_limiter, _reset_rate_limiter, _name_rate_limiter


def _patch_request_sid(sid):
    """Replace server.app.request with a stub exposing .sid (avoids LocalProxy
    introspection that fails outside a real request context)."""
    return patch('server.app.request', SimpleNamespace(sid=sid))


class TestHostCapabilityTokens(unittest.TestCase):
    """Unit tests for host token generation, verification, and authority checks."""

    def setUp(self):
        game_rooms.clear()

    def tearDown(self):
        game_rooms.clear()

    def test_token_generation(self):
        """Generated tokens should be valid and unique."""
        token1 = _generate_host_token()
        token2 = _generate_host_token()
        self.assertIsInstance(token1, str)
        self.assertIsInstance(token2, str)
        self.assertNotEqual(token1, token2)
        self.assertEqual(len(token1.split(':')), 3)

    def test_token_verification_valid(self):
        """Valid token should pass verification."""
        self.assertTrue(_verify_host_token(_generate_host_token()))

    def test_token_verification_invalid_format(self):
        """Malformed token should fail verification."""
        self.assertFalse(_verify_host_token(''))
        self.assertFalse(_verify_host_token('invalid'))
        self.assertFalse(_verify_host_token('1:2'))
        self.assertFalse(_verify_host_token('1:2:3:4'))

    def test_token_verification_expired(self):
        """Expired token should fail verification."""
        import hmac
        import hashlib
        timestamp = int(time.time()) - 7200  # 2 hours ago
        nonce = 'test'
        message = f"{timestamp}:{nonce}".encode()
        secret = app.config['SECRET_KEY'].encode()
        signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
        expired_token = f"{timestamp}:{nonce}:{signature}"
        self.assertFalse(_verify_host_token(expired_token, max_age_seconds=3600))

    def test_check_host_authority_valid(self):
        """Valid host authority check should return True."""
        room_state = _new_room_state('TEST', 'host_sid_123')
        game_rooms['TEST'] = room_state
        with _patch_request_sid('host_sid_123'):
            is_valid, msg = _check_host_authority('TEST', room_state['host_token'], room_state['host_epoch'])
        self.assertTrue(is_valid)
        self.assertIsNone(msg)

    def test_check_host_authority_invalid_sid(self):
        """Wrong socket ID should fail authority check."""
        room_state = _new_room_state('TEST', 'host_sid_123')
        game_rooms['TEST'] = room_state
        with _patch_request_sid('attacker_sid_456'):
            is_valid, msg = _check_host_authority('TEST', room_state['host_token'], room_state['host_epoch'])
        self.assertFalse(is_valid)
        self.assertIn('Not the current host', msg)

    def test_check_host_authority_invalid_token(self):
        """Wrong token should fail authority check."""
        room_state = _new_room_state('TEST', 'host_sid_123')
        game_rooms['TEST'] = room_state
        with _patch_request_sid('host_sid_123'):
            is_valid, msg = _check_host_authority('TEST', 'wrong_token', room_state['host_epoch'])
        self.assertFalse(is_valid)
        self.assertIn('mismatch', msg.lower())

    def test_check_host_authority_stale_epoch(self):
        """Stale epoch should fail authority check (prevents old reclaim events)."""
        room_state = _new_room_state('TEST', 'host_sid_123')
        game_rooms['TEST'] = room_state
        old_epoch = room_state['host_epoch'] - 1
        with _patch_request_sid('host_sid_123'):
            is_valid, msg = _check_host_authority('TEST', room_state['host_token'], old_epoch)
        self.assertFalse(is_valid)
        self.assertIn('Stale host epoch', msg)

    def test_check_host_authority_missing_room(self):
        """Missing room should fail authority check."""
        with _patch_request_sid('host_sid_123'):
            is_valid, msg = _check_host_authority('NONEXISTENT', 'token', 1)
        self.assertFalse(is_valid)
        self.assertIn('not found', msg.lower())


class TestHostAuthoritySocketEnforcement(unittest.TestCase):
    """End-to-end host-authority enforcement via the Flask-SocketIO test client.

    Proves the bead's real acceptance: a room-code-only attacker cannot reclaim,
    a valid host can reclaim (token rotates), stale epochs are rejected, and
    non-host/foreign-sid/malformed host events are rejected — against the actual
    server handlers, not mocks.
    """

    def setUp(self):
        game_rooms.clear()
        self.clients = []

    def tearDown(self):
        for c in self.clients:
            if c.is_connected():
                c.disconnect()
        game_rooms.clear()

    def _client(self):
        c = socketio.test_client(app)
        self.clients.append(c)
        return c

    def _create_room(self, host):
        host.emit('create_room', {})
        evts = [e for e in host.get_received() if e['name'] == 'room_created']
        self.assertEqual(len(evts), 1)
        return evts[0]['args'][0]

    @staticmethod
    def _errors(client):
        return [e['args'][0].get('message', '') for e in client.get_received() if e['name'] == 'error']

    @staticmethod
    def _events(client, name):
        return [e for e in client.get_received() if e['name'] == name]

    def test_create_room_issues_token_and_epoch(self):
        evt = self._create_room(self._client())
        self.assertIsInstance(evt.get('host_token'), str)
        self.assertEqual(len(evt['host_token'].split(':')), 3)
        self.assertIsNotNone(evt.get('host_epoch'))

    def test_host_event_without_token_is_rejected(self):
        """The legitimate host MUST send the token; without it, rejected (this is
        the regression that bricked the host: the client used to send no token)."""
        host = self._client()
        evt = self._create_room(host)
        host.emit('start_game', {'room_code': evt['room_code']})
        self.assertTrue(any('token' in m.lower() for m in self._errors(host)))
        self.assertEqual(len(self._events(host, 'game_started')), 0)

    def test_valid_host_event_with_token_accepted(self):
        host = self._client()
        evt = self._create_room(host)
        host.emit('start_game', {
            'room_code': evt['room_code'],
            'host_token': evt['host_token'],
            'host_epoch': evt['host_epoch'],
        })
        self.assertEqual(len(self._events(host, 'game_started')), 1)

    def test_attacker_with_room_code_only_cannot_reclaim(self):
        host = self._client()
        evt = self._create_room(host)
        original_host_sid = game_rooms[evt['room_code']]['host_sid']

        attacker = self._client()
        attacker.emit('reclaim_room', {'room_code': evt['room_code']})  # no token
        self.assertTrue(self._errors(attacker))
        self.assertEqual(len(self._events(attacker, 'room_reclaimed')), 0)
        # Host binding unchanged by the attacker.
        self.assertEqual(game_rooms[evt['room_code']]['host_sid'], original_host_sid)

    def test_foreign_sid_with_leaked_token_rejected_on_host_event(self):
        """Even with the (leaked) token, a different socket is not the host."""
        host = self._client()
        evt = self._create_room(host)
        attacker = self._client()
        attacker.emit('start_game', {
            'room_code': evt['room_code'],
            'host_token': evt['host_token'],
            'host_epoch': evt['host_epoch'],
        })
        self.assertTrue(any('host' in m.lower() for m in self._errors(attacker)))
        self.assertEqual(len(self._events(attacker, 'game_started')), 0)

    def test_valid_host_reclaim_rotates_token_and_bumps_epoch(self):
        host = self._client()
        evt = self._create_room(host)
        host.emit('reclaim_room', {
            'room_code': evt['room_code'],
            'host_token': evt['host_token'],
            'host_epoch': evt['host_epoch'],
        })
        reclaimed = self._events(host, 'room_reclaimed')
        self.assertEqual(len(reclaimed), 1)
        new = reclaimed[0]['args'][0]
        self.assertNotEqual(new['host_token'], evt['host_token'])      # rotated
        self.assertEqual(new['host_epoch'], evt['host_epoch'] + 1)     # bumped

    def test_stale_epoch_rejected_after_reclaim(self):
        host = self._client()
        evt = self._create_room(host)
        host.emit('reclaim_room', {
            'room_code': evt['room_code'],
            'host_token': evt['host_token'],
            'host_epoch': evt['host_epoch'],
        })
        new = self._events(host, 'room_reclaimed')[0]['args'][0]
        # New token but the OLD epoch -> stale, must be rejected.
        host.emit('start_game', {
            'room_code': evt['room_code'],
            'host_token': new['host_token'],
            'host_epoch': evt['host_epoch'],  # stale
        })
        self.assertTrue(any('epoch' in m.lower() for m in self._errors(host)))
        self.assertEqual(len(self._events(host, 'game_started')), 0)

    def test_non_host_vehicle_states_not_forwarded(self):
        host = self._client()
        evt = self._create_room(host)
        rc = evt['room_code']
        watcher = self._client()
        watcher.emit('join_game', {'room_code': rc, 'player_name': 'Watcher'})
        watcher.get_received()  # drain join noise

        attacker = self._client()
        attacker.emit('join_game', {'room_code': rc, 'player_name': 'Atk'})
        attacker.get_received()
        # Non-host attempts authoritative state broadcast -> must be dropped.
        attacker.emit('vehicle_states', {'room_code': rc, 'vehicles': [], 'seq': 1})
        self.assertEqual(len(self._events(watcher, 'vehicle_states')), 0)

    def test_malformed_payload_is_rejected_not_crash(self):
        host = self._client()
        self._create_room(host)
        host.emit('start_game', 'not-a-dict')  # malformed
        self.assertTrue(self._errors(host))  # graceful error, server still alive
        # server still responsive:
        host.emit('create_room', {})
        self.assertTrue(self._events(host, 'room_created'))

    def test_rejection_diagnostics_do_not_leak_token(self):
        host = self._client()
        evt = self._create_room(host)
        bogus = 'deadbeef:nonce:badsig'
        host.emit('start_game', {
            'room_code': evt['room_code'],
            'host_token': bogus,
            'host_epoch': evt['host_epoch'],
        })
        msgs = ' '.join(self._errors(host))
        self.assertTrue(msgs)
        self.assertNotIn(evt['host_token'], msgs)  # real token never echoed
        self.assertNotIn(bogus, msgs)              # supplied token never echoed


class TestSeatInputSafety(unittest.TestCase):
    """Seat input ownership + abuse controls (3xv.4), driven end-to-end through
    the real Socket.IO handlers: forged/guessed player ids and viewer/unjoined
    sockets cannot control a seat; non-finite controls are dropped; wire weapon
    ids resolve from a whitelist; names are server-canonicalized; and
    fire/reset/name events are rate-limited. (Viewer read-only is also covered in
    test_socket_routing; here we prove it from the security angle too.)"""

    def setUp(self):
        game_rooms.clear()
        self.clients = []
        _fire_rate_limiter.reset()
        _reset_rate_limiter.reset()
        _name_rate_limiter.reset()

    def tearDown(self):
        for c in self.clients:
            if c.is_connected():
                c.disconnect()
        game_rooms.clear()

    def _client(self):
        c = socketio.test_client(app)
        self.clients.append(c)
        return c

    def _create_room(self, host):
        host.emit('create_room', {})
        evts = [e for e in host.get_received() if e['name'] == 'room_created']
        self.assertEqual(len(evts), 1)
        return evts[0]['args'][0]

    def _join(self, client, room_code, name, **extra):
        payload = {'room_code': room_code, 'player_name': name}
        payload.update(extra)
        client.emit('join_game', payload)
        joined = [e for e in client.get_received() if e['name'] == 'game_joined']
        self.assertEqual(len(joined), 1)
        return joined[0]['args'][0]

    @staticmethod
    def _events(client, name):
        return [e for e in client.get_received() if e['name'] == name]

    # --- spoof closure -------------------------------------------------------
    def test_forged_player_id_cannot_steer_another_seat(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        ca, cb = self._client(), self._client()
        a = self._join(ca, rc, 'Alice')
        b = self._join(cb, rc, 'Bob')
        host.get_received()

        # Alice claims Bob's player_id -> rejected, nothing forwarded.
        ca.emit('player_control_update', {
            'player_id': b['player_id'], 'room_code': rc,
            'controls': {'steering': 1, 'acceleration': 1, 'braking': 0}, 'timestamp': 1,
        })
        self.assertEqual(self._events(host, 'player_controls_update'), [])

        # Alice controlling her OWN seat is forwarded, under Alice's id.
        ca.emit('player_control_update', {
            'player_id': a['player_id'], 'room_code': rc,
            'controls': {'steering': 0.5, 'acceleration': 0.5, 'braking': 0}, 'timestamp': 2,
        })
        fwd = self._events(host, 'player_controls_update')
        self.assertEqual(len(fwd), 1)
        self.assertEqual(fwd[0]['args'][0]['player_id'], a['player_id'])

    def test_unjoined_socket_cannot_send_controls(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        stranger = self._client()  # never joined
        host.get_received()
        stranger.emit('player_control_update', {
            'player_id': 999, 'room_code': rc,
            'controls': {'steering': 1, 'acceleration': 1, 'braking': 0}, 'timestamp': 1,
        })
        self.assertEqual(self._events(host, 'player_controls_update'), [])

    def test_viewer_socket_cannot_send_controls(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        ctrl = self._client()
        a = self._join(ctrl, rc, 'Ada')
        viewer = self._client()
        vj = self._join(viewer, rc, 'Watcher', viewer_only=True)
        self.assertEqual(vj['role'], 'viewer')
        host.get_received()

        viewer.emit('player_control_update', {
            'player_id': a['player_id'], 'room_code': rc,
            'controls': {'steering': 1, 'acceleration': 1, 'braking': 0}, 'timestamp': 1,
        })
        self.assertEqual(self._events(host, 'player_controls_update'), [])
        # The real controller can still drive.
        ctrl.emit('player_control_update', {
            'player_id': a['player_id'], 'room_code': rc,
            'controls': {'steering': 0.2, 'acceleration': 0.2, 'braking': 0}, 'timestamp': 2,
        })
        self.assertEqual(len(self._events(host, 'player_controls_update')), 1)

    # --- malformed controls --------------------------------------------------
    def test_non_finite_controls_are_dropped(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        p = self._client()
        a = self._join(p, rc, 'Nanny')
        host.get_received()

        for bad in ({'steering': float('nan'), 'acceleration': 0, 'braking': 0},
                    {'steering': 0, 'acceleration': float('inf'), 'braking': 0},
                    {'steering': 0, 'acceleration': 0, 'braking': float('-inf')}):
            p.emit('player_control_update', {
                'player_id': a['player_id'], 'room_code': rc, 'controls': bad, 'timestamp': 1,
            })
        self.assertEqual(self._events(host, 'player_controls_update'), [])

        # A finite update still gets through (and clamps).
        p.emit('player_control_update', {
            'player_id': a['player_id'], 'room_code': rc,
            'controls': {'steering': 9, 'acceleration': 0.3, 'braking': 0}, 'timestamp': 2,
        })
        fwd = self._events(host, 'player_controls_update')
        self.assertEqual(len(fwd), 1)
        self.assertEqual(fwd[0]['args'][0]['steering'], 1.0)  # clamped

    # --- weapon whitelist ----------------------------------------------------
    def test_weapon_pickup_unknown_id_dropped_valid_delivered(self):
        host = self._client()
        evt = self._create_room(host)
        rc = evt['room_code']
        p = self._client()
        a = self._join(p, rc, 'Picker')
        p.get_received()

        host.emit('weapon_pickup', {
            'room_code': rc, 'player_id': a['player_id'],
            'host_token': evt['host_token'], 'host_epoch': evt['host_epoch'],
            'weaponId': 'nuke', 'weaponName': 'Nuke', 'icon': 'x',
        })
        self.assertEqual(self._events(p, 'weapon_pickup'), [])

        host.emit('weapon_pickup', {
            'room_code': rc, 'player_id': a['player_id'],
            'host_token': evt['host_token'], 'host_epoch': evt['host_epoch'],
            'weaponId': 'MISSILE', 'weaponName': 'Missile', 'icon': 'm',
        })
        got = self._events(p, 'weapon_pickup')
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]['args'][0]['weaponId'], 'missile')  # canonical

    def test_weapon_fired_unknown_id_dropped(self):
        host = self._client()
        evt = self._create_room(host)
        rc = evt['room_code']
        p = self._client()
        a = self._join(p, rc, 'Fired')
        p.get_received()

        host.emit('weapon_fired', {
            'room_code': rc, 'player_id': a['player_id'],
            'host_token': evt['host_token'], 'host_epoch': evt['host_epoch'],
            'weaponId': 'definitely_not_a_weapon',
        })
        self.assertEqual(self._events(p, 'weapon_fired'), [])

    # --- appearance canonicalization ----------------------------------------
    def test_join_name_is_server_canonicalized(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        p = self._client()
        messy = '  <img src=x>' + ('A' * 40) + '\t\n'
        gj = self._join(p, rc, messy)
        self.assertLessEqual(len(gj['name']), 20)   # capped
        self.assertNotIn('\t', gj['name'])          # control chars stripped
        self.assertNotIn('\n', gj['name'])
        self.assertEqual(gj['name'], gj['name'].strip())

    def test_blank_name_falls_back_to_default(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        p = self._client()
        gj = self._join(p, rc, '   ')
        self.assertTrue(gj['name'])  # non-empty canonical default

    # --- rate limits ---------------------------------------------------------
    def test_fire_is_rate_limited(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        p = self._client()
        self._join(p, rc, 'Spam')
        host.get_received()
        p.emit('weapon_fire', {'room_code': rc})
        p.emit('weapon_fire', {'room_code': rc})  # within 0.1s cooldown
        self.assertEqual(len(self._events(host, 'weapon_fire')), 1)

    def test_car_reset_is_rate_limited(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        p = self._client()
        self._join(p, rc, 'Reset')
        host.get_received()
        p.emit('request_car_reset', {'room_code': rc})
        p.emit('request_car_reset', {'room_code': rc})  # within 1s cooldown
        self.assertEqual(len(self._events(host, 'car_reset_request')), 1)

    def test_name_change_is_rate_limited(self):
        host = self._client()
        rc = self._create_room(host)['room_code']
        p = self._client()
        self._join(p, rc, 'Original')
        p.get_received()
        p.emit('update_player_name', {'name': 'FirstNewName'})
        p.emit('update_player_name', {'name': 'SecondNewName'})  # within 2s cooldown
        successes = [e for e in self._events(p, 'name_updated') if e['args'][0].get('success')]
        self.assertEqual(len(successes), 1)


if __name__ == '__main__':
    unittest.main()
