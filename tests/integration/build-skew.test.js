/**
 * Integration: client/server build-skew detection drives payload suppression.
 *
 * Exercises the full decision path a deployed client hits - fetch /version,
 * compare against the baked-in client build id, flip the global stale flag, and
 * have a network sender refuse to keep emitting contract payloads - without any
 * route interception (a real injected fetch stub stands in for the server).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    checkBuildSkew,
    recordServerBuild,
    shouldSuppressSend,
    getSkewState,
    _resetSkewState
} from '../../static/js/buildInfo.js';

// Minimal network layer that gates sends on the skew flag, mirroring how the
// controller/host send path should behave once a skew is detected.
function makeGatedSender() {
    const sent = [];
    return {
        sent,
        send(payload) {
            if (shouldSuppressSend()) return false;
            sent.push(payload);
            return true;
        }
    };
}

function versionResponse(buildId) {
    return { json: async () => ({ manifest: 'jj-build-version', buildId, buildSha: 'x', buildTime: 't' }) };
}

describe('build skew integration', () => {
    beforeEach(() => {
        _resetSkewState();
        if (typeof window !== 'undefined') delete window.__buildStale;
    });
    afterEach(() => _resetSkewState());

    it('matching client/server build keeps sends flowing', async () => {
        const fetchImpl = async () => versionResponse('build-42');
        const state = await checkBuildSkew({ fetchImpl, clientBuildId: 'build-42' });
        expect(state.stale).toBe(false);
        expect(shouldSuppressSend()).toBe(false);

        const net = makeGatedSender();
        expect(net.send({ type: 'controls' })).toBe(true);
        expect(net.sent).toHaveLength(1);
    });

    it('skewed client/server build suppresses further sends', async () => {
        const net = makeGatedSender();
        // Before the check, sends flow normally.
        expect(net.send({ type: 'controls', seq: 1 })).toBe(true);

        const fetchImpl = async () => versionResponse('build-99-NEW');
        const state = await checkBuildSkew({ fetchImpl, clientBuildId: 'build-42-OLD' });
        expect(state.stale).toBe(true);
        expect(state.serverBuildId).toBe('build-99-NEW');
        expect(shouldSuppressSend()).toBe(true);

        // After detection, the gated sender refuses to emit.
        expect(net.send({ type: 'controls', seq: 2 })).toBe(false);
        expect(net.sent).toEqual([{ type: 'controls', seq: 1 }]);
    });

    it('sets and clears the window.__buildStale flag in a DOM-ish env', () => {
        const hadWindow = typeof globalThis.window !== 'undefined';
        if (!hadWindow) globalThis.window = {};
        try {
            recordServerBuild('server-NEW', 'client-OLD');
            expect(globalThis.window.__buildStale).toBe(true);
            recordServerBuild('same-build', 'same-build');
            expect(globalThis.window.__buildStale).toBeUndefined();
        } finally {
            if (!hadWindow) delete globalThis.window;
        }
    });

    it('a dev client never suppresses (partial deploy / local dev safe)', async () => {
        const fetchImpl = async () => versionResponse('real-server-build');
        const state = await checkBuildSkew({ fetchImpl, clientBuildId: 'dev' });
        expect(state.stale).toBe(false);
        expect(shouldSuppressSend()).toBe(false);
    });

    it('an unreachable /version leaves sends enabled (fail-open)', async () => {
        const fetchImpl = async () => { throw new Error('offline'); };
        await checkBuildSkew({ fetchImpl, clientBuildId: 'build-42-OLD' });
        expect(getSkewState().checked).toBe(false);
        expect(shouldSuppressSend()).toBe(false);
    });
});
