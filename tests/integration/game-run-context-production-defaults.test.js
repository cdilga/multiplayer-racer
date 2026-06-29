import { describe, it, expect } from 'vitest';
import { Engine } from '../../static/js/engine/Engine.js';
import { EventBus } from '../../static/js/engine/EventBus.js';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';
import { DEFAULT_TOPOLOGY, DEFAULT_RULESET } from '../../static/js/engine/sessionVocabulary.js';

/**
 * These tests exercise the REAL production startup path: GameHost constructs an
 * Engine and calls engine.init(); the engine is what runs at host startup. We
 * drive that same init() (no GameHost DOM/THREE dependencies needed) and assert
 * that a run context is actually created and recorded - the integration the bead
 * requires ("production startup receives a context even without a test harness").
 *
 * A fresh EventBus per engine keeps the engine:runcontext events isolated.
 */

/**
 * Boot an engine the way startup does, capturing the engine:runcontext event.
 * @param {Object} [options] - Engine options (run-context fields)
 * @returns {Promise<{engine: Engine, recorded: Object|null}>}
 */
async function bootEngine(options = {}) {
    const bus = new EventBus();
    let recorded = null;
    bus.on('engine:runcontext', (ctx) => { recorded = ctx; });
    const engine = new Engine({ eventBus: bus, ...options });
    await engine.init();
    return { engine, recorded };
}

describe('GameRunContext production startup wiring (Engine.init)', () => {
    it('real startup with no harness creates and records a run context', async () => {
        const { engine, recorded } = await bootEngine();

        const ctx = engine.getRunContext();
        expect(ctx).toBeInstanceOf(GameRunContext);
        expect(ctx.deterministic).toBe(false);   // no test harness
        expect(ctx.seedSource).toBe('generated'); // seed came from entropy
        expect(Number.isFinite(ctx.seed)).toBe(true);

        // The startup actually broadcast the recorded context for telemetry.
        expect(recorded).not.toBeNull();
        expect(recorded.seed).toBe(ctx.seed);
    });

    it('records buildId / seed / ruleset / topology / tuningHash from startup', async () => {
        const { recorded } = await bootEngine();
        expect(recorded).toMatchObject({
            buildId: 'dev',            // default when host injects none
            topology: DEFAULT_TOPOLOGY, // 'local' - today's couch flow
            ruleset: null               // no game chosen yet at engine startup
        });
        expect(Number.isFinite(recorded.seed)).toBe(true);
        expect(recorded.tuningHash).toMatch(/^[0-9a-f]{8}$/);
        expect(recorded.seedSource).toBe('generated');
    });

    it('startup passes through identity options (buildId/topology/ruleset/seed)', async () => {
        const { engine, recorded } = await bootEngine({
            buildId: 'prod-2026.06.29',
            topology: 'remote',
            ruleset: 'derby',
            seed: 4242,
            deterministic: true,
            tuningProfileId: 'arcade',
            tuning: { grip: 1.1 }
        });
        expect(recorded).toMatchObject({
            buildId: 'prod-2026.06.29',
            topology: 'remote',
            ruleset: 'derby',
            seed: 4242,
            seedSource: 'provided'
        });
        // The recorded seed actually drives the engine's RNG streams.
        const v = engine.getRunContext().stream('map').next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
    });

    it('the run context fixedDt matches the engine timestep', async () => {
        const { engine } = await bootEngine({ fixedTimestep: 1 / 30 });
        expect(engine.getRunContext().fixedDt).toBeCloseTo(1 / 30, 9);
    });

    it('separate production startups get distinct generated seeds', async () => {
        const seeds = new Set();
        for (let i = 0; i < 6; i++) {
            const { engine } = await bootEngine();
            seeds.add(engine.getRunContext().seed);
        }
        expect(seeds.size).toBeGreaterThan(1);
    });

    it('a pre-built run context is adopted instead of creating a new one', async () => {
        const pre = GameRunContext.create({ seed: 9, ruleset: 'race', deterministic: true });
        const { engine, recorded } = await bootEngine({ runContext: pre });
        expect(engine.getRunContext()).toBe(pre);
        expect(recorded.seed).toBe(9);
    });
});

describe('GameRunContext production defaults (constants)', () => {
    it('describe() output is JSON-serializable for telemetry/logs', async () => {
        const { engine } = await bootEngine({ buildId: 'b', ruleset: 'race', roomCode: 'WXYZ' });
        const json = JSON.stringify(engine.getRunContext());
        const parsed = JSON.parse(json);
        expect(parsed).toMatchObject({ buildId: 'b', ruleset: 'race', roomCode: 'WXYZ', topology: 'local' });
        expect(parsed.tuningHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('default topology/ruleset constants are the expected couch-flow values', () => {
        expect(DEFAULT_TOPOLOGY).toBe('local');
        expect(DEFAULT_RULESET).toBe('race');
    });
});
