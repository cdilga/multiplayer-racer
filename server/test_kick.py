"""Tests for host-authoritative kick seat removal (br-kick-car).

The full host-auth socket loop (kick -> despawn -> phone bounced -> seat reusable)
is covered behaviorally by tests/e2e/kick-car.spec.ts; these pin the pure
seat-removal semantics.
"""

import unittest

from server import room_seats


def _make_room_with_seat(code='KICK', player_name='Victim', sid='sid-victim'):
    room = room_seats.new_room_state(code, 'host-sid', 'host-token')
    join = room_seats.join_seat(room, sid, player_name=player_name)
    return room, join


class KickSeatTest(unittest.TestCase):
    def test_kick_seat_removes_the_seat_and_returns_the_sid(self):
        room, join = _make_room_with_seat()
        seat_id = join['seat']['seat_id']
        self.assertIn(seat_id, room['seats'])

        result = room_seats.kick_seat(room, seat_id)
        self.assertEqual(result['status'], 'kicked')
        self.assertEqual(result['kicked_sid'], 'sid-victim')
        # Seat fully removed -> id is free again (re-joinable), no ghost binding.
        self.assertNotIn(seat_id, room['seats'])
        self.assertNotIn('sid-victim', room.get('sid_index', {}))

    def test_kick_seat_missing_player_is_a_noop(self):
        room, _ = _make_room_with_seat()
        self.assertEqual(room_seats.kick_seat(room, 9999)['status'], 'missing')

    def test_kicked_seat_id_is_reusable_with_no_ghost(self):
        room, join = _make_room_with_seat()
        seat_id = join['seat']['seat_id']
        room_seats.kick_seat(room, seat_id)
        # A fresh join reuses the freed slot with no duplicate seat left behind.
        room_seats.join_seat(room, 'sid-new', player_name='Fresh')
        names = sorted(s['appearance']['name'] for s in room['seats'].values())
        self.assertEqual(names, ['Fresh'])


if __name__ == '__main__':
    unittest.main()
