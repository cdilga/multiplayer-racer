import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HitStopController } from '../../static/js/systems/HitStopController.js';

/**
 * br-skip-bin-arcade-design-language-5k3.15 (P3.1) — Smash hit-stop core.
 *
 * Phase 1: deterministic decision/timing logic only (no THREE/DOM/EventBus).
 * Proves: severity threshold ("weight not lag"), 1-3 frame cap, refresh/no-stack,
 * context policy (localized freeze vs camera punch), fixed-physics safety,
 * tunable constants, determinism, and no per-tick logging.
 */

const { MODE_NONE, MODE_FREEZE, MODE_CAMERA_PUNCH, CONTEXT_FOCUSED, CONTEXT_SHARED_RACE } =
    HitStopController;

describe('HitStopController — severity threshold (weight, not lag)', () => {
    it('ignores light taps below the heavy threshold', () => {
        const hs = new HitStopController();
        const d = hs.registerImpact({ severity: 0.1, context: 'focused' });
        expect(d.mode).toBe(MODE_NONE);
        expect(d.frames).toBe(0);
        expect(hs.active).toBe(false);
    });

    it('maps severity bands to 1/2/3 frames', () => {
        const hs = new HitStopController();
        expect(hs.severityToFrames(0.24)).toBe(0); // below threshold
        expect(hs.severityToFrames(0.25)).toBe(1); // threshold -> 1
        expect(hs.severityToFrames(0.54)).toBe(1);
        expect(hs.severityToFrames(0.55)).toBe(2);
        expect(hs.severityToFrames(0.79)).toBe(2);
        expect(hs.severityToFrames(0.80)).toBe(3);
        expect(hs.severityToFrames(1.0)).toBe(3);
    });

    it('treats non-finite severity as zero', () => {
        const hs = new HitStopController();
        expect(hs.severityToFrames(undefined)).toBe(0);
        expect(hs.severityToFrames(NaN)).toBe(0);
    });
});

describe('HitStopController — context policy (no global slow-mo)', () => {
    it('focused context uses a localized freeze', () => {
        const hs = new HitStopController();
        const d = hs.registerImpact({ severity: 0.9, context: 'focused' });
        expect(d.mode).toBe(MODE_FREEZE);
        expect(hs.freezesMeshes).toBe(true);
    });

    it('shared-race context uses a camera punch, never a freeze', () => {
        const hs = new HitStopController();
        const d = hs.registerImpact({ severity: 0.9, context: 'shared-race' });
        expect(d.mode).toBe(MODE_CAMERA_PUNCH);
        expect(hs.freezesMeshes).toBe(false);
    });

    it('unknown/missing context defaults to shared-race (safe: no freeze)', () => {
        const hs = new HitStopController();
        expect(hs.registerImpact({ severity: 0.9 }).mode).toBe(MODE_CAMERA_PUNCH);
        hs.reset();
        expect(hs.registerImpact({ severity: 0.9, context: 'weird' }).mode).toBe(MODE_CAMERA_PUNCH);
    });

    it('a mid-race elimination still uses a camera punch, not a global freeze', () => {
        const hs = new HitStopController();
        const d = hs.registerImpact({ severity: 0.9, context: 'shared-race', elimination: true });
        expect(d.mode).toBe(MODE_CAMERA_PUNCH);
        expect(hs.freezesMeshes).toBe(false);
    });
});

describe('HitStopController — elimination beats', () => {
    it('elimination forces the max frame beat regardless of severity', () => {
        const hs = new HitStopController();
        const d = hs.registerImpact({ severity: 0.01, context: 'focused', elimination: true });
        expect(d.frames).toBe(3);
        expect(d.mode).toBe(MODE_FREEZE);
    });

    it('elimination floors the punch intensity', () => {
        const hs = new HitStopController();
        const d = hs.registerImpact({ severity: 0.05, context: 'shared-race', elimination: true });
        expect(d.intensity).toBeGreaterThanOrEqual(HitStopController.DEFAULT_CONFIG.eliminationMinIntensity);
    });
});

describe('HitStopController — 1-3 frame cap + countdown', () => {
    it('counts a 3-frame effect down to idle over exactly 3 ticks', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.9, context: 'focused' });
        expect(hs.framesRemaining).toBe(3);
        expect(hs.active).toBe(true);

        expect(hs.tick().framesRemaining).toBe(2);
        expect(hs.active).toBe(true);
        expect(hs.tick().framesRemaining).toBe(1);
        expect(hs.active).toBe(true);
        const last = hs.tick();
        expect(last.framesRemaining).toBe(0);
        expect(last.active).toBe(false);
        expect(last.mode).toBe(MODE_NONE);
    });

    it('never exceeds maxFrames even if config asks for more', () => {
        const hs = new HitStopController({ eliminationFrames: 10 });
        const d = hs.registerImpact({ severity: 1, context: 'focused', elimination: true });
        expect(d.frames).toBe(HitStopController.DEFAULT_CONFIG.maxFrames);
        expect(hs.framesRemaining).toBeLessThanOrEqual(3);
    });

    it('ticking while idle is a no-op', () => {
        const hs = new HitStopController();
        const s = hs.tick();
        expect(s.active).toBe(false);
        expect(s.framesRemaining).toBe(0);
    });
});

describe('HitStopController — refresh, do not stack (anti-lag)', () => {
    it('a repeat impact refreshes the window instead of summing frames', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.9, context: 'focused' }); // 3 frames
        hs.tick(); // remaining 2
        hs.registerImpact({ severity: 0.9, context: 'focused' }); // 3 again
        // refreshed to max(2,3)=3, NOT 2+3=5
        expect(hs.framesRemaining).toBe(3);
    });

    it('a weaker impact does not shorten a stronger ongoing effect', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.9, context: 'focused' }); // 3 frames remaining
        hs.registerImpact({ severity: 0.3, context: 'focused' }); // 1 frame
        expect(hs.framesRemaining).toBe(3); // max(3,1)
    });

    it('never stacks beyond the cap across many rapid impacts', () => {
        const hs = new HitStopController();
        for (let i = 0; i < 20; i++) {
            hs.registerImpact({ severity: 1, context: 'focused', elimination: true });
        }
        expect(hs.framesRemaining).toBeLessThanOrEqual(3);
    });

    it('a stronger impact upgrades mode + intensity mid-effect', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.3, context: 'shared-race' }); // 1 frame punch, intensity 0.3
        expect(hs.mode).toBe(MODE_CAMERA_PUNCH);
        hs.registerImpact({ severity: 0.9, context: 'focused', elimination: true }); // 3-frame freeze
        expect(hs.mode).toBe(MODE_FREEZE);
        expect(hs.intensity).toBeGreaterThanOrEqual(0.8);
        expect(hs.framesRemaining).toBe(3);
    });
});

describe('HitStopController — fixed-physics safety', () => {
    it('physicsTimeScale is always 1 (never slows the sim)', () => {
        const hs = new HitStopController();
        expect(hs.physicsTimeScale).toBe(1);
        hs.registerImpact({ severity: 1, context: 'focused', elimination: true });
        expect(hs.physicsTimeScale).toBe(1);
        expect(hs.state.physicsTimeScale).toBe(1);
        hs.tick();
        expect(hs.physicsTimeScale).toBe(1);
    });

    it('camera-punch mode never freezes meshes', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.9, context: 'shared-race' });
        expect(hs.mode).toBe(MODE_CAMERA_PUNCH);
        expect(hs.freezesMeshes).toBe(false);
    });

    it('progress eases from 1 toward 0 across the window', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.9, context: 'focused' }); // 3 frames
        expect(hs.progress).toBeCloseTo(1, 5);
        hs.tick();
        expect(hs.progress).toBeCloseTo(2 / 3, 5);
        hs.tick();
        expect(hs.progress).toBeCloseTo(1 / 3, 5);
        hs.tick();
        expect(hs.progress).toBe(0);
    });
});

describe('HitStopController — tunable constants', () => {
    it('constructor overrides change gating', () => {
        const hs = new HitStopController({ heavyThreshold: 0.5 });
        expect(hs.registerImpact({ severity: 0.4, context: 'focused' }).mode).toBe(MODE_NONE);
        expect(hs.registerImpact({ severity: 0.5, context: 'focused' }).mode).toBe(MODE_FREEZE);
    });

    it('setConfig updates thresholds at runtime', () => {
        const hs = new HitStopController();
        hs.setConfig({ band1: 0.9 });
        // With band1 raised, severity 0.7 now maps to 1 frame instead of 2.
        expect(hs.severityToFrames(0.7)).toBe(1);
    });
});

describe('HitStopController — determinism', () => {
    it('identical call sequences produce identical state snapshots', () => {
        const ops = [
            (c) => c.registerImpact({ severity: 0.9, context: 'focused', elimination: true }),
            (c) => c.tick(),
            (c) => c.tick(),
            (c) => c.registerImpact({ severity: 0.6, context: 'shared-race' }),
            (c) => c.tick(),
            (c) => c.registerImpact({ severity: 0.2, context: 'focused' }),
            (c) => c.tick(),
            (c) => c.tick(),
            (c) => c.tick(),
        ];
        const a = new HitStopController();
        const b = new HitStopController();
        for (const op of ops) {
            op(a);
            op(b);
            expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
        }
    });
});

describe('HitStopController — debug + no per-tick logging', () => {
    afterEach(() => vi.restoreAllMocks());

    it('lastImpact records the decision on registerImpact only', () => {
        const hs = new HitStopController();
        expect(hs.lastImpact).toBe(null);
        hs.registerImpact({ severity: 0.9, context: 'focused' });
        expect(hs.lastImpact).not.toBe(null);
        expect(hs.lastImpact.decision.mode).toBe(MODE_FREEZE);

        const before = hs.lastImpact;
        hs.tick(); // tick must NOT touch lastImpact
        expect(hs.lastImpact).toBe(before);
    });

    it('never writes to the console across register + many ticks', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});

        const hs = new HitStopController();
        hs.registerImpact({ severity: 1, context: 'focused', elimination: true });
        for (let i = 0; i < 100; i++) hs.tick();
        hs.registerImpact({ severity: 0.6, context: 'shared-race' });
        for (let i = 0; i < 100; i++) hs.tick();

        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
    });

    it('reset clears active state and debug state', () => {
        const hs = new HitStopController();
        hs.registerImpact({ severity: 0.9, context: 'focused' });
        hs.reset();
        expect(hs.active).toBe(false);
        expect(hs.lastImpact).toBe(null);
        expect(hs.mode).toBe(MODE_NONE);
    });
});

describe('HitStopController — evidence artifact', () => {
    it('emits a decision matrix + countdown demo for tuning review', () => {
        const hs = new HitStopController();
        const cases = [
            { severity: 0.10, context: 'focused', elimination: false },
            { severity: 0.25, context: 'focused', elimination: false },
            { severity: 0.60, context: 'focused', elimination: false },
            { severity: 0.90, context: 'focused', elimination: false },
            { severity: 0.90, context: 'shared-race', elimination: false },
            { severity: 0.05, context: 'shared-race', elimination: true },
            { severity: 0.90, context: 'shared-race', elimination: true },
            { severity: 0.90, elimination: false }, // default context
        ];
        const decisionMatrix = cases.map((c) => ({ input: c, decision: hs.classify(c) }));

        const demo = new HitStopController();
        demo.registerImpact({ severity: 0.9, context: 'focused', elimination: true });
        const countdown = [demo.state];
        for (let i = 0; i < 4; i++) countdown.push(demo.tick());

        const artifact = {
            bead: 'br-skip-bin-arcade-design-language-5k3.15',
            phase: 1,
            config: HitStopController.DEFAULT_CONFIG,
            decisionMatrix,
            countdownDemo: countdown.map((f) => ({
                active: f.active,
                mode: f.mode,
                framesRemaining: f.framesRemaining,
                intensity: f.intensity,
                physicsTimeScale: f.physicsTimeScale,
            })),
        };

        // Invariant proven inline: physics is never scaled by any decision/tick.
        for (const f of artifact.countdownDemo) expect(f.physicsTimeScale).toBe(1);

        const dir = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../artifacts/br-skip-bin-arcade-design-language-5k3.15'
        );
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'hit-stop-decision-matrix.json'), JSON.stringify(artifact, null, 2));
    });
});
