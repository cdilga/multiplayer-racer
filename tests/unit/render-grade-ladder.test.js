import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RenderSystem, HOST_GRADE_TIER_DEFINITIONS } from '../../static/js/systems/RenderSystem.js';

/**
 * br-skip-bin-arcade-design-language-5k3.8 — film-grain grade ladder + reduce-effects.
 *
 * Proves the grain STRENGTH follows the host-grade ladder (native > balanced >
 * degraded > 0) and is OFF in the fallback/no-post tier, that RenderSystem
 * actually applies the tier value to the live shader uniform, that vignette is
 * still tiered, and that the manual/a11y override seam (setFilmGrainAmount, the
 * 5k3.37 hook) forces grain — including 0 for reduce-effects.
 */

// A minimal fake colorGrading pass mirroring the ShaderPass uniform shape.
function fakeColorGradingPass() {
    return {
        enabled: true,
        uniforms: {
            gradingIntensity: { value: 0 },
            posterizeBandCount: { value: 0 },
            ditherStrength: { value: 0 },
            scanlineAmount: { value: 0 },
            vignetteAmount: { value: 0 },
            filmGrainAmount: { value: 0 },
            filmGrainScale: { value: 1.5 },
            filmGrainSpeed: { value: 12 },
            time: { value: 0 }
        }
    };
}

// Build a RenderSystem without touching the DOM/renderer: pass a container so
// `options.container || document.body` never evaluates document, and stub the
// resolution-scale helper (which would touch a real renderer).
function makeRenderSystem() {
    const rs = new RenderSystem({ container: {}, eventBus: { emit() {} } });
    rs._applyResolutionScale = () => {};
    // Stub renderer-dependent diagnostics helpers so getGradeDiagnostics() runs
    // without a live WebGL renderer/THREE (we only assert the grain fields).
    rs._getRenderTargetMetrics = () => null;
    rs._getToneMappingName = () => 'none';
    rs._getShadowMapTypeName = () => 'none';
    rs.scene = null;      // guarded in _applyGradeTierSettings
    rs.renderer = null;   // guarded in _applyGradeTierSettings / getGradeDiagnostics
    rs.postProcessing.passes.colorGrading = fakeColorGradingPass();
    return rs;
}

describe('grade ladder — film grain strength descends across tiers, off in fallback', () => {
    it('native > balanced > degraded > 0 and fallback === 0', () => {
        const t = HOST_GRADE_TIER_DEFINITIONS;
        const native = t['host-native'].filmGrainAmount;
        const balanced = t['host-balanced'].filmGrainAmount;
        const degraded = t['host-degraded'].filmGrainAmount;
        const fallback = t['host-fallback'].filmGrainAmount;

        expect(native).toBeGreaterThan(balanced);
        expect(balanced).toBeGreaterThan(degraded);
        expect(degraded).toBeGreaterThan(0);
        expect(fallback).toBe(0);
    });

    it('fallback tier has post-processing OFF (so the grain pass is disabled entirely)', () => {
        expect(HOST_GRADE_TIER_DEFINITIONS['host-fallback'].postProcessing).toBe(false);
    });

    it('vignette is still tiered and preserved (native > 0, fallback 0)', () => {
        expect(HOST_GRADE_TIER_DEFINITIONS['host-native'].vignetteAmount).toBeGreaterThan(0);
        expect(HOST_GRADE_TIER_DEFINITIONS['host-fallback'].vignetteAmount).toBe(0);
    });
});

describe('grade ladder — RenderSystem applies the tier grain to the live uniform', () => {
    let rs;
    beforeEach(() => { rs = makeRenderSystem(); });
    afterEach(() => { rs = null; });

    it('applying the degraded tier sets the shader filmGrainAmount to the degraded value', () => {
        rs.activeGradeTier = 'host-degraded';
        rs._applyGradeTierSettings();
        expect(rs.postProcessing.passes.colorGrading.uniforms.filmGrainAmount.value)
            .toBe(HOST_GRADE_TIER_DEFINITIONS['host-degraded'].filmGrainAmount);
    });

    it('applying the fallback tier zeroes grain AND disables the grade pass', () => {
        rs.activeGradeTier = 'host-fallback';
        rs._applyGradeTierSettings();
        const pass = rs.postProcessing.passes.colorGrading;
        expect(pass.uniforms.filmGrainAmount.value).toBe(0);
        expect(pass.enabled).toBe(false);
    });

    it('diagnostics report grain amount + animated flag from the live uniform', () => {
        rs.activeGradeTier = 'host-native';
        rs._applyGradeTierSettings();
        const diag = rs.getGradeDiagnostics().postProcessing;
        expect(diag.filmGrainAmount).toBeGreaterThan(0);
        expect(diag.filmGrainAnimated).toBe(true);
        // getGradeDiagnostics exposes the tier value too (via tierConfig).
        expect(rs.getGradeDiagnostics().tierConfig.filmGrainAmount).toBeGreaterThan(0);
    });
});

describe('grade ladder — manual/a11y override seam (5k3.37 hook)', () => {
    let rs;
    beforeEach(() => { rs = makeRenderSystem(); rs.activeGradeTier = 'host-native'; rs._applyGradeTierSettings(); });

    it('setFilmGrainAmount(0) forces grain off even on the native tier (reduce-effects)', () => {
        rs.setFilmGrainAmount(0);
        expect(rs.postProcessing.passes.colorGrading.uniforms.filmGrainAmount.value).toBe(0);
        expect(rs.getGradeDiagnostics().postProcessing.filmGrainAnimated).toBe(false);
    });

    it('override survives a tier re-apply (manual wins over the auto tier)', () => {
        rs.setFilmGrainAmount(0);
        rs.activeGradeTier = 'host-native';
        rs._applyGradeTierSettings();
        expect(rs.postProcessing.passes.colorGrading.uniforms.filmGrainAmount.value).toBe(0);
    });

    it('setFilmGrainAmount(null) clears the override and returns to the tier value', () => {
        rs.setFilmGrainAmount(0);
        rs.setFilmGrainAmount(null);
        rs._applyGradeTierSettings();
        expect(rs.postProcessing.passes.colorGrading.uniforms.filmGrainAmount.value)
            .toBe(HOST_GRADE_TIER_DEFINITIONS['host-native'].filmGrainAmount);
    });

    it('clamps override into 0..1', () => {
        rs.setFilmGrainAmount(5);
        expect(rs.postProcessing.passes.colorGrading.uniforms.filmGrainAmount.value).toBe(1);
    });

    it('setDitherStrength overrides, reports, and clears back to the tier value', () => {
        rs.setDitherStrength(0.25);
        expect(rs.postProcessing.passes.colorGrading.uniforms.ditherStrength.value).toBe(0.25);
        expect(rs.getGradeDiagnostics().postProcessing.ditherOverride).toBe(0.25);

        rs.setDitherStrength(null);
        expect(rs.postProcessing.passes.colorGrading.uniforms.ditherStrength.value)
            .toBe(HOST_GRADE_TIER_DEFINITIONS['host-native'].ditherStrength);
        expect(rs.getGradeDiagnostics().postProcessing.ditherOverride).toBeNull();
    });

    it('setScanlineAmount overrides, reports, and clears back to the tier value', () => {
        rs.setScanlineAmount(0.2);
        expect(rs.postProcessing.passes.colorGrading.uniforms.scanlineAmount.value).toBe(0.2);
        expect(rs.getGradeDiagnostics().postProcessing.scanlineOverride).toBe(0.2);

        rs.setScanlineAmount(null);
        expect(rs.postProcessing.passes.colorGrading.uniforms.scanlineAmount.value)
            .toBe(HOST_GRADE_TIER_DEFINITIONS['host-native'].scanlineAmount);
        expect(rs.getGradeDiagnostics().postProcessing.scanlineOverride).toBeNull();
    });
});
