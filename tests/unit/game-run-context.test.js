import { describe, it, expect } from 'vitest';
import { GameRunContext, hashTuning } from '../../static/js/engine/GameRunContext.js';
import { SimClock, RealClock } from '../../static/js/engine/Clock.js';
import { RngStreams, RngStream, hashSeed, DEFAULT_STREAMS } from '../../static/js/engine/Rng.js';

/**
 * Helper: pull `n` floats off a stream.
 */
function draw(stream, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(stream.next());
    return out;
}

describe('Rng - stable seeded draws', () => {
    it('same seed + stream + key produces identical sequences', () => {
        const a = new RngStreams(12345);
        const b = new RngStreams(12345);
        expect(draw(a.stream('gameplay'), 20)).toEqual(draw(b.stream('gameplay'), 20));
        expect(draw(a.stream('map').child('arena:1'), 20))
            .toEqual(draw(b.stream('map').child('arena:1'), 20));
    });

    it('different seeds produce different sequences', () => {
        const a = new RngStreams(1);
        const b = new RngStreams(2);
        expect(draw(a.stream('gameplay'), 20)).not.toEqual(draw(b.stream('gameplay'), 20));
    });

    it('a bare RngStream is reproducible and serializable for replay', () => {
        const s = new RngStream(777);
        const first = draw(s, 5);
        const snap = s.getState();
        const after = draw(s, 5);

        const restored = new RngStream(777).setState(snap);
        expect(draw(restored, 5)).toEqual(after);

        expect(draw(new RngStream(777), 5)).toEqual(first);
    });

    it('setState restores seed/label so reset() and clone() are self-sufficient', () => {
        const original = new RngStream(777, 'gameplay');
        draw(original, 17);
        const snap = original.getState();
        expect(snap).toMatchObject({ seed: 777, label: 'gameplay' });

        // Restore into a stream constructed with a DIFFERENT seed.
        const restored = new RngStream(123, 'other').setState(snap);
        expect(restored.seed).toBe(777);
        expect(restored.label).toBe('gameplay');

        // Continuing from the accumulator matches the original's continuation.
        const cont = draw(restored, 5);
        expect(draw(original, 5)).toEqual(cont);

        // reset() after restore must use the SERIALIZED seed (777), not 123.
        const baseline = draw(new RngStream(777), 5);
        restored.reset();
        expect(draw(restored, 5)).toEqual(baseline);

        // clone() after restore must also carry the serialized seed.
        const clone = new RngStream(123).setState(snap).clone();
        expect(clone.seed).toBe(777);
        expect(draw(clone, 5)).toEqual(baseline);
    });

    it('produces values in [0, 1) and respects int/range/pick bounds', () => {
        const s = new RngStream(42);
        for (let i = 0; i < 1000; i++) {
            const v = s.next();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
        for (let i = 0; i < 1000; i++) {
            const n = s.int(1, 6);
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(6);
        }
        for (let i = 0; i < 1000; i++) {
            const r = s.range(10, 20);
            expect(r).toBeGreaterThanOrEqual(10);
            expect(r).toBeLessThan(20);
        }
        expect([10, 20, 30]).toContain(s.pick([10, 20, 30]));
        expect(s.pick([])).toBeUndefined();
    });
});

describe('Rng - stream independence', () => {
    it('draining one stream does not perturb another stream', () => {
        const ref = new RngStreams(9001);
        const refSpawn = draw(ref.stream('spawn'), 10);

        const perturbed = new RngStreams(9001);
        // Draw a lot from `map` BEFORE touching `spawn`.
        draw(perturbed.stream('map'), 5000);
        const perturbedSpawn = draw(perturbed.stream('spawn'), 10);

        expect(perturbedSpawn).toEqual(refSpawn);
    });

    it('all default streams are mutually independent (pairwise distinct)', () => {
        const rng = new RngStreams(55);
        const seqs = DEFAULT_STREAMS.map((name) => draw(rng.stream(name).clone(), 8).join(','));
        const unique = new Set(seqs);
        expect(unique.size).toBe(DEFAULT_STREAMS.length);
    });

    it('exposes default streams as lazy getters', () => {
        const rng = new RngStreams(7);
        expect(rng.gameplay).toBeInstanceOf(RngStream);
        expect(draw(rng.gameplay.clone(), 4)).toEqual(draw(rng.stream('gameplay').clone(), 4));
    });
});

describe('Rng - child-key independence', () => {
    it('children of a stream are independent of each other', () => {
        const stream = new RngStreams(31337).stream('gameplay');
        const x = draw(stream.child('x'), 12);
        const y = draw(stream.child('y'), 12);
        expect(x).not.toEqual(y);
    });

    it('child draws are independent of parent draw order', () => {
        const early = new RngStreams(31337).stream('gameplay').child('weapon:plasma');
        const earlySeq = draw(early, 10);

        // Same stream, but draw heavily from the parent first, then make the child.
        const parent = new RngStreams(31337).stream('gameplay');
        draw(parent, 1234);
        const late = parent.child('weapon:plasma');
        expect(draw(late, 10)).toEqual(earlySeq);
    });

    it('different child keys produce different sub-streams; same key is stable', () => {
        const s1 = new RngStreams(8).stream('effects');
        const s2 = new RngStreams(8).stream('effects');
        expect(draw(s1.child('a'), 6)).toEqual(draw(s2.child('a'), 6));
        expect(draw(s1.child('a'), 6)).not.toEqual(draw(s2.child('b'), 6));
    });
});

describe('SimClock - fixed stepping', () => {
    it('advances tick by whole steps and derives sim time from tick', () => {
        const clock = new SimClock({ fixedDt: 1 / 60 });
        expect(clock.tick).toBe(0);
        expect(clock.nowMs()).toBe(0);

        clock.step();
        expect(clock.tick).toBe(1);
        expect(clock.nowMs()).toBeCloseTo((1 / 60) * 1000, 9);

        clock.step(59);
        expect(clock.tick).toBe(60);
        expect(clock.nowSeconds()).toBeCloseTo(1, 9);
    });

    it('sim time is drift-free: derived from tick, not summed per step', () => {
        const a = new SimClock({ fixedDt: 1 / 60 });
        for (let i = 0; i < 600; i++) a.step();
        const b = new SimClock({ fixedDt: 1 / 60 });
        b.step(600);
        expect(a.nowMs()).toBe(b.nowMs());
        expect(a.nowMs()).toBeCloseTo(10000, 6); // 600 ticks @ 60Hz = 10s
    });

    it('honours startMs/startTick and reset()', () => {
        // startMs is the sim time AT the starting tick (resume semantics).
        const clock = new SimClock({ fixedDt: 1 / 50, startMs: 5000, startTick: 10 });
        expect(clock.tick).toBe(10);
        expect(clock.nowMs()).toBe(5000);
        clock.step(5);
        expect(clock.tick).toBe(15);
        expect(clock.nowMs()).toBe(5100); // +5 ticks @ 50Hz = +100ms
        clock.reset();
        expect(clock.tick).toBe(10);
        expect(clock.nowMs()).toBe(5000);
    });

    it('rejects fractional / negative steps', () => {
        const clock = new SimClock();
        expect(() => clock.step(1.5)).toThrow();
        expect(() => clock.step(-1)).toThrow();
    });

    it('getState/setState snapshot is self-sufficient (restores config + tick)', () => {
        const original = new SimClock({ fixedDt: 0.02, startMs: 5000, startTick: 10 });
        original.step(5); // tick 15, simTime 5100
        const snap = original.getState();
        expect(snap).toMatchObject({ tick: 15, fixedDt: 0.02, startMs: 5000, startTick: 10 });

        // Restore into a fresh clock with DIFFERENT defaults; it must adopt the
        // snapshot's config and reproduce the exact sim time.
        const restored = new SimClock({ fixedDt: 1 / 60 }).setState(snap);
        expect(restored.tick).toBe(15);
        expect(restored.nowMs()).toBe(5100);
        expect(restored.nowMs()).toBe(original.nowMs());

        // And it keeps stepping correctly with the restored fixedDt.
        restored.step(5);
        expect(restored.nowMs()).toBe(5200);
    });
});

describe('RealClock - injectable wall-time adapter', () => {
    it('reads from the injected now() and measures elapsed time', () => {
        let t = 1000;
        const clock = new RealClock({ now: () => t });
        expect(clock.nowMs()).toBe(1000);
        expect(clock.elapsedMs()).toBe(0);
        t = 1250;
        expect(clock.nowMs()).toBe(1250);
        expect(clock.elapsedMs()).toBe(250);
        clock.reset();
        expect(clock.elapsedMs()).toBe(0);
    });

    it('defaults to a real time source when none is injected', () => {
        const clock = new RealClock();
        expect(typeof clock.nowMs()).toBe('number');
        expect(clock.elapsedMs()).toBeGreaterThanOrEqual(0);
    });
});

describe('GameRunContext - tuning hash inclusion', () => {
    it('hashTuning is stable across key order and changes with values', () => {
        const h1 = hashTuning('arcade', { grip: 1, boost: 2 });
        const h2 = hashTuning('arcade', { boost: 2, grip: 1 });
        expect(h1).toBe(h2);
        const h3 = hashTuning('arcade', { grip: 1, boost: 3 });
        expect(h3).not.toBe(h1);
        expect(h1).toMatch(/^[0-9a-f]{8}$/);
    });

    it('describe() includes tuningHash and identity fields', () => {
        const ctx = GameRunContext.create({
            seed: 99,
            ruleset: 'race',
            topology: 'local',
            buildId: 'test-build',
            tuningProfileId: 'arcade',
            tuning: { grip: 1.2 },
            deterministic: true
        });
        const d = ctx.describe();
        expect(d.tuningHash).toBe(hashTuning('arcade', { grip: 1.2 }));
        expect(d).toMatchObject({
            buildId: 'test-build',
            ruleset: 'race',
            topology: 'local',
            seed: 99,
            seedSource: 'provided',
            tuningProfileId: 'arcade'
        });
    });
});

describe('GameRunContext - seed policy', () => {
    it('deterministic mode requires an explicit seed', () => {
        expect(() => GameRunContext.create({ deterministic: true })).toThrow(/seed is required/i);
    });

    it('deterministic mode with a seed is reproducible', () => {
        const a = GameRunContext.create({ seed: 2024, deterministic: true });
        const b = GameRunContext.create({ seed: 2024, deterministic: true });
        expect(draw(a.stream('gameplay'), 16)).toEqual(draw(b.stream('gameplay'), 16));
        expect(a.seedSource).toBe('provided');
    });

    it('production default works with no seed and no harness (generates a seed)', () => {
        const ctx = GameRunContext.create({ ruleset: 'derby', entropy: () => 0xABCDEF });
        expect(ctx.deterministic).toBe(false);
        expect(ctx.seedSource).toBe('generated');
        expect(Number.isFinite(ctx.seed)).toBe(true);
        // The generated seed must actually feed the streams.
        const expected = new RngStreams(0xABCDEF >>> 0);
        expect(draw(ctx.stream('spawn'), 6)).toEqual(draw(expected.stream('spawn'), 6));
    });

    it('rejects non-finite seeds and unknown topologies', () => {
        expect(() => GameRunContext.create({ seed: NaN })).toThrow(/finite/i);
        expect(() => GameRunContext.create({ seed: 1, topology: 'cloud' })).toThrow(/topology/i);
    });
});

describe('GameRunContext - clock wiring', () => {
    it('proxies sim tick/time and steps the sim clock', () => {
        const ctx = GameRunContext.create({ seed: 1, fixedDt: 1 / 60, deterministic: true });
        expect(ctx.tick).toBe(0);
        ctx.step(30);
        expect(ctx.tick).toBe(30);
        expect(ctx.simTimeMs).toBeCloseTo(500, 6);
        expect(ctx.realClock).toBeInstanceOf(RealClock);
        expect(ctx.clock).toBeInstanceOf(SimClock);
    });
});
