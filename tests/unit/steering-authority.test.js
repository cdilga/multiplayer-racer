import { describe, it, expect } from 'vitest';
import {
    computeSteeringAuthority,
    HANDLING_STATE,
    LIMITER,
    DEFAULT_STEERING_AUTHORITY_CONFIG as CFG
} from '../../static/js/systems/steeringAuthority.js';

const auth = (state, config) => computeSteeringAuthority(state, config).authority;

describe('steeringAuthority - state ordering (no abrupt cliff)', () => {
    it('grounded gives full authority', () => {
        const r = computeSteeringAuthority({ handlingState: HANDLING_STATE.GROUNDED });
        expect(r.authority).toBe(1);
        expect(r.dominantLimiter).toBe(LIMITER.NONE);
    });

    it('softens progressively: grounded >= front-light >= wheelie >= airborne', () => {
        const g = auth({ handlingState: HANDLING_STATE.GROUNDED });
        const fl = auth({ handlingState: HANDLING_STATE.FRONT_LIGHT });
        const w = auth({ handlingState: HANDLING_STATE.WHEELIE });
        const a = auth({ handlingState: HANDLING_STATE.AIRBORNE });
        expect(g).toBeGreaterThan(fl);
        expect(fl).toBeGreaterThan(w);
        expect(w).toBeGreaterThan(a);
        // front-light must soften BEFORE the wheelie cliff: clearly above wheelie,
        // clearly below grounded (the whole point of the bead).
        expect(fl).toBeGreaterThan(0.5);
        expect(fl).toBeLessThan(1);
    });

    it('wheelie keeps a weak but non-zero body influence; airborne is weakest', () => {
        const w = auth({ handlingState: HANDLING_STATE.WHEELIE });
        const a = auth({ handlingState: HANDLING_STATE.AIRBORNE });
        expect(w).toBeCloseTo(CFG.wheelieAuthority, 6);
        expect(a).toBeCloseTo(CFG.airborneAuthority, 6);
        expect(a).toBeGreaterThan(0); // subtle air control, not fully dead
    });

    it('front-contact override blends progressively toward full', () => {
        const seq = [0, 0.25, 0.5, 0.75, 1].map((c) => auth({ frontContact: c }));
        for (let i = 1; i < seq.length; i++) {
            expect(seq[i]).toBeGreaterThan(seq[i - 1]); // monotonic increasing
        }
        expect(seq[0]).toBeCloseTo(CFG.airborneAuthority, 6); // no contact == airborne floor
        expect(seq[seq.length - 1]).toBe(1);                  // full contact == full
    });
});

describe('steeringAuthority - speed', () => {
    it('reduces gently with speed, never below the floor', () => {
        const slow = auth({ handlingState: 'grounded', speedMps: 0 });
        const fast = auth({ handlingState: 'grounded', speedMps: 100 });
        expect(slow).toBe(1);
        expect(fast).toBeCloseTo(CFG.highSpeedAuthorityFloor, 6);
        expect(fast).toBeGreaterThanOrEqual(CFG.highSpeedAuthorityFloor - 1e-9);
    });

    it('speed is the dominant limiter when only speed is high', () => {
        const r = computeSteeringAuthority({ handlingState: 'grounded', speedMps: 30 });
        expect(r.dominantLimiter).toBe(LIMITER.SPEED);
    });
});

describe('steeringAuthority - roll / side-tilt', () => {
    it('roll below threshold does not cut steering', () => {
        const r = computeSteeringAuthority({ handlingState: 'grounded', rollDeg: 10 });
        expect(r.authority).toBe(1);
    });

    it('normal steering fades toward the floor as the car goes on its side', () => {
        const upright = auth({ handlingState: 'grounded', rollDeg: 0 });
        const twoWheel = auth({ handlingState: 'grounded', rollDeg: 50 });
        const onSide = auth({ handlingState: 'grounded', rollDeg: 90 });
        expect(twoWheel).toBeLessThan(upright);
        expect(onSide).toBeLessThan(twoWheel);
        expect(onSide).toBeCloseTo(CFG.sideTiltSteerFloor, 6);
    });

    it('side-tilt gives a forgiving recovery influence (not a magic reset)', () => {
        const upright = computeSteeringAuthority({ rollDeg: 0 });
        const tilted = computeSteeringAuthority({ rollDeg: 60 });
        const onSide = computeSteeringAuthority({ rollDeg: 90 });
        expect(upright.recoveryInfluence).toBe(0);
        expect(tilted.recoveryInfluence).toBeGreaterThan(0);
        expect(onSide.recoveryInfluence).toBeGreaterThan(tilted.recoveryInfluence);
        // forgiving, capped: never an instant full righting
        expect(onSide.recoveryInfluence).toBeLessThanOrEqual(CFG.recoveryMaxInfluence + 1e-9);
        expect(onSide.recoveryInfluence).toBeCloseTo(CFG.recoveryMaxInfluence, 6);
    });

    it('reports side-tilt as the dominant limiter when roll dominates', () => {
        const r = computeSteeringAuthority({ handlingState: 'grounded', rollDeg: 90 });
        expect(r.dominantLimiter).toBe(LIMITER.SIDE_TILT);
    });
});

describe('steeringAuthority - bad landing ramps back (no snap)', () => {
    it('floors at badLandingAuthority right after landing and ramps to full', () => {
        const justLanded = auth({ handlingState: 'grounded', badLanding: { active: true, progress: 0 } });
        const mid = auth({ handlingState: 'grounded', badLanding: { active: true, progress: 0.5 } });
        const recovered = auth({ handlingState: 'grounded', badLanding: { active: true, progress: 1 } });
        expect(justLanded).toBeCloseTo(CFG.badLandingAuthority, 6);
        expect(mid).toBeGreaterThan(justLanded);
        expect(mid).toBeLessThan(recovered);
        expect(recovered).toBeCloseTo(1, 6);
    });

    it('inactive bad landing does not reduce authority', () => {
        expect(auth({ handlingState: 'grounded', badLanding: { active: false } })).toBe(1);
    });

    it('bad landing reported as dominant limiter when it dominates', () => {
        const r = computeSteeringAuthority({ handlingState: 'grounded', badLanding: { active: true, progress: 0 } });
        expect(r.dominantLimiter).toBe(LIMITER.BAD_LANDING);
    });
});

describe('steeringAuthority - wall contact never rail-locks', () => {
    it('wall contact does NOT reduce authority and adds a peel-away bias', () => {
        const noWall = computeSteeringAuthority({ handlingState: 'grounded', speedMps: 10, wallContact: false });
        const wall = computeSteeringAuthority({ handlingState: 'grounded', speedMps: 10, wallContact: true });
        expect(wall.authority).toBe(noWall.authority); // no extra reduction
        expect(wall.wallPeel).toBeCloseTo(CFG.wallPeelBias, 6);
        expect(noWall.wallPeel).toBe(0);
    });
});

describe('steeringAuthority - combined factors + bounds', () => {
    it('authority always stays within [0, 1]', () => {
        const samples = [
            { handlingState: 'airborne', speedMps: 80, rollDeg: 120, badLanding: { active: true, progress: 0 } },
            { handlingState: 'grounded', speedMps: 0, rollDeg: 0 },
            { frontContact: -5, speedMps: -10, rollDeg: -200 },
            {}
        ];
        for (const s of samples) {
            const a = computeSteeringAuthority(s).authority;
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(1);
        }
    });

    it('factors multiply (wheelie + high speed is worse than either alone)', () => {
        const wheelieOnly = auth({ handlingState: 'wheelie', speedMps: 0 });
        const both = auth({ handlingState: 'wheelie', speedMps: 30 });
        expect(both).toBeLessThan(wheelieOnly);
    });

    it('the wheelie tradeoff remains meaningful even at low speed (cannot carve)', () => {
        // A wheelie at a crawl still must not give a near-full racing line.
        expect(auth({ handlingState: 'wheelie', speedMps: 1 })).toBeLessThan(0.3);
    });

    it('config overrides are honoured', () => {
        const a = auth({ handlingState: 'wheelie' }, { wheelieAuthority: 0.4 });
        expect(a).toBeCloseTo(0.4, 6);
    });

    it('exposes per-factor multipliers for telemetry', () => {
        const r = computeSteeringAuthority({ handlingState: 'front-light', speedMps: 22, rollDeg: 90 });
        expect(r.factors).toHaveProperty('state');
        expect(r.factors).toHaveProperty('speed');
        expect(r.factors).toHaveProperty('roll');
        expect(r.factors).toHaveProperty('badLanding');
        // product of factors equals reported authority
        const product = r.factors.state * r.factors.speed * r.factors.roll * r.factors.badLanding;
        expect(r.authority).toBeCloseTo(product, 9);
    });
});
