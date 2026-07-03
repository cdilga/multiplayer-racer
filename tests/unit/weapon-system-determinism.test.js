/**
 * Weapon system determinism (bead br-weapon-test-lab-zas).
 *
 * The lab's value depends on reproducibility: the same scenario + seed must
 * produce byte-identical diagnostics (selection, placement, timing, damage),
 * while a different seed must still produce a valid run. This guards against
 * accidental reintroduction of Date.now / Math.random into weapon paths.
 */
import { describe, it, expect } from 'vitest';
import { runScenario } from '../../static/js/weaponLab/scenarios.js';
import { createLabHarness } from '../../static/js/weaponLab/harness.js';

describe('weapon system determinism', () => {
    it('reproduces identical diagnostics for the same seed (pickup spawning)', async () => {
        const a = await runScenario('pickup-field', { seed: 42 });
        const b = await runScenario('pickup-field', { seed: 42 });
        expect(b.diagnostics).toEqual(a.diagnostics);
        expect(b.diagnostics.determinism.hash).toBe(a.diagnostics.determinism.hash);
        // Spawning actually happened (otherwise equality would be trivial).
        expect(a.diagnostics.spawnedWeapons.length).toBeGreaterThan(0);
    });

    it('reproduces identical damage records for the same seed (combat)', async () => {
        const a = await runScenario('flamethrower-cone', { seed: 7 });
        const b = await runScenario('flamethrower-cone', { seed: 7 });
        expect(b.diagnostics.damage).toEqual(a.diagnostics.damage);
        expect(a.diagnostics.damage.length).toBeGreaterThan(0);
    });

    it('changes pickup placement for a different seed but stays valid', async () => {
        const s1 = await runScenario('pickup-field', { seed: 1 });
        const s2 = await runScenario('pickup-field', { seed: 2 });
        // Both runs are valid (all checks pass)...
        expect(s1.checks.every((c) => c.pass)).toBe(true);
        expect(s2.checks.every((c) => c.pass)).toBe(true);
        // ...but a different seed yields a different spawn layout.
        expect(s2.diagnostics.spawnedWeapons).not.toEqual(s1.diagnostics.spawnedWeapons);
        expect(s2.diagnostics.determinism.hash).not.toBe(s1.diagnostics.determinism.hash);
    });

    it('drives weapon timing from the injected SimClock, not wall time', async () => {
        // Two harnesses created "at the same time" but stepped differently must
        // diverge purely from sim steps, proving no wall-clock dependence.
        const h = await createLabHarness({ seed: 99 }).init();
        h.addVehicle({ id: 'owner', playerId: 1, x: 0, z: 0, heading: 0 });
        h.addVehicle({ id: 'victim', playerId: 2, x: 0, z: -2, heading: 0 });
        h.giveWeapon(1, 'mine');
        h.fire(1);
        h.advanceSeconds(0.5);
        expect(h.totalDamageTo('victim')).toBe(0); // sim time 0.5s < 1s arm delay
        expect(h.clock.nowMs()).toBeCloseTo(500, 0);
        h.advanceSeconds(0.7);
        expect(h.totalDamageTo('victim')).toBeGreaterThan(0); // sim time 1.2s > arm delay
    });
});
