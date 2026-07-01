import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    TelemetryClient,
    bootstrapPageTelemetry,
    initBrowserTelemetry,
    resetBrowserTelemetryForTests,
    resolveTelemetryConfig
} from '../../static/js/telemetry/index.js';

class MemoryStorage {
    constructor() {
        this.map = new Map();
    }

    getItem(key) {
        return this.map.has(key) ? this.map.get(key) : null;
    }

    setItem(key, value) {
        this.map.set(key, String(value));
    }

    removeItem(key) {
        this.map.delete(key);
    }

    clear() {
        this.map.clear();
    }
}

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

function installWindow({ pathname = '/player', search = '' } = {}) {
    const localStorage = new MemoryStorage();
    const windowStub = {
        location: {
            pathname,
            search,
            origin: 'https://jammers.test',
            href: `https://jammers.test${pathname}${search}`,
        },
        localStorage,
    };
    globalThis.window = windowStub;
    return windowStub;
}

describe('TelemetryClient', () => {
    beforeEach(() => {
        resetBrowserTelemetryForTests();
        globalThis.fetch = undefined;
    });

    afterEach(() => {
        resetBrowserTelemetryForTests();
        globalThis.window = originalWindow;
        globalThis.fetch = originalFetch;
    });

    it('resolves to safe noop mode when env is absent or disabled', async () => {
        installWindow({ pathname: '/host', search: '?room=ABCD' });
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock;

        const client = initBrowserTelemetry({
            role: 'host',
            source: 'HostEntry',
            enabled: false,
            fetchImpl: fetchMock,
        });

        expect(client.config.sink).toBe('noop');
        expect(client.capture('app_boot', { routePath: '/host' })).toBeNull();
        await expect(client.flush()).resolves.toEqual({ sent: 0, failed: 0 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('identifies an anonymous player id and persists it across instances', () => {
        const windowStub = installWindow();

        const first = new TelemetryClient({
            role: 'controller',
            source: 'PlayerEntry',
            sink: 'test',
            enabled: true,
        });
        const anonymousId = first.getContext().playerAnalyticsId;
        expect(anonymousId.startsWith('anon-')).toBe(true);

        resetBrowserTelemetryForTests();
        globalThis.window = windowStub;

        const second = new TelemetryClient({
            role: 'controller',
            source: 'PlayerEntry',
            sink: 'test',
            enabled: true,
        });
        expect(second.getContext().playerAnalyticsId).toBe(anonymousId);
    });

    it('updates correlation context from explicit setters and wire payloads', () => {
        installWindow({ pathname: '/host' });
        const client = new TelemetryClient({
            role: 'host',
            source: 'HostEntry',
            sink: 'test',
            enabled: true,
        });

        client.setContext({
            roomAnalyticsId: 'room-host123',
            matchId: 'match-host123',
        });
        client.setContextFromPayload({
            player_analytics_id: 'player-host123',
        });

        const event = client.capture('route_view', { routePath: '/host' });
        expect(event.roomAnalyticsId).toBe('room-host123');
        expect(event.matchId).toBe('match-host123');
        expect(event.playerAnalyticsId).toBe('player-host123');
    });

    it('captures app_boot and route_view into the debug/test sink with sanitized route paths only', () => {
        installWindow({ pathname: '/player', search: '?room=ABCD&debug=1' });

        const client = bootstrapPageTelemetry({
            role: 'controller',
            source: 'PlayerEntry',
            sink: 'test',
            enabled: true,
        });

        const events = client.getDebugEvents();
        expect(events.map((event) => event.eventName)).toEqual(['app_boot', 'route_view']);
        expect(events[0].properties.routePath).toBe('/player');
        expect(events[1].properties.routePath).toBe('/player');
        expect(JSON.stringify(events)).not.toContain('?room=ABCD');
    });

    it('captures exceptions without leaking raw message text and enforces property caps', () => {
        installWindow({ pathname: '/player' });
        const client = new TelemetryClient({
            role: 'controller',
            source: 'PlayerEntry',
            sink: 'test',
            enabled: true,
        });

        const event = client.captureException(
            new Error('Alice failed in room ABCD with token secret-token'),
            {
                player_name: 'Alice',
                room_code: 'ABCD',
            }
        );

        expect(event.properties.errorMessage).toBe('[redacted]');
        expect(event.properties.player_name).toBe('[redacted]');
        expect(event.properties.room_code).toBe('[redacted]');
        expect(JSON.stringify(event)).not.toContain('Alice failed in room ABCD');

        expect(() => {
            client.capture('route_view', { description: 'x'.repeat(501) });
        }).toThrow('exceeds');
    });

    it('flushes to PostHog only when env config enables the PostHog sink', async () => {
        installWindow({ pathname: '/player' });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });

        const client = new TelemetryClient({
            role: 'controller',
            source: 'PlayerEntry',
            enabled: true,
            autoFlush: false,
            fetchImpl: fetchMock,
            env: {
                MODE: 'production',
                VITE_TELEMETRY_ENABLED: '1',
                VITE_POSTHOG_API_KEY: 'phc_test_key',
                VITE_POSTHOG_HOST: 'https://posthog.example',
            },
        });

        expect(client.config.sink).toBe('posthog');
        client.setContext({
            roomAnalyticsId: 'room-posthog123',
            matchId: 'match-posthog123',
            playerAnalyticsId: 'player-posthog123',
        });
        client.capture('route_view', { routePath: '/player' });

        await expect(client.flush()).resolves.toEqual({ sent: 1, failed: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, request] = fetchMock.mock.calls[0];
        expect(url).toBe('https://posthog.example/batch/');
        const payload = JSON.parse(request.body);
        expect(payload.api_key).toBe('phc_test_key');
        expect(payload.batch[0].event).toBe('route_view');
        expect(payload.batch[0].properties.distinct_id).toBe('player-posthog123');
        expect(payload.batch[0].properties.roomAnalyticsId).toBe('room-posthog123');
    });

    it('supports explicit debug sink config and no-op flushes safely', async () => {
        installWindow({ pathname: '/host' });

        const config = resolveTelemetryConfig({
            enabled: true,
            sink: 'debug',
            env: { MODE: 'development' },
        });
        expect(config.sink).toBe('debug');

        const client = new TelemetryClient({
            role: 'host',
            source: 'HostEntry',
            enabled: true,
            sink: 'debug',
            env: { MODE: 'development' },
        });
        client.capture('app_boot', { routePath: '/host' });
        await expect(client.flush()).resolves.toEqual({ sent: 1, failed: 0 });
        expect(client.getDebugEvents()).toHaveLength(1);
    });
});
