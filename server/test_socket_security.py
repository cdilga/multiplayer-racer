"""
Host Capability Token and Socket Security Tests
"""

import unittest
import time
from unittest.mock import patch, MagicMock
try:
    from app import app, game_rooms, _generate_host_token, _verify_host_token, _check_host_authority, _new_room_state
except ImportError:
    from server.app import app, game_rooms, _generate_host_token, _verify_host_token, _check_host_authority, _new_room_state


class TestHostCapabilityTokens(unittest.TestCase):
    """Test host token generation, verification, and authority checks."""

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
        token = _generate_host_token()
        self.assertTrue(_verify_host_token(token))

    def test_token_verification_invalid_format(self):
        """Malformed token should fail verification."""
        self.assertFalse(_verify_host_token(''))
        self.assertFalse(_verify_host_token('invalid'))
        self.assertFalse(_verify_host_token('1:2'))
        self.assertFalse(_verify_host_token('1:2:3:4'))

    def test_token_verification_expired(self):
        """Expired token should fail verification."""
        timestamp = int(time.time()) - 7200  # 2 hours ago
        nonce = 'test'
        import hmac
        import hashlib
        message = f"{timestamp}:{nonce}".encode()
        secret = app.config['SECRET_KEY'].encode()
        signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
        expired_token = f"{timestamp}:{nonce}:{signature}"

        self.assertFalse(_verify_host_token(expired_token, max_age_seconds=3600))

    def test_check_host_authority_valid(self):
        """Valid host authority check should return True."""
        room_code = 'TEST'
        room_state = _new_room_state('host_sid_123')
        game_rooms[room_code] = room_state

        with patch('server.app.request') as mock_request:
            mock_request.sid = 'host_sid_123'
            is_valid, msg = _check_host_authority(room_code, room_state['host_token'], room_state['host_epoch'])
            self.assertTrue(is_valid)
            self.assertIsNone(msg)

    def test_check_host_authority_invalid_sid(self):
        """Wrong socket ID should fail authority check."""
        room_code = 'TEST'
        room_state = _new_room_state('host_sid_123')
        game_rooms[room_code] = room_state

        with patch('server.app.request') as mock_request:
            mock_request.sid = 'attacker_sid_456'
            is_valid, msg = _check_host_authority(room_code, room_state['host_token'], room_state['host_epoch'])
            self.assertFalse(is_valid)
            self.assertIn('Not the current host', msg)

    def test_check_host_authority_invalid_token(self):
        """Wrong token should fail authority check."""
        room_code = 'TEST'
        room_state = _new_room_state('host_sid_123')
        game_rooms[room_code] = room_state

        with patch('server.app.request') as mock_request:
            mock_request.sid = 'host_sid_123'
            is_valid, msg = _check_host_authority(room_code, 'wrong_token', room_state['host_epoch'])
            self.assertFalse(is_valid)
            self.assertIn('mismatch', msg.lower())

    def test_check_host_authority_stale_epoch(self):
        """Stale epoch should fail authority check (prevents old reclaim events)."""
        room_code = 'TEST'
        room_state = _new_room_state('host_sid_123')
        game_rooms[room_code] = room_state
        old_epoch = room_state['host_epoch'] - 1

        with patch('server.app.request') as mock_request:
            mock_request.sid = 'host_sid_123'
            is_valid, msg = _check_host_authority(room_code, room_state['host_token'], old_epoch)
            self.assertFalse(is_valid)
            self.assertIn('Stale host epoch', msg)

    def test_check_host_authority_missing_room(self):
        """Missing room should fail authority check."""
        with patch('server.app.request') as mock_request:
            mock_request.sid = 'host_sid_123'
            is_valid, msg = _check_host_authority('NONEXISTENT', 'token', 1)
            self.assertFalse(is_valid)
            self.assertIn('not found', msg.lower())


if __name__ == '__main__':
    unittest.main()
