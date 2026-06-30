import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildGeometryDiagnostics,
    canonicalizeLoop,
    containsPointInGate,
    deriveEdgesFromFrames,
    deriveTrackFrames,
    hashGeometryBundle,
    makeOrientedGate,
    segmentCrossesGate,
    validateSpawnSet
} from '../../static/js/geometry/GeometryKernel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, './fixtures');
const geometryDir = resolve(__dirname, '../../static/js/geometry');

const VALID_INPUT = {
    source: {
        mapId: 'valid-octagon',
        seed: 12345,
        recipe: 'unit-test',
        generatorVersion: 'v1'
    },
    centerline: [
        { x: -40, y: 0, z: -10 },
        { x: -40, y: 0, z: 0 },
        { x: -40, y: 0, z: 10 },
        { x: 0, y: 0, z: 10 },
        { x: 40, y: 0, z: 10 },
        { x: 40, y: 0, z: 0 },
        { x: 40, y: 0, z: -10 },
        { x: 0, y: 0, z: -10 }
    ],
    gateSpecs: [
        { id: 'finish', frameIndex: 2, width: 18, depth: 4, isFinishLine: true },
        { id: 'mid', frameIndex: 6, width: 18, depth: 4 }
    ],
    spawns: [
        {
            id: 'spawn-a',
            position: { x: -24, y: 1.5, z: -10 },
            headingRad: 0,
            clearance: 3.5,
            support: { hit: true, y: 0, normal: { x: 0, y: 1, z: 0 } }
        },
        {
            id: 'spawn-b',
            position: { x: 0, y: 1.5, z: -10 },
            headingRad: 0,
            clearance: 3.2,
            support: { hit: true, y: 0, normal: { x: 0, y: 1, z: 0 } }
        },
        {
            id: 'spawn-c',
            position: { x: 24, y: 1.5, z: -10 },
            headingRad: 0,
            clearance: 3.1,
            support: { hit: true, y: 0, normal: { x: 0, y: 1, z: 0 } }
        }
    ],
    constraints: {
        minPairDistance: 10,
        minClearance: 2,
        requireSupport: true
    }
};

const INVALID_INPUT = {
    source: {
        mapId: 'invalid-square',
        seed: 999,
        recipe: 'unit-test',
        generatorVersion: 'v1'
    },
    centerline: [
        { x: -20, y: 0, z: -20 },
        { x: -20, y: 0, z: -20 },
        { x: 20, y: 0, z: 20 },
        { x: 20, y: 0, z: -20 }
    ],
    gateSpecs: [
        { id: 'broken-gate', frameIndex: 10, width: 0, depth: 0 }
    ],
    spawns: [
        {
            id: 'spawn-0',
            position: { x: 0, y: 1.5, z: 0 },
            headingRad: 0,
            clearance: 0.5,
            support: { hit: false }
        },
        {
            id: 'spawn-1',
            position: { x: 3, y: 1.5, z: 0 },
            headingRad: 0,
            clearance: 1.2,
            support: { hit: true, y: 0, normal: { x: 0, y: 1, z: 0 } }
        }
    ],
    constraints: {
        minPairDistance: 8,
        minClearance: 2,
        requireSupport: true
    }
};

function readFixture(name) {
    return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8'));
}

describe('geometry kernel - frames and edges', () => {
    it('canonicalizes clockwise loops and derives stable edge offsets', () => {
        const canonical = canonicalizeLoop(VALID_INPUT.centerline);
        expect(canonical.inputWinding).toBe('cw');
        expect(canonical.winding).toBe('ccw');
        expect(canonical.reversed).toBe(true);

        const frames = deriveTrackFrames(VALID_INPUT.centerline);
        expect(frames.frames).toHaveLength(8);
        expect(frames.frames[0].point).toEqual({ x: 0, y: 0, z: -10 });
        expect(frames.frames[0].tangent).toEqual({ x: 1, y: 0, z: 0 });
        expect(frames.totalLength).toBe(200);

        const edges = deriveEdgesFromFrames(frames, 5);
        expect(edges.leftEdge[0]).toEqual({ x: 0, y: 0, z: -5 });
        expect(edges.rightEdge[0]).toEqual({ x: 0, y: 0, z: -15 });
    });

    it('flags degenerate frame samples without mutating caller input', () => {
        const polyline = [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 }
        ];
        const original = JSON.parse(JSON.stringify(polyline));

        const frames = deriveTrackFrames(polyline, { closed: false });

        expect(frames.degenerateIndices).toEqual([0]);
        expect(polyline).toEqual(original);
    });
});

describe('geometry kernel - oriented gates', () => {
    it('builds gates from canonical frames and detects crossings', () => {
        const frames = deriveTrackFrames(VALID_INPUT.centerline);
        const gate = makeOrientedGate(frames.frames[2], {
            id: 'finish',
            width: 18,
            depth: 4,
            isFinishLine: true
        });

        expect(gate.center).toEqual({ x: 40, y: 0, z: 0 });
        expect(gate.tangent).toEqual({ x: 0, y: 0, z: 1 });
        expect(gate.normal).toEqual({ x: -1, y: 0, z: 0 });
        expect(containsPointInGate({ x: 40, y: 0, z: 0 }, gate)).toBe(true);
        expect(containsPointInGate({ x: 52, y: 0, z: 0 }, gate)).toBe(false);
        expect(segmentCrossesGate({ x: 40, y: 0, z: -3 }, { x: 40, y: 0, z: 3 }, gate)).toBe(true);
        expect(segmentCrossesGate({ x: 55, y: 0, z: -3 }, { x: 55, y: 0, z: 3 }, gate)).toBe(false);
    });
});

describe('geometry kernel - hashes and diagnostics', () => {
    it('keeps geometry hashes stable across key order and quantized float noise', () => {
        const first = {
            source: { b: 2, a: 1 },
            points: [{ x: 1, y: 0, z: 2.0000001 }]
        };
        const second = {
            points: [{ z: 2.0000004, y: 0, x: 1 }],
            source: { a: 1, b: 2 }
        };
        const changed = {
            source: { a: 1, b: 3 },
            points: [{ x: 1, y: 0, z: 2 }]
        };

        expect(hashGeometryBundle(first)).toBe(hashGeometryBundle(second));
        expect(hashGeometryBundle(changed)).not.toBe(hashGeometryBundle(first));
    });

    it('reproduces the checked-in valid and invalid diagnostic artifacts', () => {
        expect(buildGeometryDiagnostics(VALID_INPUT)).toEqual(readFixture('geometry-kernel-valid.json'));
        expect(buildGeometryDiagnostics(INVALID_INPUT)).toEqual(readFixture('geometry-kernel-invalid.json'));
    });

    it('reports machine-readable spawn diagnostics and failure codes', () => {
        const result = validateSpawnSet(INVALID_INPUT.spawns, INVALID_INPUT.constraints);

        expect(result.valid).toBe(false);
        expect(result.minPairDistance).toBe(3);
        expect(result.failures.map((failure) => failure.code)).toContain('support_missing');
        expect(result.failures.map((failure) => failure.code)).toContain('clearance_below_min');
        expect(result.failures.map((failure) => failure.code)).toContain('pair_distance_below_min');
    });
});

describe('geometry kernel - purity guard', () => {
    it('imports and executes without browser globals', async () => {
        expect(globalThis.window).toBeUndefined();
        expect(globalThis.document).toBeUndefined();

        const geometryKernel = await import('../../static/js/geometry/GeometryKernel.js');

        expect(geometryKernel.hashGeometryBundle({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
        expect(geometryKernel.buildGeometryDiagnostics({ centerline: [] }).schema).toBe('geometry-kernel/v1');
    });

    it('contains no forbidden environment or renderer tokens', () => {
        const forbiddenPatterns = [
            /\bDate\.now\b/,
            /\bperformance\.now\b/,
            /\bMath\.random\b/,
            /\bwindow\b/,
            /\bdocument\b/,
            /\bTHREE\b/,
            /\bcreateElement\b/,
            /\bappendChild\b/,
            /\binnerWidth\b/,
            /\binnerHeight\b/
        ];

        const geometryFiles = readdirSync(geometryDir).filter((name) => name.endsWith('.js'));
        expect(geometryFiles.length).toBeGreaterThan(0);

        for (const fileName of geometryFiles) {
            const source = readFileSync(resolve(geometryDir, fileName), 'utf8');
            for (const pattern of forbiddenPatterns) {
                expect(source, `${fileName} should not contain ${pattern}`).not.toMatch(pattern);
            }
        }
    });
});
