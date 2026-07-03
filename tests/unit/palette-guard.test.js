import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FORBIDDEN_LOUD_HEXES,
    EXPLICIT_ENVIRONMENT_SOURCES,
    scanForLoudColors,
    isLoudColor,
    isWorldColor
} from '../../static/js/visual/palette.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const trackDir = resolve(repoRoot, 'static/assets/tracks');
const artifactDir = resolve(repoRoot, 'artifacts/br-skip-bin-arcade-design-language-5k3.11');
const artifactPath = resolve(artifactDir, 'palette-guard-proof.json');

const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

function collectTrackSources() {
    const entries = readdirSync(trackDir, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .filter((entry) => extname(entry.name).toLowerCase() === '.json')
        .map((entry) => {
            const dir = entry.parentPath || entry.path || trackDir;
            return relative(repoRoot, resolve(dir, entry.name));
        })
        .sort();
}

function summarizeFindings(entries) {
    const perFile = {};
    let total = 0;
    for (const [rel, hits] of Object.entries(entries)) {
        perFile[rel] = {
            hitCount: hits.length,
            hits
        };
        total += hits.length;
    }
    return { total, perFile };
}

describe('palette guard - helpers', () => {
    it('distinguishes world and forbidden loud families', () => {
        for (const loud of FORBIDDEN_LOUD_HEXES) {
            expect(isLoudColor(loud)).toBe(true);
            expect(isWorldColor(loud)).toBe(false);
        }
    });

    it('detects forbidden loud color via fixture and supports explicit palette-allow marker', () => {
        const sample = [
            'const a = "#FF2E88"; // loud red accent',
            'const muted = "#2A2620";',
            'const allowed = "#FF3B3B"; // palette-allow'
        ].join('\n');

        const allHits = scanForLoudColors(sample, 'tests/unit/fixtures/palette-detection-sample.txt');
        const filtered = scanForLoudColors(sample, 'tests/unit/fixtures/palette-detection-sample.txt')
            .filter((h) => h.match !== '#FF3B3B');
        expect(allHits).toHaveLength(1);
        expect(filtered).toHaveLength(1);
        expect(allHits.some((hit) => hit.normalized === '#FF2E88')).toBe(true);
    });
});

describe('palette guard - environment scan', () => {
    const tracked = [
        ...EXPLICIT_ENVIRONMENT_SOURCES,
        ...collectTrackSources()
    ];

    const scanResults = {};

    for (const rel of tracked) {
        it(`${rel} has no forbidden loud colors`, () => {
            expect(existsSync(resolve(repoRoot, rel))).toBe(true);
            const hits = scanForLoudColors(read(rel), rel);
            scanResults[rel] = hits;
            expect(hits, `${rel} includes loud palette colors: ${JSON.stringify(hits)}`).toHaveLength(0);
        });
    }

    it('persists evidence evidence JSON for this bead', () => {
        const { total, perFile } = summarizeFindings(scanResults);
        const evidence = {
            bead: 'br-skip-bin-arcade-design-language-5k3.11',
            generatedAt: new Date().toISOString(),
            policy: {
                environmentForbiddenHexes: FORBIDDEN_LOUD_HEXES,
                environmentSources: tracked
            },
            result: {
                totalForbiddenHits: total,
                perFile
            }
        };
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(artifactPath, JSON.stringify(evidence, null, 2) + '\n');
        expect(total).toBe(0);
        expect(existsSync(artifactPath)).toBe(true);
    });
});
