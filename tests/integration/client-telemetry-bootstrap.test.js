import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getBrowserTelemetry,
    initBrowserTelemetry,
    resetBrowserTelemetryForTests
} from '../../static/js/telemetry/index.js';
import { NetworkSystem } from '../../static/js/systems/NetworkSystem.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const originalWindow = globalThis.window;

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
}

class FakeSocket {
    constructor() {
        this.connected = true;
        this.handlers = new Map();
    }

    on(name, handler) {
        const bucket = this.handlers.get(name) || [];
        bucket.push({ handler, once: false });
        this.handlers.set(name, bucket);
    }

    once(name, handler) {
        const bucket = this.handlers.get(name) || [];
        bucket.push({ handler, once: true });
        this.handlers.set(name, bucket);
    }

    emit() {}

    disconnect() {}

    trigger(name, payload) {
        const bucket = this.handlers.get(name) || [];
        const keep = [];
        for (const entry of bucket) {
            entry.handler(payload);
            if (!entry.once) {
                keep.push(entry);
            }
        }
        this.handlers.set(name, keep);
    }
}

function installWindow(pathname = '/host') {
    globalThis.window = {
        location: {
            pathname,
            search: '',
            origin: 'https://jammers.test',
            href: `https://jammers.test${pathname}`,
        },
        localStorage: new MemoryStorage(),
    };
}

function readText(relPath) {
    return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function collectBrowserFiles(dirPath, results = []) {
    for (const entry of readdirSync(dirPath)) {
        const fullPath = path.join(dirPath, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            if (entry === 'telemetry' || entry === 'dist' || entry === 'node_modules') {
                continue;
            }
            collectBrowserFiles(fullPath, results);
            continue;
        }
        if (/\.(js|html)$/.test(entry)) {
            results.push(fullPath);
        }
    }
    return results;
}

describe('client telemetry bootstrap integration', () => {
    beforeEach(() => {
        resetBrowserTelemetryForTests();
        installWindow('/host');
    });

    afterEach(() => {
        resetBrowserTelemetryForTests();
        globalThis.window = originalWindow;
    });

    it('host network payloads update telemetry context with roomAnalyticsId and matchId', () => {
        initBrowserTelemetry({
            role: 'host',
            source: 'HostEntry',
            sink: 'test',
            enabled: true,
        });

        const socket = new FakeSocket();
        const eventBus = { emit: vi.fn() };
        const network = new NetworkSystem({ socket, eventBus });
        network._setupSocketHandlers();

        socket.trigger('room_created', {
            room_code: 'ABCD',
            room_analytics_id: 'room-host123',
            topology: 'local',
            match_id: null,
        });
        socket.trigger('game_started', {
            room_code: 'ABCD',
            room_analytics_id: 'room-host123',
            match_id: 'match-host123',
            phase: 'active',
        });

        const telemetry = getBrowserTelemetry();
        const event = telemetry.capture('route_view', { routePath: '/host' });
        expect(event.roomAnalyticsId).toBe('room-host123');
        expect(event.matchId).toBe('match-host123');
    });

    it('host and player entrypoints bootstrap through the wrapper and avoid direct vendor references', () => {
        const hostSource = readText('src/host/main.js');
        const playerSource = readText('src/player/main.js');

        expect(hostSource).toContain('bootstrapPageTelemetry');
        expect(playerSource).toContain('bootstrapPageTelemetry');
        expect(hostSource).not.toContain('posthog');
        expect(playerSource).not.toContain('posthog');
    });

    it('keeps vendor references inside the telemetry wrapper only', () => {
        const browserRoots = [
            path.join(repoRoot, 'src'),
            path.join(repoRoot, 'static', 'js'),
            path.join(repoRoot, 'frontend'),
        ];

        const offenders = [];
        for (const root of browserRoots) {
            for (const filePath of collectBrowserFiles(root)) {
                const text = readFileSync(filePath, 'utf8');
                if (/posthog/i.test(text)) {
                    offenders.push(path.relative(repoRoot, filePath));
                }
                if (/cdn\.jsdelivr|unpkg\.com|cdnjs/i.test(text)) {
                    offenders.push(path.relative(repoRoot, filePath));
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
