import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MaterialFactory } from '../../static/js/resources/MaterialFactory.js';
import { WeaponSystem } from '../../static/js/systems/WeaponSystem.js';

/**
 * Blocker-repair guard for br-skip-bin-arcade-design-language-5k3.5 (P1.3).
 *
 * Proves the Skip Bin Arcade material conversion:
 *   - MaterialFactory returns MeshBasic (flat) / MeshToon (toon), never PBR.
 *   - EVERY toon material receives the shared gradientMap (ramp bug regression).
 *   - Weapon pickup/projectile/mine props are matte, not MeshStandardMaterial.
 *   - Source of vehicle/track/weapon factories contains no MeshStandardMaterial.
 *
 * Runs in vitest's node env, so we inject a minimal fake `THREE` + `document`.
 */

let canvasTextureCount = 0;

class FakeMaterial {
    constructor(params = {}) {
        Object.assign(this, params);
    }
    dispose() {}
}
class MeshBasicMaterial extends FakeMaterial {
    constructor(params) {
        super(params);
        this.isMeshBasicMaterial = true;
    }
}
class MeshToonMaterial extends FakeMaterial {
    constructor(params) {
        super(params);
        this.isMeshToonMaterial = true;
    }
}
class CanvasTexture {
    constructor(canvas) {
        this.canvas = canvas;
        this.isCanvasTexture = true;
        canvasTextureCount++;
    }
    dispose() {}
}
class FakeGeometry {
    rotateX() { return this; }
    dispose() {}
}
class FakeMesh {
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.userData = {};
        const vector = () => ({
            x: 0,
            y: 0,
            z: 0,
            set(x = 0, y = 0, z = 0) {
                this.x = x;
                this.y = y;
                this.z = z;
            }
        });
        this.scale = vector();
        this.rotation = vector();
        this.position = vector();
    }
}

const fakeTHREE = {
    MeshBasicMaterial,
    MeshToonMaterial,
    CanvasTexture,
    Mesh: FakeMesh,
    BoxGeometry: FakeGeometry,
    ConeGeometry: FakeGeometry,
    CylinderGeometry: FakeGeometry,
    SphereGeometry: FakeGeometry,
    TorusGeometry: FakeGeometry,
    NearestFilter: 'nearest',
    DoubleSide: 'double',
};

const fakeDocument = {
    createElement() {
        return {
            width: 0,
            height: 0,
            getContext() {
                return { fillStyle: '', fillRect() {} };
            },
        };
    },
};

const originalTHREE = globalThis.THREE;
const originalDocument = globalThis.document;

beforeEach(() => {
    globalThis.THREE = fakeTHREE;
    globalThis.document = fakeDocument;
    // Reset the module-level toon-ramp cache + construction counter so each
    // test observes caching behaviour deterministically.
    MaterialFactory.toonRamp = null;
    canvasTextureCount = 0;
});

afterAll(() => {
    globalThis.THREE = originalTHREE;
    globalThis.document = originalDocument;
});

describe('MaterialFactory returns matte flat/toon materials', () => {
    it("type 'flat' returns a MeshBasicMaterial (unlit, matte)", () => {
        const mat = new MaterialFactory().createMaterial({ color: 0xff2e88, type: 'flat' });
        expect(mat.isMeshBasicMaterial).toBe(true);
        expect(mat.isMeshStandardMaterial).toBeFalsy();
    });

    it("type 'toon' returns a MeshToonMaterial", () => {
        const mat = new MaterialFactory().createMaterial({ color: 0x2a2620, type: 'toon' });
        expect(mat.isMeshToonMaterial).toBe(true);
        expect(mat.isMeshStandardMaterial).toBeFalsy();
    });

    it('never sets PBR metalness/roughness on any material', () => {
        const factory = new MaterialFactory();
        const flat = factory.createMaterial({ color: 0xffffff, type: 'flat' });
        const toon = factory.createMaterial({ color: 0xffffff, type: 'toon' });
        for (const mat of [flat, toon]) {
            expect(mat.metalness).toBeUndefined();
            expect(mat.roughness).toBeUndefined();
        }
    });

    it('flat material does not carry emissive props (MeshBasic is unlit)', () => {
        const mat = new MaterialFactory().createMaterial({
            color: 0xffffff,
            type: 'flat',
            emissive: 0xff0000,
            emissiveIntensity: 0.8,
        });
        expect(mat.emissive).toBeUndefined();
        expect(mat.emissiveIntensity).toBeUndefined();
    });
});

describe('Toon ramp is assigned to EVERY toon material (ramp-bug regression)', () => {
    it('assigns the shared gradientMap on the 1st AND 2nd+ toon materials', () => {
        const factory = new MaterialFactory();
        const first = factory.createMaterial({ color: 0x111111, type: 'toon' });
        const second = factory.createMaterial({ color: 0x222222, type: 'toon' });
        const third = factory.createMaterial({ color: 0x333333, type: 'toon' });

        expect(first.gradientMap).toBeTruthy();
        expect(second.gradientMap).toBeTruthy(); // regressed to null before the fix
        expect(third.gradientMap).toBeTruthy();
        // All share the one cached ramp instance.
        expect(second.gradientMap).toBe(first.gradientMap);
        expect(third.gradientMap).toBe(first.gradientMap);
    });

    it('constructs the ramp CanvasTexture exactly once (caching preserved)', () => {
        const factory = new MaterialFactory();
        factory.createMaterial({ color: 0x111111, type: 'toon' });
        factory.createMaterial({ color: 0x222222, type: 'toon' });
        factory.createMaterial({ color: 0x333333, type: 'toon' });
        expect(canvasTextureCount).toBe(1);
    });
});

describe('Weapon props are matte, not PBR (runtime harness)', () => {
    // Exercise the real WeaponSystem methods without its heavy constructor by
    // binding a minimal `this` that carries the material factory.
    const ctx = () => ({ materialFactory: new MaterialFactory() });

    it('pickup mesh uses a flat MeshBasic material, no PBR spec', () => {
        const mesh = WeaponSystem.prototype._createPickupMesh.call(ctx(), { ui: { color: '#FFD23E' } });
        expect(mesh.material.isMeshBasicMaterial).toBe(true);
        expect(mesh.material.isMeshStandardMaterial).toBeFalsy();
        expect(mesh.material.metalness).toBeUndefined();
        expect(mesh.material.roughness).toBeUndefined();
    });

    it('projectile mesh uses a flat MeshBasic material, no PBR spec', () => {
        const mesh = WeaponSystem.prototype._createProjectileMesh.call(ctx(), {
            effects: { trail: { color: '#FF4400' } },
        });
        expect(mesh.material.isMeshBasicMaterial).toBe(true);
        expect(mesh.material.isMeshStandardMaterial).toBeFalsy();
        expect(mesh.material.metalness).toBeUndefined();
    });

    it('mine mesh uses a matte toon material with emissive glow, no PBR spec', () => {
        const mesh = WeaponSystem.prototype._createMineMesh.call(ctx(), {
            effects: { idle: { color: '#FF0000' } },
        });
        expect(mesh.material.isMeshToonMaterial).toBe(true);
        expect(mesh.material.isMeshStandardMaterial).toBeFalsy();
        expect(mesh.material.metalness).toBeUndefined();
        expect(mesh.material.emissive).toBe('#FF0000');
    });
});

describe('No MeshStandardMaterial remains in car/track/weapon factories', () => {
    const files = [
        '../../static/js/resources/VehicleFactory.js',
        '../../static/js/resources/TrackFactory.js',
        '../../static/js/systems/WeaponSystem.js',
    ];

    for (const rel of files) {
        it(`${rel.split('/').pop()} constructs no THREE.MeshStandardMaterial`, () => {
            const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
            expect(src).not.toMatch(/new\s+THREE\.MeshStandardMaterial/);
        });
    }
});
