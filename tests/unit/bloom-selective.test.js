import { describe, it, expect } from 'vitest';
import { BLOOM_LAYER, isBloomEligible, enableBloom } from '../../static/js/resources/bloomLayer.js';

// Minimal THREE.Layers-like helper.
function fakeLayers() {
    let mask = 1;
    return {
        enable(ch) { mask |= (1 << ch); },
        has(ch) { return (mask & (1 << ch)) !== 0; }
    };
}

function mesh(material, userData = {}) {
    return { isMesh: true, material, userData, layers: fakeLayers() };
}

describe('selective bloom layer (5k3.6)', () => {
    it('reserves a non-zero bloom layer', () => {
        expect(BLOOM_LAYER).toBeGreaterThan(0);
    });

    it('is eligible for a lit emissive material', () => {
        expect(isBloomEligible(mesh({ emissiveIntensity: 1.2 }))).toBe(true);
        expect(isBloomEligible(mesh({ emissiveIntensity: 0 }))).toBe(false);
    });

    it('is eligible for an explicit userData.bloomEligible opt-in (unlit props)', () => {
        expect(isBloomEligible(mesh({}, { bloomEligible: true }))).toBe(true);
    });

    it('EXCLUDES a plain flat world mesh (the core "no full-frame bloom" guarantee)', () => {
        const grimyGround = mesh({ color: 0x6b5a41 }); // flat MeshBasic, no emissive
        expect(isBloomEligible(grimyGround)).toBe(false);
    });

    it('handles multi-material meshes (eligible if any sub-material is emissive)', () => {
        expect(isBloomEligible(mesh([{ color: 0 }, { emissiveIntensity: 0.5 }]))).toBe(true);
        expect(isBloomEligible(mesh([{ color: 0 }, { emissiveIntensity: 0 }]))).toBe(false);
    });

    it('enableBloom sets the bloom layer on the object and descendants', () => {
        const child = mesh({ emissiveIntensity: 1 });
        const parent = { layers: fakeLayers(), children: [child] };
        enableBloom(parent);
        expect(parent.layers.has(BLOOM_LAYER)).toBe(true);
        expect(child.layers.has(BLOOM_LAYER)).toBe(true);
    });

    it('is safe on nodes without layers', () => {
        expect(() => enableBloom({})).not.toThrow();
        expect(() => enableBloom(null)).not.toThrow();
        expect(isBloomEligible(null)).toBe(false);
    });
});
