import unittest

from server.app import app, game_rooms, socketio
from server.session_vocabulary import (
    TOPOLOGY_LOCAL, TOPOLOGY_REMOTE, TOPOLOGY_MIXED, DEFAULT_TOPOLOGY,
    RULESET_RACE, RULESET_DERBY,
    ROLE_HOST, ROLE_CONTROLLER, ROLE_VIEWER, ROLE_SPECTATOR,
    participant_roles, primary_role,
)


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

    def create_room_event(self, host, topology=None):
        payload = {} if topology is None else {'topology': topology}
        host.emit('create_room', payload)
        room_events = [event for event in host.get_received() if event['name'] == 'room_created']
        self.assertEqual(len(room_events), 1)
        return room_events[0]['args'][0]

    def create_room(self, host, topology=None):
        return self.create_room_event(host, topology)['room_code']

    def join_player(self, client, room_code, name, **extra):
        payload = {'room_code': room_code, 'player_name': name}
        payload.update(extra)
        client.emit('join_game', payload)
        joined = [event for event in client.get_received() if event['name'] == 'game_joined']
        self.assertEqual(len(joined), 1)
        return joined[0]['args'][0]['player_id']

    def join_player_event(self, client, room_code, name, **extra):
        payload = {'room_code': room_code, 'player_name': name}
        payload.update(extra)
        client.emit('join_game', payload)
        joined = [event for event in client.get_received() if event['name'] == 'game_joined']
        self.assertEqual(len(joined), 1)
        return joined[0]['args'][0]

    def event_named(self, client, name):
        return [event for event in client.get_received() if event['name'] == name]

    def get_host_auth(self, room_code):
        """Get current host_token and host_epoch for a room."""
        room = game_rooms[room_code]
        return room['host_token'], room['host_epoch']

    def test_player_controls_forward_to_host_only_and_are_clamped(self):
        host = self.make_client()
        player = self.make_client()
        other_player = self.make_client()

        room_code = self.create_room(host)
        player_join = self.join_player_event(player, room_code, 'RoutingOne')
        player_id = player_join['player_id']
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
            'seat_id': player_join['seat_id'],
            'lease_version': player_join['lease_version'],
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

    def test_duplicate_controller_takeover_rejects_stale_input_and_preserves_player_id(self):
        host = self.make_client()
        player_a = self.make_client()
        player_b = self.make_client()

        room_code = self.create_room(host)
        first_join = self.join_player_event(
            player_a,
            room_code,
            'SeatOwner',
            client_instance_id='tab-a',
        )
        seat_token = first_join['seat_token']
        host.get_received()

        player_b.emit('join_game', {
            'room_code': room_code,
            'player_name': 'SeatOwner clone',
            'seat_token': seat_token,
            'client_instance_id': 'tab-b',
        })
        prompt_events = self.event_named(player_b, 'controller_takeover_required')
        self.assertEqual(len(prompt_events), 1)
        self.assertEqual(prompt_events[0]['args'][0]['player_id'], first_join['player_id'])

        player_b.emit('confirm_controller_takeover', {
            'room_code': room_code,
            'seat_token': seat_token,
            'client_instance_id': 'tab-b',
        })
        second_join = self.event_named(player_b, 'game_joined')[0]['args'][0]
        self.assertEqual(second_join['player_id'], first_join['player_id'])
        self.assertEqual(second_join['seat_id'], first_join['seat_id'])
        self.assertEqual(second_join['lease_version'], first_join['lease_version'] + 1)

        takeover_notice = self.event_named(player_a, 'seat_taken_over')
        self.assertEqual(len(takeover_notice), 1)

        host.get_received()
        player_a.emit('player_control_update', {
            'player_id': first_join['player_id'],
            'room_code': room_code,
            'lease_version': first_join['lease_version'],
            'client_instance_id': 'tab-a',
            'controls': {
                'steering': 0.75,
                'acceleration': 1,
                'braking': 0,
            },
            'timestamp': 100,
        })
        player_b.emit('player_control_update', {
            'player_id': second_join['player_id'],
            'room_code': room_code,
            'lease_version': second_join['lease_version'],
            'client_instance_id': 'tab-b',
            'controls': {
                'steering': -0.4,
                'acceleration': 0.5,
                'braking': 0.2,
            },
            'timestamp': 101,
        })

        host_updates = self.event_named(host, 'player_controls_update')
        self.assertEqual(len(host_updates), 1)
        self.assertEqual(host_updates[0]['args'][0]['player_id'], first_join['player_id'])
        self.assertEqual(host_updates[0]['args'][0]['seat_id'], first_join['seat_id'])
        self.assertEqual(host_updates[0]['args'][0]['lease_version'], second_join['lease_version'])
        self.assertEqual(host_updates[0]['args'][0]['timestamp'], 101)

    def test_viewer_duplicate_is_read_only_and_keeps_controller_live(self):
        host = self.make_client()
        controller = self.make_client()
        viewer = self.make_client()

        room_code = self.create_room(host)
        controller_join = self.join_player_event(
            controller,
            room_code,
            'SharedSeat',
            client_instance_id='tab-a',
        )
        viewer_join = self.join_player_event(
            viewer,
            room_code,
            'ViewerSeat',
            seat_token=controller_join['seat_token'],
            viewer_only=True,
            role='viewer',
            can_render=True,
        )

        self.assertEqual(viewer_join['role'], 'viewer')
        host.get_received()

        viewer.emit('player_control_update', {
            'player_id': controller_join['player_id'],
            'room_code': room_code,
            'lease_version': controller_join['lease_version'],
            'controls': {
                'steering': 1,
                'acceleration': 1,
                'braking': 0,
            },
            'timestamp': 200,
        })
        controller.emit('player_control_update', {
            'player_id': controller_join['player_id'],
            'room_code': room_code,
            'lease_version': controller_join['lease_version'],
            'client_instance_id': 'tab-a',
            'controls': {
                'steering': 0.25,
                'acceleration': 1,
                'braking': 0,
            },
            'timestamp': 201,
        })

        host_updates = self.event_named(host, 'player_controls_update')
        self.assertEqual(len(host_updates), 1)
        self.assertEqual(host_updates[0]['args'][0]['timestamp'], 201)

    def test_host_disconnect_enters_grace_and_reclaim_restores_room(self):
        host = self.make_client()
        player = self.make_client()

        create_event = self.create_room_event(host)
        room_code = create_event['room_code']
        token = create_event['host_token']
        epoch = create_event['host_epoch']
        self.join_player(player, room_code, 'GraceDriver')
        host.get_received()
        player.get_received()

        host.emit('start_game', {
            'room_code': room_code,
            'host_token': token,
            'host_epoch': epoch,
        })
        host.get_received()
        player.get_received()

        host.disconnect()

        self.assertIn(room_code, game_rooms)
        self.assertEqual(game_rooms[room_code]['phase'], 'host_lost')
        host_loss_events = self.event_named(player, 'host_disconnected')
        self.assertEqual(len(host_loss_events), 1)
        self.assertEqual(host_loss_events[0]['args'][0]['phase'], 'host_lost')
        self.assertIn('grace_seconds', host_loss_events[0]['args'][0])

        reclaimed_host = self.make_client()
        reclaimed_host.emit('reclaim_room', {
            'room_code': room_code,
            'host_token': token,
        })
        reclaimed_events = self.event_named(reclaimed_host, 'room_reclaimed')
        self.assertEqual(len(reclaimed_events), 1)
        self.assertEqual(reclaimed_events[0]['args'][0]['phase'], 'active')
        self.assertEqual(game_rooms[room_code]['phase'], 'active')
        self.assertEqual(game_rooms[room_code]['host_epoch'], epoch + 1)

        room_phase_events = self.event_named(player, 'room_phase')
        self.assertTrue(any(event['args'][0]['phase'] == 'active' for event in room_phase_events))


class RoomTopologyTest(unittest.TestCase):
    """Topology is a first-class ROOM axis, orthogonal to ruleset and roles."""

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
        events = [e for e in host.get_received() if e['name'] == 'room_created']
        self.assertEqual(len(events), 1)
        return events[0]['args'][0]

    def join_event(self, client, room_code, name='Player', **extra):
        payload = {'room_code': room_code, 'player_name': name}
        payload.update(extra)
        client.emit('join_game', payload)
        joined = [e for e in client.get_received() if e['name'] == 'game_joined']
        self.assertEqual(len(joined), 1)
        return joined[0]['args'][0]

    def test_default_room_is_local(self):
        host = self.make_client()
        event = self.create_room_event(host)
        self.assertEqual(event['topology'], TOPOLOGY_LOCAL)
        self.assertEqual(game_rooms[event['room_code']]['topology'], DEFAULT_TOPOLOGY)
        self.assertEqual(DEFAULT_TOPOLOGY, TOPOLOGY_LOCAL)

    def test_explicit_remote_topology_is_stored_and_echoed(self):
        host = self.make_client()
        event = self.create_room_event(host, topology=TOPOLOGY_REMOTE)
        self.assertEqual(event['topology'], TOPOLOGY_REMOTE)
        self.assertEqual(game_rooms[event['room_code']]['topology'], TOPOLOGY_REMOTE)

    def test_invalid_topology_falls_back_to_local(self):
        host = self.make_client()
        event = self.create_room_event(host, topology='nonsense')
        # A bad client hint must never break the Local path.
        self.assertEqual(event['topology'], TOPOLOGY_LOCAL)
        self.assertEqual(game_rooms[event['room_code']]['topology'], TOPOLOGY_LOCAL)

    def test_topology_is_independent_of_ruleset(self):
        """Selecting the derby ruleset leaves the room's topology untouched."""
        host = self.make_client()
        create_event = self.create_room_event(host)
        room_code = create_event['room_code']
        token = create_event['host_token']
        epoch = create_event['host_epoch']
        host.get_received()

        host.emit('mode_selected', {'room_code': room_code, 'mode': RULESET_DERBY, 'host_token': token, 'host_epoch': epoch})

        room = game_rooms[room_code]
        self.assertEqual(room['mode'], RULESET_DERBY)        # ruleset axis
        self.assertEqual(room['topology'], TOPOLOGY_LOCAL)   # topology axis unchanged
        # The two axes are distinct keys, never overloaded onto one field.
        self.assertNotEqual(room['mode'], room['topology'])

    def test_local_join_carries_topology_and_controller_role(self):
        host = self.make_client()
        player = self.make_client()
        room_code = self.create_room_event(host)['room_code']

        joined = self.join_event(player, room_code, 'Couch1')
        self.assertEqual(joined['topology'], TOPOLOGY_LOCAL)
        # Regression guard: Local phones are controllers (input + HUD only).
        self.assertEqual(joined['role'], ROLE_CONTROLLER)
        self.assertEqual(joined['roles'], [ROLE_CONTROLLER])
        self.assertNotIn(ROLE_VIEWER, joined['roles'])  # phones never render
        # Ruleset still defaults to race and is reported separately from topology.
        self.assertEqual(joined['mode'], RULESET_RACE)

    def test_local_join_ignores_can_render_hint(self):
        """LOCAL ARCHITECTURE GUARD: even a client claiming it can render stays
        a controller/HUD-only participant; only the host renders the world."""
        host = self.make_client()
        player = self.make_client()
        room_code = self.create_room_event(host)['room_code']

        joined = self.join_event(player, room_code, 'RogueLocal', can_render=True)
        self.assertEqual(joined['topology'], TOPOLOGY_LOCAL)
        self.assertEqual(joined['roles'], [ROLE_CONTROLLER])
        self.assertNotIn(ROLE_VIEWER, joined['roles'])

    def test_remote_join_is_driver_viewer(self):
        """Remote does not collapse to a single viewer role: a remote player is
        a driver-viewer (controller + viewer)."""
        host = self.make_client()
        player = self.make_client()
        room_code = self.create_room_event(host, topology=TOPOLOGY_REMOTE)['room_code']

        joined = self.join_event(player, room_code, 'Remote1')
        self.assertEqual(joined['topology'], TOPOLOGY_REMOTE)
        self.assertEqual(joined['roles'], [ROLE_CONTROLLER, ROLE_VIEWER])
        self.assertEqual(joined['role'], ROLE_CONTROLLER)  # primary = drives

    def test_mixed_join_defaults_to_local_style_controller(self):
        """Mixed includes Local-style controller/HUD-only participants: a
        joiner that does not declare can_render is controller-only."""
        host = self.make_client()
        player = self.make_client()
        room_code = self.create_room_event(host, topology=TOPOLOGY_MIXED)['room_code']

        joined = self.join_event(player, room_code, 'MixedCouch')
        self.assertEqual(joined['topology'], TOPOLOGY_MIXED)
        self.assertEqual(joined['roles'], [ROLE_CONTROLLER])

    def test_mixed_join_with_can_render_is_driver_viewer(self):
        host = self.make_client()
        player = self.make_client()
        room_code = self.create_room_event(host, topology=TOPOLOGY_MIXED)['room_code']

        joined = self.join_event(player, room_code, 'MixedRemote', can_render=True)
        self.assertEqual(joined['topology'], TOPOLOGY_MIXED)
        self.assertEqual(joined['roles'], [ROLE_CONTROLLER, ROLE_VIEWER])

    def test_role_capability_combinations(self):
        """The role contract supports combined capabilities (host-driver,
        driver-viewer) instead of one collapsed role per topology."""
        # Local: host renders the shared world and is NOT a driver; phones drive.
        self.assertEqual(participant_roles(TOPOLOGY_LOCAL, is_host=True), [ROLE_HOST])
        self.assertEqual(participant_roles(TOPOLOGY_LOCAL), [ROLE_CONTROLLER])
        # Remote: host-as-player => host-driver; players => driver-viewer.
        self.assertEqual(
            participant_roles(TOPOLOGY_REMOTE, is_host=True),
            [ROLE_HOST, ROLE_CONTROLLER, ROLE_VIEWER],
        )
        self.assertEqual(
            participant_roles(TOPOLOGY_REMOTE),
            [ROLE_CONTROLLER, ROLE_VIEWER],
        )
        # Mixed: co-located controller vs rendering driver-viewer.
        self.assertEqual(participant_roles(TOPOLOGY_MIXED), [ROLE_CONTROLLER])
        self.assertEqual(
            participant_roles(TOPOLOGY_MIXED, can_render=True),
            [ROLE_CONTROLLER, ROLE_VIEWER],
        )
        # Spectators own no car; they render only where participants render.
        self.assertEqual(participant_roles(TOPOLOGY_REMOTE, is_spectator=True), [ROLE_VIEWER])
        self.assertEqual(participant_roles(TOPOLOGY_LOCAL, is_spectator=True), [])
        # Primary role precedence: host > controller > viewer.
        self.assertEqual(primary_role(TOPOLOGY_REMOTE, is_host=True), ROLE_HOST)
        self.assertEqual(primary_role(TOPOLOGY_REMOTE), ROLE_CONTROLLER)
        self.assertEqual(primary_role(TOPOLOGY_REMOTE, is_spectator=True), ROLE_VIEWER)

    def test_reclaim_missing_room_defaults_to_local(self):
        host = self.make_client()
        # Create a dummy room to get a valid token for reclaim (simulating token from earlier session)
        dummy_host = self.make_client()
        token_event = self.create_room_event(dummy_host)
        dummy_token = token_event['host_token']
        dummy_host.disconnect()

        # Reclaim a missing room with a valid token
        host.emit('reclaim_room', {'room_code': 'ZZZZ', 'host_token': dummy_token})
        events = [e for e in host.get_received() if e['name'] == 'room_reclaimed']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['args'][0]['topology'], TOPOLOGY_LOCAL)
        self.assertEqual(game_rooms['ZZZZ']['topology'], TOPOLOGY_LOCAL)

    def test_reclaim_existing_room_preserves_topology_during_host_loss_grace(self):
        host = self.make_client()
        create_event = self.create_room_event(host, topology=TOPOLOGY_REMOTE)
        room_code = create_event['room_code']
        token = create_event['host_token']
        host.get_received()

        host.disconnect()
        self.assertIn(room_code, game_rooms)
        self.assertEqual(game_rooms[room_code]['phase'], 'host_lost')

        # Reconnect and reclaim with valid token while the room is still in grace.
        host2 = self.make_client()
        host2.emit('reclaim_room', {'room_code': room_code, 'host_token': token, 'topology': TOPOLOGY_REMOTE})
        events = [e for e in host2.get_received() if e['name'] == 'room_reclaimed']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['args'][0]['topology'], TOPOLOGY_REMOTE)
        self.assertEqual(game_rooms[room_code]['topology'], TOPOLOGY_REMOTE)


if __name__ == '__main__':
    unittest.main()
