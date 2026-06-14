import { describe, it, expect } from 'vitest';
import {
    REPORT_EMAIL,
    buildReportSlug,
    buildSummaryText,
    buildMailto
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
