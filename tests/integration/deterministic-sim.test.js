import { describe, it, expect } from 'vitest';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';
import { EventBus } from '../../static/js/engine/EventBus.js';
import { hashSeed } from '../../static/js/engine/Rng.js';
import * as WeaponMod from '../../static/js/systems/WeaponSystem.js';
import { generateTrackConfig } from '../../static/js/resources/ProceduralTrackGenerator.js';

const WeaponSystem = WeaponMod.WeaponSystem || globalThis.WeaponSystem;

const FIXED_DT = 1 / 60;

/**
 * Quantize a float to 1e-3 so hashes ignore sub-millimetre / sub-ms float noise.
 * @param {number} n
 * @returns {number}
 */
const q = (n) => Math.round(n * 1000) / 1000;

/**
 * Fold a string into a stable hex digest (xmur3 via hashSeed).
 * @param {string} s
 * @returns {string}
 */
const digest = (s) => hashSeed(s).toString(16).padStart(8, '0');

/**
 * Representative headless sim: drives the REAL migrated WeaponSystem plus map +
 * spawn generation off one GameRunContext, advancing the sim clock with a
 * fixed-timestep accumulator fed at a given render fps. Mirrors GameLoop's
 * accumulator so this is a faithful frame-pacing model.
 *
 * @param {Object} opts
 * @param {number} opts.seed
 * @param {string} opts.ruleset - 'race' | 'derby'
 * @param {number} opts.fps - render frames per second
 * @param {number} opts.simSeconds - simulated duration
 * @param {string} [opts.tuningProfileId]
 * @returns {Promise<Object>} deterministic run summary + hashes
 */
async function runSim({ seed, ruleset, fps, simSeconds, tuningProfileId = 'arcade' }) {
    const ctx = GameRunContext.create({
        seed, ruleset, deterministic: true, fixedDt: FIXED_DT,
        tuningProfileId, tuning: { grip: 1.0, boost: 1.5 }
    });

    // --- Map generation (off the 'map' stream) ---
    const track = generateTrackConfig(undefined, ctx);
    const mapHash = digest(`${track.seed}|${JSON.stringify(track.geometry)}`);

    // --- Spawn generation (off the 'spawn' stream): 8 grid-ish start slots ---
    const spawn = ctx.stream('spawn');
    const spawns = Array.from({ length: 8 }, () => ({
        x: q(spawn.range(-40, 40)),
        z: q(spawn.range(-40, 40)),
        heading: q(spawn.range(0, Math.PI * 2))
    }));
    const spawnHash = digest(JSON.stringify(spawns));

    // --- Weapon system (real migrated gameplay code) ---
    const bus = new EventBus();
    const weapons = new WeaponSystem({ eventBus: bus });
    weapons.setRunContext(ctx);
    await weapons.init();
    weapons.enabled = true;
    weapons.spawnArea = { type: 'circle', radius: 30 };

    // Record the pickup schedule: when (tick), which weapon, where, plus the
    // cadence timer expiry (nextSpawnTime) at the moment of each spawn.
    const schedule = [];
    bus.on('weapon:spawned', (e) => {
        schedule.push({
            tick: ctx.tick,
            weaponId: e.weaponId,
            x: q(e.position.x),
            z: q(e.position.z)
        });
    });

    weapons.start();

    // --- Fixed-timestep accumulator driven at `fps` ---
    const frameDt = 1 / fps;
    const totalFrames = Math.round(simSeconds * fps);
    let acc = 0;
    let ticks = 0;
    for (let f = 0; f < totalFrames; f++) {
        acc += frameDt;
        // Epsilon mirrors a robust fixed-step loop; keeps step counts exact for
        // cadences that are rational multiples of the fixed timestep.
        while (acc >= FIXED_DT - 1e-9) {
            acc -= FIXED_DT;
            ctx.clock.step(1);
            weapons.update(FIXED_DT);
            ticks++;
        }
    }

    const scheduleHash = digest(JSON.stringify(schedule));
    const finalHash = digest([
        ruleset,
        ticks,
        mapHash,
        spawnHash,
        scheduleHash,
        weapons.pickups.size,
        q(weapons.nextSpawnTime),
        ctx.tuningHash
    ].join('|'));

    return {
        seed, ruleset, fps, ticks,
        mapSeed: track.seed, mapHash, spawnHash, scheduleHash,
        spawnCount: schedule.length, finalHash, tuningHash: ctx.tuningHash
    };
}

describe('deterministic sim - same seed+tuning+script is stable', () => {
    it('race: identical hashes across two runs of the same seed', async () => {
        const a = await runSim({ seed: 4242, ruleset: 'race', fps: 60, simSeconds: 40 });
        const b = await runSim({ seed: 4242, ruleset: 'race', fps: 60, simSeconds: 40 });
        expect(a.mapHash).toBe(b.mapHash);
        expect(a.spawnHash).toBe(b.spawnHash);
        expect(a.scheduleHash).toBe(b.scheduleHash);
        expect(a.finalHash).toBe(b.finalHash);
        expect(a.spawnCount).toBeGreaterThan(0); // pickups actually spawned
    });

    it('derby: identical hashes across two runs of the same seed', async () => {
        const a = await runSim({ seed: 99, ruleset: 'derby', fps: 60, simSeconds: 40 });
        const b = await runSim({ seed: 99, ruleset: 'derby', fps: 60, simSeconds: 40 });
        expect(a.finalHash).toBe(b.finalHash);
    });

    it('different seeds diverge', async () => {
        const a = await runSim({ seed: 1, ruleset: 'race', fps: 60, simSeconds: 40 });
        const b = await runSim({ seed: 2, ruleset: 'race', fps: 60, simSeconds: 40 });
        expect(a.finalHash).not.toBe(b.finalHash);
        expect(a.mapHash).not.toBe(b.mapHash);
    });

    it('different tuning profile changes the recorded tuning hash', async () => {
        const a = await runSim({ seed: 7, ruleset: 'race', fps: 60, simSeconds: 10, tuningProfileId: 'arcade' });
        const b = await runSim({ seed: 7, ruleset: 'race', fps: 60, simSeconds: 10, tuningProfileId: 'sim' });
        expect(a.tuningHash).not.toBe(b.tuningHash);
    });
});

describe('deterministic sim - frame pacing (30/60/120 fps)', () => {
    it('race: same sim tick count and final hash across pacing', async () => {
        const r30 = await runSim({ seed: 4242, ruleset: 'race', fps: 30, simSeconds: 40 });
        const r60 = await runSim({ seed: 4242, ruleset: 'race', fps: 60, simSeconds: 40 });
        const r120 = await runSim({ seed: 4242, ruleset: 'race', fps: 120, simSeconds: 40 });

        expect(r30.ticks).toBe(r60.ticks);
        expect(r60.ticks).toBe(r120.ticks);
        expect(r60.ticks).toBe(40 * 60); // 40s @ 60Hz

        expect(r30.finalHash).toBe(r60.finalHash);
        expect(r60.finalHash).toBe(r120.finalHash);
        expect(r30.scheduleHash).toBe(r120.scheduleHash);
    });

    it('derby: same sim tick count and final hash across pacing', async () => {
        const r30 = await runSim({ seed: 99, ruleset: 'derby', fps: 30, simSeconds: 40 });
        const r60 = await runSim({ seed: 99, ruleset: 'derby', fps: 60, simSeconds: 40 });
        const r120 = await runSim({ seed: 99, ruleset: 'derby', fps: 120, simSeconds: 40 });
        expect(r30.ticks).toBe(r60.ticks);
        expect(r60.ticks).toBe(r120.ticks);
        expect(r30.finalHash).toBe(r60.finalHash);
        expect(r60.finalHash).toBe(r120.finalHash);
    });
});
