import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMapData, MAP_VALIDATOR_VERSION } from '../../static/js/resources/mapValidator.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const trackDir = resolve(repoRoot, 'static/assets/tracks');
const artifactDir = resolve(repoRoot, 'artifacts/br-map-authoring-tool-j3i.2');
const artifactPath = resolve(artifactDir, 'validation-reports.json');

function loadTrack(id) {
    return JSON.parse(readFileSync(resolve(trackDir, `${id}.json`), 'utf8'));
}

const SHIPPED = {
    oval: { ruleset: 'race', playerCount: 4 },
    'derby-arena': { ruleset: 'derby', playerCount: 8 },
    'derby-bowl': { ruleset: 'derby', playerCount: 8 },
    'derby-coliseum': { ruleset: 'derby', playerCount: 8 },
    'derby-dunes': { ruleset: 'derby', playerCount: 8 }
};

function codes(report) {
    return report.reasons.map((r) => r.code);
}

describe('map validator - shipped maps are valid', () => {
    for (const [id, ctx] of Object.entries(SHIPPED)) {
        it(`${id} validates for ${ctx.ruleset} @ ${ctx.playerCount} players`, () => {
            const report = validateMapData(loadTrack(id), {
                ...ctx,
                requestedTrackId: id,
                lateJoinCapacity: 16
            });
            expect(report.reasons, JSON.stringify(report.reasons)).toEqual([]);
            expect(report.ok).toBe(true);
            expect(report.resolvedMapId).toBe(id);
            expect(report.validatorVersion).toBe(MAP_VALIDATOR_VERSION);
        });
    }
});

describe('map validator - fail-loud on invalid maps', () => {
    it('rejects a null/empty map', () => {
        expect(codes(validateMapData(null, {}))).toContain('map_data_missing');
    });

    it('rejects an incompatible ruleset without coercion', () => {
        // A derby arena validated under the race ruleset must fail, not coerce.
        const report = validateMapData(loadTrack('derby-arena'), { ruleset: 'race', playerCount: 4 });
        expect(report.ok).toBe(false);
        expect(codes(report)).toContain('incompatible_ruleset');
        expect(report.resolvedMapId).toBe('derby-arena');
    });

    it('rejects missing geometry', () => {
        const map = { id: 'broken', type: 'derby', derby: {}, spawn: { positions: [{ x: 0, z: 0 }] }, physics: {} };
        expect(codes(validateMapData(map, { ruleset: 'derby', playerCount: 1 }))).toContain('missing_geometry');
    });

    it('rejects an open derby boundary (no walls)', () => {
        const map = {
            id: 'open-derby', type: 'derby', derby: {},
            geometry: { type: 'square', diameter: 70, wallHeight: 0 },
            spawn: { positions: [{ x: 0, z: 0 }] }, physics: {}
        };
        expect(codes(validateMapData(map, { ruleset: 'derby', playerCount: 1 }))).toContain('open_derby_boundary');
    });

    it('rejects a race map missing checkpoints and finish line', () => {
        const map = {
            id: 'no-cp',
            geometry: { type: 'oval', innerRadius: 35, outerRadius: 55, trackWidth: 20 },
            spawn: { positions: [{ x: 0, z: 0 }] }, physics: {}, checkpoints: []
        };
        expect(codes(validateMapData(map, { ruleset: 'race', playerCount: 1 }))).toContain('missing_checkpoints');
    });

    it('rejects degenerate (collinear) checkpoint winding', () => {
        const map = {
            id: 'flat-cp',
            geometry: { type: 'oval', innerRadius: 35, outerRadius: 55, trackWidth: 20 },
            spawn: { positions: [{ x: 0, z: 0 }] }, physics: {},
            checkpoints: [
                { id: 0, position: { x: 0, z: 0 }, isFinishLine: true },
                { id: 1, position: { x: 10, z: 0 } },
                { id: 2, position: { x: 20, z: 0 } },
                { id: 3, position: { x: 30, z: 0 } }
            ]
        };
        expect(codes(validateMapData(map, { ruleset: 'race', playerCount: 1 }))).toContain('bad_checkpoint_winding');
    });

    it('rejects insufficient spawn capacity for the player count', () => {
        const report = validateMapData(loadTrack('oval'), { ruleset: 'race', playerCount: 32 });
        expect(codes(report)).toContain('insufficient_spawn_capacity');
    });

    it('rejects overlapping (unsafe) spawns', () => {
        const map = {
            id: 'overlap', type: 'derby', derby: {},
            geometry: { type: 'square', diameter: 70, wallHeight: 12 },
            physics: {},
            spawn: { positions: [{ x: 0, z: 0 }, { x: 0, z: 0 }] }
        };
        expect(codes(validateMapData(map, { ruleset: 'derby', playerCount: 2 }))).toContain('unsafe_spawn_overlap');
    });

    it('rejects a pickup/weapon zone overlapping a spawn', () => {
        const map = {
            id: 'zone-overlap', type: 'derby', derby: {},
            geometry: { type: 'square', diameter: 70, wallHeight: 12 },
            physics: {},
            spawn: { positions: [{ x: 5, z: 5 }, { x: -5, z: -5 }] },
            weapons: { enabled: true, zones: [{ id: 'z1', x: 5, z: 5, radius: 2 }] }
        };
        expect(codes(validateMapData(map, { ruleset: 'derby', playerCount: 2 }))).toContain('pickup_zone_overlaps_spawn');
    });

    it('rejects a map with no physics (render/physics misalignment)', () => {
        const map = {
            id: 'no-physics', type: 'derby', derby: {},
            geometry: { type: 'square', diameter: 70, wallHeight: 12 },
            spawn: { positions: [{ x: 0, z: 0 }] }
        };
        expect(codes(validateMapData(map, { ruleset: 'derby', playerCount: 1 }))).toContain('missing_physics');
    });
});

describe('map validator - evidence artifact', () => {
    it('persists sample valid + invalid ValidationReports', () => {
        const valid = validateMapData(loadTrack('derby-arena'), {
            ruleset: 'derby', playerCount: 8, lateJoinCapacity: 16, requestedTrackId: 'derby-arena'
        });
        const invalid = validateMapData(loadTrack('oval'), {
            ruleset: 'derby', playerCount: 32, requestedTrackId: 'oval'
        });
        expect(valid.ok).toBe(true);
        expect(invalid.ok).toBe(false);
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(artifactPath, JSON.stringify({
            bead: 'br-map-authoring-tool-j3i.2',
            validatorVersion: MAP_VALIDATOR_VERSION,
            valid,
            invalid
        }, null, 2) + '\n');
        expect(existsSync(artifactPath)).toBe(true);
    });
});
