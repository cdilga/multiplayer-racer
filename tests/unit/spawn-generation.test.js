import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Track } from '../../static/js/entities/Track.js';
import {
    DEFAULT_MIN_CLEARANCE,
    DEFAULT_MIN_PAIR_DISTANCE,
    generateSpawnsForTrack,
    generateSpawns,
    getSpawnPosition
} from '../../static/js/resources/SpawnGenerator.js';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const trackDir = resolve(__dirname, '../../static/assets/tracks');
const shippedTrackIds = ['oval', 'derby-arena', 'derby-bowl', 'derby-coliseum', 'derby-dunes'];

function loadTrackConfig(trackId) {
    return JSON.parse(readFileSync(resolve(trackDir, `${trackId}.json`), 'utf8'));
}

function makeTrack(trackId) {
    return new Track({ config: loadTrackConfig(trackId) });
}

function makeRunContext(seed, ruleset = 'race') {
    return GameRunContext.create({
        seed,
        ruleset,
        deterministic: true
    });
}

function planarDistance(a, b) {
    const dx = (a.x ?? 0) - (b.x ?? 0);
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return Math.hypot(dx, dz);
}

function isWithinTrack(config, spawn) {
    const geometry = config.geometry || {};
    const x = spawn.position?.x ?? spawn.x ?? 0;
    const z = spawn.position?.z ?? spawn.z ?? 0;

    switch (geometry.type) {
        case 'oval': {
            const radius = Math.hypot(x, z);
            return radius >= geometry.innerRadius && radius <= geometry.outerRadius;
        }
        case 'square': {
            const half = (geometry.diameter || geometry.size || 70) / 2;
            return Math.abs(x) <= half && Math.abs(z) <= half;
        }
        case 'bowl': {
            const radius = (geometry.diameter || 80) / 2;
            return Math.hypot(x, z) <= radius;
        }
        case 'dunes': {
            return Math.hypot(x, z) <= (geometry.rimStart || geometry.radius || 70);
        }
        default:
            return true;
    }
}

function assertValidSpawnSet(trackId, playerCount, seed = 0xC0FFEE) {
    const track = makeTrack(trackId);
    const ruleset = track.config.type === 'derby' ? 'derby' : 'race';
    const result = generateSpawnsForTrack(track, playerCount, makeRunContext(seed, ruleset));
    const reports = result.diagnostics.validation.spawns;

    expect(result.valid, `${trackId} ${playerCount} should validate`).toBe(true);
    expect(result.spawns, `${trackId} ${playerCount} count`).toHaveLength(playerCount);
    expect(result.diagnostics.validation.valid).toBe(true);
    expect(result.diagnostics.validation.minPairDistance).toBeGreaterThanOrEqual(DEFAULT_MIN_PAIR_DISTANCE - 0.01);
    expect(result.diagnostics.rejectedCandidates.counts).toBeDefined();

    reports.forEach((report, index) => {
        const spawn = result.spawns[index];
        expect(report.valid, `${trackId} ${playerCount} spawn ${index} invalid`).toBe(true);
        expect(report.support.hit, `${trackId} ${playerCount} spawn ${index} support`).toBe(true);
        expect(report.clearance, `${trackId} ${playerCount} spawn ${index} clearance`).toBeGreaterThanOrEqual(DEFAULT_MIN_CLEARANCE - 0.01);
        expect(Number.isFinite(report.headingRad), `${trackId} ${playerCount} spawn ${index} heading`).toBe(true);
        expect(isWithinTrack(track.config, spawn), `${trackId} ${playerCount} spawn ${index} in bounds`).toBe(true);
        expect(spawn.position.y).toBeGreaterThan(report.support.y);
    });

    for (let left = 0; left < result.spawns.length; left++) {
        for (let right = left + 1; right < result.spawns.length; right++) {
            expect(
                planarDistance(result.spawns[left].position, result.spawns[right].position),
                `${trackId} ${playerCount} pair ${left}/${right}`
            ).toBeGreaterThanOrEqual(DEFAULT_MIN_PAIR_DISTANCE - 0.01);
        }
    }

    return result;
}

describe('spawn generation', () => {
    it.each(shippedTrackIds)('generates 32 and 64 validated spawns for %s', (trackId) => {
        for (const count of [32, 64]) {
            assertValidSpawnSet(trackId, count, 0xCAFE00 + count);
        }
    });

    it('is deterministic for the same seed and changes across seeds on shipped maps', () => {
        const track = makeTrack('derby-arena');
        const sameA = generateSpawnsForTrack(track, 64, makeRunContext(12345, 'derby'));
        const sameB = generateSpawnsForTrack(track, 64, makeRunContext(12345, 'derby'));
        const different = generateSpawnsForTrack(track, 64, makeRunContext(54321, 'derby'));

        expect(sameA.spawns).toEqual(sameB.spawns);

        let changed = 0;
        for (let index = 0; index < sameA.spawns.length; index++) {
            const a = sameA.spawns[index].position;
            const b = different.spawns[index].position;
            if (planarDistance(a, b) > 0.25) changed++;
        }
        expect(changed).toBeGreaterThan(0);
    });

    it('does not modulo-wrap authored or generated spawn lookups', () => {
        const track = makeTrack('derby-arena');

        expect(track.getSpawnPosition(16)).toBeNull();

        const generation = assertValidSpawnSet('derby-arena', 64, 424242);
        expect(track.setGeneratedSpawns(generation)).toBe(true);

        const spawn0 = track.getSpawnPosition(0);
        const spawn16 = track.getSpawnPosition(16);
        const spawn63 = track.getSpawnPosition(63);

        expect(spawn16).not.toBeNull();
        expect(spawn63).not.toBeNull();
        expect(planarDistance(spawn0, spawn16)).toBeGreaterThan(1);
        expect(track.getSpawnPosition(64)).toBeNull();
        expect(getSpawnPosition(generation.spawns, 64)).toBeNull();
    });

    it('stores generated diagnostics on the track for runtime inspection', () => {
        const track = makeTrack('oval');
        const generation = assertValidSpawnSet('oval', 32, 20260701);

        expect(track.setGeneratedSpawns(generation)).toBe(true);
        expect(track.spawnGenerationMetadata.trackId).toBe('oval');
        expect(track.spawnGenerationMetadata.playerCount).toBe(32);
        expect(track.spawnGenerationMetadata.validation.valid).toBe(true);
        expect(track.getAllSpawnPositions()).toHaveLength(32);
    });
});

describe('nocap spawn generator (br-nocap-spawn-generator)', () => {
    // The promoted no-cap public seam: generateSpawns(track, N) for arbitrary N.
    it.each(['oval', 'derby-arena', 'derby-bowl'])('generateSpawns(%s, N) yields N valid non-overlapping on-ground spawns at high N', (trackId) => {
        const track = makeTrack(trackId);
        for (const n of [48, 60, 100]) {
            const result = generateSpawns(track, n, { seed: 777 });
            expect(result.valid, `${trackId} ${n} valid`).toBe(true);
            expect(result.spawns, `${trackId} ${n} count`).toHaveLength(n);

            const reports = result.diagnostics.validation.spawns;
            reports.forEach((report, i) => {
                expect(report.support.hit, `${trackId} ${n} spawn ${i} on-ground`).toBe(true);
                expect(Number.isFinite(report.headingRad), `${trackId} ${n} spawn ${i} heading`).toBe(true);
                expect(isWithinTrack(track.config, result.spawns[i]), `${trackId} ${n} spawn ${i} in bounds`).toBe(true);
            });
            // No overlap: nearest pair clears the minimum (no player-17-on-player-1).
            expect(result.diagnostics.validation.minPairDistance).toBeGreaterThanOrEqual(DEFAULT_MIN_PAIR_DISTANCE - 0.01);
        }
    });

    it('is deterministic: same track + N + seed -> identical spawn set', () => {
        const track = makeTrack('derby-arena');
        const a = generateSpawns(track, 64, { seed: 'sweep-1' });
        const b = generateSpawns(track, 64, { seed: 'sweep-1' });
        const c = generateSpawns(track, 64, { seed: 'sweep-2' });
        expect(JSON.stringify(a.spawns)).toBe(JSON.stringify(b.spawns));
        expect(JSON.stringify(a.spawns)).not.toBe(JSON.stringify(c.spawns));
    });
});
