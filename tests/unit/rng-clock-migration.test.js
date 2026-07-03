import { describe, it, expect } from 'vitest';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';
import { EventBus } from '../../static/js/engine/EventBus.js';
import RaceSystemDefault, * as RaceMod from '../../static/js/systems/RaceSystem.js';
import DamageSystemDefault, * as DamageMod from '../../static/js/systems/DamageSystem.js';
import WeaponSystemDefault, * as WeaponMod from '../../static/js/systems/WeaponSystem.js';
import { generateTrackConfig } from '../../static/js/resources/ProceduralTrackGenerator.js';

// These systems use global-style class declarations; grab whichever binding the
// bundler exposes (named, default, or window global).
const RaceSystem = RaceMod.RaceSystem || RaceSystemDefault || globalThis.RaceSystem;
const DamageSystem = DamageMod.DamageSystem || DamageSystemDefault || globalThis.DamageSystem;
const WeaponSystem = WeaponMod.WeaponSystem || WeaponSystemDefault || globalThis.WeaponSystem;

const ctx = (seed) => GameRunContext.create({ seed, ruleset: 'derby', deterministic: true });

describe('RaceSystem clock migration', () => {
    it('race timing reads deterministic sim time, not wall time', () => {
        const c = ctx(1);
        const race = new RaceSystem({ eventBus: new EventBus() });
        race.setRunContext(c);
        race.initialized = true; // skip async init for a pure timing check
        race.startRace();
        expect(race.raceStartTime).toBe(0);      // sim time at tick 0
        expect(race.getRaceTime()).toBe(0);

        c.clock.step(60);                          // 1 simulated second @ 60Hz
        expect(race.getRaceTime()).toBeCloseTo(1000, 6);
        c.clock.step(60);
        expect(race.getRaceTime()).toBeCloseTo(2000, 6);
    });

    it('falls back to a real clock when no context is attached (no throw)', () => {
        const race = new RaceSystem({ eventBus: new EventBus() });
        race.initialized = true;
        race.startRace();
        expect(typeof race.getRaceTime()).toBe('number');
    });
});

describe('DamageSystem clock migration', () => {
    it('collision cooldowns expire on sim time', async () => {
        const c = ctx(2);
        const dmg = new DamageSystem({ eventBus: new EventBus() });
        dmg.setRunContext(c);
        await dmg.init();

        dmg.collisionCooldowns.set('a-b', dmg._nowMs() + dmg.cooldownDuration); // expire at 500ms
        c.clock.step(24); // 400ms - not yet expired
        dmg.update(1 / 60);
        expect(dmg.collisionCooldowns.has('a-b')).toBe(true);

        c.clock.step(12); // now 600ms - expired
        dmg.update(1 / 60);
        expect(dmg.collisionCooldowns.has('a-b')).toBe(false);
    });
});

describe('WeaponSystem RNG + clock migration', () => {
    async function makeWeapons(seed) {
        const w = new WeaponSystem({ eventBus: new EventBus() });
        w.setRunContext(ctx(seed));
        await w.init();
        return w;
    }

    it('weapon selection is identical for the same seed', async () => {
        const a = await makeWeapons(7);
        const b = await makeWeapons(7);
        const selA = Array.from({ length: 12 }, () => a._selectRandomWeapon()?.id);
        const selB = Array.from({ length: 12 }, () => b._selectRandomWeapon()?.id);
        expect(selA).toEqual(selB);
        expect(selA.every((x) => typeof x === 'string')).toBe(true);
    });

    it('pickup placement is identical for the same seed and differs across seeds', async () => {
        const a = await makeWeapons(7);
        const b = await makeWeapons(7);
        const c = await makeWeapons(8);
        const posA = Array.from({ length: 10 }, () => a._getRandomSpawnPosition());
        const posB = Array.from({ length: 10 }, () => b._getRandomSpawnPosition());
        const posC = Array.from({ length: 10 }, () => c._getRandomSpawnPosition());
        expect(posA).toEqual(posB);
        expect(posA).not.toEqual(posC);
    });

    it('spawn cadence (nextSpawnTime) is deterministic and uses sim time', async () => {
        const a = await makeWeapons(9);
        const b = await makeWeapons(9);
        a._scheduleNextSpawn();
        b._scheduleNextSpawn();
        expect(a.nextSpawnTime).toBe(b.nextSpawnTime);
        // At sim tick 0, nextSpawnTime == interval (seconds) drawn from the stream.
        expect(a.nextSpawnTime).toBeGreaterThan(0);
    });

    it('weapon RNG draws come from the named "weapons" stream', async () => {
        const c = ctx(123);
        const w = new WeaponSystem({ eventBus: new EventBus() });
        w.setRunContext(c);
        await w.init();
        // The system's stream is the same object as the context weapons stream.
        expect(w._wrng()).toBe(c.stream('weapons'));
        // Drawing from the gameplay stream does not perturb weapons (independence).
        const ref = ctx(123);
        ref.stream('gameplay').next();
        ref.stream('gameplay').next();
        expect(w._wrng().next()).toBe(ref.stream('weapons').next());
    });
});

describe('ProceduralTrackGenerator seed migration', () => {
    const sig = (t) => JSON.stringify(t.geometry);

    it('explicit seed is reproducible', () => {
        const a = generateTrackConfig(12345);
        const b = generateTrackConfig(12345);
        expect(a.seed).toBe(12345);
        expect(sig(a)).toBe(sig(b));
    });

    it('fallback seed comes from the run context map stream (deterministic)', () => {
        const a = generateTrackConfig(undefined, ctx(55));
        const b = generateTrackConfig(undefined, ctx(55));
        expect(a.seed).toBe(b.seed);
        expect(sig(a)).toBe(sig(b));
        // Different run seed -> different track seed.
        const d = generateTrackConfig(undefined, ctx(56));
        expect(d.seed).not.toBe(a.seed);
    });
});
