import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryClient } from '../../static/js/telemetry/index.js';
import { TelemetryService } from '../../static/js/telemetry/TelemetryService.js';

/**
 * br-jj-observability-analytics-rkt.11 — Correlation proof (client half).
 *
 * A synthetic room/join/start/error path must produce client events that are
 * join-able with server events by release + roomAnalyticsId + matchId.
 *
 * The server owns the correlation ids (sha256-derived room_analytics_id/match_id)
 * and propagates them to the client in the join/phase payload via
 * `_with_server_metadata`. The client adopts them through setContextFromPayload
 * and MUST stamp every subsequent event with those exact ids. The server half of
 * this proof (server events + the client-facing payload carry the same ids and no
 * raw room code) lives in server/test_telemetry.py.
 */

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
}

function installWindow() {
    const windowStub = {
        location: { pathname: '/host', search: '', origin: 'https://jammers.test', href: 'https://jammers.test/host' },
        localStorage: new MemoryStorage(),
        navigator: { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120' },
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    };
    globalThis.window = windowStub;
    globalThis.document = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    return windowStub;
}

function testClient(role) {
    return new TelemetryClient({ role, source: `${role}-entry`, sink: 'test', enabled: true, release: 'rel-42' });
}

// Simulates the payload the server sends to the client (subset of _with_server_metadata output).
const SERVER_PAYLOAD = {
    roomAnalyticsId: 'sha-room-9f8e7d6c',
    matchId: 'sha-match-1a2b3c4d',
    release: 'rel-42',
    // Raw identifiers that must NOT be adopted as correlation ids:
    room_code: 'WXYZ',
    player_name: 'Grace',
};

describe('telemetry correlation — client adopts server ids and stamps every event', () => {
    beforeEach(() => installWindow());
    afterEach(() => {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    });

    it('setContextFromPayload adopts roomAnalyticsId + matchId from the server payload', () => {
        const client = testClient('controller');
        client.setContextFromPayload(SERVER_PAYLOAD);
        const ctx = client.getContext();
        expect(ctx.roomAnalyticsId).toBe('sha-room-9f8e7d6c');
        expect(ctx.matchId).toBe('sha-match-1a2b3c4d');
        // Adopted ids are the anonymized ones, never the raw room code.
        expect(ctx.roomAnalyticsId).not.toBe('WXYZ');
    });

    it('client + host events across a join/start/error path share release+room+match', () => {
        const host = testClient('host');
        const controller = testClient('controller');
        host.setContextFromPayload(SERVER_PAYLOAD);
        controller.setContextFromPayload(SERVER_PAYLOAD);

        host.capture('gameplay:match:started', { playerCount: 2 });
        controller.capture('gameplay:join:completed', {});
        controller.capture('gameplay:controller:reconnect_succeeded', { attempt: 1 });
        host.capture('error:gameplay:crash', {});

        const events = [...host.getDebugEvents(), ...controller.getDebugEvents()];
        expect(events.length).toBe(4);
        for (const e of events) {
            expect(e.roomAnalyticsId).toBe('sha-room-9f8e7d6c');
            expect(e.matchId).toBe('sha-match-1a2b3c4d');
            expect(e.release).toBe('rel-42');
        }
        // Join key is well-formed and identical across roles => events are joinable.
        const joinKeys = new Set(events.map((e) => `${e.release}|${e.roomAnalyticsId}|${e.matchId}`));
        expect(joinKeys.size).toBe(1);
    });

    it('raw room code / player name never appear in emitted client events', () => {
        const client = testClient('controller');
        client.setContextFromPayload(SERVER_PAYLOAD);
        client.capture('gameplay:join:started', {});
        client.capture('gameplay:player:joined', {});
        const serialized = JSON.stringify(client.getDebugEvents());
        expect(serialized).not.toContain('WXYZ');
        expect(serialized).not.toContain('Grace');
    });

    it('events before context adoption carry the safe UNKNOWN sentinels (never crash / never raw)', () => {
        const client = testClient('controller');
        const evt = client.capture('gameplay:join:route_viewed', {});
        expect(evt).not.toBeNull();
        // roomAnalyticsId defaults to a sentinel, not empty and not a raw code.
        expect(typeof evt.roomAnalyticsId).toBe('string');
        expect(evt.roomAnalyticsId.length).toBeGreaterThan(0);
        expect(evt.roomAnalyticsId).not.toBe('WXYZ');
    });
});

describe('telemetry correlation — server-role service labels stay consistent for joins', () => {
    it('a server-role service stamps the shared ids so client+server rows align', () => {
        // Mirrors the server envelope (ServerTelemetry stamps roomAnalyticsId/matchId/release).
        const server = new TelemetryService({ enabled: true, release: 'rel-42', role: 'server', source: 'SocketIO' });
        server.setRoomAnalyticsId('sha-room-9f8e7d6c');
        server.setMatchId('sha-match-1a2b3c4d');
        server.setPlayerAnalyticsId('player-analytics-1');
        const evt = server.emit('server:room:created', {});
        expect(evt.release).toBe('rel-42');
        expect(evt.roomAnalyticsId).toBe('sha-room-9f8e7d6c');
        expect(evt.matchId).toBe('sha-match-1a2b3c4d');
        expect(evt.service).toBe('game-server');
    });
});
