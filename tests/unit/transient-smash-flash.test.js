import { describe, expect, it } from 'vitest';
import { RenderSystem } from '../../static/js/systems/RenderSystem.js';

function createRenderSystem() {
    return new RenderSystem({ eventBus: null, container: {} });
}

describe('RenderSystem transient smash flash', () => {
    it('keeps chromatic aberration neutral until a heavy event triggers the pulse', () => {
        const render = createRenderSystem();
        const result = render.sampleTransientSmashFlash({ severity: 0.2, source: 'light-tap' }, 3);

        expect(result.triggerResult).toEqual({
            triggered: false,
            severity: 0.2,
            reason: 'below-threshold'
        });
        expect(result.trigger.diagnostics.ignoredCount).toBe(1);
        expect(result.samples.every((sample) => sample.pulseIntensity === 0)).toBe(true);
        expect(result.samples.every((sample) => sample.chromaticEnabled === false)).toBe(true);
        expect(result.samples.every((sample) => sample.chromaticAmount === 0)).toBe(true);
        expect(result.samples.map((sample) => sample.frameIndex)).toEqual([1, 2, 3]);
    });

    it('applies a short frame-indexed CA/posterize pulse that decays back to neutral', () => {
        const render = createRenderSystem();
        const result = render.sampleTransientSmashFlash({
            severity: 0.9,
            source: 'damage:vehicleCollision'
        }, 5);
        const [frame1, frame2, frame3, frame4, frame5] = result.samples;

        expect(result.triggerResult.triggered).toBe(true);
        expect(result.triggerResult.frames).toBe(3);
        expect(frame1.frameIndex).toBe(1);
        expect(frame1.pulseIntensity).toBeCloseTo(0.9, 5);
        expect(frame1.chromaticEnabled).toBe(true);
        expect(frame1.chromaticAmount).toBeGreaterThan(0);
        expect(frame1.gradingIntensity).toBeGreaterThan(frame2.gradingIntensity);
        expect(frame1.posterizeBandCount).toBeLessThan(render.gradeTiers['host-native'].posterizeBandCount);

        expect(frame2.pulseIntensity).toBeLessThan(frame1.pulseIntensity);
        expect(frame3.pulseIntensity).toBeLessThan(frame2.pulseIntensity);
        expect(frame4.pulseIntensity).toBe(0);
        expect(frame4.chromaticEnabled).toBe(false);
        expect(frame4.chromaticAmount).toBe(0);
        expect(frame4.gradingIntensity).toBe(render.gradeTiers['host-native'].gradingIntensity);
        expect(frame4.posterizeBandCount).toBe(render.gradeTiers['host-native'].posterizeBandCount);
        expect(frame4.ditherStrength).toBe(render.gradeTiers['host-native'].ditherStrength);
        expect(frame5).toEqual({
            ...frame4,
            frameIndex: 5
        });
    });

    it('allows elimination to use the max pulse window without extending past it', () => {
        const render = createRenderSystem();
        const result = render.sampleTransientSmashFlash({
            severity: 0.1,
            elimination: true,
            source: 'damage:destroyed'
        }, 6);
        const activeFrames = result.samples.filter((sample) => sample.pulseIntensity > 0);
        const neutralFrames = result.samples.filter((sample) => sample.pulseIntensity === 0);

        expect(result.triggerResult.triggered).toBe(true);
        expect(result.triggerResult.frames).toBe(4);
        expect(activeFrames).toHaveLength(4);
        expect(activeFrames.map((sample) => sample.frameIndex)).toEqual([1, 2, 3, 4]);
        expect(activeFrames[0].pulseIntensity).toBeCloseTo(1, 5);
        expect(activeFrames[3].pulseIntensity).toBeCloseTo(0.25, 5);
        expect(neutralFrames).toHaveLength(2);
        expect(neutralFrames.every((sample) => sample.chromaticEnabled === false)).toBe(true);
    });

    it('refreshes instead of stacking repeated smash flashes and never changes physics time', () => {
        const render = createRenderSystem();

        render.triggerTransientSmashFlash({ severity: 0.8, source: 'weapon:explosion' });
        render._applyTransientSmashFlash();
        render.triggerTransientSmashFlash({ severity: 1, source: 'damage:destroyed', elimination: true });
        render.triggerTransientSmashFlash({ severity: 1, source: 'repeat' });

        const diagnostics = render.getTransientSmashFlashDiagnostics();
        expect(diagnostics.framesRemaining).toBeLessThanOrEqual(diagnostics.curve.maxFrames);
        expect(diagnostics.intensity).toBeLessThanOrEqual(1);
        expect(diagnostics.physicsTimeScale).toBe(1);

        const samples = [];
        for (let frame = 0; frame < 6; frame++) {
            samples.push(render._applyTransientSmashFlash());
        }

        expect(samples.every((sample) => sample.chromaticAmount <= diagnostics.curve.maxChromaticAmount)).toBe(true);
        expect(samples.at(-1).pulseIntensity).toBe(0);
        expect(render.getTransientSmashFlashDiagnostics().physicsTimeScale).toBe(1);
    });

    it('reduce-effects gate suppresses the HEAVY smash flash (triggered=false, neutral frames)', () => {
        const render = createRenderSystem();
        render.setTransientSmashFlashReduceEffects(true);
        const result = render.sampleTransientSmashFlash({ severity: 0.9, source: 'damage:vehicleCollision' }, 4);

        expect(result.triggerResult).toEqual({ triggered: false, severity: 0.9, reason: 'reduce-effects' });
        expect(result.samples.every((sample) => sample.pulseIntensity === 0)).toBe(true);
        expect(result.samples.every((sample) => sample.chromaticEnabled === false)).toBe(true);
        expect(result.samples.every((sample) => sample.chromaticAmount === 0)).toBe(true);
        expect(result.trigger.diagnostics.suppressedCount).toBe(1);
        // physics is never touched by a presentation gate
        expect(result.trigger.physicsTimeScale).toBe(1);
    });

    it('reduce-effects gate suppresses the ELIMINATION smash flash', () => {
        const render = createRenderSystem();
        render.setTransientSmashFlashReduceEffects(true);
        const result = render.sampleTransientSmashFlash({ elimination: true, source: 'damage:destroyed' }, 4);

        expect(result.triggerResult.triggered).toBe(false);
        expect(result.triggerResult.reason).toBe('reduce-effects');
        expect(result.samples.every((sample) => sample.pulseIntensity === 0)).toBe(true);
        expect(result.samples.every((sample) => sample.chromaticEnabled === false)).toBe(true);
    });

    it('an active pulse is forced neutral the moment reduce-effects turns on', () => {
        const render = createRenderSystem();
        render.triggerTransientSmashFlash({ severity: 1, source: 'damage:destroyed', elimination: true });
        expect(render.getTransientSmashFlashDiagnostics().framesRemaining).toBeGreaterThan(0);
        render.setTransientSmashFlashReduceEffects(true);
        const diag = render.getTransientSmashFlashDiagnostics();
        expect(diag.framesRemaining).toBe(0);
        expect(diag.intensity).toBe(0);
    });

    it('clearing reduce-effects restores the normal pulse: heavy ~3, elimination max 4, light ignored', () => {
        // heavy collision -> ~3 frames
        const heavyR = createRenderSystem();
        heavyR.setTransientSmashFlashReduceEffects(true);
        heavyR.setTransientSmashFlashReduceEffects(false);
        const heavy = heavyR.sampleTransientSmashFlash({ severity: 0.9, source: 'damage:vehicleCollision' }, 5);
        expect(heavy.triggerResult.triggered).toBe(true);
        expect(heavy.triggerResult.frames).toBe(3);
        expect(heavy.samples[0].pulseIntensity).toBeCloseTo(0.9, 5);
        expect(heavy.samples[0].chromaticEnabled).toBe(true);
        expect(heavy.samples[3].pulseIntensity).toBe(0);

        // elimination -> max 4 frames
        const elimR = createRenderSystem();
        elimR.setTransientSmashFlashReduceEffects(true);
        elimR.setTransientSmashFlashReduceEffects(false);
        const elim = elimR.sampleTransientSmashFlash({ elimination: true, source: 'damage:destroyed' }, 6);
        expect(elim.triggerResult.triggered).toBe(true);
        expect(elim.triggerResult.frames).toBe(4);

        // light tap -> still ignored (below threshold), not reduce-effects
        const lightR = createRenderSystem();
        lightR.setTransientSmashFlashReduceEffects(true);
        lightR.setTransientSmashFlashReduceEffects(false);
        const light = lightR.sampleTransientSmashFlash({ severity: 0.2, source: 'light-tap' }, 3);
        expect(light.triggerResult.triggered).toBe(false);
        expect(light.triggerResult.reason).toBe('below-threshold');
    });
});
