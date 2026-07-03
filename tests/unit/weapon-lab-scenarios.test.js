/**
 * Weapon Lab scenario coverage (bead br-weapon-test-lab-zas).
 *
 * Runs every lab preset against the REAL WeaponSystem and asserts each
 * scenario's production-behaviour checks pass: missile hit, mine arm/explode,
 * oil friction toggle/clear, shield block, EMP stun, flamethrower cone, and
 * deterministic pickup spawning. Also proves preset reset/cleanup.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SEED, runScenario, runScenarioWithHarness, runAllScenarios, SCENARIOS } from '../../static/js/weaponLab/scenarios.js';

function failedChecks(result) {
    return result.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`);
}

describe('weapon lab scenarios', () => {
    it('registers the documented presets', () => {
        const ids = SCENARIOS.map((s) => s.id);
        expect(ids).toEqual([
            'pickup-field',
            'missile-chase',
            'mine-arming',
            'oil-slick',
            'shield-block',
            'emp-stun',
            'flamethrower-cone'
        ]);
    });

    for (const scenario of SCENARIOS) {
        it(`passes all checks: ${scenario.id}`, async () => {
            const result = await runScenario(scenario.id);
            expect(result.checks.length).toBeGreaterThan(0);
            // Surface failing check names/details in the assertion message.
            expect(failedChecks(result)).toEqual([]);
            expect(result.checks.every((c) => c.pass)).toBe(true);
        });
    }

    it('every scenario ends with cleared transient state (reset/cleanup)', async () => {
        const results = await runAllScenarios();
        for (const result of results) {
            const cleanup = result.checks.find((c) => c.name.startsWith('cleanup'));
            expect(cleanup, `cleanup check missing for ${result.id}`).toBeTruthy();
            expect(cleanup.pass).toBe(true);
        }
    });

    it('rejects an unknown scenario id', async () => {
        await expect(runScenario('does-not-exist')).rejects.toThrow(/unknown scenario/);
    });

    it('produces machine-readable diagnostics naming production paths', async () => {
        const result = await runScenario('missile-chase');
        expect(result.diagnostics.productionPaths).toContain('static/js/systems/WeaponSystem.js');
        expect(result.diagnostics.productionPaths).toContain('static/js/resources/TrackFactory.js');
        expect(result.diagnostics.schema).toBe('jj.debugLab.diagnostics.v1');
        expect(result.diagnostics.trackContext?.source).toBe('TrackFactory-backed');
        expect(result.diagnostics.trackContext?.trackId).toBe('derby-bowl');
        expect(typeof result.diagnostics.determinism?.hash).toBe('string');
        expect(result.diagnostics.seed).toBeTypeOf('number');
        expect(Array.isArray(result.diagnostics.damage)).toBe(true);
        expect(result.scenario.schema).toBe('jj.weaponLabScenario.v1');
        expect(result.scenario.track?.trackId).toBe('derby-bowl');
        expect(result.scenario.diagnosticsHash).toBe(result.diagnostics.determinism.hash);
        // The diagnostics must round-trip through JSON unchanged (machine-readable).
        expect(() => JSON.parse(JSON.stringify(result.diagnostics))).not.toThrow();
    });

    it('applies imported actors and weapon overrides through harness-backed execution', async () => {
        const { result, harness } = await runScenarioWithHarness('missile-chase', {
            seed: DEFAULT_SEED,
            actors: [
                { id: 'shooter', playerId: 1, x: 0, z: 0, heading: 0 },
                { id: 'target', playerId: 2, x: 0, z: 15, heading: 0 }
            ],
            weaponOverrides: {
                missile: {
                    damage: {
                        amount: 123
                    }
                }
            }
        });

        expect(result).toBeTruthy();
        expect(harness).toBeTruthy();
        expect(result.diagnostics.state?.actors).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'shooter' }),
            expect.objectContaining({ id: 'target' })
        ]));
        expect(harness.getVehicle('shooter')).toBeTruthy();
        expect(harness.getVehicle('target')).toBeTruthy();
        expect(harness.totalDamageTo('target')).toBe(123);
    });
});
