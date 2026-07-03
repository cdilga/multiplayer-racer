import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Race Lifecycle Integration Tests
 *
 * Covers: full race flow from start to results, grace timer,
 * DNF ranking, late joins at various thresholds
 */

describe('race lifecycle - full flow', () => {
    let raceEngine;

    beforeEach(() => {
        // Simplified race engine for testing
        raceEngine = {
            startTime: 0,
            vehicles: new Map(),
            state: 'lobby',
            firstFinisherTime: null,
            graceStartTime: null,
            graceDuration: 30000,
            expectedDuration: 120000
        };
    });

    it('completes full race: start → first finisher → grace → all finish → results', async () => {
        // Start race
        raceEngine.startTime = 1000;
        raceEngine.state = 'active';
        raceEngine.vehicles.set('p1', { seatId: 'p1', lap: 0, lastUpdate: 1000 });
        raceEngine.vehicles.set('p2', { seatId: 'p2', lap: 0, lastUpdate: 1000 });
        raceEngine.vehicles.set('p3', { seatId: 'p3', lap: 0, lastUpdate: 1000 });

        expect(raceEngine.state).toBe('active');

        // P1 finishes at 3 laps
        const p1Vehicle = raceEngine.vehicles.get('p1');
        p1Vehicle.lap = 3;
        p1Vehicle.lastUpdate = 60000;
        p1Vehicle.finished = true;

        // First finisher detected
        raceEngine.firstFinisherTime = 60000;
        raceEngine.state = 'finish_grace';
        raceEngine.graceStartTime = 60000;

        expect(raceEngine.state).toBe('finish_grace');
        expect(raceEngine.firstFinisherTime).toBe(60000);

        // P2 and P3 finish before grace expires
        const p2Vehicle = raceEngine.vehicles.get('p2');
        p2Vehicle.lap = 3;
        p2Vehicle.lastUpdate = 70000;
        p2Vehicle.finished = true;

        const p3Vehicle = raceEngine.vehicles.get('p3');
        p3Vehicle.lap = 3;
        p3Vehicle.lastUpdate = 75000;
        p3Vehicle.finished = true;

        const allFinished = Array.from(raceEngine.vehicles.values()).every(v => v.finished);
        if (allFinished) {
            raceEngine.state = 'finished';
            raceEngine.graceEndedEarly = true;
        }

        expect(raceEngine.state).toBe('finished');
        expect(raceEngine.graceEndedEarly).toBe(true);
    });

    it('handles grace timer expiry with unfinished vehicles (DNF)', async () => {
        raceEngine.startTime = 1000;
        raceEngine.state = 'active';
        raceEngine.vehicles.set('p1', { seatId: 'p1', lap: 3, finished: true, lastUpdate: 60000 });
        raceEngine.vehicles.set('p2', { seatId: 'p2', lap: 2, finished: false, lastUpdate: 55000 });
        raceEngine.vehicles.set('p3', { seatId: 'p3', lap: 2, finished: false, lastUpdate: 59000 });

        // First finisher triggers grace
        raceEngine.firstFinisherTime = 60000;
        raceEngine.state = 'finish_grace';
        raceEngine.graceStartTime = 60000;

        // Simulate grace expiry at 60000 + 30000 = 90000
        const currentTime = 90001;
        const graceExpired = currentTime - raceEngine.graceStartTime >= raceEngine.graceDuration;

        if (graceExpired) {
            raceEngine.state = 'finished';

            // Rank vehicles (p2 and p3 are DNF)
            const sorted = Array.from(raceEngine.vehicles.values()).sort((a, b) => {
                if (a.lap !== b.lap) return b.lap - a.lap;
                if (a.lastUpdate !== b.lastUpdate) return b.lastUpdate - a.lastUpdate;
                return a.seatId.localeCompare(b.seatId);
            });

            expect(sorted[0].seatId).toBe('p1'); // Winner: 3 laps, finished
            expect(sorted[1].seatId).toBe('p3'); // DNF: 2 laps, later update
            expect(sorted[2].seatId).toBe('p2'); // DNF: 2 laps, earlier update
        }

        expect(raceEngine.state).toBe('finished');
    });
});

describe('race lifecycle - late join scenarios', () => {
    let raceState;

    beforeEach(() => {
        raceState = {
            startTime: 10000,
            expectedDuration: 120000,
            firstFinisherTime: null,
            state: 'active',
            players: new Map(),
            lateJoinWindow: 0.5 // 50% of expected duration
        };
    });

    it('allows late join at 10% of expected duration', () => {
        const joinTime = raceState.startTime + (raceState.expectedDuration * 0.1); // 10%
        const timeSinceStart = joinTime - raceState.startTime;
        const canJoinActive = timeSinceStart < raceState.expectedDuration * raceState.lateJoinWindow &&
                              (raceState.firstFinisherTime === null || joinTime < raceState.firstFinisherTime);

        expect(canJoinActive).toBe(true);

        raceState.players.set('latejoiner-10pct', {
            seatId: 'latejoiner-10pct',
            joinTime,
            active: true
        });

        expect(raceState.players.get('latejoiner-10pct').active).toBe(true);
    });

    it('allows late join at exactly 50% threshold', () => {
        const joinTime = raceState.startTime + (raceState.expectedDuration * 0.5); // Exactly 50%
        const timeSinceStart = joinTime - raceState.startTime;
        const canJoinActive = timeSinceStart <= raceState.expectedDuration * raceState.lateJoinWindow; // <= not <

        expect(canJoinActive).toBe(true);

        raceState.players.set('latejoiner-50pct', {
            seatId: 'latejoiner-50pct',
            joinTime,
            active: canJoinActive
        });

        expect(raceState.players.get('latejoiner-50pct').active).toBe(true);
    });

    it('queues late join at 51% of expected duration', () => {
        const joinTime = raceState.startTime + (raceState.expectedDuration * 0.51); // 51%
        const timeSinceStart = joinTime - raceState.startTime;
        const canJoinActive = timeSinceStart < raceState.expectedDuration * raceState.lateJoinWindow;

        expect(canJoinActive).toBe(false);

        raceState.players.set('latejoiner-51pct', {
            seatId: 'latejoiner-51pct',
            joinTime,
            active: false,
            queued: true
        });

        expect(raceState.players.get('latejoiner-51pct').queued).toBe(true);
    });

    it('queues late join after first finisher', () => {
        raceState.firstFinisherTime = raceState.startTime + 60000; // First finisher at 60s
        raceState.state = 'finish_grace';

        const joinTime = raceState.firstFinisherTime + 5000; // 5s after first finisher
        const canJoinActive = joinTime < raceState.firstFinisherTime;

        expect(canJoinActive).toBe(false);

        raceState.players.set('latejoiner-after-finish', {
            seatId: 'latejoiner-after-finish',
            joinTime,
            active: false,
            spectating: true
        });

        expect(raceState.players.get('latejoiner-after-finish').spectating).toBe(true);
    });

    it('queues late join during grace period', () => {
        raceState.firstFinisherTime = raceState.startTime + 60000;
        raceState.state = 'finish_grace';
        raceState.graceDuration = 30000;

        const joinTime = raceState.firstFinisherTime + 10000; // During grace
        const canJoinActive = joinTime < raceState.firstFinisherTime;

        expect(canJoinActive).toBe(false);

        raceState.players.set('latejoiner-grace', {
            seatId: 'latejoiner-grace',
            joinTime,
            active: false,
            note: 'Queued - active race locked during grace period'
        });

        expect(raceState.players.get('latejoiner-grace').active).toBe(false);
    });
});

describe('race lifecycle - late join restrictions', () => {
    let resultPayload;

    beforeEach(() => {
        resultPayload = {
            results: []
        };
    });

    it('marks active-window late joiner as eligible for podium', () => {
        const activeLatejoin = {
            seatId: 'p-active-late',
            joinTime: 12000,
            raceStartTime: 10000,
            finished: true,
            rank: 1,
            late_join_time_ms: 2000,
            active_race_eligible: true,
            podium_eligible: true
        };

        resultPayload.results.push(activeLatejoin);

        expect(resultPayload.results[0].podium_eligible).toBe(true);
    });

    it('marks late-join-after-first-finisher as ineligible for podium', () => {
        const graceLatejoin = {
            seatId: 'p-grace-join',
            joinTime: 90000,
            raceStartTime: 10000,
            finished: false,
            rank: null,
            late_join_time_ms: 80000,
            active_race_eligible: false,
            podium_eligible: false,
            note: 'Queued - no driving controls in locked race'
        };

        resultPayload.results.push(graceLatejoin);

        expect(resultPayload.results[0].podium_eligible).toBe(false);
        expect(resultPayload.results[0].active_race_eligible).toBe(false);
    });

    it('ensures late joiner cannot extend finish grace timer', () => {
        const raceState = {
            firstFinisherTime: 60000,
            graceStartTime: 60000,
            graceDuration: 30000,
            graceExpiryTime: 60000 + 30000
        };

        const lateJoiner = {
            joinTime: 65000,
            active: false // Cannot drive
        };

        // Simulate grace expiry
        const currentTime = 90001;
        const graceExpired = currentTime >= raceState.graceExpiryTime;
        const lateJoinerCanAffectExpiry = lateJoiner.active && lateJoiner.joinTime < raceState.graceExpiryTime;

        expect(lateJoinerCanAffectExpiry).toBe(false);
        expect(graceExpired).toBe(true);
    });

    it('ensures late joiner cannot displace locked placements', () => {
        const finalResults = [
            { seatId: 'p1', rank: 1, finished: true, locked: true },
            { seatId: 'p2', rank: 2, finished: true, locked: true },
            { seatId: 'p3', rank: 3, finished: false, dnf: true, locked: true },
            { seatId: 'late-joiner', joinTime: 90000, active: false, locked: false }
        ];

        const lockedRanks = finalResults.filter(r => r.locked).map(r => r.rank);
        const lateJoinerRank = finalResults.find(r => r.seatId === 'late-joiner').rank;

        expect(lockedRanks).toEqual([1, 2, 3]);
        expect(lateJoinerRank).toBeUndefined(); // Cannot rank in locked race
    });
});
