import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    REPORT_EMAIL,
    buildReportSlug,
    buildSummaryText,
    buildMailto,
    buildReportPayload,
    postReport
} from '../../static/js/ui/BugReportUI.js';

const sampleDebugInfo = {
    timestamp: '2026-06-14T12:34:56.789Z',
    url: 'https://jammers.dilger.dev/',
    userAgent: 'TestBrowser/1.0',
    roomCode: 'ABCD',
    socketId: 'sock-123',
    gameState: 'RACING',
    fps: 58,
    settings: { mode: 'derby', laps: 3 },
    players: [{ playerId: 'p1' }, { playerId: 'p2' }]
};

describe('bug report - report slug', () => {
    it('builds a filesystem-safe slug from room code + timestamp', () => {
        const slug = buildReportSlug(sampleDebugInfo);
        expect(slug).toBe('bug-ABCD-2026-06-14T12-34-56-789Z');
        // No colons or dots that would be awkward in filenames
        expect(slug).not.toMatch(/[:.]/);
    });

    it('falls back gracefully when fields are missing', () => {
        expect(buildReportSlug({})).toBe('bug-no-room-unknown-time');
        expect(buildReportSlug(undefined as any)).toBe('bug-no-room-unknown-time');
    });
});

describe('bug report - summary text', () => {
    it('includes correlation IDs needed to match against server logs', () => {
        const summary = buildSummaryText(sampleDebugInfo);
        expect(summary).toContain('Room: ABCD');
        expect(summary).toContain('Socket: sock-123');
        expect(summary).toContain('Time: 2026-06-14T12:34:56.789Z');
        expect(summary).toContain('Mode: derby');
        expect(summary).toContain('State: RACING');
        expect(summary).toContain('Players: 2');
    });

    it('uses dashes for missing fields instead of undefined', () => {
        const summary = buildSummaryText({});
        expect(summary).toContain('Room: -');
        expect(summary).not.toContain('undefined');
    });
});

describe('bug report - mailto', () => {
    it('targets the bug report inbox', () => {
        const mailto = buildMailto({ email: REPORT_EMAIL, debugInfo: sampleDebugInfo, description: 'it broke' });
        expect(mailto.startsWith(`mailto:${REPORT_EMAIL}?`)).toBe(true);
        expect(REPORT_EMAIL).toBe('bugs@jammers.dilger.dev');
    });

    it('encodes the description and debug summary into the body', () => {
        const mailto = buildMailto({
            email: REPORT_EMAIL,
            debugInfo: sampleDebugInfo,
            description: 'car flew into space',
            screenshotFilename: 'bug-ABCD-x.jpg'
        });
        const decoded = decodeURIComponent(mailto);
        expect(decoded).toContain('car flew into space');
        expect(decoded).toContain('Room: ABCD');
        expect(decoded).toContain('bug-ABCD-x.jpg');
        // Subject carries the room code for quick triage
        expect(decoded).toContain('Bug report: ABCD');
    });

    it('produces a valid mailto even with no screenshot or data', () => {
        const mailto = buildMailto({ email: REPORT_EMAIL, debugInfo: {}, description: '' });
        expect(mailto.startsWith('mailto:')).toBe(true);
        expect(mailto).not.toContain('undefined');
    });
});

describe('BugReportUI — POST /report payload + fallback (woq.4)', () => {
    const debugInfo = {
        roomCode: 'ABCD',
        settings: { mode: 'derby' },
        userAgent: 'test-agent',
        runContext: { buildId: 'b7', seed: 42, tuningHash: 'abc123', ruleset: 'derby', topology: 'local', tick: 120 },
        replayJournal: { schemaVersion: 1, latestSnapshot: { stateHash: 'deadbeef' } },
        mapValidation: { ok: true, resolvedMapId: 'derby-arena' },
        spawnDiagnostics: [{ phase: 'respawn', reason: 'jitter_fallback' }],
        trackResolution: { requested: 'random', resolved: 'derby-arena', random: true }
    };

    it('carries build/run-context + replay/map diagnostics for reproduction', () => {
        const payload = buildReportPayload({ debugInfo, description: 'car in void' });
        expect(payload.description).toBe('car in void');
        expect(payload.buildId).toBe('b7');
        expect(payload.seed).toBe(42);
        expect(payload.tuningHash).toBe('abc123');
        expect(payload.mode).toBe('derby');
        expect(payload.runContext.tick).toBe(120);
        expect(payload.replayExcerpt.latestSnapshot.stateHash).toBe('deadbeef');
        expect(payload.mapValidation.resolvedMapId).toBe('derby-arena');
        expect(payload.trackResolution.resolved).toBe('derby-arena');
        expect(typeof payload.clientReportId).toBe('string');
    });

    it('omits an absent screenshot and never carries an obvious secret field', () => {
        const payload = buildReportPayload({ debugInfo, description: 'd' });
        expect('screenshot' in payload).toBe(false);
        expect(JSON.stringify(payload)).not.toMatch(/host_token|seat_token|password/i);
        const withShot = buildReportPayload({ debugInfo, description: 'd', screenshot: 'data:image/png;base64,AAAA' });
        expect(withShot.screenshot).toBe('data:image/png;base64,AAAA');
    });

    it('postReport returns true on a 2xx and false on error (mailto fallback)', async () => {
        const ok = await postReport({ description: 'x' }, async () => ({ ok: true }) as any);
        expect(ok).toBe(true);
        const notOk = await postReport({ description: 'x' }, async () => ({ ok: false }) as any);
        expect(notOk).toBe(false);
        const threw = await postReport({ description: 'x' }, async () => { throw new Error('offline'); });
        expect(threw).toBe(false); // unreachable => caller falls back to mailto
    });

    it('POSTs to the /report endpoint (never a tracker/tooling URL)', async () => {
        let calledUrl = '';
        await postReport({ description: 'x' }, async (url: string) => { calledUrl = url; return { ok: true } as any; });
        expect(calledUrl).toBe('/report');
    });

    it('the browser report path invokes no br/gh/shell/maintainer tooling', () => {
        const src = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), '../../static/js/ui/BugReportUI.js'),
            'utf8'
        );
        // Client code must never shell out or touch the tracker/GitHub directly.
        expect(src).not.toMatch(/child_process|subprocess|execSync|spawnSync/);
        expect(src).not.toMatch(/\bbr create\b|\bgh issue\b|\bgh pr\b/);
        expect(src).not.toMatch(/maintainer[_-]?token/i);
    });
});
