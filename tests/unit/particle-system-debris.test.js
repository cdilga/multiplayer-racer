import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParticleSystem } from '../../static/js/systems/ParticleSystem.js';
import { EFFECT_PRESETS } from '../../static/js/systems/ParticleSystem.js';

let disposeCount;

class FakeMaterial {
    constructor(params = {}) {
        Object.assign(this, params);
        this.color = {
            set: () => {
                return this;
            },
        };
    }

    clone() {
        return new FakeMaterial(this);
    }

    dispose() {
        disposeCount += 1;
    }
}

class FakeMesh {
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = { set() {} };
        this.scale = { set() {} };
    }
}

class FakeGeometry {
    constructor(type) {
        this.type = type;
    }

    dispose() {
        disposeCount += 1;
    }
}

class FakeBoxGeometry extends FakeGeometry {
    constructor() {
        super('box');
        this.isBoxGeometry = true;
    }
}

class FakeSphereGeometry extends FakeGeometry {
    constructor() {
        super('sphere');
        this.isSphereGeometry = true;
    }
}

class FakeScene {
    constructor() {
        this.added = [];
        this.removed = [];
    }

    add(object) {
        this.added.push(object);
    }

    remove(object) {
        this.removed.push(object);
    }
}

class FakeRingGeometry extends FakeGeometry {
    constructor() {
        super('ring');
    }
}

const fakeTHREE = {
    MeshBasicMaterial: FakeMaterial,
    Mesh: FakeMesh,
    BoxGeometry: FakeBoxGeometry,
    ConeGeometry: FakeGeometry,
    SphereGeometry: FakeSphereGeometry,
    RingGeometry: FakeRingGeometry,
    Group: class {
        constructor() {
            this.children = [];
        }
        add(mesh) {
            this.children.push(mesh);
        }
        traverse(fn) {
            this.children.forEach(fn);
        }
    },
};

const originalTHREE = globalThis.THREE;
const originalPerformance = globalThis.performance;

beforeEach(() => {
    disposeCount = 0;
    globalThis.THREE = fakeTHREE;
    globalThis.performance = { now: () => 0 };
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
});

afterEach(() => {
    globalThis.THREE = originalTHREE;
    globalThis.performance = originalPerformance;
    Math.random.mockRestore();
});

describe('ParticleSystem debris shape selection (5k3.18)', () => {
    it('creates elimination debris as box geometry for vehicle-destroy preset', () => {
        const ps = new ParticleSystem({ scene: new FakeScene() });
        ps.initialized = true;

        const groupId = ps.createVehicleDestruction({ x: 0, y: 0, z: 0 });
        const group = ps.particleGroups.get(groupId);

        expect(group).toBeTruthy();
        const particles = group.particles;
        expect(particles.length).toBe(EFFECT_PRESETS['vehicle-destroy'].count);
        expect(particles.every((particle) => particle.mesh && particle.mesh.geometry.isBoxGeometry)).toBe(true);
    });

    it('keeps explosions and smoke as sphere/default geometry', () => {
        const ps = new ParticleSystem({ scene: new FakeScene() });
        ps.initialized = true;

        const explosionGroupId = ps.createExplosion({ x: 0, y: 0, z: 0 });
        const smokeGroupId = ps.createSmoke({ x: 1, y: 0, z: 0 });
        const explosionGroup = ps.particleGroups.get(explosionGroupId);
        const smokeGroup = ps.particleGroups.get(smokeGroupId);

        expect(explosionGroup).toBeTruthy();
        expect(smokeGroup).toBeTruthy();
        expect(explosionGroup.particles.every((particle) => particle.mesh && particle.mesh.geometry.isSphereGeometry)).toBe(true);
        expect(smokeGroup.particles.every((particle) => particle.mesh && particle.mesh.geometry.isSphereGeometry)).toBe(true);
    });

    it('safely skips particle creation when no scene is available', () => {
        const ps = new ParticleSystem({ scene: null });
        ps.initialized = true;

        const groupId = ps.createVehicleDestruction({ x: 0, y: 0, z: 0 });
        expect(groupId).toBeNull();
        expect(ps.particleGroups.size).toBe(0);
    });

    it('falls back to sphere geometry when preset shape is unknown', () => {
        const ps = new ParticleSystem({ scene: new FakeScene() });
        ps.initialized = true;

        const groupId = ps.createExplosion({ x: 0, y: 0, z: 0 }, { shape: 'prism' });
        const group = ps.particleGroups.get(groupId);

        expect(group).toBeTruthy();
        expect(group.particles.every((particle) => particle.mesh && particle.mesh.geometry.isSphereGeometry)).toBe(true);
    });

    it('clears and removes all particle groups', () => {
        const scene = new FakeScene();
        const ps = new ParticleSystem({ scene });
        ps.initialized = true;

        ps.createVehicleDestruction({ x: 0, y: 0, z: 0 });
        ps.createExplosion({ x: 0, y: 0, z: 0 });

        expect(ps.particleGroups.size).toBe(2);

        ps.clear();
        expect(ps.particleGroups.size).toBe(0);
    });

    it('returns null for vehicle destruction when THREE is unavailable', () => {
        const savedThree = globalThis.THREE;
        globalThis.THREE = undefined;
        const ps = new ParticleSystem({ scene: new FakeScene() });
        ps.initialized = true;

        const groupId = ps.createVehicleDestruction({ x: 0, y: 0, z: 0 });

        expect(groupId).toBeNull();
        expect(ps.particleGroups.size).toBe(0);
        globalThis.THREE = savedThree;
    });

    it('returns null for vehicle destruction when disabled', () => {
        const ps = new ParticleSystem({ scene: new FakeScene() });
        ps.initialized = true;
        ps.setEnabled(false);

        const groupId = ps.createVehicleDestruction({ x: 0, y: 0, z: 0 });
        expect(groupId).toBeNull();
        expect(ps.particleGroups.size).toBe(0);
    });

    it('expires vehicle debris during update and disposes/removes meshes', () => {
        const scene = new FakeScene();
        const ps = new ParticleSystem({ scene });
        ps.initialized = true;

        globalThis.performance = { now: () => 0 };
        const groupId = ps.createExplosion(
            { x: 0, y: 0, z: 0 },
            { preset: 'vehicle-destroy', lifetime: { min: 0.2, max: 0.2 } }
        );
        expect(ps.particleGroups.size).toBe(1);
        expect(scene.added.length).toBe(1);

        globalThis.performance = { now: () => 2000 };
        ps.update(0.016);

        expect(ps.particleGroups.has(groupId)).toBe(false);
        expect(ps.particleGroups.size).toBe(0);
        expect(scene.removed.length).toBe(1);
        expect(disposeCount).toBeGreaterThan(0);
    });

    it('drains high-count vehicle destruction bursts after lifetime expiry', () => {
        const scene = new FakeScene();
        const ps = new ParticleSystem({ scene });
        ps.initialized = true;

        globalThis.performance = { now: () => 0 };
        const burstCount = 50;
        for (let i = 0; i < burstCount; i += 1) {
            ps.createExplosion(
                { x: i, y: 0, z: 0 },
                { preset: 'vehicle-destroy', lifetime: { min: 0.1, max: 0.1 } }
            );
        }
        expect(ps.particleGroups.size).toBe(burstCount);
        expect(scene.added.length).toBe(burstCount);

        globalThis.performance = { now: () => 2000 };
        ps.update(0.016);

        expect(ps.particleGroups.size).toBe(0);
        expect(scene.removed.length).toBe(burstCount);
        expect(disposeCount).toBeGreaterThan(burstCount);
    });
});
