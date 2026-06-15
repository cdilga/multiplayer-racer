import unittest

from server.app import app, game_rooms, socketio


class SocketRoutingTest(unittest.TestCase):
    def setUp(self):
        game_rooms.clear()
        self.clients = []

    def tearDown(self):
        for client in self.clients:
            if client.is_connected():
                client.disconnect()
        game_rooms.clear()

    def make_client(self):
        client = socketio.test_client(app)
        self.clients.append(client)
        return client

    def create_room(self, host):
        host.emit('create_room')
        room_events = [event for event in host.get_received() if event['name'] == 'room_created']
        self.assertEqual(len(room_events), 1)
        return room_events[0]['args'][0]['room_code']

    def join_player(self, client, room_code, name):
        client.emit('join_game', {'room_code': room_code, 'player_name': name})
        joined = [event for event in client.get_received() if event['name'] == 'game_joined']
        self.assertEqual(len(joined), 1)
        return joined[0]['args'][0]['player_id']

    def event_named(self, client, name):
        return [event for event in client.get_received() if event['name'] == name]

    def test_player_controls_forward_to_host_only_and_are_clamped(self):
        host = self.make_client()
        player = self.make_client()
        other_player = self.make_client()

        room_code = self.create_room(host)
        player_id = self.join_player(player, room_code, 'RoutingOne')
        self.join_player(other_player, room_code, 'RoutingTwo')

        # Drain lobby join notifications before the control assertion.
        host.get_received()
        player.get_received()
        other_player.get_received()

        player.emit('player_control_update', {
            'player_id': player_id,
            'room_code': room_code,
            'controls': {
                'steering': 2,
                'acceleration': 3,
                'braking': -1
            },
            'timestamp': 123456
        })

        host_updates = self.event_named(host, 'player_controls_update')
        player_updates = self.event_named(player, 'player_controls_update')
        other_updates = self.event_named(other_player, 'player_controls_update')

        self.assertEqual(len(host_updates), 1)
        self.assertEqual(player_updates, [])
        self.assertEqual(other_updates, [])
        self.assertEqual(host_updates[0]['args'][0], {
            'player_id': player_id,
            'steering': 1.0,
            'acceleration': 1.0,
            'braking': 0.0,
            'timestamp': 123456
        })

    def test_player_controls_for_unknown_room_are_ignored(self):
        host = self.make_client()
        player = self.make_client()

        self.create_room(host)
        host.get_received()

        player.emit('player_control_update', {
            'player_id': 99,
            'room_code': 'NOPE',
            'controls': {
                'steering': 0.5,
                'acceleration': 1,
                'braking': 0
            },
            'timestamp': 123456
        })

        self.assertEqual(self.event_named(host, 'player_controls_update'), [])


if __name__ == '__main__':
    unittest.main()
