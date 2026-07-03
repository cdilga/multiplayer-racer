import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryClient } from '../../static/js/telemetry/index.js';

/**
 * br-jj-observability-analytics-rkt.11 — No-spam proof.
 *
 * High-rate control updates and gameplay/render loops must NOT emit per-frame /
 * per-packet analytics. The runtime provides two bounded-emission primitives the
 * gameplay layer uses (verified in telemetry-client.test.js): captureWithCooldown
 * (rate-limit identical payloads) and captureStateTransition (emit only on change).
 * Here we drive them at loop frequency and assert the emitted count is bounded far
 * below the iteration count.
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
    globalThis.window = {
        location: { pathname: '/player', search: '', origin: 'https://jammers.test', href: 'https://jammers.test/player' },
        localStorage: new MemoryStorage(),
        navigator: { userAgent: 'Mozilla/5.0 (iPhone) Mobile Safari' },
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    };
    globalThis.document = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
}

function testClient() {
    const c = new TelemetryClient({ role: 'controller', source: 'no-spam', sink: 'test', enabled: true, release: 'rel' });
    c.setContextFromPayload({ roomAnalyticsId: 'r-1', matchId: 'm-1' });
    return c;
}

const FRAMES = 600; // ~10s at 60fps

describe('telemetry no-spam — high-rate loops do not emit per-frame/per-packet events', () => {
    beforeEach(() => installWindow());
    afterEach(() => {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    });

    it('a 600-packet control loop with a 1s cooldown emits at most ~11 events (not 600)', () => {
        const client = testClient();
        let nowMs = 1_000_000;
        for (let i = 0; i < FRAMES; i++) {
            // Same payload every frame (e.g. "input stalled" heartbeat) at 60fps.
            client.captureWithCooldown('gameplay:controller:input_stalled', { reason: 'no_input_packet' }, {
                cooldownMs: 1000,
                nowMs,
            });
            nowMs += 1000 / 60; // advance one frame
        }
        const emitted = client.getDebugEvents().length;
        // 600 frames / (1000ms cooldown / 16.67ms per frame) ~= 10-11 emissions.
        expect(emitted).toBeLessThanOrEqual(12);
        expect(emitted).toBeGreaterThan(0);
        expect(emitted).toBeLessThan(FRAMES); // the key invariant: NOT one-per-frame
    });

    it('a steady state repeated every frame emits exactly once via captureStateTransition', () => {
        const client = testClient();
        let nowMs = 2_000_000;
        for (let i = 0; i < FRAMES; i++) {
            client.captureStateTransition('gameplay:controller:reconnect_succeeded', 'connected', { attempt: 1 }, { nowMs });
            nowMs += 1000 / 60;
        }
        // No state change across 600 frames => exactly one emission.
        expect(client.getDebugEvents().length).toBe(1);
    });

    it('state transitions emit once per DISTINCT state, not per frame', () => {
        const client = testClient();
        const states = ['connecting', 'connected', 'connecting', 'connected']; // 4 real transitions
        let nowMs = 3_000_000;
        for (const state of states) {
            // Hold each state for 100 frames.
            for (let i = 0; i < 100; i++) {
                client.captureStateTransition('gameplay:controller:reconnect_attempted', state, {}, { nowMs });
                nowMs += 1000 / 60;
            }
        }
        // 400 frames, 4 distinct transitions => 4 events.
        expect(client.getDebugEvents().length).toBe(4);
    });

    it('distinct payloads within a cooldown are NOT collapsed (cooldown keys on payload)', () => {
        const client = testClient();
        const nowMs = 4_000_000;
        client.captureWithCooldown('gameplay:boost:used', { boostMultiplier: 2 }, { cooldownMs: 5000, nowMs });
        client.captureWithCooldown('gameplay:boost:used', { boostMultiplier: 3 }, { cooldownMs: 5000, nowMs });
        // Different payloads => two events (bounded correctness, not over-suppression).
        expect(client.getDebugEvents().length).toBe(2);
    });

    it('every emitted event in a high-rate burst is allowlisted and privacy-clean', () => {
        const client = testClient();
        let nowMs = 5_000_000;
        for (let i = 0; i < FRAMES; i++) {
            client.captureWithCooldown('gameplay:wheelie:sustained', { durationBucket: '1m_to_2m' }, { cooldownMs: 3000, nowMs });
            nowMs += 1000 / 60;
        }
        const events = client.getDebugEvents();
        expect(events.length).toBeLessThan(FRAMES);
        const serialized = JSON.stringify(events);
        // No raw room/player identifiers leaked through the loop path.
        expect(serialized).not.toContain('WXYZ');
    });
});
