import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { WeaponSystem } from '../../static/js/systems/WeaponSystem.js';

const originalThree = globalThis.THREE;

beforeEach(() => {
    globalThis.THREE = THREE;
});

afterEach(() => {
    globalThis.THREE = originalThree;
});

describe('pickup model definitions and runtime mesh shapes', () => {
    it('defines bundled pickup visuals for every production weapon', async () => {
        const ws = new WeaponSystem();
        await ws.init();
        const requiredWeapons = ['missile', 'mine', 'boost', 'oil-slick', 'sniper', 'shield', 'emp', 'flamethrower'];
        for (const id of requiredWeapons) {
            const weapon = ws.weaponDefs.get(id);
            expect(weapon, `missing definition for ${id}`).toBeDefined();
            expect(weapon.pickupVisual).toBeTypeOf('object');
            expect(['box', 'cone', 'sphere', 'cylinder', 'torus']).toContain(weapon.pickupVisual.geometry);
            expect(weapon.pickupVisual.geometryScale).toBeTypeOf('object');
            expect(weapon.pickupVisual.geometryScale.length).toBe(3);
            expect(weapon.pickupVisual.materialType).toBeTypeOf('string');
        }
    });

    it('creates stylized pickup meshes for all weapon definitions without external resources', async () => {
        const ws = new WeaponSystem();
        await ws.init();

        for (const weapon of ws.weaponDefs.values()) {
            const mesh = ws._createPickupMesh(weapon);
            expect(mesh).toBeTruthy();
            expect(mesh.userData.weaponId).toBe(weapon.id);
            expect(mesh.userData.pickupVisual).toMatchObject(weapon.pickupVisual);
            expect(mesh.geometry).toBeTruthy();
            expect(mesh.material).toBeTruthy();
            expect(mesh.userData).not.toHaveProperty('modelUrl');
            expect(
                mesh.material.isMeshBasicMaterial === true ||
                mesh.material.isMeshToonMaterial === true
            ).toBe(true);
        }
    });
});
