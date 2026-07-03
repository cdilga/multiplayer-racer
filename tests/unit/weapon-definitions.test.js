/**
 * Weapon definitions coverage (bead br-weapon-test-lab-zas).
 *
 * Proves the production weapon catalog is well-formed: the exported type/rarity
 * constants are consistent, and the real WeaponSystem loads all eight weapons
 * with the fields the lab + game rely on.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { WEAPON_TYPES, RARITY_TIERS, WeaponSystem } from '../../static/js/systems/WeaponSystem.js';

const EXPECTED_WEAPONS = [
    'missile', 'mine', 'boost', 'oil-slick', 'sniper', 'shield', 'emp', 'flamethrower'
];

const EXPECTED_BEHAVIOR_TYPE = {
    missile: 'projectile',
    mine: 'deployable',
    boost: 'buff',
    'oil-slick': 'zone',
    sniper: 'hitscan',
    shield: 'buff',
    emp: 'aoe',
    flamethrower: 'continuous'
};

describe('weapon definitions', () => {
    let defs;

    beforeAll(async () => {
        const ws = new WeaponSystem();
        await ws.init();
        defs = ws.weaponDefs;
    });

    it('exports a type id for every weapon', () => {
        const typeValues = new Set(Object.values(WEAPON_TYPES));
        expect(typeValues.size).toBe(EXPECTED_WEAPONS.length);
        for (const id of EXPECTED_WEAPONS) {
            expect(typeValues.has(id)).toBe(true);
        }
    });

    it('loads all eight production weapon definitions', () => {
        expect(defs.size).toBe(EXPECTED_WEAPONS.length);
        for (const id of EXPECTED_WEAPONS) {
            expect(defs.has(id)).toBe(true);
        }
    });

    it('gives each weapon the fields the lab and game read', () => {
        for (const id of EXPECTED_WEAPONS) {
            const w = defs.get(id);
            expect(w.id).toBe(id);
            expect(typeof w.name).toBe('string');
            expect(w.name.length).toBeGreaterThan(0);
            expect(w.behavior?.type).toBe(EXPECTED_BEHAVIOR_TYPE[id]);
            expect(w.damage).toBeTypeOf('object');
            expect(typeof w.damage.amount).toBe('number');
            expect(w.ui?.color).toMatch(/^#[0-9a-fA-F]{6}$/);
            expect(typeof w.ui?.description).toBe('string');
        }
    });


    it('includes stylized pickup visual metadata for all weapons', async () => {
        const ws = new WeaponSystem();
        await ws.init();

        for (const id of EXPECTED_WEAPONS) {
            const weapon = defs.get(id);
            expect(weapon.pickupVisual).toBeTypeOf('object');
            expect(weapon.pickupVisual.geometry).toBeTruthy();
            expect(['box', 'cone', 'sphere', 'cylinder', 'torus']).toContain(weapon.pickupVisual.geometry);
            expect(Array.isArray(weapon.pickupVisual.geometryScale)).toBe(true);
            expect(weapon.pickupVisual.geometryScale.length).toBe(3);
            expect(weapon.pickupVisual.materialType === 'flat' || weapon.pickupVisual.materialType === 'toon').toBe(true);
        }
    });

    it('keeps rarity tiers consistent with defined weapons', () => {
        const known = new Set(EXPECTED_WEAPONS);
        let tierWeaponCount = 0;
        for (const tier of Object.values(RARITY_TIERS)) {
            expect(tier.weight).toBeGreaterThan(0);
            expect(Array.isArray(tier.weapons)).toBe(true);
            for (const id of tier.weapons) {
                expect(known.has(id)).toBe(true); // no rarity tier references a phantom weapon
                tierWeaponCount += 1;
            }
        }
        // Every weapon appears in exactly one rarity tier.
        expect(tierWeaponCount).toBe(EXPECTED_WEAPONS.length);
    });

    it('sets damaging weapons above zero and support weapons at zero', () => {
        expect(defs.get('missile').damage.amount).toBe(70);
        expect(defs.get('mine').damage.amount).toBe(85);
        expect(defs.get('sniper').damage.amount).toBe(125);
        expect(defs.get('flamethrower').damage.amount).toBe(10);
        // Support / movement weapons deal no direct damage.
        expect(defs.get('boost').damage.amount).toBe(0);
        expect(defs.get('oil-slick').damage.amount).toBe(0);
        expect(defs.get('shield').damage.amount).toBe(0);
        expect(defs.get('emp').damage.amount).toBe(0);
    });
});
