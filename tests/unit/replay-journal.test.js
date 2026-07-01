import { describe, it, expect } from 'vitest';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';
import {
    ReplayJournal,
    JOURNAL_SCHEMA_VERSION,
    redact,
    quantize,
    quantizedHash,
    REDACTED_KEYS
} from '../../static/js/engine/replayJournal.js';

const ctx = (seed = 4242) => GameRunContext.create({
    seed, ruleset: 'race', topology: 'local', buildId: 'test-build',
    tuningProfileId: 'arcade', tuning: { grip: 1.1 }, deterministic: true
});

describe('ReplayJournal - schema + run context', () => {
    it('records the redacted run context identity and schema version', () => {
        const j = new ReplayJournal(ctx(7), { roomConfig: { laps: 3 } });
        const out = j.toJSON();
        expect(out.schemaVersion).toBe(JOURNAL_SCHEMA_VERSION);
        expect(out.context).toMatchObject({
            buildId: 'test-build',
            seed: 7,
            ruleset: 'race',
            topology: 'local',
            tuningProfileId: 'arcade'
        });
        expect(out.context.tuningHash).toMatch(/^[0-9a-f]{8}$/);
        expect(out.roomConfig).toEqual({ laps: 3 });
        expect(out.entries).toEqual([]);
        expect(out.snapshots).toEqual([]);
    });

    it('tolerates a missing/contextless construction', () => {
        const j = new ReplayJournal();
        const out = j.toJSON();
        expect(out.schemaVersion).toBe(JOURNAL_SCHEMA_VERSION);
        expect(out.context.seed).toBeNull();
        expect(j.drawCounters()).toEqual({});
    });
});

describe('ReplayJournal - run context redaction / privacy-safe', () => {
    it('strips every known secret key from context, roomConfig, commands, events', () => {
        // Distinctive secret values (not substrings of JSON keys) so not.toContain is meaningful.
        const secrets = {
            host: 'HOSTTOK-aaa111', seat: 'SEATTOK-bbb222', cmdSeat: 'CMDSEAT-ccc333',
            cmdTok: 'CMDTOK-ddd444', reg: 'REGTOK-eee555', pw: 'PASSWD-fff666'
        };
        const j = new ReplayJournal(ctx(), {
            roomConfig: { laps: 3, host_token: secrets.host, nested: { seatToken: secrets.seat } }
        });
        j.recordCommand(1, 'seat-1', { steering: 0.5, seatToken: secrets.cmdSeat, token: secrets.cmdTok });
        j.recordEvent(1, 'player:join', { name: 'Ava', registration_token: secrets.reg, password: secrets.pw });
        const blob = JSON.stringify(j.toJSON());

        for (const secret of Object.values(secrets)) {
            expect(blob).not.toContain(secret);
        }
        // The marker is present where secrets were, and non-secret fields survive.
        expect(j.toJSON().roomConfig.host_token).toBe('[REDACTED]');
        expect(j.toJSON().roomConfig.nested.seatToken).toBe('[REDACTED]');
        expect(j.entries[0].command.steering).toBe(0.5);
        expect(j.entries[0].command.seatToken).toBe('[REDACTED]');
        expect(j.entries[1].data.name).toBe('Ava');
    });

    it('redact() helper covers arrays and nested objects', () => {
        const r = redact({ a: 1, token: 'x', list: [{ password: 'y', ok: 2 }] });
        expect(r).toEqual({ a: 1, token: '[REDACTED]', list: [{ password: '[REDACTED]', ok: 2 }] });
        expect(REDACTED_KEYS).toContain('host_token');
    });
});

describe('ReplayJournal - ordered commands + events', () => {
    it('assigns monotonic seq across interleaved commands and events', () => {
        const j = new ReplayJournal(ctx());
        j.recordCommand(1, 'seat-1', { acceleration: 1 });
        j.recordEvent(1, 'race:start', {});
        j.recordCommand(2, 'seat-2', { steering: -0.4 });
        j.snapshot(2, { x: 1 });
        j.recordEvent(3, 'weapon:pickup', { weaponId: 'missile' });

        const seqs = [...j.entries.map((e) => e.seq), ...j.snapshots.map((s) => s.seq)].sort((a, b) => a - b);
        // seqs are unique and contiguous from 0
        expect(seqs).toEqual([0, 1, 2, 3, 4]);
        expect(j.entries.map((e) => e.type)).toEqual(['command', 'event', 'command', 'event']);
        expect(j.entries[0]).toMatchObject({ seq: 0, tick: 1, seatId: 'seat-1' });
        expect(j.entries[2]).toMatchObject({ seq: 2, tick: 2, seatId: 'seat-2' });
        expect(j.length).toBe(4);
    });
});

describe('ReplayJournal - RNG draw counters', () => {
    it('records per-stream draw counts only for streams actually drawn', () => {
        const c = ctx();
        c.stream('map').next();
        c.stream('map').next();
        c.stream('spawn').next();
        // gameplay/weapons never drawn -> should not appear
        const j = new ReplayJournal(c);
        const counters = j.drawCounters();
        expect(counters.map).toBe(2);
        expect(counters.spawn).toBe(1);
        expect('gameplay' in counters).toBe(false);
        expect('weapons' in counters).toBe(false);
    });

    it('a snapshot captures the draw counters at that moment', () => {
        const c = ctx();
        c.stream('weapons').next();
        const j = new ReplayJournal(c);
        const s1 = j.snapshot(10, { a: 1 });
        expect(s1.drawCounters.weapons).toBe(1);
        c.stream('weapons').next();
        c.stream('weapons').next();
        const s2 = j.snapshot(20, { a: 1 });
        expect(s2.drawCounters.weapons).toBe(3); // advanced since s1
    });
});

describe('ReplayJournal - quantized snapshot hashes', () => {
    it('quantizes sub-quantum float noise to the same hash', () => {
        const j = new ReplayJournal(ctx());
        const a = j.snapshot(1, { pos: { x: 1.00000001, y: 2.4999999 } });
        const b = new ReplayJournal(ctx()).snapshot(1, { pos: { x: 1.0, y: 2.5 } });
        expect(a.stateHash).toBe(b.stateHash);
        expect(a.stateHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('a real state difference changes the hash (detects divergence)', () => {
        const j = new ReplayJournal(ctx());
        const a = j.snapshot(1, { pos: { x: 1.0 } });
        const b = j.snapshot(1, { pos: { x: 1.5 } });
        expect(a.stateHash).not.toBe(b.stateHash);
    });

    it('preserves NaN/Inf so replays can flag them', () => {
        expect(quantize(NaN)).toBeNaN();
        expect(quantize(Infinity)).toBe(Infinity);
        // hashing is stable regardless
        expect(quantizedHash({ v: NaN })).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe('ReplayJournal - determinism', () => {
    it('identical input sequences produce byte-identical journals', () => {
        const build = (seed) => {
            const c = ctx(seed);
            const j = new ReplayJournal(c, { roomConfig: { laps: 3 } });
            for (let tick = 1; tick <= 5; tick++) {
                c.stream('gameplay').next();
                j.recordCommand(tick, 'seat-1', { acceleration: tick / 5 });
                if (tick % 2 === 0) j.recordEvent(tick, 'tick:even', { tick });
                j.snapshot(tick, { tick, r: c.stream('gameplay').next() });
            }
            return JSON.stringify(j.toJSON());
        };
        expect(build(99)).toBe(build(99));       // same seed => identical
        expect(build(99)).not.toBe(build(100));  // different seed => different
    });
});

describe('ReplayJournal - bug-report excerpt', () => {
    it('excerpt exposes identity + recent entries + latest snapshot, no secrets', () => {
        const j = new ReplayJournal(ctx(), { roomConfig: { host_token: 's:e:c' } });
        for (let t = 1; t <= 30; t++) j.recordCommand(t, 'seat-1', { acceleration: 1, token: 'leak' });
        j.snapshot(30, { done: true });
        const ex = j.excerpt(5);
        expect(ex.context.seed).toBe(4242);
        expect(ex.totalEntries).toBe(30);
        expect(ex.recentEntries).toHaveLength(5);
        expect(ex.recentEntries[0].tick).toBe(26); // last 5 of 30
        expect(ex.latestSnapshot.tick).toBe(30);
        expect(JSON.stringify(ex)).not.toContain('leak');
    });
});
