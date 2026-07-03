import { describe, expect, it } from 'vitest';
import { RenderSystem } from '../../static/js/systems/RenderSystem.js';

function createRenderSystem() {
    const render = new RenderSystem({ eventBus: null, container: {} });
    render.camera = {
        position: { x: 0, y: 0, z: 0 }
    };
    return render;
}

describe('RenderSystem impact camera shake curves', () => {
    it('scales impact impulse by collision severity bands', () => {
        const render = createRenderSystem();

        const light = render.sampleImpactShakeDecay({ severity: 0.2, source: 'light' }, 0).resolved;
        const medium = render.sampleImpactShakeDecay({ severity: 0.55, source: 'medium' }, 0).resolved;
        const heavy = render.sampleImpactShakeDecay({ severity: 0.9, source: 'heavy' }, 0).resolved;
        const elimination = render.sampleImpactShakeDecay({
            severity: 1,
            elimination: true,
            source: 'elimination'
        }, 0).resolved;

        expect(light.impulse).toBeGreaterThan(0);
        expect(medium.impulse).toBeGreaterThan(light.impulse);
        expect(heavy.impulse).toBeGreaterThan(medium.impulse);
        expect(elimination.impulse).toBeGreaterThanOrEqual(heavy.impulse);
        expect(elimination.impulse).toBeLessThanOrEqual(render.cameraShake.impactCap);
    });

    it('decays sharply over a short frame window without lingering weight', () => {
        const render = createRenderSystem();
        const { samples } = render.sampleImpactShakeDecay({ severity: 0.9, source: 'heavy' }, 10);
        const peak = samples[0].impact;
        const frame3 = samples[3].impact;
        const frame6 = samples[6].impact;
        const frame10 = samples[10].impact;

        expect(peak).toBeGreaterThan(0.5);
        expect(frame3).toBeLessThan(peak * 0.22);
        expect(frame6).toBeLessThan(peak * 0.06);
        expect(frame10).toBeLessThan(0.01);
    });

    it('caps accumulated impact shake and records diagnostics without logging', () => {
        const render = createRenderSystem();

        render.addImpactShake({ severity: 0.9, source: 'hit-a' });
        render.addImpactShake({ severity: 0.9, source: 'hit-b' });
        render.addImpactShake({ severity: 1, elimination: true, source: 'destroyed' });

        const diagnostics = render.getImpactShakeDiagnostics();
        expect(diagnostics.impact).toBeLessThanOrEqual(diagnostics.impactCap);
        expect(diagnostics.diagnostics.peakImpact).toBeLessThanOrEqual(diagnostics.impactCap);
        expect(diagnostics.diagnostics.lastSource).toBe('destroyed');
        expect(diagnostics.diagnostics.samples.length).toBeGreaterThan(0);
    });

    it('keeps hit-stop camera punch render-only with a sharp 1-3 frame falloff', () => {
        const render = createRenderSystem();
        render.triggerHitStopCameraPunch({
            frames: 3,
            intensity: 0.9,
            source: 'damage:vehicleCollision'
        });

        render._applyHitStopCameraPunch();
        const first = render.getHitStopRenderDiagnostics();
        render._applyHitStopCameraPunch();
        const second = render.getHitStopRenderDiagnostics();
        render._applyHitStopCameraPunch();
        const third = render.getHitStopRenderDiagnostics();
        render._applyHitStopCameraPunch();
        const after = render.getHitStopRenderDiagnostics();

        expect(first.lastOffset.z).toBeLessThan(-0.8);
        expect(Math.abs(second.lastOffset.z)).toBeLessThan(Math.abs(first.lastOffset.z) * 0.5);
        expect(Math.abs(third.lastOffset.z)).toBeLessThan(Math.abs(first.lastOffset.z) * 0.15);
        expect(after.framesRemaining).toBe(0);
        expect(after.lastOffset).toEqual({ x: 0, y: 0, z: 0 });
        expect(after.physicsTimeScale).toBe(1);
    });
});
