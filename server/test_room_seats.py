import unittest

from server.room_seats import (
    HOST_LOSS_GRACE_SECONDS,
    PHASE_ACTIVE,
    PHASE_HOST_LOST,
    PHASE_RESULTS,
    PHASE_WAITING,
    STALE_CONTROLLER_SECONDS,
    append_room_trace,
    begin_room_match,
    confirm_pending_takeover,
    disconnect_binding,
    join_seat,
    new_room_state,
    reap_room_if_needed,
    reclaim_host,
    redacted_room_snapshot,
)


class RoomSeatRegistryTest(unittest.TestCase):
    def make_room(self):
        return new_room_state('ABCD', 'host-1', 'host-token')

    def test_legacy_reconnect_mints_durable_seat_token(self):
        room = self.make_room()
        first_join = join_seat(room, 'controller-1', player_name='Alice', client_instance_id='tab-a')

        disconnect_binding(room, 'controller-1', now=5)
        reconnect = join_seat(
            room,
            'controller-2',
            player_name='Alice',
            reconnect_id=first_join['seat']['seat_id'],
            client_instance_id='tab-b',
            now=6,
        )

        self.assertEqual(reconnect['status'], 'joined')
        self.assertEqual(reconnect['join_payload']['player_id'], first_join['join_payload']['player_id'])
        self.assertEqual(reconnect['join_payload']['seat_id'], first_join['join_payload']['seat_id'])
        self.assertIsInstance(reconnect['join_payload']['seat_token'], str)
        self.assertTrue(reconnect['join_payload']['seat_token'])

    def test_active_duplicate_controller_requires_prompt_then_takeover(self):
        room = self.make_room()
        first_join = join_seat(
            room,
            'controller-1',
            player_name='Alice',
            client_instance_id='tab-a',
            now=0,
        )

        prompted = join_seat(
            room,
            'controller-2',
            player_name='Alice clone',
            seat_token=first_join['join_payload']['seat_token'],
            client_instance_id='tab-b',
            now=1,
        )
        self.assertEqual(prompted['status'], 'takeover_required')

        confirmed = confirm_pending_takeover(
            room,
            'controller-2',
            seat_token=first_join['join_payload']['seat_token'],
            client_instance_id='tab-b',
            now=2,
        )
        self.assertEqual(confirmed['status'], 'joined')
        self.assertEqual(confirmed['seat']['player_id'], first_join['seat']['player_id'])
        self.assertEqual(confirmed['seat']['lease_version'], 2)
        self.assertEqual(confirmed['old_controller_sid'], 'controller-1')

    def test_same_instance_and_stale_heartbeat_auto_take_over(self):
        room = self.make_room()
        first_join = join_seat(
            room,
            'controller-1',
            player_name='Alice',
            client_instance_id='tab-a',
            now=0,
        )
        token = first_join['join_payload']['seat_token']

        same_instance = join_seat(
            room,
            'controller-2',
            player_name='Alice',
            seat_token=token,
            client_instance_id='tab-a',
            now=1,
        )
        self.assertEqual(same_instance['status'], 'joined')
        self.assertEqual(same_instance['takeover_kind'], 'same_instance')
        self.assertEqual(same_instance['seat']['lease_version'], 2)

        stale = join_seat(
            room,
            'controller-3',
            player_name='Alice',
            seat_token=token,
            client_instance_id='tab-c',
            now=1 + STALE_CONTROLLER_SECONDS + 1,
        )
        self.assertEqual(stale['status'], 'joined')
        self.assertEqual(stale['takeover_kind'], 'stale_heartbeat')
        self.assertEqual(stale['seat']['lease_version'], 3)

    def test_viewer_duplicates_do_not_displace_controller(self):
        room = self.make_room()
        controller = join_seat(room, 'controller-1', player_name='Alice', client_instance_id='tab-a')

        viewer = join_seat(
            room,
            'viewer-1',
            player_name='Alice viewer',
            seat_token=controller['join_payload']['seat_token'],
            viewer_only=True,
            can_render=True,
        )

        self.assertEqual(viewer['status'], 'joined')
        self.assertEqual(viewer['join_payload']['role'], 'viewer')
        self.assertEqual(controller['seat']['controller_sid'], 'controller-1')
        self.assertIn('viewer-1', controller['seat']['viewer_sids'])

    def test_host_loss_grace_reclaim_and_post_grace_resolution(self):
        room = self.make_room()
        begin_room_match(room)
        self.assertEqual(room['phase'], PHASE_ACTIVE)

        disconnect_result = disconnect_binding(room, 'host-1', now=100)
        self.assertEqual(disconnect_result['status'], 'host_lost')
        self.assertEqual(room['phase'], PHASE_HOST_LOST)

        reclaimed = reclaim_host(room, 'host-2', 'host-token', now=110)
        self.assertTrue(reclaimed)
        self.assertEqual(room['phase'], PHASE_ACTIVE)
        self.assertEqual(room['host_epoch'], 2)

        disconnect_binding(room, 'host-2', now=200)
        resolved = reap_room_if_needed(room, now=200 + HOST_LOSS_GRACE_SECONDS + 1)
        self.assertEqual(resolved, 'resolved')
        self.assertEqual(room['phase'], PHASE_RESULTS)

        reclaimed_after_grace = reclaim_host(room, 'host-3', 'host-token', now=240)
        self.assertTrue(reclaimed_after_grace)
        self.assertEqual(room['phase'], PHASE_RESULTS)
        self.assertEqual(room['host_epoch'], 3)

    def test_redacted_snapshot_masks_secrets_and_is_inspectable(self):
        room = self.make_room()
        join_seat(room, 'controller-1', player_name='Alice', client_instance_id='tab-a')
        append_room_trace(room, 'manual_trace', when=10)

        snapshot = redacted_room_snapshot(room, reason='manual_trace', when=11)
        self.assertEqual(snapshot['reason'], 'manual_trace')
        self.assertEqual(snapshot['phase'], PHASE_WAITING)
        self.assertEqual(snapshot['host']['tokenHash'], '[redacted]')
        self.assertEqual(snapshot['seats'][0]['seatTokenHash'], '[redacted]')
        self.assertEqual(snapshot['seats'][0]['roleBindings']['controller'], True)


if __name__ == '__main__':
    unittest.main()
