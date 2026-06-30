import { test, expect } from '@playwright/test';

/**
 * Focused controller-touch smoke for ControlMapper input shaping.
 *
 * Two layers, both browser-light (NO full 4-player WebGL flow), both DETERMINISTIC
 * (no arbitrary sleeps - they advance via ControlMapper.step()/the player page's
 * advanceFrame() test hook):
 *
 *  1. In-browser ControlMapper API: dead zone, snap-to-zero, response curve,
 *     full-lock reachability, raw-vs-shaped separation, deterministic throttle
 *     RAMP (post-196.3 throttle is intentionally ramped, not instant), and
 *     keyboard priority.
 *  2. Real player-page touch path: drives the actual player.js touch-intent
 *     functions through window.__playerControlMapperTestHooks into the LIVE
 *     ControlMapper, proving browser touch intent reaches shaped controls.
 */
test.describe('Joystick Input Shaping Smoke Test', () => {
    const RAMP_FRAMES = 40; // 40 * 16.667ms ~= 667ms - comfortably past the throttle ramp windows

    test('shapes touch input through ControlMapper (deterministic)', async ({ page }) => {
        await page.goto('http://localhost:8000/player');
        await page.waitForLoadState('networkidle');

        const result = await page.evaluate((rampFrames) => {
            const ControlMapper = (window as any).ControlMapper;
            if (!ControlMapper) throw new Error('ControlMapper not available in window');

            const mapper = new (ControlMapper as any)({
                steeringDeadZone: 0.1,
                steeringCurveExponent: 1.5,
                steeringSnapThreshold: 0.03,
                steeringFilterLagMs: 50,
            });

            return {
                // Dead zone suppresses tiny steering.
                deadZoneSuppressed: (() => {
                    mapper.reset();
                    mapper.setTouchInput(0.05, 0, 0);
                    return mapper.getControls().steering === 0;
                })(),

                // Responds above dead zone.
                respondsAboveDeadZone: (() => {
                    mapper.reset();
                    mapper.setTouchInput(0.2, 0, 0);
                    return Math.abs(mapper.getControls().steering) > 0;
                })(),

                // Full lock still reachable after sustained input.
                fullLockReachable: (() => {
                    mapper.reset();
                    for (let i = 0; i < 10; i++) mapper.setTouchInput(1.0, 0, 0);
                    return Math.abs(mapper.getControls().steering) > 0.9;
                })(),

                // RAW touch contract preserved (196.1/196.2): debug.touchRaw stays
                // canonical raw while shaped output is separate.
                rawTouchPreserved: (() => {
                    mapper.reset();
                    mapper.setTouchInput(1.5, 0, 0); // out-of-range -> raw clamps to 1
                    const dbg = mapper.getDebugValues();
                    return dbg.touchRaw.steering === 1 && 'touchShaped' in dbg;
                })(),

                // Snap-to-zero: sub-threshold steering shapes to 0 but raw is untouched.
                snapToZero: (() => {
                    mapper.reset();
                    mapper.setTouchInput(0.02, 0, 0); // <= 0.03 threshold
                    const dbg = mapper.getDebugValues();
                    return mapper.getControls().steering === 0 && dbg.touchRaw.steering === 0.02;
                })(),

                // THROTTLE RAMP (post-196.3): acceleration is NOT instant; it ramps
                // up to target and back down to 0 deterministically via step().
                throttleRamps: (() => {
                    mapper.reset();
                    mapper.setTouchInput(0, 1, 0);        // hold full throttle
                    const immediate = mapper.getControls().acceleration;
                    for (let i = 0; i < rampFrames; i++) mapper.step(16.667);
                    const ramped = mapper.getControls().acceleration;
                    mapper.setTouchInput(0, 0, 0);        // release
                    for (let i = 0; i < rampFrames; i++) mapper.step(16.667);
                    const released = mapper.getControls().acceleration;
                    return { immediate, ramped, released };
                })(),

                // Determinism: identical input sequence -> identical shaped steering.
                deterministic: (() => {
                    const seq = [0.05, 0.2, 0.5, 1.0, 0.5, 0.2, 0.0];
                    const run = () => {
                        mapper.reset();
                        return seq.map((v) => {
                            mapper.setTouchInput(v, 0, 0);
                            mapper.step(16.667);
                            return mapper.getControls().steering;
                        });
                    };
                    const a = run();
                    const b = run();
                    return a.every((v, i) => v === b[i]);
                })(),
            };
        }, RAMP_FRAMES);

        expect(result.deadZoneSuppressed).toBe(true);
        expect(result.respondsAboveDeadZone).toBe(true);
        expect(result.fullLockReachable).toBe(true);
        expect(result.rawTouchPreserved).toBe(true);
        expect(result.snapToZero).toBe(true);
        // Throttle ramps rather than snapping to the target instantly.
        expect(result.throttleRamps.immediate).toBeLessThan(1);
        expect(result.throttleRamps.ramped).toBeCloseTo(1, 5);
        expect(result.throttleRamps.released).toBeCloseTo(0, 5);
        expect(result.deterministic).toBe(true);
    });

    test('keyboard input dominates over touch', async ({ page }) => {
        await page.goto('http://localhost:8000/player');
        await page.waitForLoadState('networkidle');

        const result = await page.evaluate(() => {
            const ControlMapper = (window as any).ControlMapper;
            const mapper = new (ControlMapper as any)();
            mapper.setKeyboardKeys(['KeyD']);
            mapper.step(16.667);
            const keyboardValue = mapper.getControls().steering;
            mapper.setTouchInput(0.5, 0, 0);
            const blendedValue = mapper.getControls().steering;
            return { keyboardValue, blendedValue, keyboardDominates: keyboardValue === blendedValue };
        });

        expect(result.keyboardDominates).toBe(true);
    });

    test('real player-page touch intent reaches shaped controls (deterministic)', async ({ page }) => {
        // Drives the ACTUAL player.js touch-intent path into the live ControlMapper
        // via the test hook - proves browser touch reaches shaped controls without
        // a full WebGL/4-player flow. Deterministic via advanceFrame() (no sleeps).
        // NOTE: don't wait for 'networkidle' - the player page holds an open
        // socket so the network never goes idle. Gate on the test hook instead.
        await page.goto('http://localhost:8000/player?testMode=1', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!(window as any).__playerControlMapperTestHooks, null, { timeout: 20000 });

        const out = await page.evaluate((rampFrames) => {
            const h = (window as any).__playerControlMapperTestHooks;
            h.setSession({ playerId: 1, roomCode: 'TEST', gameStarted: true });

            // Full throttle via the real touch-intent path.
            h.applyTouchIntent({ acceleration: 1 });
            const accImmediate = h.getControls().acceleration;
            const rawAcc = h.getControlDebug().touchRaw.acceleration;
            let accRamped = accImmediate;
            for (let i = 0; i < rampFrames; i++) accRamped = h.advanceFrame(16.667).acceleration;

            // Release ramps down.
            h.applyTouchIntent({ acceleration: 0 });
            let accReleased = h.getControls().acceleration;
            for (let i = 0; i < rampFrames; i++) accReleased = h.advanceFrame(16.667).acceleration;

            // Sub-threshold steering snaps shaped to 0 while raw is preserved.
            h.applyTouchIntent({ steering: 0.02 });
            const snapShaped = h.getControls().steering;
            const snapRaw = h.getControlDebug().touchRaw.steering;

            // Above-deadzone steering reaches the shaped output.
            h.applyTouchIntent({ steering: 0.6 });
            let steer = h.getControls().steering;
            for (let i = 0; i < 10; i++) steer = h.advanceFrame(16.667).steering;

            return { accImmediate, rawAcc, accRamped, accReleased, snapShaped, snapRaw, steer };
        }, RAMP_FRAMES);

        // Raw touch preserved through the real player path.
        expect(out.rawAcc).toBe(1);
        // Throttle ramps (not instant binary), reaches full, releases to 0 - all via the live page.
        expect(out.accImmediate).toBeLessThan(1);
        expect(out.accRamped).toBeCloseTo(1, 5);
        expect(out.accReleased).toBeCloseTo(0, 5);
        // Snap-to-zero on the real path: shaped 0, raw preserved.
        expect(out.snapShaped).toBe(0);
        expect(out.snapRaw).toBeCloseTo(0.02, 5);
        // Above-deadzone steering reaches shaped controls.
        expect(Math.abs(out.steer)).toBeGreaterThan(0);
    });
});
