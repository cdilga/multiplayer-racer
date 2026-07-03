import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VehicleFactory } from '../../static/js/resources/VehicleFactory.js';

/**
 * br-skip-bin-arcade-design-language-5k3.9 — blob/contact shadows.
 *
 * Proves: each built car has exactly one grounded, transparent contact-shadow
 * blob tagged userData.isContactShadow; the car body/roof/wheels no longer cast
 * real shadows; and the RenderSystem grade ladder no longer uses PCFSoft /
 * full-scene soft shadow maps (source-scan, no heavy renderer import).
 */

// --- Minimal fake THREE for the vehicle build path (no DOM/canvas). ---
class FakeMaterial {
    constructor(params = {}) { Object.assign(this, params); this.color = { set() {}, getHex: () => 0 }; }
    clone() { return new FakeMaterial(this); }
    dispose() {}
}
class FakeGeom { constructor(type) { this.type = type; } rotateX() { return this; } dispose() {} }
class FakeMesh {
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.rotation = { x: 0, y: 0, z: 0, set() {} };
        this.scale = { set() {} };
        this.castShadow = undefined;
        this.receiveShadow = undefined;
        this.renderOrder = 0;
        this.userData = {};
    }
}
class FakeGroup {
    constructor() { this.children = []; this.userData = {}; }
    add(o) { this.children.push(o); }
}
const fakeTHREE = {
    Group: FakeGroup,
    Mesh: FakeMesh,
    BoxGeometry: class extends FakeGeom { constructor() { super('box'); } },
    CylinderGeometry: class extends FakeGeom { constructor() { super('cyl'); } },
    PlaneGeometry: class extends FakeGeom { constructor() { super('plane'); } },
    SphereGeometry: class extends FakeGeom { constructor() { super('sphere'); } },
    MeshBasicMaterial: FakeMaterial,
    MeshToonMaterial: FakeMaterial,
    CanvasTexture: class { constructor() { this.isCanvasTexture = true; } },
    NearestFilter: 'nearest',
    DoubleSide: 'double',
};

const CONFIG = {
    id: 'test-car',
    visual: {
        body: { width: 2, height: 1, length: 4, color: 0xff2e88 },
        roof: { color: 0x222222, widthScale: 0.75, heightScale: 0.7, lengthScale: 0.5 },
        wheels: { radius: 0.5, thickness: 0.3, segments: 12, color: 0x111111 },
        // no headlights/taillights => no light meshes, keeps the fake minimal
    },
};

const originalTHREE = globalThis.THREE;
beforeEach(() => { globalThis.THREE = fakeTHREE; });
afterEach(() => { globalThis.THREE = originalTHREE; });

function buildCar() {
    const vf = new VehicleFactory();
    return vf._createVisualMesh(CONFIG, { playerId: 'p1' });
}

describe('VehicleFactory contact shadow (5k3.9)', () => {
    it('adds exactly one contact-shadow blob per car', () => {
        const car = buildCar();
        const shadows = car.children.filter((c) => c.userData?.isContactShadow);
        expect(shadows.length).toBe(1);
    });

    it('the contact shadow is transparent, grounded, and casts/receives no real shadow', () => {
        const car = buildCar();
        const shadow = car.children.find((c) => c.userData?.isContactShadow);
        expect(shadow.material.transparent).toBe(true);
        expect(shadow.castShadow).toBe(false);
        expect(shadow.receiveShadow).toBe(false);
        // grounded just above the floor
        expect(shadow.position.y).toBeGreaterThan(0);
        expect(shadow.position.y).toBeLessThan(0.1);
    });

    it('no car part casts a real shadow anymore (blob replaces them)', () => {
        const car = buildCar();
        // body + roof + wheels are present...
        const parts = car.children.filter((c) => !c.userData?.isContactShadow);
        expect(parts.length).toBeGreaterThan(0);
        // ...and none of them (nor the blob) cast a real shadow.
        expect(car.children.every((c) => c.castShadow === false)).toBe(true);
    });
});

describe('RenderSystem grade ladder drops PCFSoft / full-scene soft shadows', () => {
    const src = readFileSync(
        fileURLToPath(new URL('../../static/js/systems/RenderSystem.js', import.meta.url)),
        'utf8'
    );

    it('no grade tier uses a pcf-soft shadow map type', () => {
        expect(src).not.toMatch(/shadowMapType:\s*'pcf-soft'/);
    });

    it('the shadow-type resolver no longer defaults to PCFSoftShadowMap', () => {
        expect(src).not.toMatch(/default:\s*\n\s*return THREE\.PCFSoftShadowMap/);
    });

    it('does not force PCFSoftShadowMap on the renderer at init', () => {
        expect(src).not.toMatch(/shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/);
    });

    it('exposes a contact/disabled shadow mode in diagnostics', () => {
        expect(src).toMatch(/mode:\s*renderer\?\.shadowMap\?\.enabled\s*\?\s*'full-scene'\s*:\s*'contact-blob'/);
    });
});
