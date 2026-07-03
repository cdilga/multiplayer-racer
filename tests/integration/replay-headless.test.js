import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';
import { ReplayJournal } from '../../static/js/engine/replayJournal.js';

/**
 * br-around-couch-risk-resolution-3xv.10 — headless replay determinism.
 *
 * A canonical headless runner (Node/vitest) drives a deterministic 10-second
 * 4-player script for BOTH race and derby through the real deterministic
 * primitives — GameRunContext (SimClock + seeded RngStreams) and the ReplayJournal
 * (ordered commands/events + periodic quantized state-hash snapshots). It proves:
 *   - identical seed + script => byte-identical journal (deterministic replay),
 *   - an injected perturbation is caught at the FIRST divergent tick,
 *   - no NaN/Inf leaks into the simulated state over the run,
 *   - RNG draw counters advance and match across identical runs.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactDir = resolve(repoRoot, 'artifacts/br-around-couch-risk-resolution-3xv.10');
const artifactPath = resolve(artifactDir, 'replay-headless-summary.json');

const FIXED_DT = 1 / 60;
const TICKS = 600;          // 10 seconds @ 60 Hz
const SNAPSHOT_EVERY = 30;  // 20 snapshots over the run
const SEATS = [1, 2, 3, 4];

// Deterministic per-(tick, seat) control script — a pure function, no RNG, so the
// only stochastic inputs are the seeded RngStreams (which replay identically).
function scriptedControl(tick, seat) {
    const phase = (tick + seat * 13) % 120;
    return {
        steering: Math.sin((phase / 120) * Math.PI * 2) * 0.8,
        acceleration: phase < 90 ? 1 : 0.3,
        braking: phase >= 110 ? 1 : 0
    };
}

function runReplay(seed, ruleset, { perturbAtTick = null } = {}) {
    const ctx = GameRunContext.create({
        seed, ruleset, topology: 'local', buildId: 'replay-headless-test',
        tuningProfileId: 'arcade', tuning: { grip: 1.1 }, deterministic: true
    });
    const journal = new ReplayJournal(ctx, { roomConfig: { laps: 3, players: SEATS.length, ruleset } });
    const gameplay = ctx.stream('gameplay');
    const weapons = ctx.stream('weapons');

    const vehicles = SEATS.map((s) => ({ seat: s, x: s * 4, z: 0, vx: 0, vz: 0, health: 100, lap: 0, alive: true }));
    const snapshotHashes = [];
    let sawNonFinite = false;

    for (let tick = 0; tick < TICKS; tick += 1) {
        for (const v of vehicles) {
            if (!v.alive) continue;
            const c = scriptedControl(tick, v.seat);
            journal.recordCommand(tick, v.seat, c);
            const accel = c.acceleration - c.braking;
            v.vx += Math.cos(c.steering) * accel * FIXED_DT * 20;
            v.vz += Math.sin(c.steering) * accel * FIXED_DT * 20;
            v.x += v.vx * FIXED_DT;
            v.z += v.vz * FIXED_DT;
            v.vx *= 0.98;
            v.vz *= 0.98;
        }

        // Seeded, replayable events.
        if (gameplay.bool(0.05)) {
            const v = vehicles[gameplay.int(0, vehicles.length - 1)];
            if (ruleset === 'race') {
                v.lap += 1;
                journal.recordEvent(tick, 'lap', { seat: v.seat, lap: v.lap });
            }
        }
        if (ruleset === 'derby' && weapons.bool(0.04)) {
            const attacker = vehicles[weapons.int(0, vehicles.length - 1)];
            const target = vehicles[weapons.int(0, vehicles.length - 1)];
            if (target.alive && attacker.seat !== target.seat) {
                target.health -= 20;
                journal.recordEvent(tick, 'damage', { attacker: attacker.seat, target: target.seat, health: target.health });
                if (target.health <= 0) {
                    target.alive = false;
                    journal.recordEvent(tick, 'eliminated', { seat: target.seat });
                }
            }
        }

        if (perturbAtTick != null && tick === perturbAtTick) {
            vehicles[0].x += 0.5; // a nudge the very next snapshot must reflect
        }

        if (tick % SNAPSHOT_EVERY === 0) {
            const state = { vehicles: vehicles.map((v) => ({ x: v.x, z: v.z, health: v.health, lap: v.lap, alive: v.alive })) };
            for (const v of state.vehicles) {
                if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) sawNonFinite = true;
            }
            const snap = journal.snapshot(tick, state);
            snapshotHashes.push({ tick, stateHash: snap.stateHash, drawCounters: snap.drawCounters });
        }

        ctx.step(1);
    }

    return { json: journal.toJSON(), snapshotHashes, sawNonFinite, excerpt: journal.excerpt() };
}

function firstDivergentTick(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
        if (a[i].stateHash !== b[i].stateHash) return a[i].tick;
    }
    return null;
}

describe('headless replay determinism (3xv.10)', () => {
    it('replays a 10s 4-player RACE script byte-identically', () => {
        const a = runReplay(90210, 'race');
        const b = runReplay(90210, 'race');
        expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
        expect(firstDivergentTick(a.snapshotHashes, b.snapshotHashes)).toBeNull();
        expect(a.snapshotHashes.length).toBe(TICKS / SNAPSHOT_EVERY);
    });

    it('replays a 10s 4-player DERBY script byte-identically', () => {
        const a = runReplay(555, 'derby');
        const b = runReplay(555, 'derby');
        expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
        expect(firstDivergentTick(a.snapshotHashes, b.snapshotHashes)).toBeNull();
    });

    it('reports the FIRST divergent tick on an injected mismatch', () => {
        const clean = runReplay(90210, 'race');
        const perturbed = runReplay(90210, 'race', { perturbAtTick: 150 });
        // Snapshots before 150 are identical; the tick-150 snapshot (taken after the
        // nudge) is the first to differ.
        expect(firstDivergentTick(clean.snapshotHashes, perturbed.snapshotHashes)).toBe(150);
    });

    it('advances RNG draw counters and matches them across identical runs', () => {
        const a = runReplay(90210, 'derby');
        const b = runReplay(90210, 'derby');
        const lastA = a.snapshotHashes[a.snapshotHashes.length - 1].drawCounters;
        const lastB = b.snapshotHashes[b.snapshotHashes.length - 1].drawCounters;
        expect(lastA).toEqual(lastB);
        // At least one stream was actually drawn from over the run.
        expect(Object.values(lastA).some((c) => c > 0)).toBe(true);
    });

    it('produces no NaN/Inf in simulated state across the run', () => {
        expect(runReplay(1, 'race').sawNonFinite).toBe(false);
        expect(runReplay(2, 'derby').sawNonFinite).toBe(false);
    });

    it('persists a replay summary evidence artifact', () => {
        const run = runReplay(90210, 'race');
        const final = run.snapshotHashes[run.snapshotHashes.length - 1];
        const summary = {
            bead: 'br-around-couch-risk-resolution-3xv.10',
            context: run.json.context,
            roomConfig: run.json.roomConfig,
            ticks: TICKS,
            snapshots: run.snapshotHashes.length,
            finalSnapshot: final,
            journalEntries: run.json.entries.length,
            excerpt: run.excerpt
        };
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(artifactPath, JSON.stringify(summary, null, 2) + '\n');
        expect(existsSync(artifactPath)).toBe(true);
        expect(summary.finalSnapshot.stateHash).toBeTruthy();
    });
});
