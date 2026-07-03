import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scanSource,
    GAMEPLAY_SOURCES,
    ALLOWLISTED_SOURCES,
    PENDING_SOURCES,
    BANNED_PATTERNS
} from '../../static/js/engine/determinism.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('determinism static scan - detection', () => {
    it('detects every banned global in the bad fixture', () => {
        const v = scanSource(read('tests/unit/fixtures/determinism-bad-fixture.js'));
        const tokens = v.map((x) => x.token);
        expect(tokens).toContain('Math.random');
        expect(tokens).toContain('performance.now');
        expect(tokens).toContain('Date.now');
    });

    it('honours the inline determinism-allow marker', () => {
        const v = scanSource(read('tests/unit/fixtures/determinism-bad-fixture.js'));
        // The fixture's allowed line must NOT be reported.
        expect(v.some((x) => /determinism-allow/.test(x.text))).toBe(false);
    });

    it('ignores banned tokens that only appear in comments', () => {
        const sample = [
            '// this mentions performance.now() in a comment',
            '/* and Math.random() in a block comment */',
            'const x = 1;'
        ].join('\n');
        expect(scanSource(sample)).toHaveLength(0);
    });

    it('flags real code even with surrounding comments', () => {
        const sample = 'const r = Math.random(); // pick';
        const v = scanSource(sample);
        expect(v).toHaveLength(1);
        expect(v[0].token).toBe('Math.random');
    });

    it('exposes the three banned patterns', () => {
        expect(BANNED_PATTERNS.map((p) => p.token).sort())
            .toEqual(['Date.now', 'Math.random', 'performance.now']);
    });
});

describe('determinism static scan - migrated gameplay files are clean', () => {
    for (const rel of GAMEPLAY_SOURCES) {
        it(`${rel} has no direct banned calls`, () => {
            expect(existsSync(resolve(repoRoot, rel))).toBe(true);
            const v = scanSource(read(rel));
            expect(v, `unexpected non-deterministic calls in ${rel}: ` +
                JSON.stringify(v)).toHaveLength(0);
        });
    }
});

describe('determinism static scan - allowlist is honest', () => {
    it('every allowlisted file actually exists', () => {
        for (const rel of Object.keys(ALLOWLISTED_SOURCES)) {
            expect(existsSync(resolve(repoRoot, rel)), `${rel} missing`).toBe(true);
        }
    });

    it('a migrated file is never also allowlisted (no double-counting)', () => {
        for (const rel of GAMEPLAY_SOURCES) {
            expect(ALLOWLISTED_SOURCES[rel]).toBeUndefined();
        }
    });

    it('pending files are real, reasoned, and not silently allowlisted', () => {
        // PENDING entries are gameplay files we could not migrate (blocked by
        // another agent's reservation). They must exist, carry a reason, and
        // NOT be in the allowlist (so the gap stays visible).
        for (const [rel, reason] of Object.entries(PENDING_SOURCES)) {
            expect(existsSync(resolve(repoRoot, rel)), `${rel} missing`).toBe(true);
            expect(typeof reason).toBe('string');
            expect(reason.length).toBeGreaterThan(10);
            expect(ALLOWLISTED_SOURCES[rel]).toBeUndefined();
            // These genuinely still contain banned calls (that's why they're pending).
            expect(scanSource(read(rel)).length).toBeGreaterThan(0);
        }
    });
});
