import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdaptiveQualityController } from '../../static/js/engine/AdaptiveQualityController.js';

/**
 * br-skip-bin-arcade-design-language-5k3.39 — adaptive quality controller.
 * Pure decision-core tests: hardware heuristic, fps hysteresis ladder, tier
 * step up/down, resolution clamps, remote floor, manual override, determinism,
 * target-driving via the RenderSystem public API, and no per-frame logging.
 */

const TIER = { NATIVE: 'native', BALANCED: 'balanced', DEGRADED: 'degraded', FALLBACK: 'fallback' };

function feed(ctrl, fps, n) {
    let last;
    for (let i = 0; i < n; i++) last = ctrl.sample(fps);
    return last;
}

// A minimal RenderSystem-like target that records driver calls.
function makeTarget(tiers) {
    return {
        gradeTierCalls: [],
        resolutionCalls: [],
        materialWarpCalls: [],
        // Mirrors the real RenderSystem.listGradeTiers() shape ({ tierName, ... }).
        listGradeTiers: () => (tiers || AdaptiveQualityController.DEFAULT_TIERS.map(t => ({ tierName: t.name, resolutionScale: t.resolutionScale }))),
        setGradeTier(name) { this.gradeTierCalls.push(name); return true; },
        setResolutionScale(s) { this.resolutionCalls.push(s); return true; },
        setMaterialWarpEnabled(config) { this.materialWarpCalls.push(config); return config; },
    };
}

describe('classifyHardware — starting tier from capabilities', () => {
    it('strong hardware starts at native', () => {
        expect(AdaptiveQualityController.classifyHardware({ cores: 8, deviceMemory: 8 })).toBe(0);
    });
    it('software GPU forces the worst tier regardless of cores/memory', () => {
        expect(AdaptiveQualityController.classifyHardware({ cores: 16, deviceMemory: 32, softwareGpu: true })).toBe(3);
    });
    it('weak device (2 cores / 2GB) starts at the fallback tier', () => {
        expect(AdaptiveQualityController.classifyHardware({ cores: 2, deviceMemory: 2 })).toBe(3);
    });
    it('a remote participant starts one step more conservative than the same local device', () => {
        const local = AdaptiveQualityController.classifyHardware({ cores: 4, deviceMemory: 4, remote: false });
        const remote = AdaptiveQualityController.classifyHardware({ cores: 4, deviceMemory: 4, remote: true });
        expect(remote).toBeGreaterThan(local);
    });
    it('starts optimistic (native) when no hardware signal is available', () => {
        expect(AdaptiveQualityController.classifyHardware({})).toBe(0);
        expect(AdaptiveQualityController.classifyHardware({ devicePixelRatio: 2 })).toBe(0);
        // A remote participant with no signal starts one step down.
        expect(AdaptiveQualityController.classifyHardware({ remote: true })).toBe(1);
    });
    it('clamps within the tier range', () => {
        for (const caps of [{ cores: 64, deviceMemory: 64 }, { cores: 1, deviceMemory: 1, remote: true, devicePixelRatio: 4 }]) {
            const i = AdaptiveQualityController.classifyHardware(caps);
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThanOrEqual(3);
        }
    });
});

describe('fps ladder — hysteresis + debounce (no flapping)', () => {
    it('steps down one tier only after sustained slow frames (debounce)', () => {
        const c = new AdaptiveQualityController();
        expect(c.state.tier).toBe(TIER.NATIVE);
        // 5 slow samples: still pending, no change.
        for (let i = 0; i < 5; i++) expect(c.sample(30).changed).toBe(false);
        // 6th crosses downDebounce => step down.
        const d = c.sample(30);
        expect(d.action).toBe('tier_down');
        expect(c.state.tier).toBe(TIER.BALANCED);
    });

    it('a single slow spike inside a fast stretch never changes the tier', () => {
        const c = new AdaptiveQualityController();
        for (let i = 0; i < 30; i++) {
            c.sample(120);      // fast
            c.sample(20);       // one spike — resets fast streak but not enough slow
        }
        expect(c.state.tier).toBe(TIER.NATIVE); // never demoted
    });

    it('steps up only after a longer sustained-fast streak (cautious recovery)', () => {
        const c = new AdaptiveQualityController();
        feed(c, 20, 6);                       // -> balanced
        expect(c.state.tier).toBe(TIER.BALANCED);
        for (let i = 0; i < 11; i++) expect(c.sample(120).changed).toBe(false); // pending
        const up = c.sample(120);             // 12th => promote
        expect(up.action).toBe('tier_up');
        expect(c.state.tier).toBe(TIER.NATIVE);
    });

    it('oscillating fps in the dead-band produces no tier change', () => {
        const c = new AdaptiveQualityController();
        for (let i = 0; i < 100; i++) c.sample(54); // between downFps(50) and upFps(58)
        expect(c.state.tier).toBe(TIER.NATIVE);
        expect(c.state.slowStreak).toBe(0);
        expect(c.state.fastStreak).toBe(0);
    });
});

describe('tier + resolution clamps', () => {
    it('descends native -> balanced -> degraded -> fallback under sustained load', () => {
        const c = new AdaptiveQualityController();
        feed(c, 20, 6); expect(c.state.tier).toBe(TIER.BALANCED);
        feed(c, 20, 6); expect(c.state.tier).toBe(TIER.DEGRADED);
        feed(c, 20, 6); expect(c.state.tier).toBe(TIER.FALLBACK);
        expect(c.state.resolutionScale).toBeCloseTo(0.55, 5);
    });

    it('at the worst tier, trims resolution toward the floor then stops (no runaway)', () => {
        const c = new AdaptiveQualityController();
        feed(c, 20, 18); // -> fallback @ 0.55
        const first = feed(c, 20, 6);
        expect(first.action).toBe('res_down');
        expect(c.state.resolutionScale).toBeCloseTo(0.5, 5); // clamped to MIN_RENDER_SCALE
        const again = feed(c, 20, 6);
        expect(again.action).toBe('floor');            // nothing left to shed
        expect(c.state.resolutionScale).toBeCloseTo(0.5, 5);
        expect(c.state.resolutionScale).toBeGreaterThanOrEqual(AdaptiveQualityController.MIN_RENDER_SCALE);
    });

    it('recovers trimmed resolution before promoting the tier', () => {
        const c = new AdaptiveQualityController();
        feed(c, 20, 24); // fallback + one res trim -> 0.5
        expect(c.state.resolutionScale).toBeCloseTo(0.5, 5);
        const resUp = feed(c, 120, 12);
        expect(resUp.action).toBe('res_up');
        expect(c.state.resolutionScale).toBeCloseTo(0.55, 5);
        expect(c.state.tier).toBe(TIER.FALLBACK);      // still fallback until res restored
        const tierUp = feed(c, 120, 12);
        expect(tierUp.action).toBe('tier_up');
        expect(c.state.tier).toBe(TIER.DEGRADED);
    });

    it('never promotes above native', () => {
        const c = new AdaptiveQualityController();
        const d = feed(c, 240, 24);
        expect(c.state.tier).toBe(TIER.NATIVE);
        expect(d.action).toBe('ceiling');
    });
});

describe('manual override (5k3.37 seam) wins over auto', () => {
    it('pins the tier and ignores sampling until setAuto()', () => {
        const c = new AdaptiveQualityController();
        expect(c.setManualTier(TIER.DEGRADED)).toBe(true);
        expect(c.state.manual).toBe(true);
        feed(c, 10, 50);                      // brutal load
        expect(c.state.tier).toBe(TIER.DEGRADED); // unchanged
        c.setAuto();
        expect(c.state.manual).toBe(false);
        feed(c, 10, 6);
        expect(c.state.tier).toBe(TIER.FALLBACK); // auto resumes
    });
    it('rejects an unknown manual tier', () => {
        const c = new AdaptiveQualityController();
        expect(c.setManualTier('ultra')).toBe(false);
        expect(c.setManualTier(99)).toBe(false);
    });
});

describe('determinism', () => {
    it('identical fps sequences yield identical state', () => {
        const seq = [30, 30, 120, 20, 20, 20, 55, 58, 62, 62, 10, 10, 10, 10, 10, 10, 200, 200];
        const a = new AdaptiveQualityController();
        const b = new AdaptiveQualityController();
        for (const fps of seq) {
            a.sample(fps); b.sample(fps);
            expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
        }
    });
});

describe('drives a RenderSystem-like target via its public API', () => {
    it('reads the ladder from listGradeTiers on attach', () => {
        const target = makeTarget([{ tierName: 'A', resolutionScale: 1 }, { tierName: 'B', resolutionScale: 0.6 }]);
        const c = new AdaptiveQualityController().attach(target, { cores: 8, deviceMemory: 8 });
        expect(c.tiers.map(t => t.name)).toEqual(['A', 'B']);
        expect(c.state.tier).toBe('A');
    });

    it('calls setGradeTier + setResolutionScale on a tier drop, only when values change', () => {
        const target = makeTarget();
        const c = new AdaptiveQualityController().attach(target, { cores: 8, deviceMemory: 8 });
        target.gradeTierCalls.length = 0; target.resolutionCalls.length = 0; // ignore initial apply
        feed(c, 20, 6); // -> balanced
        expect(target.gradeTierCalls).toContain('balanced');
        expect(target.resolutionCalls).toContain(0.85);
        // stable samples do not spam the setters
        const before = target.gradeTierCalls.length;
        feed(c, 55, 20);
        expect(target.gradeTierCalls.length).toBe(before);
    });
});

describe('material warp G2 policy — adaptive/manual/reduce-effects seam', () => {
    it('auto policy enables subtle world warp on native/balanced and sheds it on degraded/fallback tier changes', () => {
        const target = makeTarget();
        const c = new AdaptiveQualityController({
            config: { downDebounce: 1, upDebounce: 1 }
        }).attach(target, { cores: 8, deviceMemory: 8 });

        target.materialWarpCalls.length = 0;
        c.setMaterialWarpPolicy({
            mode: 'auto',
            reduceEffects: false,
            vertexSnapIntensity: 0.4,
            affineIntensity: 0.15,
            snapGridSize: 0.6
        });
        expect(target.materialWarpCalls.at(-1)).toEqual({
            enabled: true,
            mode: 'auto',
            policy: 'auto-native',
            tier: 'native',
            vertexSnapIntensity: 0.4,
            affineIntensity: 0.15,
            snapGridSize: 0.6
        });

        c.sample(10); // balanced
        expect(target.materialWarpCalls.at(-1).policy).toBe('auto-balanced');
        expect(target.materialWarpCalls.at(-1).enabled).toBe(true);

        c.sample(10); // degraded
        expect(target.materialWarpCalls.at(-1)).toEqual(expect.objectContaining({
            enabled: false,
            policy: 'auto-degraded',
            vertexSnapIntensity: 0,
            affineIntensity: 0
        }));

        c.sample(10); // fallback
        expect(target.materialWarpCalls.at(-1)).toEqual(expect.objectContaining({
            enabled: false,
            policy: 'auto-fallback'
        }));
    });

    it('manual off and reduce-effects force material warp off regardless of tier', () => {
        const target = makeTarget();
        const c = new AdaptiveQualityController().attach(target, { cores: 8, deviceMemory: 8 });

        c.setMaterialWarpPolicy({ mode: 'off', vertexSnapIntensity: 0.8, affineIntensity: 0.4 });
        expect(target.materialWarpCalls.at(-1)).toEqual(expect.objectContaining({
            enabled: false,
            policy: 'manual-off',
            vertexSnapIntensity: 0,
            affineIntensity: 0
        }));

        c.setMaterialWarpPolicy({ mode: 'on', reduceEffects: true, vertexSnapIntensity: 0.8, affineIntensity: 0.4 });
        expect(target.materialWarpCalls.at(-1)).toEqual(expect.objectContaining({
            enabled: false,
            policy: 'reduce-effects',
            vertexSnapIntensity: 0,
            affineIntensity: 0
        }));
    });

    it('manual on enables warp even at fallback and stable samples do not spam the target', () => {
        const target = makeTarget();
        const c = new AdaptiveQualityController().attach(target, { softwareGpu: true });
        target.materialWarpCalls.length = 0;

        c.setMaterialWarpPolicy({ mode: 'on', vertexSnapIntensity: 0.5, affineIntensity: 0.2, snapGridSize: 0.8 });
        expect(target.materialWarpCalls).toHaveLength(1);
        expect(target.materialWarpCalls[0]).toEqual(expect.objectContaining({
            enabled: true,
            policy: 'manual-on',
            tier: 'fallback'
        }));

        feed(c, 55, 20);
        expect(target.materialWarpCalls).toHaveLength(1);
    });
});

describe('evidence artifact — tier-transition timeline (non-fudged)', () => {
    it('emits a real decision timeline over a synthetic fps track', () => {
        // Synthetic fps track: healthy -> sustained load (descend) -> floor
        // squeeze -> recovery back toward native. Real controller output.
        const track = [
            ...Array(10).fill(120),  // healthy, native
            ...Array(24).fill(22),   // sustained load -> descend to fallback + res trim
            ...Array(8).fill(22),    // keep pushing at the floor
            ...Array(40).fill(130),  // recovery -> climb back up
        ];
        const c = new AdaptiveQualityController();
        const timeline = [];
        track.forEach((fps, i) => {
            const d = c.sample(fps);
            if (d.changed || i === 0) {
                timeline.push({ i, fps, action: d.action, tier: d.tier, tierIndex: d.tierIndex, resolutionScale: d.resolutionScale });
            }
        });

        const hardwareMatrix = [
            { caps: { cores: 8, deviceMemory: 8 }, tierIndex: AdaptiveQualityController.classifyHardware({ cores: 8, deviceMemory: 8 }) },
            { caps: { cores: 4, deviceMemory: 4 }, tierIndex: AdaptiveQualityController.classifyHardware({ cores: 4, deviceMemory: 4 }) },
            { caps: { cores: 4, deviceMemory: 4, remote: true }, tierIndex: AdaptiveQualityController.classifyHardware({ cores: 4, deviceMemory: 4, remote: true }) },
            { caps: { cores: 2, deviceMemory: 2 }, tierIndex: AdaptiveQualityController.classifyHardware({ cores: 2, deviceMemory: 2 }) },
            { caps: { softwareGpu: true }, tierIndex: AdaptiveQualityController.classifyHardware({ softwareGpu: true }) },
        ];

        // Invariants proven inline as the timeline is written.
        expect(timeline.some(e => e.action === 'tier_down')).toBe(true);
        expect(timeline.some(e => e.action === 'res_down')).toBe(true);
        expect(timeline.some(e => e.action === 'tier_up' || e.action === 'res_up')).toBe(true);
        expect(timeline.every(e => e.resolutionScale >= AdaptiveQualityController.MIN_RENDER_SCALE)).toBe(true);

        const dir = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../artifacts/br-skip-bin-arcade-design-language-5k3.39'
        );
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'decision-timeline.json'), JSON.stringify({
            bead: 'br-skip-bin-arcade-design-language-5k3.39',
            config: AdaptiveQualityController.DEFAULT_CONFIG,
            tiers: AdaptiveQualityController.DEFAULT_TIERS,
            hardwareMatrix,
            timeline,
        }, null, 2));
    });
});

describe('no per-frame logging', () => {
    afterEach(() => vi.restoreAllMocks());
    it('never writes to the console across classify, attach, and many samples', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const target = makeTarget();
        const c = new AdaptiveQualityController().attach(target, { cores: 4, deviceMemory: 4, remote: true });
        for (let i = 0; i < 500; i++) c.sample(i % 2 ? 20 : 120);
        c.setManualTier(TIER.NATIVE); c.setAuto();
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
    });
});
