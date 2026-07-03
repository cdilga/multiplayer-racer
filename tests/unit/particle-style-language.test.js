import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParticleSystem, EFFECT_PRESETS } from '../../static/js/systems/ParticleSystem.js';
import { TrailSystem } from '../../static/js/systems/TrailSystem.js';

/**
 * br-skip-bin-arcade-design-language-5k3.34 — particle/trail lo-fi restyle.
 *
 * Proves fire/explosion, smoke, sparks, EMP, and trails read chunky/dithered/
 * hard-edged (low-poly geometry + non-additive dithered materials + low-segment
 * EMP ring + quantized trail fade) rather than soft glows, and that the closed
 * 5k3.18 vehicle-destroy box-debris behavior is NOT regressed. No RenderSystem.
 */

// Distinct blending constants so we can assert normal-vs-additive.
const NORMAL_BLENDING = 1;
const ADDITIVE_BLENDING = 2;

class FakeMaterial {
    constructor(params = {}) {
        Object.assign(this, params);
        this.color = { set() {} };
    }
    clone() {
        return new FakeMaterial(this);
    }
    dispose() {}
}
class FakePointsMaterial extends FakeMaterial {
    constructor(params) {
        super(params);
        this.isPointsMaterial = true;
    }
}
class FakeGeometry {
    dispose() {}
    rotateX() { return this; }
    setAttribute() {}
    setDrawRange() {}
}
class FakeBoxGeometry extends FakeGeometry {
    constructor(w, h, d) {
        super();
        this.isBoxGeometry = true;
        this.width = w; this.height = h; this.depth = d;
    }
}
class FakeSphereGeometry extends FakeGeometry {
    constructor(radius, widthSegments, heightSegments) {
        super();
        this.isSphereGeometry = true;
        this.radius = radius;
        this.widthSegments = widthSegments;
        this.heightSegments = heightSegments;
    }
}
class FakeConeGeometry extends FakeGeometry {
    constructor() { super(); this.isConeGeometry = true; }
}
class FakeRingGeometry extends FakeGeometry {
    constructor(inner, outer, thetaSegments) {
        super();
        this.isRingGeometry = true;
        this.innerRadius = inner; this.outerRadius = outer;
        this.thetaSegments = thetaSegments;
    }
}
class FakeBufferGeometry extends FakeGeometry {
    constructor() { super(); this.attributes = {}; }
}
class FakeMesh {
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = { set() {} };
        this.scale = { set() {} };
        this.userData = {};
    }
}
class FakeScene {
    constructor() { this.added = []; this.removed = []; }
    add(o) { this.added.push(o); }
    remove(o) { this.removed.push(o); }
}

const fakeTHREE = {
    MeshBasicMaterial: FakeMaterial,
    PointsMaterial: FakePointsMaterial,
    Mesh: FakeMesh,
    Points: FakeMesh,
    BoxGeometry: FakeBoxGeometry,
    SphereGeometry: FakeSphereGeometry,
    ConeGeometry: FakeConeGeometry,
    RingGeometry: FakeRingGeometry,
    BufferGeometry: FakeBufferGeometry,
    BufferAttribute: class { constructor(a) { this.array = a; } },
    Color: class { constructor(c) { this.c = c; } clone() { return this; } multiplyScalar() { return this; } },
    Group: class {
        constructor() { this.children = []; }
        add(m) { this.children.push(m); }
        traverse(fn) { this.children.forEach(fn); }
    },
    NormalBlending: NORMAL_BLENDING,
    AdditiveBlending: ADDITIVE_BLENDING,
    DoubleSide: 2,
};

const originalTHREE = globalThis.THREE;

beforeEach(() => {
    globalThis.THREE = fakeTHREE;
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
});

afterEach(() => {
    globalThis.THREE = originalTHREE;
    Math.random.mockRestore();
});

function makePS() {
    const ps = new ParticleSystem({ scene: new FakeScene() });
    ps.initialized = true;
    return ps;
}

function firstParticleMesh(ps, groupId) {
    return ps.particleGroups.get(groupId).particles[0].mesh;
}

describe('5k3.34 — chunky low-poly particle geometry (not soft round glows)', () => {
    it('fire/explosion uses a heavily-faceted low-poly sphere (segments < smooth 8)', () => {
        const ps = makePS();
        const mesh = firstParticleMesh(ps, ps.createExplosion({ x: 0, y: 0, z: 0 }));
        expect(mesh.geometry.isSphereGeometry).toBe(true);
        expect(mesh.geometry.widthSegments).toBeLessThan(8);
        expect(mesh.geometry.heightSegments).toBeLessThan(8);
    });

    it('smoke uses a chunky low-poly puff, not a smooth sphere', () => {
        const ps = makePS();
        const mesh = firstParticleMesh(ps, ps.createSmoke({ x: 0, y: 0, z: 0 }));
        expect(mesh.geometry.isSphereGeometry).toBe(true);
        expect(mesh.geometry.widthSegments).toBeLessThanOrEqual(5);
    });

    it('sparks are hard-edged boxy shards', () => {
        const ps = makePS();
        const mesh = firstParticleMesh(ps, ps.createSparks({ x: 0, y: 0, z: 0 }));
        expect(mesh.geometry.isBoxGeometry).toBe(true);
        expect(mesh.geometry.width).toBeLessThan(0.6); // small shard, smaller than debris box
    });

    it('presets carry explicit chunky shape metadata that the geometry consumes', () => {
        expect(EFFECT_PRESETS['explosion-fire'].shape).toBe('chunk');
        expect(EFFECT_PRESETS['smoke'].shape).toBe('chunk');
        expect(EFFECT_PRESETS['sparks'].shape).toBe('shard');
    });
});

describe('5k3.34 — hard-edged dithered materials (no additive glow)', () => {
    it('particle material uses normal blending + dithering, never additive', () => {
        const ps = makePS();
        const mesh = firstParticleMesh(ps, ps.createExplosion({ x: 0, y: 0, z: 0 }));
        expect(mesh.material.blending).toBe(NORMAL_BLENDING);
        expect(mesh.material.blending).not.toBe(ADDITIVE_BLENDING);
        expect(mesh.material.dithering).toBe(true);
    });
});

describe('5k3.34 — EMP shockwave is a chunky low-segment ring', () => {
    it('builds a low-segment ring (<= 8) instead of a smooth 32-segment glow', () => {
        const ps = makePS();
        const groupId = ps.createShockwave({ x: 0, y: 0, z: 0 });
        const ring = ps.particleGroups.get(groupId).mesh.geometry;
        expect(ring.isRingGeometry).toBe(true);
        expect(ring.thetaSegments).toBeLessThanOrEqual(8);
        expect(ring.thetaSegments).not.toBe(32);
        expect(ps.particleGroups.get(groupId).mesh.material.dithering).toBe(true);
    });
});

describe('5k3.34 — trails read chunky, not a soft additive glow', () => {
    function makeTrailSystem() {
        const scene = new FakeScene();
        const ts = new TrailSystem({
            eventBus: null,
            renderSystem: { getScene: () => scene },
        });
        ts.initialized = true;
        return { ts, scene };
    }

    it('default trail config is lo-fi: normal blending, dithering, chunky size, banded fade', () => {
        const ts = new TrailSystem({ eventBus: null, renderSystem: null });
        expect(ts.config.blending).toBe('normal');
        expect(ts.config.blending).not.toBe('additive');
        expect(ts.config.dithering).toBe(true);
        expect(ts.config.particleSize).toBeGreaterThanOrEqual(0.4);
        expect(ts.config.fadeSteps).toBeGreaterThanOrEqual(2);
    });

    it('created trail material uses NORMAL (not additive) blending + dithering', () => {
        const { ts } = makeTrailSystem();
        ts._onVehicleCreated({
            vehicle: { id: 'v1', color: 0xff3b3b, mesh: { position: { x: 0, y: 0, z: 0 } } },
        });
        const trail = ts.trails.get('v1');
        expect(trail.material.blending).toBe(NORMAL_BLENDING);
        expect(trail.material.blending).not.toBe(ADDITIVE_BLENDING);
        expect(trail.material.dithering).toBe(true);
        expect(trail.material.size).toBeGreaterThanOrEqual(0.4);
    });

    it('quantizes the fade into hard bands (posterized), not a smooth gradient', () => {
        const { ts } = makeTrailSystem();
        ts._onVehicleCreated({
            vehicle: { id: 'v2', color: 0xffffff, mesh: { position: { x: 0, y: 0, z: 0 } } },
        });
        const trail = ts.trails.get('v2');
        const steps = trail.config.fadeSteps;
        // Every quantized value is an exact multiple of 1/steps (a hard band).
        for (const raw of [0.05, 0.2, 0.37, 0.6, 0.83, 0.99]) {
            const q = trail._quantizeFade(raw);
            expect(Math.round(q * steps)).toBeCloseTo(q * steps, 6);
            expect(q).toBeGreaterThanOrEqual(0);
            expect(q).toBeLessThanOrEqual(1);
        }
        // Distinct raw values inside one band collapse to the same output.
        expect(trail._quantizeFade(0.76)).toBe(trail._quantizeFade(0.99));
    });
});

describe('5k3.34 — preserves closed 5k3.18 vehicle-destroy behavior', () => {
    it('vehicle-destroy debris is still boxy', () => {
        const ps = makePS();
        const mesh = firstParticleMesh(ps, ps.createVehicleDestruction({ x: 0, y: 0, z: 0 }));
        expect(mesh.geometry.isBoxGeometry).toBe(true);
        expect(EFFECT_PRESETS['vehicle-destroy'].shape).toBe('box');
    });

    it('still returns null for vehicle destruction when disabled', () => {
        const ps = makePS();
        ps.setEnabled(false);
        expect(ps.createVehicleDestruction({ x: 0, y: 0, z: 0 })).toBeNull();
        expect(ps.particleGroups.size).toBe(0);
    });

    it('still returns null for vehicle destruction with no scene', () => {
        const ps = new ParticleSystem({ scene: null });
        ps.initialized = true;
        expect(ps.createVehicleDestruction({ x: 0, y: 0, z: 0 })).toBeNull();
        expect(ps.particleGroups.size).toBe(0);
    });
});
