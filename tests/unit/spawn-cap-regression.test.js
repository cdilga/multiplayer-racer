import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Track } from '../../static/js/entities/Track.js';
import { generateSpawnsForTrack } from '../../static/js/resources/SpawnGenerator.js';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const trackDir = resolve(__dirname, '../../static/assets/tracks');

function loadTrackConfig(trackId) {
    return JSON.parse(readFileSync(resolve(trackDir, `${trackId}.json`), 'utf8'));
}

function makeRunContext(seed, ruleset) {
    return GameRunContext.create({
        seed,
        ruleset,
        deterministic: true
    });
}

describe('spawn cap regression - br-fb-spawncap-qi9', () => {
    it('returns null instead of modulo-wrapping when only authored spawns exist', () => {
        const track = new Track({ config: loadTrackConfig('derby-arena') });

        const spawn0 = track.getSpawnPosition(0);
        const spawn1 = track.getSpawnPosition(1);

        expect(spawn0).not.toBeNull();
        expect(spawn1).not.toBeNull();
        expect(track.getSpawnPosition(16)).toBeNull();
        expect(track.getSpawnPosition(32)).toBeNull();
    });

    it('provides unique generated spawns for 17+ players without reusing player 1', () => {
        const track = new Track({ config: loadTrackConfig('derby-arena') });
        const generation = generateSpawnsForTrack(track, 64, makeRunContext(12345, 'derby'));

        expect(generation.valid).toBe(true);
        expect(generation.spawns).toHaveLength(64);
        expect(track.setGeneratedSpawns(generation)).toBe(true);

        const spawn0 = track.getSpawnPosition(0);
        const spawn16 = track.getSpawnPosition(16);
        const spawn17 = track.getSpawnPosition(17);
        const spawn63 = track.getSpawnPosition(63);

        expect(spawn16).not.toBeNull();
        expect(spawn17).not.toBeNull();
        expect(spawn63).not.toBeNull();
        expect(Math.hypot(spawn17.x - spawn0.x, spawn17.z - spawn0.z)).toBeGreaterThan(1);
        expect(track.getSpawnPosition(64)).toBeNull();
    });

    it('preserves inspectable generation metadata after installation', () => {
        const track = new Track({ config: loadTrackConfig('oval') });
        const generation = generateSpawnsForTrack(track, 32, makeRunContext(20260701, 'race'));

        expect(track.setGeneratedSpawns(generation)).toBe(true);
        expect(track.spawnGenerationMetadata.playerCount).toBe(32);
        expect(track.spawnGenerationMetadata.generatedCount).toBe(26);
        expect(track.spawnGenerationMetadata.validation.valid).toBe(true);
    });
});
