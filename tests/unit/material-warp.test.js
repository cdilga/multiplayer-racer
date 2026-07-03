import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from 'vitest';
import {
    MaterialFactory,
    configureLoFiWarpMaterial,
    setLoFiWarpEnabled,
    setLoFiWarpIntensity
} from '../../static/js/resources/MaterialFactory.js';

/**
 * br-skip-bin-arcade-design-language-5k3.10 slice A.
 *
 * Proves the optional per-material lo-fi warp hook is present but disabled by
 * default, preserves the repo's flat/toon material types, clamps intensities,
 * exempts readability-critical roles, and installs shader-local uniforms/code
 * without using ShaderMaterial or per-frame logging.
 */

class FakeMaterial {
    constructor(params = {}) {
        Object.assign(this, params);
        this.userData = {};
        this.needsUpdate = false;
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
    dispose() {}
}

const fakeTHREE = {
    MeshBasicMaterial,
    MeshToonMaterial,
    CanvasTexture,
    NearestFilter: 'nearest',
    DoubleSide: 'double'
};

const fakeDocument = {
    createElement() {
        return {
            width: 0,
            height: 0,
            getContext() {
                return { fillStyle: '', fillRect() {} };
            }
        };
    }
};

const originalTHREE = globalThis.THREE;
const originalDocument = globalThis.document;

function shaderFixture() {
    return {
        uniforms: {},
        vertexShader: [
            'void main() {',
            '#include <common>',
            '#include <begin_vertex>',
            'gl_Position = projectionMatrix * modelViewMatrix * vec4( transformed, 1.0 );',
            '}'
        ].join('\n'),
        fragmentShader: [
            'void main() {',
            '#include <common>',
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            'gl_FragColor = diffuseColor;',
            '}'
        ].join('\n')
    };
}

beforeEach(() => {
    globalThis.THREE = fakeTHREE;
    globalThis.document = fakeDocument;
    MaterialFactory.toonRamp = null;
});

afterAll(() => {
    globalThis.THREE = originalTHREE;
    globalThis.document = originalDocument;
});

describe('lo-fi material warp defaults', () => {
    it('adds disabled no-op metadata to flat materials by default', () => {
        const mat = new MaterialFactory().createMaterial({ color: 0xff00ff, type: 'flat' });

        expect(mat.isMeshBasicMaterial).toBe(true);
        expect(mat.isShaderMaterial).toBeFalsy();
        expect(mat.userData.skipBinWarp).toMatchObject({
            enabled: false,
            eligible: false,
            exempt: false,
            role: 'unclassified',
            vertexSnapIntensity: 0,
            affineIntensity: 0,
            snapGridSize: 0.25
        });
    });

    it('preserves toon materials and their shared gradient ramp', () => {
        const mat = new MaterialFactory().createMaterial({ color: 0x333333, type: 'toon' });

        expect(mat.isMeshToonMaterial).toBe(true);
        expect(mat.gradientMap).toBeTruthy();
        expect(mat.userData.skipBinWarp.enabled).toBe(false);
    });
});

describe('lo-fi material warp configuration', () => {
    it('clamps intensities and snap grid while enabling eligible world materials', () => {
        const mat = new MaterialFactory().createMaterial({
            color: 0x00ff00,
            type: 'flat',
            loFiWarp: {
                enabled: true,
                eligible: true,
                role: 'world',
                vertexSnapIntensity: 2,
                affineIntensity: -1,
                snapGridSize: -3
            }
        });

        expect(mat.userData.skipBinWarp).toMatchObject({
            enabled: true,
            eligible: true,
            exempt: false,
            role: 'world',
            vertexSnapIntensity: 1,
            affineIntensity: 0,
            snapGridSize: 0.25
        });
    });

    it('keeps readability-critical roles exempt even when enabled is requested', () => {
        const roles = ['vehicle-readable', 'danger-readable', 'ui', 'hud', 'player-identity'];

        for (const role of roles) {
            const mat = new MaterialFactory().createMaterial({
                type: 'flat',
                loFiWarp: {
                    enabled: true,
                    eligible: true,
                    role,
                    vertexSnapIntensity: 1,
                    affineIntensity: 1
                }
            });

            expect(mat.userData.skipBinWarp.exempt).toBe(true);
            expect(mat.userData.skipBinWarp.enabled).toBe(false);
        }
    });

    it('helper APIs toggle enabled state and update intensities without rebuilding material type', () => {
        const mat = new MaterialFactory().createMaterial({
            type: 'flat',
            loFiWarp: { eligible: true, role: 'world', vertexSnapIntensity: 0.25 }
        });

        setLoFiWarpEnabled(mat, true);
        expect(mat.isMeshBasicMaterial).toBe(true);
        expect(mat.userData.skipBinWarp.enabled).toBe(true);

        setLoFiWarpIntensity(mat, { vertexSnapIntensity: 0.5, affineIntensity: 0.75, snapGridSize: 0.4 });
        expect(mat.userData.skipBinWarp).toMatchObject({
            enabled: true,
            vertexSnapIntensity: 0.5,
            affineIntensity: 0.75,
            snapGridSize: 0.4
        });

        setLoFiWarpEnabled(mat, false);
        expect(mat.userData.skipBinWarp.enabled).toBe(false);
    });
});

describe('lo-fi material warp shader hook', () => {
    it('installs uniforms and vertex/fragment hooks through onBeforeCompile', () => {
        const mat = new MaterialFactory().createMaterial({
            type: 'flat',
            loFiWarp: {
                enabled: true,
                eligible: true,
                role: 'world',
                vertexSnapIntensity: 0.35,
                affineIntensity: 0.2,
                snapGridSize: 0.5
            }
        });
        const shader = shaderFixture();

        mat.onBeforeCompile(shader);

        expect(shader.uniforms.skipBinWarpEnabled.value).toBe(1);
        expect(shader.uniforms.skipBinVertexSnapIntensity.value).toBe(0.35);
        expect(shader.uniforms.skipBinAffineIntensity.value).toBe(0.2);
        expect(shader.uniforms.skipBinSnapGridSize.value).toBe(0.5);
        expect(shader.vertexShader).toMatch(/skipBinSnapped/);
        expect(shader.vertexShader).toMatch(/mix\(transformed, skipBinSnapped/);
        expect(shader.fragmentShader).toMatch(/uniform float skipBinAffineIntensity/);
        expect(shader.fragmentShader).toMatch(/diffuseColor\.rgb = mix/);
    });

    it('intensity 0 and enabled false compile as a true shader no-op via uniforms', () => {
        const mat = configureLoFiWarpMaterial(new MeshBasicMaterial({ color: 0xffffff }), {
            enabled: false,
            eligible: true,
            role: 'world',
            vertexSnapIntensity: 1,
            affineIntensity: 1
        });
        const shader = shaderFixture();

        mat.onBeforeCompile(shader);

        expect(shader.uniforms.skipBinWarpEnabled.value).toBe(0);
        expect(shader.uniforms.skipBinVertexSnapIntensity.value).toBe(1);
        expect(shader.uniforms.skipBinAffineIntensity.value).toBe(1);
    });

    it('preserves a previous onBeforeCompile callback', () => {
        const mat = new MeshBasicMaterial({ color: 0xffffff });
        const prior = vi.fn((shader) => { shader.uniforms.prior = { value: 1 }; });
        mat.onBeforeCompile = prior;

        configureLoFiWarpMaterial(mat, { enabled: true, eligible: true, role: 'world', vertexSnapIntensity: 0.1 });
        const shader = shaderFixture();
        mat.onBeforeCompile(shader);

        expect(prior).toHaveBeenCalledOnce();
        expect(shader.uniforms.prior.value).toBe(1);
        expect(shader.uniforms.skipBinWarpEnabled.value).toBe(1);
    });
});

describe('lo-fi material warp console discipline', () => {
    let log;
    let warn;
    let error;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it('configuration and shader compilation path produce no console output', () => {
        const mat = new MaterialFactory().createMaterial({
            type: 'flat',
            loFiWarp: { enabled: true, eligible: true, role: 'world', vertexSnapIntensity: 0.2 }
        });
        mat.onBeforeCompile(shaderFixture());
        setLoFiWarpIntensity(mat, { vertexSnapIntensity: 0.4, affineIntensity: 0.4 });
        setLoFiWarpEnabled(mat, false);

        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});
