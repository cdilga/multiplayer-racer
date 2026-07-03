import { describe, it, expect, vi, afterEach } from 'vitest';
import { ManualVisualSettingsController } from '../../static/js/ui/ManualVisualSettingsController.js';

function memoryStorage(initial = {}) {
    const data = new Map();
    for (const [key, value] of Object.entries(initial)) data.set(key, value);
    return {
        getItem: (key) => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        dump: () => Object.fromEntries(data.entries())
    };
}

function fakeBody() {
    const classes = new Set();
    return {
        classList: {
            toggle(name, on) {
                if (on) classes.add(name);
                else classes.delete(name);
            },
            contains(name) {
                return classes.has(name);
            }
        }
    };
}

function makeSeams() {
    const calls = [];
    const render = {
        postProcessing: { enabled: true, passes: { bloom: { strength: 1 } } },
        scene: { fog: { density: 0.008 } },
        cameraShake: { intensity: 0.15 },
        setResolutionScale: vi.fn((scale) => calls.push(['resolution', scale])),
        setFilmGrainAmount: vi.fn((amount) => calls.push(['grain', amount])),
        setDitherStrength: vi.fn((amount) => calls.push(['dither', amount])),
        setScanlineAmount: vi.fn((amount) => calls.push(['scanline', amount])),
        setChromaticAberrationAmount: vi.fn((amount) => calls.push(['chromatic', amount])),
        setMaterialWarpEnabled: vi.fn((config) => calls.push(['materialWarp', config])),
        setTransientSmashFlashReduceEffects: vi.fn((on) => calls.push(['smashFlashReduce', on]))
    };
    const adaptiveQuality = {
        state: { tier: 'native' },
        setManualTier: vi.fn((tier) => calls.push(['manualTier', tier])),
        setAuto: vi.fn(() => calls.push(['auto'])),
        setMaterialWarpPolicy: vi.fn((policy) => calls.push(['adaptiveMaterialWarpPolicy', policy]))
    };
    const grainOverlay = {
        setEnabled: vi.fn((on) => calls.push(['overlayEnabled', on])),
        setIntensity: vi.fn((amount) => calls.push(['overlayIntensity', amount]))
    };
    const body = fakeBody();
    return { calls, render, adaptiveQuality, grainOverlay, doc: { body } };
}

describe('ManualVisualSettingsController - storage and normalization', () => {
    it('loads defaults without clobbering existing visualSettings keys such as uiScale', () => {
        const storage = memoryStorage({
            visualSettings: JSON.stringify({
                bloom: 1.4,
                fog: 0.011,
                shake: 0.25,
                postProcessing: false,
                uiScale: 1.2,
                customFutureKey: 'keep'
            })
        });
        const c = new ManualVisualSettingsController({ storage });
        const settings = c.getSettings();

        expect(settings.bloom).toBe(1.4);
        expect(settings.fog).toBe(0.011);
        expect(settings.shake).toBe(0.25);
        expect(settings.postProcessing).toBe(false);
        expect(settings.uiScale).toBe(1.2);
        expect(settings.customFutureKey).toBe('keep');
        expect(settings.visualQualityMode).toBe('auto');

        c.update({ filmGrain: 0.2 }, { apply: false });
        const saved = JSON.parse(storage.getItem('visualSettings'));
        expect(saved.uiScale).toBe(1.2);
        expect(saved.customFutureKey).toBe('keep');
        expect(saved.filmGrain).toBe(0.2);
    });

    it('clamps manual numeric settings into supported ranges', () => {
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            defaults: { bloom: 1, fog: 0.008, shake: 0.15 }
        });
        c.update({
            resolutionScale: 2,
            filmGrain: -1,
            ditherStrength: 4,
            scanline: Number.NaN,
            bloom: 99,
            fog: -5,
            shake: 2
        }, { apply: false });
        const s = c.getSettings();
        expect(s.resolutionScale).toBe(1);
        expect(s.filmGrain).toBe(0);
        expect(s.ditherStrength).toBe(1);
        expect(s.scanline).toBeNull();
        expect(s.bloom).toBe(2);
        expect(s.fog).toBe(0);
        expect(s.shake).toBe(0.5);
        expect(s.materialWarpMode).toBe('auto');
        expect(s.vertexSnapIntensity).toBe(0.35);
        expect(s.affineIntensity).toBe(0.12);
        expect(s.snapGridSize).toBe(0.5);
    });
});

describe('ManualVisualSettingsController - adaptive override semantics', () => {
    it('auto mode calls adaptiveQuality.setAuto and leaves auto unpinned', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render,
            grainOverlay: seams.grainOverlay,
            doc: seams.doc
        });

        c.update({ visualQualityMode: 'auto' });
        expect(seams.adaptiveQuality.setAuto).toHaveBeenCalled();
        expect(seams.adaptiveQuality.setManualTier).not.toHaveBeenCalled();
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledWith(expect.objectContaining({
            enabled: true,
            policy: 'auto-native'
        }));
    });

    it('manual quality mode pins adaptiveQuality with setManualTier', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render,
            grainOverlay: seams.grainOverlay,
            doc: seams.doc
        });

        c.update({ visualQualityMode: 'host-degraded', resolutionScale: 0.42 });
        expect(seams.adaptiveQuality.setManualTier).toHaveBeenCalledWith('host-degraded');
        expect(seams.render.setResolutionScale).toHaveBeenCalledWith(0.5);
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledWith(expect.objectContaining({
            enabled: false,
            policy: 'auto-degraded',
            vertexSnapIntensity: 0,
            affineIntensity: 0
        }));
    });

    it('forced resolution applies through the render seam and clamps to 0.5..1', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            render: seams.render
        });

        c.update({ resolutionScale: 0.1 });
        c.update({ resolutionScale: 1.8 });
        expect(seams.render.setResolutionScale).toHaveBeenNthCalledWith(1, 0.5);
        expect(seams.render.setResolutionScale).toHaveBeenNthCalledWith(2, 1);
    });
});

describe('ManualVisualSettingsController - reduce-effects path', () => {
    it('disables or lowers heavy presentation effects without touching sim/network state', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render,
            grainOverlay: seams.grainOverlay,
            doc: seams.doc
        });

        c.update({
            visualQualityMode: 'host-native',
            filmGrain: 0.4,
            ditherStrength: 0.5,
            scanline: 0.3,
            bloom: 1.5,
            fog: 0.012,
            shake: 0.25,
            postProcessing: true,
            reduceEffects: true
        });

        expect(seams.adaptiveQuality.setManualTier).toHaveBeenCalledWith('host-fallback');
        expect(seams.render.setFilmGrainAmount).toHaveBeenCalledWith(0);
        expect(seams.render.setDitherStrength).toHaveBeenCalledWith(0);
        expect(seams.render.setScanlineAmount).toHaveBeenCalledWith(0);
        expect(seams.render.postProcessing.enabled).toBe(false);
        expect(seams.render.postProcessing.passes.bloom.strength).toBe(0);
        expect(seams.render.scene.fog.density).toBe(0.003);
        expect(seams.render.cameraShake.intensity).toBe(0);
        expect(seams.grainOverlay.setEnabled).toHaveBeenCalledWith(false);
        expect(seams.grainOverlay.setIntensity).toHaveBeenCalledWith(0);
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledWith(expect.objectContaining({
            enabled: false,
            policy: 'reduce-effects',
            vertexSnapIntensity: 0,
            affineIntensity: 0
        }));
        expect(seams.render.setTransientSmashFlashReduceEffects).toHaveBeenCalledWith(true);
        expect(seams.doc.body.classList.contains('reduce-effects')).toBe(true);
        expect(c.lastApplied.reduceEffects).toBe(true);
    });

    it('clearing reduce-effects restores the saved manual settings through the same seams', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render,
            grainOverlay: seams.grainOverlay,
            doc: seams.doc
        });

        c.update({
            visualQualityMode: 'host-balanced',
            filmGrain: 0.25,
            ditherStrength: 0.5,
            scanline: 0.2,
            bloom: 1.2,
            fog: 0.01,
            shake: 0.2,
            postProcessing: true,
            reduceEffects: true
        });
        vi.clearAllMocks();
        c.disableReduceEffects();

        expect(seams.adaptiveQuality.setManualTier).toHaveBeenCalledWith('host-balanced');
        expect(seams.render.setFilmGrainAmount).toHaveBeenCalledWith(0.25);
        expect(seams.render.setDitherStrength).toHaveBeenCalledWith(0.5);
        expect(seams.render.setScanlineAmount).toHaveBeenCalledWith(0.2);
        expect(seams.render.postProcessing.enabled).toBe(true);
        expect(seams.render.postProcessing.passes.bloom.strength).toBe(1.2);
        expect(seams.render.scene.fog.density).toBe(0.01);
        expect(seams.render.cameraShake.intensity).toBe(0.2);
        expect(seams.grainOverlay.setEnabled).toHaveBeenCalledWith(true);
        expect(seams.grainOverlay.setIntensity).toHaveBeenCalledWith(0.25);
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledWith(expect.objectContaining({
            enabled: true,
            policy: 'auto-balanced'
        }));
        expect(seams.render.setTransientSmashFlashReduceEffects).toHaveBeenCalledWith(false);
        expect(seams.doc.body.classList.contains('reduce-effects')).toBe(false);
    });

    it('clearing reduce-effects clears nullable dither and scanline overrides back to the grade tier', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render,
            grainOverlay: seams.grainOverlay,
            doc: seams.doc
        });

        c.update({ reduceEffects: true });
        vi.clearAllMocks();
        c.disableReduceEffects();

        expect(seams.render.setDitherStrength).toHaveBeenCalledWith(null);
        expect(seams.render.setScanlineAmount).toHaveBeenCalledWith(null);
        expect(seams.render.setChromaticAberrationAmount).toHaveBeenCalledWith(null);
    });
});

describe('ManualVisualSettingsController - material warp policy', () => {
    it('manual off wins over auto tier policy and preserves unrelated visualSettings keys', () => {
        const storage = memoryStorage({ visualSettings: JSON.stringify({ uiScale: 1.15 }) });
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage,
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render
        });

        c.update({ materialWarpMode: 'off', vertexSnapIntensity: 0.8, affineIntensity: 0.4 });
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledWith(expect.objectContaining({
            enabled: false,
            policy: 'manual-off',
            vertexSnapIntensity: 0,
            affineIntensity: 0
        }));
        expect(seams.adaptiveQuality.setMaterialWarpPolicy).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'off',
            reduceEffects: false
        }));
        expect(JSON.parse(storage.getItem('visualSettings')).uiScale).toBe(1.15);
    });

    it('manual on enables warp even on fallback when reduce-effects is false', () => {
        const seams = makeSeams();
        seams.adaptiveQuality.state.tier = 'fallback';
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render
        });

        c.update({
            visualQualityMode: 'host-fallback',
            materialWarpMode: 'on',
            vertexSnapIntensity: 0.7,
            affineIntensity: 0.3,
            snapGridSize: 0.9
        });
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledWith({
            enabled: true,
            mode: 'on',
            policy: 'manual-on',
            tier: 'fallback',
            vertexSnapIntensity: 0.7,
            affineIntensity: 0.3,
            snapGridSize: 0.9
        });
    });

    it('does not spam render.setMaterialWarpEnabled when the resolved config is unchanged', () => {
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render
        });

        c.update({ materialWarpMode: 'auto', vertexSnapIntensity: 0.35 });
        c.apply();
        c.apply();
        expect(seams.render.setMaterialWarpEnabled).toHaveBeenCalledTimes(1);
    });
});

describe('ManualVisualSettingsController - no logging', () => {
    afterEach(() => vi.restoreAllMocks());

    it('does not log while normalizing, saving, or applying settings', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const seams = makeSeams();
        const c = new ManualVisualSettingsController({
            storage: memoryStorage(),
            adaptiveQuality: seams.adaptiveQuality,
            render: seams.render,
            grainOverlay: seams.grainOverlay,
            doc: seams.doc
        });

        c.update({ visualQualityMode: 'host-fallback', resolutionScale: 0.5, reduceEffects: true });
        c.disableReduceEffects();
        c.update({ visualQualityMode: 'auto' });

        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
    });
});
