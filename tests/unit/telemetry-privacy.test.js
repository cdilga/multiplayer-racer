import { describe, it, expect } from 'vitest';
import { TelemetryService } from '../../static/js/telemetry/TelemetryService.js';

/**
 * br-jj-observability-analytics-rkt.11 — Telemetry privacy proof (end-to-end validation layer).
 *
 * Proves the documented privacy model (docs/contracts/telemetry-contract.md §Privacy Rules):
 * raw room codes, player display names, query strings/URLs, raw IPs, long tokens/secrets,
 * and arbitrary long text are NOT emitted as analytics properties. This complements the
 * per-field redaction cases in telemetry-contract.test.js with a systematic
 * (forbidden-value x event-family) matrix so no allowlisted family can leak.
 *
 * NOTE ON THREAT MODEL (matches runtime, not an idealized one): the service redacts by
 * (a) sensitive KEY name and (b) sensitive VALUE shape (IP / URL-with-query / bearer /
 * query-string), and REJECTS non-scalar or >500-char properties. Callers place raw
 * identifiers under their natural sensitive keys (room_code, player_name, clientIp,
 * apiToken, url), which is exactly what this test drives.
 */

const REDACTED = '[redacted]';

function makeService() {
    const service = new TelemetryService({ enabled: true, release: 'test', role: 'host', source: 'PrivacyTest' });
    service.setRoomAnalyticsId('room-analytics-abc'); // anonymized id (allowed)
    service.setMatchId('match-analytics-abc');
    service.setPlayerAnalyticsId('player-analytics-abc');
    return service;
}

// Event families that carry gameplay/context properties (a representative spread).
const EVENT_FAMILIES = [
    'gameplay:join:started',
    'gameplay:player:joined',
    'gameplay:match:started',
    'gameplay:controller:reconnect_attempted',
    'gameplay:weapon:fired',
    'gameplay:map:validation_failed',
    'error:gameplay:crash',
    'error:network:disconnect',
    'server:room:created',
];

describe('telemetry privacy — forbidden values are redacted under sensitive keys', () => {
    // Each case: a property object carrying a raw forbidden value under a realistic key.
    const forbiddenCases = [
        { label: 'raw room code', props: { room_code: 'WXYZ' }, key: 'room_code' },
        { label: 'raw join code', props: { join_code: 'QP42' }, key: 'join_code' },
        { label: 'player display name', props: { player_name: 'Ada Lovelace' }, key: 'player_name' },
        { label: 'display name variant', props: { displayName: 'Ada Lovelace' }, key: 'displayName' },
        { label: 'nickname', props: { nickname: 'AceRacer' }, key: 'nickname' },
        { label: 'raw client IP', props: { clientIp: '192.168.1.42' }, key: 'clientIp' },
        { label: 'ip_address key', props: { ip_address: '10.0.0.5' }, key: 'ip_address' },
        { label: 'auth token', props: { apiToken: 'sk-livesecrettoken-abcdef123456' }, key: 'apiToken' },
        { label: 'secret', props: { sessionSecret: 'hunter2-super-secret' }, key: 'sessionSecret' },
        { label: 'socket id', props: { socket_id: 'A1b2C3d4E5' }, key: 'socket_id' },
        { label: 'query string url', props: { url: 'https://jammers.test/join?room=WXYZ&token=abc' }, key: 'url' },
        { label: 'referrer with query', props: { referrer: 'https://x.test/p?token=zzz' }, key: 'referrer' },
    ];

    for (const family of EVENT_FAMILIES) {
        for (const c of forbiddenCases) {
            it(`${family} redacts ${c.label}`, () => {
                const service = makeService();
                const event = service.emit(family, { ...c.props });
                expect(event).not.toBeNull();
                // The specific property is redacted...
                expect(event.properties[c.key]).toBe(REDACTED);
                // ...and the raw value never survives anywhere in the serialized event.
                const raw = Object.values(c.props)[0];
                expect(JSON.stringify(event)).not.toContain(raw);
            });
        }
    }
});

describe('telemetry privacy — sensitive VALUE shapes are redacted regardless of key name', () => {
    // Even under an innocuous key, IP / URL-with-query / bearer / query-string SHAPES are caught.
    const valueCases = [
        { label: 'bare IP under innocuous key', props: { note: '192.168.1.1' } },
        { label: 'url with query under innocuous key', props: { detail: 'https://jammers.test/x?token=abc' } },
        { label: 'bearer token under innocuous key', props: { context: 'Bearer sk-abc.def-123' } },
        { label: 'query fragment under innocuous key', props: { info: '?token=leak&x=1' } },
    ];
    for (const c of valueCases) {
        it(`redacts ${c.label}`, () => {
            const service = makeService();
            const event = service.emit('gameplay:match:started', { ...c.props });
            const key = Object.keys(c.props)[0];
            expect(event.properties[key]).toBe(REDACTED);
        });
    }
});

describe('telemetry privacy — property bounds reject unbounded/complex payloads', () => {
    it('rejects arbitrary text longer than the 500-char cap (no unbounded user text)', () => {
        const service = makeService();
        const tooLong = 'x'.repeat(501);
        expect(() => service.emit('gameplay:match:started', { note: tooLong })).toThrow(/exceeds/i);
    });

    it('rejects nested objects (only bounded scalars allowed)', () => {
        const service = makeService();
        expect(() => service.emit('gameplay:match:started', { blob: { a: 1 } })).toThrow(/string, number, boolean/i);
    });

    it('rejects array properties (no unbounded collections)', () => {
        const service = makeService();
        expect(() => service.emit('gameplay:match:started', { list: [1, 2, 3] })).toThrow(/string, number, boolean/i);
    });

    it('accepts a text value exactly at the cap', () => {
        const service = makeService();
        const atCap = 'x'.repeat(500);
        expect(() => service.emit('gameplay:match:started', { note: atCap })).not.toThrow();
    });
});

describe('telemetry privacy — anonymized correlation ids are allowed (not redacted)', () => {
    it('keeps roomAnalyticsId/matchId/playerAnalyticsId on the event envelope', () => {
        const service = makeService();
        const event = service.emit('gameplay:match:started', { playerCount: 4 });
        expect(event.roomAnalyticsId).toBe('room-analytics-abc');
        expect(event.matchId).toBe('match-analytics-abc');
        expect(event.playerAnalyticsId).toBe('player-analytics-abc');
        // A pseudonymous analytics id in properties (roomId/activePlayerId) is allowed.
        const withIds = service.emit('gameplay:match:started', { activePlayerId: 'player-123', roomId: 'room-123' });
        expect(withIds.properties.activePlayerId).toBe('player-123');
        expect(withIds.properties.roomId).toBe('room-123');
    });
});
