/**
 * Host Authority — CLIENT contract coverage
 *
 * The server (server/app.py) rejects host-only events unless they carry the
 * server-minted host_token + host_epoch (see server/test_socket_security.py for
 * the server-side enforcement proof). This suite proves the OTHER half of the
 * contract: that the client (NetworkSystem) actually captures those credentials
 * from room_created / room_reclaimed and attaches them to every host-only emit.
 *
 * This directly guards the regression where the client sent NO token, so the
 * server silently rejected the legitimate host (could not start a game / no
 * state sync). These tests drive the real NetworkSystem code with a recording
 * mock socket — no tautologies, no duplicated logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkSystem } from '../../static/js/systems/NetworkSystem.js';

function makeMockSocket() {
    const handlers = {};
    const emits = [];
    return {
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
        once(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
        emit(ev, payload) { emits.push({ ev, payload }); },
        disconnect() {},
        // test helpers
        _fire(ev, data) { (handlers[ev] || []).forEach((fn) => fn(data)); },
        _emits: emits,
        _last(ev) { return [...emits].reverse().find((e) => e.ev === ev); },
    };
}

const HOST_ONLY_EVENTS = [
    'start_game', 'end_game', 'vehicle_states', 'mode_selected',
    'weapon_pickup', 'weapon_fired', 'return_to_lobby',
];

describe('Host authority — client attaches token/epoch to host-only emits', () => {
    let net;
    let socket;
    const TOKEN = '1700000000:abc123:deadbeefsignature';
    const EPOCH = 1;

    beforeEach(() => {
        socket = makeMockSocket();
        net = new NetworkSystem({ socket, eventBus: { emit() {} } });
        net._setupSocketHandlers();
        // Server issues credentials on room creation.
        socket._fire('room_created', {
            room_code: 'ABCD',
            join_url: 'http://x/ABCD',
            topology: 'local',
            host_token: TOKEN,
            host_epoch: EPOCH,
        });
    });

    it('captures host_token/host_epoch from room_created', () => {
        expect(net.hostToken).toBe(TOKEN);
        expect(net.hostEpoch).toBe(EPOCH);
        expect(net.roomCode).toBe('ABCD');
        expect(net.isHost).toBe(true);
    });

    it('every host-only emit carries the captured token + epoch', () => {
        net.startGame({ laps: 3 });
        net.endGame({ results: [] });
        net.broadcastVehicleStates([{ id: 1 }]);
        net.broadcastModeSelected('derby');
        net.sendWeaponPickup(1, { weaponId: 'missile' });
        net.sendWeaponFired(1, { weaponId: 'missile' });
        net.returnToLobby();

        for (const ev of HOST_ONLY_EVENTS) {
            const last = net.socket._last(ev);
            expect(last, `no emit recorded for ${ev}`).toBeTruthy();
            expect(last.payload.host_token, `${ev} missing host_token`).toBe(TOKEN);
            expect(last.payload.host_epoch, `${ev} missing host_epoch`).toBe(EPOCH);
            expect(last.payload.room_code).toBe('ABCD');
        }
    });

    it('start_game still forwards its own options alongside the auth fields', () => {
        net.startGame({ laps: 5, mode: 'race' });
        const p = net.socket._last('start_game').payload;
        expect(p.host_token).toBe(TOKEN);
        expect(p.laps).toBe(5);
        expect(p.mode).toBe('race');
    });

    it('reclaim_room on reconnect carries the token (so reclaim is authorized)', () => {
        socket._fire('connect');
        const reclaim = net.socket._last('reclaim_room');
        expect(reclaim).toBeTruthy();
        expect(reclaim.payload.room_code).toBe('ABCD');
        expect(reclaim.payload.host_token).toBe(TOKEN);
        expect(reclaim.payload.host_epoch).toBe(EPOCH);
    });

    it('adopts the rotated token/epoch from room_reclaimed', () => {
        const NEW_TOKEN = '1700000001:xyz789:newsignature';
        socket._fire('room_reclaimed', {
            room_code: 'ABCD', topology: 'local',
            host_token: NEW_TOKEN, host_epoch: 2,
        });
        expect(net.hostToken).toBe(NEW_TOKEN);
        expect(net.hostEpoch).toBe(2);
        net.startGame();
        const p = net.socket._last('start_game').payload;
        expect(p.host_token).toBe(NEW_TOKEN);   // uses the rotated token
        expect(p.host_epoch).toBe(2);
    });
});

describe('Host authority — without credentials the client sends none (server will reject)', () => {
    it('a NetworkSystem that never received room_created emits null auth (the bug guard)', () => {
        const socket = makeMockSocket();
        const net = new NetworkSystem({ socket, eventBus: { emit() {} } });
        net._setupSocketHandlers();
        net.roomCode = 'ZZZZ'; // pretend we know a code but never got credentials
        net.startGame();
        const p = net.socket._last('start_game').payload;
        // Null token is exactly what the server rejects — proving the credential
        // capture above is load-bearing, not decorative.
        expect(p.host_token).toBeNull();
        expect(p.host_epoch).toBeNull();
    });
});
