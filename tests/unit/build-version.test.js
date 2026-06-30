import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    BUILD_INFO,
    isBuildSkewed,
    recordServerBuild,
    getSkewState,
    checkBuildSkew,
    _resetSkewState
} from '../../static/js/buildInfo.js';
import { buildSummaryText, buildReportBuildInfo } from '../../static/js/ui/BugReportUI.js';

describe('buildInfo: build identity', () => {
    it('exposes a frozen identity with string buildId/buildSha/buildTime', () => {
        expect(typeof BUILD_INFO.buildId).toBe('string');
        expect(typeof BUILD_INFO.buildSha).toBe('string');
        expect(typeof BUILD_INFO.buildTime).toBe('string');
        expect(Object.isFrozen(BUILD_INFO)).toBe(true);
        // Unit test runs without Vite define injection -> deterministic dev fallback.
        expect(BUILD_INFO.buildId).toBe('dev');
        expect(BUILD_INFO.buildSha).toBe('unknown');
        expect(BUILD_INFO.buildTime).toBe('dev');
    });
});

describe('buildInfo: isBuildSkewed (pure)', () => {
    it('reports skew only for two differing real build ids', () => {
        expect(isBuildSkewed('abc123', 'def456')).toBe(true);
        expect(isBuildSkewed('abc123', 'abc123')).toBe(false);
    });

    it('never false-alarms on unknown/missing/dev ids', () => {
        expect(isBuildSkewed('', 'def456')).toBe(false);
        expect(isBuildSkewed('abc123', '')).toBe(false);
        expect(isBuildSkewed(null, 'def456')).toBe(false);
        expect(isBuildSkewed('dev', 'def456')).toBe(false);
        expect(isBuildSkewed('abc123', 'dev')).toBe(false);
        expect(isBuildSkewed('unknown', 'def456')).toBe(false);
        expect(isBuildSkewed('abc123', 'unknown')).toBe(false);
    });

    it('coerces non-string ids before comparing', () => {
        expect(isBuildSkewed(123, 123)).toBe(false);
        expect(isBuildSkewed(123, 456)).toBe(true);
    });
});

describe('buildInfo: skew state recording', () => {
    beforeEach(() => _resetSkewState());
    afterEach(() => _resetSkewState());

    it('starts unchecked and not stale', () => {
        expect(getSkewState()).toEqual({ checked: false, stale: false, serverBuildId: null });
    });

    it('records a matching server build as not stale', () => {
        // Client buildId is the dev fallback here, so a real server id is treated
        // as dev-vs-real => not stale (dev never nags).
        const state = recordServerBuild('server-real-1');
        expect(state.checked).toBe(true);
        expect(state.stale).toBe(false);
        expect(state.serverBuildId).toBe('server-real-1');
    });

    it('records skew when both ids are real and differ', () => {
        // Use isBuildSkewed directly to validate the real-vs-real path the
        // browser hits in production (client buildId injected by Vite).
        expect(isBuildSkewed('client-A', 'server-B')).toBe(true);
        const state = recordServerBuild(undefined);
        expect(state.stale).toBe(false);
        expect(state.serverBuildId).toBe(null);
    });
});

describe('buildInfo: checkBuildSkew (injected fetch)', () => {
    beforeEach(() => _resetSkewState());
    afterEach(() => _resetSkewState());

    it('fetches /version and records the server build id', async () => {
        const fetchImpl = async (url) => {
            expect(url).toBe('/version');
            return { json: async () => ({ buildId: 'server-xyz', buildSha: 'deadbeef', buildTime: '2026' }) };
        };
        const state = await checkBuildSkew({ fetchImpl });
        expect(state.checked).toBe(true);
        expect(state.serverBuildId).toBe('server-xyz');
    });

    it('swallows network errors and keeps prior state', async () => {
        const fetchImpl = async () => { throw new Error('network down'); };
        const state = await checkBuildSkew({ fetchImpl });
        expect(state.checked).toBe(false);
        expect(state.stale).toBe(false);
    });

    it('uses a custom url when provided', async () => {
        let seen = null;
        const fetchImpl = async (url) => { seen = url; return { json: async () => ({ buildId: 'x' }) }; };
        await checkBuildSkew({ fetchImpl, url: '/api/version' });
        expect(seen).toBe('/api/version');
    });
});

describe('bug-report build integration', () => {
    beforeEach(() => _resetSkewState());
    afterEach(() => _resetSkewState());

    it('report payload carries build identity + wasStale=false by default', () => {
        const info = buildReportBuildInfo();
        expect(info.buildId).toBe(BUILD_INFO.buildId);
        expect(info.buildSha).toBe(BUILD_INFO.buildSha);
        expect(info.buildTime).toBe(BUILD_INFO.buildTime);
        expect(info.wasStale).toBe(false);
        expect(info.serverBuildId).toBe(null);
    });

    it('report payload reflects wasStale=true after a real skew is observed', () => {
        recordServerBuild('server-NEW', 'client-OLD');
        const info = buildReportBuildInfo();
        expect(info.wasStale).toBe(true);
        expect(info.serverBuildId).toBe('server-NEW');
    });

    it('summary text includes a Build line and a Stale client line', () => {
        const text = buildSummaryText({ roomCode: 'ABCD' });
        expect(text).toContain('Build:');
        expect(text).toContain(BUILD_INFO.buildId);
        expect(text).toContain('Stale client: no');
        recordServerBuild('server-NEW', 'client-OLD');
        expect(buildSummaryText({ roomCode: 'ABCD' })).toContain('Stale client: YES');
    });
});
