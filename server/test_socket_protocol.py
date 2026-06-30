import json
import unittest
from pathlib import Path

from server.app import app, game_rooms, socketio


MANIFEST = json.loads(
    (Path(__file__).resolve().parents[1] / 'docs' / 'contracts' / 'socket-protocol-manifest.json')
    .read_text(encoding='utf-8')
)


def manifest_example(example_id):
    for example in MANIFEST['examples']:
        if example['id'] == example_id:
            return example
    raise KeyError(f'Unknown manifest example: {example_id}')


class SocketProtocolTest(unittest.TestCase):
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

    def create_room_event(self, host, topology=None):
        payload = {} if topology is None else {'topology': topology}
        host.emit('create_room', payload)
        events = self.event_named(host, 'room_created')
        self.assertEqual(len(events), 1)
        return events[0]['args'][0]

    def join_event(self, client, room_code, name='Player', **extra):
        payload = {'room_code': room_code, 'player_name': name}
        payload.update(extra)
        client.emit('join_game', payload)
        joined = self.event_named(client, 'game_joined')
        self.assertEqual(len(joined), 1)
        return joined[0]['args'][0]

    def event_named(self, client, name):
        return [event for event in client.get_received() if event['name'] == name]

    def assert_subset(self, actual, expected, keys):
        self.assertEqual({key: actual.get(key) for key in keys}, {key: expected.get(key) for key in keys})

    def get_host_auth(self, room_code):
        """Get current host_token and host_epoch for a room."""
        room = game_rooms[room_code]
        return room['host_token'], room['host_epoch']

    def test_remote_and_mixed_join_shapes_match_manifest_examples(self):
        remote_example = manifest_example('remote-driver-viewer-join')['messages'][0]['payload']
        mixed_example = manifest_example('mixed-rendering-join')['messages'][0]['payload']

        remote_host = self.make_client()
        remote_player = self.make_client()
        remote_room = self.create_room_event(remote_host, topology='remote')['room_code']
        remote_joined = self.join_event(remote_player, remote_room, 'Remote1')
        self.assert_subset(remote_joined, remote_example, ('mode', 'topology', 'role', 'roles'))

        mixed_host = self.make_client()
        mixed_player = self.make_client()
        mixed_room = self.create_room_event(mixed_host, topology='mixed')['room_code']
        mixed_joined = self.join_event(mixed_player, mixed_room, 'MixedView', can_render=True)
        self.assert_subset(mixed_joined, mixed_example, ('mode', 'topology', 'role', 'roles'))

    def test_late_join_matches_manifest_shape(self):
        late_example = manifest_example('late-join-racing')['messages'][0]['payload']
        host = self.make_client()
        early = self.make_client()
        late = self.make_client()

        room_code = self.create_room_event(host)['room_code']
        token, epoch = self.get_host_auth(room_code)
        self.join_event(early, room_code, 'EarlyBird')
        host.get_received()
        early.get_received()

        host.emit('start_game', {'room_code': room_code, 'host_token': token, 'host_epoch': epoch})
        self.assertEqual(game_rooms[room_code]['game_state'], 'racing')

        joined = self.join_event(late, room_code, 'LateJoiner')
        self.assert_subset(joined, late_example, ('game_state', 'is_late_join', 'mode', 'topology', 'role', 'roles'))

    def test_duplicate_tab_takeover_reuses_same_room_seat_identity(self):
        host = self.make_client()
        first_tab = self.make_client()
        second_tab = self.make_client()
        room_code = self.create_room_event(host)['room_code']

        initial = self.join_event(first_tab, room_code, 'Reloaded')
        seat_id = initial['player_id']

        host.get_received()
        first_tab.get_received()

        second = self.join_event(second_tab, room_code, 'Reloaded', reconnect_id=seat_id)
        self.assertEqual(second['player_id'], seat_id)
        self.assertEqual(len(game_rooms[room_code]['players']), 1)

        host_events = host.get_received()
        left = [event for event in host_events if event['name'] == 'player_left']
        joined = [event for event in host_events if event['name'] == 'player_joined']
        self.assertEqual(len(left), 1)
        self.assertEqual(len(joined), 1)
        self.assertEqual(left[0]['args'][0]['player_id'], seat_id)
        self.assertFalse(left[0]['args'][0]['can_reconnect'])
        self.assertEqual(joined[0]['args'][0]['id'], seat_id)

    def test_spoofed_controller_input_is_dropped_but_authorized_input_forwards_with_seq(self):
        host = self.make_client()
        victim = self.make_client()
        attacker = self.make_client()

        room_code = self.create_room_event(host)['room_code']
        victim_joined = self.join_event(victim, room_code, 'Victim')
        attacker_joined = self.join_event(attacker, room_code, 'Attacker')
        self.assertNotEqual(victim_joined['player_id'], attacker_joined['player_id'])

        host.get_received()
        victim.get_received()
        attacker.get_received()

        attacker.emit('player_control_update', {
            'room_code': room_code,
            'player_id': victim_joined['player_id'],
            'seq': 41,
            'timestamp': 1000,
            'controls': {
                'steering': 0.8,
                'acceleration': 1,
                'braking': 0
            }
        })
        self.assertEqual(self.event_named(host, 'player_controls_update'), [])

        victim.emit('player_control_update', {
            'room_code': room_code,
            'player_id': victim_joined['player_id'],
            'seq': 42,
            'timestamp': 1001,
            'controls': {
                'steering': 2,
                'acceleration': 3,
                'braking': -1
            }
        })
        forwarded = self.event_named(host, 'player_controls_update')
        self.assertEqual(len(forwarded), 1)
        self.assertEqual(forwarded[0]['args'][0], {
            'player_id': victim_joined['player_id'],
            'steering': 1.0,
            'acceleration': 1.0,
            'braking': 0.0,
            'timestamp': 1001,
            'seq': 42
        })

    def test_vehicle_states_require_host_sender_and_echo_seq(self):
        example = manifest_example('remote-viewer-state')['messages'][0]['payload']
        host = self.make_client()
        viewer = self.make_client()

        room_code = self.create_room_event(host, topology='remote')['room_code']
        token, epoch = self.get_host_auth(room_code)
        self.join_event(viewer, room_code, 'RemoteViewer')
        host.get_received()
        viewer.get_received()

        viewer.emit('vehicle_states', {
            'room_code': room_code,
            'seq': example['seq'],
            'vehicles': example['vehicles']
        })
        self.assertEqual(self.event_named(viewer, 'vehicle_states_update'), [])
        self.assertEqual(self.event_named(host, 'vehicle_states_update'), [])

        host.emit('vehicle_states', {
            'room_code': room_code,
            'seq': example['seq'],
            'vehicles': example['vehicles'],
            'host_token': token,
            'host_epoch': epoch
        })
        updates = self.event_named(viewer, 'vehicle_states_update')
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]['args'][0], {
            'room_code': room_code,
            'seq': example['seq'],
            'vehicles': example['vehicles']
        })

    def test_end_game_broadcasts_race_results_and_marks_room_finished(self):
        example = manifest_example('race-results')['messages'][0]['payload']
        host = self.make_client()
        player = self.make_client()

        room_code = self.create_room_event(host)['room_code']
        token, epoch = self.get_host_auth(room_code)
        self.join_event(player, room_code, 'Finisher')
        host.get_received()
        player.get_received()

        payload = dict(example)
        payload['room_code'] = room_code
        payload['host_token'] = token
        payload['host_epoch'] = epoch
        host.emit('end_game', payload)

        self.assertEqual(game_rooms[room_code]['game_state'], 'finished')
        game_end = self.event_named(player, 'game_end')
        self.assertEqual(len(game_end), 1)
        self.assertEqual(game_end[0]['args'][0], {
            'room_code': room_code,
            'mode': 'race',
            'topology': 'local',
            'seq': example['seq'],
            'results': example['results']
        })

    def test_end_game_broadcasts_derby_results_for_derby_rooms(self):
        example = manifest_example('derby-results')['messages'][0]['payload']
        host = self.make_client()
        player = self.make_client()

        room_code = self.create_room_event(host, topology='remote')['room_code']
        token, epoch = self.get_host_auth(room_code)
        self.join_event(player, room_code, 'DerbyFinisher')
        host.get_received()
        player.get_received()

        host.emit('mode_selected', {'room_code': room_code, 'mode': 'derby', 'host_token': token, 'host_epoch': epoch})
        host.get_received()
        player.get_received()

        payload = dict(example)
        payload['room_code'] = room_code
        payload['host_token'] = token
        payload['host_epoch'] = epoch
        host.emit('end_game', payload)

        self.assertEqual(game_rooms[room_code]['game_state'], 'finished')
        game_end = self.event_named(player, 'game_end')
        self.assertEqual(len(game_end), 1)
        self.assertEqual(game_end[0]['args'][0], {
            'room_code': room_code,
            'mode': 'derby',
            'topology': 'remote',
            'seq': example['seq'],
            'results': example['results']
        })

    def test_invalid_or_unauthorized_results_are_rejected(self):
        host = self.make_client()
        player = self.make_client()

        room_code = self.create_room_event(host)['room_code']
        token, epoch = self.get_host_auth(room_code)
        self.join_event(player, room_code, 'Viewer')
        host.get_received()
        player.get_received()

        player.emit('end_game', {'room_code': room_code, 'results': []})
        player_errors = self.event_named(player, 'error')
        self.assertEqual(len(player_errors), 1)
        self.assertIn('host', player_errors[0]['args'][0]['message'].lower())
        self.assertEqual(self.event_named(player, 'game_end'), [])
        self.assertEqual(game_rooms[room_code]['game_state'], 'waiting')

        host.emit('end_game', {'room_code': room_code, 'results': {}, 'host_token': token, 'host_epoch': epoch})
        host_errors = self.event_named(host, 'error')
        self.assertEqual(len(host_errors), 1)
        self.assertEqual(host_errors[0]['args'][0]['message'], 'Invalid results payload')
        self.assertEqual(game_rooms[room_code]['game_state'], 'waiting')

    def test_host_disconnect_broadcasts_host_loss_and_closes_room(self):
        host = self.make_client()
        player = self.make_client()

        room_code = self.create_room_event(host)['room_code']
        self.join_event(player, room_code, 'Stranded')
        player.get_received()

        host.disconnect()
        events = self.event_named(player, 'host_disconnected')
        self.assertEqual(len(events), 1)
        self.assertNotIn(room_code, game_rooms)


if __name__ == '__main__':
    unittest.main()
