import { describe, expect, it } from 'vitest';
import {
    acceptJoin,
    applyRoomPhase,
    applySeatTakenOver,
    createRoomSeatRegistry,
    getRoomSnapshot,
    noteTakeoverRequired,
} from '../../static/js/engine/roomSeatRegistry.js';

describe('room seat registry lifecycle', () => {
    it('preserves one logical seat across duplicate takeover and host-loss phase updates', () => {
        const registry = createRoomSeatRegistry();

        acceptJoin(registry, {
            room_code: 'ABCD',
            player_id: 1,
            seat_id: 1,
            room_analytics_id: 'room-abc12345',
            player_analytics_id: 'player-a1b2c3d4e5f6a7b8',
            seat_token: 'seat-token-a',
            lease_version: 1,
            client_instance_id: 'tab-a',
            role: 'controller',
            phase: 'waiting',
            mode: 'race',
            topology: 'local',
            host_epoch: 1,
        });

        noteTakeoverRequired(registry, {
            room_code: 'ABCD',
            player_id: 1,
            seat_id: 1,
            lease_version: 1,
            phase: 'waiting',
        });

        let snapshot = getRoomSnapshot(registry, 'ABCD');
        expect(snapshot.pendingTakeover).toMatchObject({
            seatId: 1,
            playerId: 1,
            leaseVersion: 1,
        });
        expect(snapshot.seats).toHaveLength(1);

        acceptJoin(registry, {
            room_code: 'ABCD',
            player_id: 1,
            seat_id: 1,
            room_analytics_id: 'room-abc12345',
            player_analytics_id: 'player-a1b2c3d4e5f6a7b8',
            seat_token: 'seat-token-a',
            lease_version: 2,
            client_instance_id: 'tab-b',
            role: 'controller',
            phase: 'active',
            mode: 'race',
            topology: 'local',
            host_epoch: 1,
        });

        snapshot = getRoomSnapshot(registry, 'ABCD');
        expect(snapshot.pendingTakeover).toBe(null);
        expect(snapshot.phase).toBe('active');
        expect(snapshot.roomAnalyticsId).toBe('room-abc12345');
        expect(snapshot.seats).toEqual([
            expect.objectContaining({
                seatId: 1,
                playerId: 1,
                playerAnalyticsId: 'player-a1b2c3d4e5f6a7b8',
                seatToken: 'seat-token-a',
                leaseVersion: 2,
                clientInstanceId: 'tab-b',
                role: 'controller',
                controllerActive: true,
                phase: 'active',
            }),
        ]);

        applyRoomPhase(registry, {
            room_code: 'ABCD',
            phase: 'host_lost',
            mode: 'race',
            topology: 'local',
            host_epoch: 1,
        });
        snapshot = getRoomSnapshot(registry, 'ABCD');
        expect(snapshot.phase).toBe('host_lost');
        expect(snapshot.seats[0].controllerActive).toBe(false);

        applyRoomPhase(registry, {
            room_code: 'ABCD',
            phase: 'active',
            match_id: 'match-1',
            round_id: 'round-1',
            host_epoch: 2,
        });
        snapshot = getRoomSnapshot(registry, 'ABCD');
        expect(snapshot.phase).toBe('active');
        expect(snapshot.hostEpoch).toBe(2);
        expect(snapshot.seats[0].controllerActive).toBe(true);
        expect(snapshot.matchId).toBe('match-1');
        expect(snapshot.roundId).toBe('round-1');

        applyRoomPhase(registry, {
            room_code: 'ABCD',
            phase: 'waiting',
            match_id: null,
            round_id: null,
            host_epoch: 2,
        });
        snapshot = getRoomSnapshot(registry, 'ABCD');
        expect(snapshot.phase).toBe('waiting');
        expect(snapshot.matchId).toBe(null);
        expect(snapshot.roundId).toBe(null);
        expect(snapshot.roomAnalyticsId).toBe('room-abc12345');
    });

    it('allows viewer duplicates without displacing the controller seat', () => {
        const registry = createRoomSeatRegistry();

        acceptJoin(registry, {
            room_code: 'WXYZ',
            player_id: 7,
            seat_id: 7,
            room_analytics_id: 'room-view9876',
            player_analytics_id: 'player-seat-view9876',
            seat_token: 'seat-token-b',
            lease_version: 1,
            client_instance_id: 'tab-owner',
            role: 'controller',
            phase: 'waiting',
            topology: 'remote',
            mode: 'race',
        });
        acceptJoin(registry, {
            room_code: 'WXYZ',
            player_id: 7,
            seat_id: 7,
            room_analytics_id: 'room-view9876',
            player_analytics_id: 'player-seat-view9876',
            seat_token: 'seat-token-b',
            lease_version: 1,
            client_instance_id: 'viewer-tab',
            role: 'viewer',
            phase: 'waiting',
            topology: 'remote',
            mode: 'race',
        });

        const snapshot = getRoomSnapshot(registry, 'WXYZ');
        expect(snapshot.roomAnalyticsId).toBe('room-view9876');
        expect(snapshot.seats).toEqual([
            expect.objectContaining({
                seatId: 7,
                playerId: 7,
                playerAnalyticsId: 'player-seat-view9876',
                leaseVersion: 1,
                controllerActive: true,
                viewerCount: 1,
                role: 'controller',
                clientInstanceId: 'tab-owner',
            }),
        ]);
    });

    it('marks a local seat inactive after seat_taken_over without inventing a new player id', () => {
        const registry = createRoomSeatRegistry();

        acceptJoin(registry, {
            room_code: 'QWER',
            player_id: 4,
            seat_id: 4,
            room_analytics_id: 'room-seat0001',
            player_analytics_id: 'player-seat0001',
            seat_token: 'seat-token-c',
            lease_version: 3,
            client_instance_id: 'tab-a',
            role: 'controller',
            phase: 'active',
            topology: 'local',
            mode: 'race',
        });

        applySeatTakenOver(registry, {
            room_code: 'QWER',
            seat_id: 4,
            player_id: 4,
            lease_version: 4,
        });

        const snapshot = getRoomSnapshot(registry, 'QWER');
        expect(snapshot.seats[0]).toMatchObject({
            seatId: 4,
            playerId: 4,
            playerAnalyticsId: 'player-seat0001',
            leaseVersion: 4,
            controllerActive: false,
        });
    });
});
