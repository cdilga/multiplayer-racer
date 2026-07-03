import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MaterialFactory } from '../../static/js/resources/MaterialFactory.js';
import { KINDS, PropKit } from '../../static/js/resources/PropKit.js';

describe('prop-kit', () => {
    const previousThree = globalThis.THREE;

    it('creates all required prop kinds with low-poly geometry', () => {
        globalThis.THREE = THREE;
        const materialFactory = new MaterialFactory();
        const kit = new PropKit(materialFactory);

        const palette = {
            default: '#445566',
            crate: '#7a5a3a',
            tyres: '#222222',
            unknown: '#000000'
        };

        const kinds = ['crate', 'barrel', 'tyres', 'cone', 'barrier', 'ramp', 'sign', 'husk', 'drum'];
        const created = kinds.map((kind) => kit.createProp({ kind, x: 0, y: 0, z: 0, size: 1, paletteKey: kind }, palette));

        expect(created).toHaveLength(kinds.length);
        created.forEach((prop, index) => {
            expect(prop).toBeInstanceOf(THREE.Group);
            expect(prop.userData).toMatchObject({
                isPropKitProp: true,
                propKind: kinds[index],
                decorativeOnly: true,
                childCount: expect.any(Number)
            });
            expect(prop.userData.childCount).toBeGreaterThan(0);
        });

        created.forEach((prop) => {
            prop.children.forEach((child) => {
                expect(child.isMesh).toBe(true);
                const segments = child.geometry?.parameters?.radialSegments
                    || child.geometry?.parameters?.segments
                    || child.geometry?.parameters?.widthSegments
                    || child.geometry?.parameters?.heightSegments;
                if (segments !== undefined) {
                    expect(segments).toBeLessThanOrEqual(12);
                }
                expect(child.userData).toMatchObject({
                    isPropKitProp: true,
                    propKind: prop.userData.propKind
                });
            });
        });

        globalThis.THREE = previousThree;
    });

    it('recolors props using palette keys', () => {
        globalThis.THREE = THREE;
        const materialFactory = new MaterialFactory();
        const kit = new PropKit(materialFactory);
        const palette = {
            crate: '#111111',
            default: '#fefefe'
        };

        const prop = kit.createProp({ kind: 'crate', paletteKey: 'crate', size: 1 }, palette);
        expect(prop).toBeTruthy();
        const child = prop.children[0];
        const expected = new THREE.Color('#111111').getHex();
        expect(child.material.color.getHex()).toBe(expected);

        const fallback = kit.createProp({ kind: 'barrel', paletteKey: 'missing', size: 1 }, palette);
        expect(fallback).toBeTruthy();
        const fallbackChild = fallback.children[0];
        expect(fallbackChild.material.color.getHex()).toBe(new THREE.Color('#fefefe').getHex());

        globalThis.THREE = previousThree;
    });

    it('skips malformed entries and unknown kinds', () => {
        globalThis.THREE = THREE;
        const kit = new PropKit();
        const bad = kit.createPropsList([
            { kind: 'crate', x: 1 },
            { kind: 'missing-kind' },
            null,
            { kind: 'drum' }
        ], {});

        expect(bad).toHaveLength(2);
        expect(bad[0].userData.propKind).toBe('crate');
        expect(bad[1].userData.propKind).toBe('drum');

        const none = kit.createPropsList(null, {});
        expect(none).toHaveLength(0);
        globalThis.THREE = previousThree;
    });

    it('exposes expected userData contract', () => {
        globalThis.THREE = THREE;
        const kit = new PropKit();
        const prop = kit.createProp({
            kind: 'sign',
            size: 1.1,
            x: 2,
            y: 3,
            z: 4,
            paletteKey: 'crate',
            rotationY: 0.5,
            scale: 1.2
        }, { crate: 0x00ff00 });

        expect(prop?.userData).toMatchObject({
            isPropKitProp: true,
            propKind: 'sign',
            decorativeOnly: true,
            childCount: 2,
            paletteKey: 'crate'
        });

        expect(prop.position.toArray()).toEqual([2, 3, 4]);
        expect(prop.children[0].userData).toMatchObject({
            isPropKitProp: true,
            propKind: 'sign',
            propPart: expect.any(String),
            geometryType: expect.any(String)
        });
        globalThis.THREE = previousThree;
    });
});

