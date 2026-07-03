import json
import unittest
from unittest.mock import patch

from server.app import app, game_rooms, server_telemetry, socketio
from server.telemetry import ServerTelemetry


class ServerTelemetryTest(unittest.TestCase):
    def setUp(self):
        game_rooms.clear()
        server_telemetry.clear()
        self.clients = []
        self.client = app.test_client()
        self._original_propagate = app.config.get('PROPAGATE_EXCEPTIONS')
        app.config['PROPAGATE_EXCEPTIONS'] = False

    def tearDown(self):
        for client in self.clients:
            if client.is_connected():
                client.disconnect()
        game_rooms.clear()
        server_telemetry.clear()
        app.config['PROPAGATE_EXCEPTIONS'] = self._original_propagate

    def make_socket_client(self):
        client = socketio.test_client(app)
        self.clients.append(client)
        return client

    def create_room_event(self, host):
        host.emit('create_room', {})
        events = [event for event in host.get_received() if event['name'] == 'room_created']
        self.assertEqual(len(events), 1)
        return events[0]['args'][0]

    def join_player_event(self, client, room_code, name, **extra):
        payload = {'room_code': room_code, 'player_name': name}
        payload.update(extra)
        client.emit('join_game', payload)
        events = [event for event in client.get_received() if event['name'] == 'game_joined']
        self.assertEqual(len(events), 1)
        return events[0]['args'][0]

    def telemetry_events(self, event_name=None):
        if event_name is None:
            return list(server_telemetry.queue)
        return [event for event in server_telemetry.queue if event['eventName'] == event_name]

    def test_room_lifecycle_and_game_events_share_correlation(self):
        host = self.make_socket_client()
        player = self.make_socket_client()

        create_event = self.create_room_event(host)
        room_code = create_event['room_code']
        room = game_rooms[room_code]

        join_event = self.join_player_event(player, room_code, 'TelemetryRider', client_instance_id='telemetry-a')
        room_created = self.telemetry_events('server:room:created')[-1]
        player_joined = self.telemetry_events('server:player:joined')[-1]

        self.assertEqual(room_created['roomAnalyticsId'], room['room_analytics_id'])
        self.assertEqual(player_joined['roomAnalyticsId'], room['room_analytics_id'])
        self.assertEqual(player_joined['playerAnalyticsId'], room['seats'][join_event['seat_id']]['player_analytics_id'])
        self.assertNotIn(room_code, json.dumps(room_created))

        host.emit('start_game', {
            'room_code': room_code,
            'host_token': create_event['host_token'],
            'host_epoch': create_event['host_epoch'],
        })
        game_started = self.telemetry_events('server:game:started')[-1]
        self.assertEqual(game_started['roomAnalyticsId'], room['room_analytics_id'])
        self.assertEqual(game_started['matchId'], room['match_id'])
        self.assertNotEqual(game_started['matchId'], 'match-unknown')

        host.emit('end_game', {
            'room_code': room_code,
            'host_token': create_event['host_token'],
            'host_epoch': create_event['host_epoch'],
            'results': [{'position': 1, 'playerId': join_event['player_id']}],
        })
        game_ended = self.telemetry_events('server:game:ended')[-1]
        self.assertEqual(game_ended['roomAnalyticsId'], room['room_analytics_id'])
        self.assertEqual(game_ended['matchId'], game_started['matchId'])
        self.assertEqual(game_ended['properties']['resultsCount'], 1)

    def test_join_failure_and_reconnect_are_sanitized(self):
        bad_player = self.make_socket_client()
        bad_player.emit('join_game', {'room_code': 'NOPE', 'player_name': 'Alice'})
        join_error = [event for event in bad_player.get_received() if event['name'] == 'join_error']
        self.assertEqual(len(join_error), 1)

        failed = self.telemetry_events('server:player:join_failed')[-1]
        failed_json = json.dumps(failed)
        self.assertEqual(failed['properties']['bucket'], 'invalid_room_code')
        self.assertEqual(failed['roomAnalyticsId'], 'room-unknown')
        self.assertNotIn('NOPE', failed_json)
        self.assertNotIn('Alice', failed_json)

        host = self.make_socket_client()
        player = self.make_socket_client()
        room_code = self.create_room_event(host)['room_code']
        first_join = self.join_player_event(player, room_code, 'SeatOwner', client_instance_id='tab-a')
        player.disconnect()

        replacement = self.make_socket_client()
        self.join_player_event(
            replacement,
            room_code,
            'SeatOwner',
            seat_token=first_join['seat_token'],
            client_instance_id='tab-b',
        )
        reconnect_event = self.telemetry_events('server:player:reconnected')[-1]
        self.assertEqual(reconnect_event['roomAnalyticsId'], game_rooms[room_code]['room_analytics_id'])
        self.assertEqual(
            reconnect_event['playerAnalyticsId'],
            game_rooms[room_code]['seats'][first_join['seat_id']]['player_analytics_id'],
        )

    def test_host_disconnect_and_control_validation_metrics(self):
        host = self.make_socket_client()
        player = self.make_socket_client()

        create_event = self.create_room_event(host)
        room_code = create_event['room_code']
        joined = self.join_player_event(player, room_code, 'ControlPilot', client_instance_id='pad-a')

        server_telemetry.clear()
        player.emit('player_control_update', {
            'room_code': room_code,
            'player_id': joined['player_id'],
            'controls': {'steering': 'bad', 'acceleration': 1, 'braking': 0},
            'timestamp': 1234,
        })
        self.assertEqual(self.telemetry_events('server:validation:failed'), [])
        metrics = self.client.get('/metrics').get_data(as_text=True)
        self.assertIn('jj_server_validation_failures_total{bucket="invalid_controls",handler="player_control_update"} 1', metrics)

        host.disconnect()
        host_lost = self.telemetry_events('server:host:disconnected')[-1]
        self.assertEqual(host_lost['roomAnalyticsId'], game_rooms[room_code]['room_analytics_id'])
        self.assertEqual(host_lost['properties']['handler'], 'disconnect')
        self.assertEqual(host_lost['properties']['graceSeconds'], 30.0)
        self.assertIn(
            'jj_server_disconnects_total{cause="host"',
            self.client.get('/metrics').get_data(as_text=True),
        )

    def test_report_submission_metrics_and_health_are_privacy_safe(self):
        description = 'Alice in room ABCD using token supersecrettoken1234567890 from 10.0.0.1'
        response = self.client.post('/telemetry/report-submission', json={
            'roomAnalyticsId': 'room-report123',
            'matchId': 'match-report123',
            'playerAnalyticsId': 'player-report123',
            'role': 'controller',
            'source': 'BugReportUI',
            'description': description,
            'screenshotAttached': True,
            'wasStale': True,
            'errorFingerprint': 'jjerr-clientabc123',
            'screenshotDataUrl': 'data:image/png;base64,secretpixels',
        })
        self.assertEqual(response.status_code, 202)

        report_event = self.telemetry_events('server:report:submitted')[-1]
        report_json = json.dumps(report_event)
        self.assertEqual(report_event['roomAnalyticsId'], 'room-report123')
        self.assertEqual(report_event['matchId'], 'match-report123')
        self.assertEqual(report_event['playerAnalyticsId'], 'player-report123')
        self.assertTrue(report_event['properties']['descriptionProvided'])
        self.assertEqual(report_event['properties']['descriptionLength'], len(description))
        self.assertEqual(report_event['properties']['fingerprint'], 'jjerr-clientabc123')
        self.assertNotIn(description, report_json)
        self.assertNotIn('Alice', report_json)
        self.assertNotIn('ABCD', report_json)
        self.assertNotIn('supersecrettoken1234567890', report_json)
        self.assertNotIn('secretpixels', report_json)

        metrics_text = self.client.get('/metrics').get_data(as_text=True)
        self.assertIn('jj_server_events_total{event_name="server:report:submitted"}', metrics_text)
        self.assertIn('jj_server_exceptions_total', metrics_text)
        health = self.client.get('/health')
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json(), {'status': 'ok', 'rooms': 0})

    def test_server_metrics_are_scrape_safe_and_low_cardinality(self):
        host = self.make_socket_client()
        room_code = self.create_room_event(host)['room_code']
        response = self.client.get('/metrics')
        self.assertEqual(response.status_code, 200)
        base_metrics = response.get_data(as_text=True)
        self.assertIn('jj_server_active_rooms 1', base_metrics)
        self.assertIn('jj_server_active_players 0', base_metrics)

        player = self.make_socket_client()
        self.join_player_event(player, room_code, 'SeatOwner', client_instance_id='scrape-test')
        joined_metrics = self.client.get('/metrics').get_data(as_text=True)
        self.assertIn('jj_server_active_players 1', joined_metrics)

        player.disconnect()
        host.disconnect()
        metrics_text = self.client.get('/metrics').get_data(as_text=True)
        self.assertRegex(metrics_text, r'jj_server_disconnects_total\{[^}]*cause="seat"')
        self.assertIn('jj_server_socket_events_total{handler="disconnect",result="ok"}', metrics_text)
        self.assertIn('jj_server_events_total{event_name="server:player:left"', metrics_text)
        self.assertIn('jj_server_uptime_seconds ', metrics_text)
        self.assertNotIn(room_code, metrics_text)

    def test_http_exception_capture_redacts_query_and_ip(self):
        with patch('server.app.render_template', side_effect=RuntimeError('boom ABCD token-secret 10.0.0.1')):
            response = self.client.get('/host?room=ABCD')
        self.assertEqual(response.status_code, 500)

        exception_event = self.telemetry_events('error:server:exception')[-1]
        message = exception_event['properties']['message']
        self.assertEqual(exception_event['properties']['kind'], 'http')
        self.assertEqual(exception_event['properties']['handler'], 'host')
        self.assertTrue(exception_event['properties']['fingerprint'].startswith('jjerr-'))
        self.assertEqual(exception_event['properties']['method'], 'GET')
        self.assertEqual(exception_event['properties']['path'], '/host')
        self.assertEqual(exception_event['properties']['queryKeys'], 'room')
        self.assertTrue(exception_event['properties']['remoteAddrHash'])
        self.assertNotIn('ABCD', message)
        self.assertNotIn('token-secret', message)
        self.assertNotIn('10.0.0.1', message)

    def test_socket_exception_capture_redacts_room_name_and_token(self):
        host = self.make_socket_client()
        room_code = self.create_room_event(host)['room_code']
        player = self.make_socket_client()
        seat_token = 'seat-token-abcdefghijklmnopqrstuvwxyz'

        with patch('server.app.join_seat', side_effect=RuntimeError(f'join failed {room_code} Alice {seat_token} 10.0.0.1')):
            try:
                player.emit('join_game', {
                    'room_code': room_code,
                    'player_name': 'Alice',
                    'seat_token': seat_token,
                    'client_instance_id': 'crash-a',
                })
            except Exception:
                pass

        exception_event = self.telemetry_events('error:server:exception')[-1]
        message = exception_event['properties']['message']
        self.assertEqual(exception_event['properties']['kind'], 'socket')
        self.assertEqual(exception_event['properties']['handler'], 'join_game')
        self.assertTrue(exception_event['properties']['fingerprint'].startswith('jjerr-'))
        self.assertEqual(exception_event['properties']['payloadKeys'], 'client_instance_id,player_name,room_code,seat_token')
        self.assertNotIn(room_code, message)
        self.assertNotIn('Alice', message)
        self.assertNotIn(seat_token, message)
        self.assertNotIn('10.0.0.1', message)

    def test_server_exception_fingerprint_throttles_repeated_spam(self):
        telemetry = ServerTelemetry(
            release='release-test',
            env='local',
            dispatch_enabled=False,
            exception_throttle_seconds=60,
        )

        first = telemetry.record_exception(
            RuntimeError('same hidden token'),
            handler='test_handler',
            kind='http',
            context={'method': 'GET', 'path': '/test', 'query_keys': ['room']},
        )
        second = telemetry.record_exception(
            RuntimeError('same hidden token'),
            handler='test_handler',
            kind='http',
            context={'method': 'GET', 'path': '/test', 'query_keys': ['room']},
        )

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(len(telemetry.queue), 1)
        self.assertTrue(telemetry.queue[0]['properties']['fingerprint'].startswith('jjerr-'))

    def test_server_error_capture_disable_guard(self):
        telemetry = ServerTelemetry(
            release='release-test',
            env='local',
            dispatch_enabled=False,
            error_capture_enabled=False,
        )

        event = telemetry.record_exception(
            RuntimeError('disabled boom'),
            handler='test_handler',
            kind='http',
            context={'method': 'GET', 'path': '/test'},
        )

        self.assertIsNone(event)
        self.assertEqual(telemetry.queue, [])


if __name__ == '__main__':
    unittest.main()
