import { describe, it, expect, beforeEach } from 'vitest';
import { RaceSystem } from '../../static/js/systems/RaceSystem.js';

describe('RaceSystem - Finish Grace', () => {
    let race;
    let mockEventBus;

    beforeEach(() => {
        mockEventBus = {
            events: [],
            emit(event, data) {
                this.events.push({ event, data, time: Date.now() });
            },
            getEvents(type) {
                return this.events.filter(e => e.event === type);
            }
        };

        race = new RaceSystem({
            eventBus: mockEventBus,
            laps: 3,
            finishGraceMs: 30000
        });
    });

    describe('grace phase state transitions', () => {
        it('starts in idle state', () => {
            expect(race.state).toBe('idle');
        });

        it('transitions to racing after countdown', () => {
            race.startCountdown();
            expect(race.state).toBe('countdown');
            race.startRace();
            expect(race.state).toBe('racing');
        });

        it('transitions to grace when first vehicle finishes', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            data.currentLap = 3;
            data.nextCheckpoint = 0;

            // Simulate finish line crossing
            race._onVehicleFinish('car-1', data, race._nowMs());

            expect(race.state).toBe('racing');
            race.update(0.016);
            expect(race.state).toBe('grace');
            expect(race.firstFinisherTime).not.toBeNull();
        });

        it('transitions to finished when grace expires', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            expect(race.state).toBe('grace');

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            expect(race.state).toBe('finished');
        });
    });

    describe('finish grace duration', () => {
        it('uses default grace duration of 30 seconds', () => {
            const r = new RaceSystem();
            expect(r.finishGraceMs).toBe(30000);
        });

        it('uses custom grace duration if provided', () => {
            const r = new RaceSystem({ finishGraceMs: 60000 });
            expect(r.finishGraceMs).toBe(60000);
        });

        it('returns remaining grace time during grace phase', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            expect(race.state).toBe('grace');
            const remaining = race.getGraceTimeRemaining();
            expect(remaining).toBeGreaterThan(0);
            expect(remaining).toBeLessThanOrEqual(race.finishGraceMs);
        });

        it('returns 0 grace time when not in grace phase', () => {
            expect(race.getGraceTimeRemaining()).toBe(0);
            race.startRace();
            expect(race.getGraceTimeRemaining()).toBe(0);
        });
    });

    describe('DNF ranking', () => {
        it('ranks unfinished vehicles by progress', () => {
            race.startRace();

            const car1 = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false, seatId: 1 };
            const car2 = { id: 'car-2', playerId: 'p2', position: [0, 0, 0], isDead: false, seatId: 2 };

            race.registerVehicle(car1);
            race.registerVehicle(car2);

            const data1 = race.getVehicleData('car-1');
            const data2 = race.getVehicleData('car-2');

            data1.currentLap = 2;
            data2.currentLap = 1;

            race._onVehicleFinish('car-1', data1, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results.length).toBe(2);
            expect(results[0].isDNF).toBe(false);
            expect(results[1].isDNF).toBe(true);
            expect(results[1].position).toBe(2);
        });

        it('ranks DNF by checkpoint if laps are equal', () => {
            race.startRace();

            const car1 = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false, seatId: 1 };
            const car2 = { id: 'car-2', playerId: 'p2', position: [0, 0, 0], isDead: false, seatId: 2 };

            race.registerVehicle(car1);
            race.registerVehicle(car2);

            const data1 = race.getVehicleData('car-1');
            const data2 = race.getVehicleData('car-2');

            data1.currentLap = 2;
            data1.nextCheckpoint = 3;

            data2.currentLap = 2;
            data2.nextCheckpoint = 1;

            race._onVehicleFinish('car-1', data1, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results[0].vehicleId).toBe('car-1');
            expect(results[1].vehicleId).toBe('car-2');
        });

        it('uses seat ID as tiebreaker for display', () => {
            race.startRace();

            const car1 = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false, seatId: 5 };
            const car2 = { id: 'car-2', playerId: 'p2', position: [0, 0, 0], isDead: false, seatId: 3 };

            race.registerVehicle(car1);
            race.registerVehicle(car2);

            const data1 = race.getVehicleData('car-1');
            const data2 = race.getVehicleData('car-2');

            data1.currentLap = 2;
            data1.nextCheckpoint = 2;

            data2.currentLap = 2;
            data2.nextCheckpoint = 2;

            race._onVehicleFinish('car-1', data1, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results[1].vehicleId).toBe('car-2');
        });
    });

    describe('late join handling', () => {
        it('allows join before first finisher', () => {
            race.startRace();
            const elapsed = 5000;
            expect(race.canJoinActiveRace(elapsed)).toBe(true);
        });

        it('allows join before 50% expected race duration', () => {
            race.startRace();
            const expected = race.totalLaps * 60000;
            const at40Percent = expected * 0.4;
            expect(race.canJoinActiveRace(at40Percent)).toBe(true);
        });

        it('denies join after 50% expected race duration', () => {
            race.startRace();
            const expected = race.totalLaps * 60000;
            const at60Percent = expected * 0.6;
            expect(race.canJoinActiveRace(at60Percent)).toBe(false);
        });

        it('denies join after first finisher', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            expect(race.canJoinActiveRace(5000)).toBe(false);
        });

        it('requires spectate mode during grace phase', () => {
            race.startRace();
            expect(race.shouldLateJoinSpectate()).toBe(false);

            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            expect(race.shouldLateJoinSpectate()).toBe(true);
        });

        it('marks vehicles as late join', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            race.markAsLateJoin('car-1');
            const data = race.getVehicleData('car-1');
            expect(data.isLateJoin).toBe(true);
        });

        it('includes late join flag in results', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            race.markAsLateJoin('car-1');
            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results[0].isLateJoin).toBe(true);
            expect(results[0].restrictedPodium).toBe(true);
        });
    });

    describe('early grace close', () => {
        it('ends race when all vehicles finish before grace expires', () => {
            race.startRace();

            const car1 = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(car1);

            const data1 = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data1, race._nowMs());
            race.update(0.016);

            expect(race.state).toBe('grace');

            const car2 = { id: 'car-2', playerId: 'p2', position: [0, 0, 0], isDead: false };
            race.registerVehicle(car2);
            const data2 = race.getVehicleData('car-2');
            race._onVehicleFinish('car-2', data2, race._nowMs());
            race.update(0.016);

            expect(race.state).toBe('finished');
        });
    });

    describe('results payload', () => {
        it('includes required fields in results', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results[0]).toHaveProperty('position');
            expect(results[0]).toHaveProperty('vehicleId');
            expect(results[0]).toHaveProperty('playerId');
            expect(results[0]).toHaveProperty('isLateJoin');
            expect(results[0]).toHaveProperty('isDNF');
            expect(results[0]).toHaveProperty('restrictedPodium');
        });

        it('marks finished vehicles with proper finishTime', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results[0].finishTime).not.toBeNull();
            expect(results[0].isDNF).toBe(false);
        });

        it('marks DNF vehicles with isDNF=true', () => {
            race.startRace();

            const car1 = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false };
            const car2 = { id: 'car-2', playerId: 'p2', position: [0, 0, 0], isDead: false };

            race.registerVehicle(car1);
            race.registerVehicle(car2);

            const data1 = race.getVehicleData('car-1');
            race._onVehicleFinish('car-1', data1, race._nowMs());
            race.update(0.016);

            race.graceStartTime = race._nowMs() - race.finishGraceMs - 100;
            race.update(0.016);

            const results = race.getResults();
            expect(results[1].finishTime).toBeNull();
            expect(results[1].isDNF).toBe(true);
        });
    });

    describe('reset', () => {
        it('clears grace state on reset', () => {
            race.startRace();
            const vehicle = { id: 'car-1', playerId: 'p1', position: [0, 0, 0], isDead: false, resetRaceState: () => {} };
            race.registerVehicle(vehicle);

            const data = race.getVehicleData('car-1');
            data.isLateJoin = true;
            race._onVehicleFinish('car-1', data, race._nowMs());
            race.update(0.016);

            race.reset();

            expect(race.state).toBe('idle');
            expect(race.firstFinisherTime).toBeNull();
            expect(race.graceStartTime).toBeNull();
            expect(race.getVehicleData('car-1').isLateJoin).toBe(false);
        });
    });
});
