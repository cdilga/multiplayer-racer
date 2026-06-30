import { describe, it, expect, beforeEach } from 'vitest';
import { Track } from '../../static/js/entities/Track.js';
import { RaceSystem } from '../../static/js/systems/RaceSystem.js';

describe('Checkpoint Gate Orientation', () => {
    let track;

    beforeEach(() => {
        const config = {
            id: 'test-track',
            checkpoints: [
                {
                    id: 0,
                    position: { x: 0, y: 0, z: 0 },
                    width: 20,
                    tangent: { x: 1, z: 0 },  // Facing +X
                    heightBand: { min: -1, max: 5 },
                    isFinishLine: true
                },
                {
                    id: 1,
                    position: { x: 50, y: 0, z: 0 },
                    width: 20,
                    tangent: { x: 0.707, z: 0.707 },  // 45-degree angle
                    heightBand: { min: -1, max: 5 },
                    isFinishLine: false
                },
                {
                    id: 2,
                    position: { x: 50, y: 0, z: 50 },
                    width: 20,
                    tangent: { x: 0, z: 1 },  // Facing +Z
                    heightBand: { min: -1, max: 5 },
                    isFinishLine: false
                }
            ],
            spawn: { positions: [] }
        };
        track = new Track({ config });
    });

    describe('Height band filtering', () => {
        it('accepts vehicles within the height band', () => {
            const pos = { x: 0, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(true);
        });

        it('rejects vehicles above the height band', () => {
            const pos = { x: 0, y: 10, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });

        it('rejects vehicles below the height band', () => {
            const pos = { x: 0, y: -5, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });

        it('accepts vehicles at band boundaries', () => {
            expect(track.isInCheckpoint({ x: 0, y: -1, z: 0 }, 0)).toBe(true);
            expect(track.isInCheckpoint({ x: 0, y: 5, z: 0 }, 0)).toBe(true);
        });
    });

    describe('Current-position gate slice detection (axis-aligned)', () => {
        it('accepts vehicles on the gate plane within the gate width', () => {
            const pos = { x: 0, y: 1, z: 5 };
            expect(track.isInCheckpoint(pos, 0)).toBe(true);
        });

        it('rejects vehicles beyond perpendicular tolerance', () => {
            const pos = { x: 0, y: 1, z: 15 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });

        it('rejects vehicles far along the tangent even when centered laterally', () => {
            const pos = { x: 19.99, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });
    });

    describe('Oriented gate detection (45-degree angle)', () => {
        it('accepts vehicles crossing perpendicular to 45-degree gate', () => {
            // Gate at (50,0,0) facing 45 degrees (+X +Z direction)
            // A vehicle at the perpendicular should be detected
            const checkpoint = track.getCheckpoint(1);
            const gatePerpDir = { x: -checkpoint.tangent.z, z: checkpoint.tangent.x };
            // Position perpendicular to gate: gate_center + 5 * perpendicular_direction
            const pos = {
                x: 50 + gatePerpDir.x * 5,
                y: 1,
                z: 0 + gatePerpDir.z * 5
            };
            expect(track.isInCheckpoint(pos, 1)).toBe(true);
        });

        it('rejects vehicles beyond perpendicular tolerance on angled gate', () => {
            // Position far in perpendicular direction
            const checkpoint = track.getCheckpoint(1);
            const gatePerpDir = { x: -checkpoint.tangent.z, z: checkpoint.tangent.x };
            const pos = {
                x: 50 + gatePerpDir.x * 15,
                y: 1,
                z: 0 + gatePerpDir.z * 15
            };
            expect(track.isInCheckpoint(pos, 1)).toBe(false);
        });

        it('rejects vehicles far ahead along the tangent on an angled gate', () => {
            const checkpoint = track.getCheckpoint(1);
            const pos = {
                x: 50 + checkpoint.tangent.x * 18,
                y: 1,
                z: 0 + checkpoint.tangent.z * 18
            };
            expect(track.isInCheckpoint(pos, 1)).toBe(false);
        });
    });

    describe('Airborne rejection', () => {
        it('rejects airborne vehicle above track', () => {
            // Vehicle flying high above checkpoint
            const pos = { x: 0, y: 20, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });

        it('rejects vehicle under-track', () => {
            // Vehicle phased below track
            const pos = { x: 0, y: -10, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });
    });

    describe('Checkpoint data preservation', () => {
        it('stores tangent vector from config', () => {
            const cp = track.getCheckpoint(0);
            expect(cp.tangent).toEqual({ x: 1, z: 0 });
        });

        it('normalizes non-unit tangent vectors from config', () => {
            const normalizedTrack = new Track({
                config: {
                    id: 'normalized-track',
                    checkpoints: [{
                        id: 0,
                        position: { x: 0, y: 0, z: 0 },
                        width: 20,
                        tangent: { x: 10, z: 0 },
                        isFinishLine: true
                    }],
                    spawn: { positions: [] }
                }
            });
            const cp = normalizedTrack.getCheckpoint(0);
            expect(cp.tangent).toEqual({ x: 1, z: 0 });
        });

        it('stores height band from config', () => {
            const cp = track.getCheckpoint(0);
            expect(cp.heightBand).toEqual({ min: -1, max: 5 });
        });

        it('derives a sane tangent for legacy checkpoints when tangent is missing', () => {
            const configNoTangent = {
                id: 'legacy-track',
                checkpoints: [
                    {
                        id: 0,
                        position: { x: 0, y: 0, z: 0 },
                        width: 20,
                        isFinishLine: true
                        // no tangent or heightBand
                    }
                ],
                spawn: { positions: [] }
            };
            const track2 = new Track({ config: configNoTangent });
            const cp = track2.getCheckpoint(0);
            expect(cp.tangent).toEqual({ x: 1, z: 0 });
            expect(cp.heightBand).toEqual({ min: -1, max: 10 });
        });

        it('derives tangent from neighboring checkpoints for legacy multi-checkpoint tracks', () => {
            const legacyTrack = new Track({
                config: {
                    id: 'legacy-loop',
                    checkpoints: [
                        { id: 0, position: { x: 0, y: 0, z: -10 }, width: 20, isFinishLine: true },
                        { id: 1, position: { x: 10, y: 0, z: 0 }, width: 20, isFinishLine: false },
                        { id: 2, position: { x: 0, y: 0, z: 10 }, width: 20, isFinishLine: false },
                        { id: 3, position: { x: -10, y: 0, z: 0 }, width: 20, isFinishLine: false }
                    ],
                    spawn: { positions: [] }
                }
            });
            const cp0 = legacyTrack.getCheckpoint(0);
            const cp1 = legacyTrack.getCheckpoint(1);
            expect(cp0.tangent.x).toBeCloseTo(1, 6);
            expect(cp0.tangent.z).toBeCloseTo(0, 6);
            expect(cp1.tangent.x).toBeCloseTo(0, 6);
            expect(cp1.tangent.z).toBeCloseTo(1, 6);
        });
    });

    describe('Multiple checkpoints', () => {
        it('detects vehicle in different checkpoints', () => {
            // In checkpoint 0
            const pos0 = { x: 0, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos0, 0)).toBe(true);
            expect(track.isInCheckpoint(pos0, 1)).toBe(false);

            // In checkpoint 1
            const pos1 = { x: 50, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos1, 0)).toBe(false);
            expect(track.isInCheckpoint(pos1, 1)).toBe(true);
        });

        it('handles vertical axis gate (+Z)', () => {
            // Checkpoint 2 at (50, 0, 50) facing +Z
            const pos = { x: 50, y: 1, z: 50 };
            expect(track.isInCheckpoint(pos, 2)).toBe(true);

            // Perpendicular offset in X direction
            const pos2 = { x: 55, y: 1, z: 50 };
            expect(track.isInCheckpoint(pos2, 2)).toBe(true);

            // Far perpendicular offset
            const pos3 = { x: 70, y: 1, z: 50 };
            expect(track.isInCheckpoint(pos3, 2)).toBe(false);
        });
    });

    describe('Edge cases', () => {
        it('handles invalid checkpoint index', () => {
            const pos = { x: 0, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos, 999)).toBe(false);
        });

        it('handles negative checkpoint index', () => {
            const pos = { x: 0, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos, -1)).toBe(false);
        });

        it('rejects vehicle at exact height boundary edge cases', () => {
            // Right at min
            expect(track.isInCheckpoint({ x: 0, y: -1.0001, z: 0 }, 0)).toBe(false);
            // Right at max
            expect(track.isInCheckpoint({ x: 0, y: 5.0001, z: 0 }, 0)).toBe(false);
        });
    });

    describe('Frame-to-frame crossing detection', () => {
        it('detects vehicle crossing the gate plane', () => {
            const prevPos = { x: -5, y: 0, z: 0 };
            const currPos = { x: 5, y: 0, z: 0 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(true);
        });

        it('rejects vehicle moving along the gate line without crossing the plane', () => {
            const prevPos = { x: 0, y: 0, z: -10 };
            const currPos = { x: 0, y: 0, z: 10 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('rejects vehicle far along the tangent (far-ahead false positive prevention)', () => {
            const prevPos = { x: 30, y: 0, z: -2 };
            const currPos = { x: 35, y: 0, z: 2 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('detects high-speed crossing that skips frame', () => {
            const prevPos = { x: -100, y: 0, z: 4 };
            const currPos = { x: 100, y: 0, z: 4 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(true);
        });

        it('rejects crossing outside the gate width', () => {
            const prevPos = { x: -5, y: 0, z: 20 };
            const currPos = { x: 5, y: 0, z: 20 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('rejects crossing when height is out of band', () => {
            const prevPos = { x: -5, y: 10, z: 0 };
            const currPos = { x: 5, y: 10, z: 0 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('prevents double-triggers when a vehicle leaves the plane after a crossing', () => {
            let prevPos = { x: -5, y: 0, z: 0 };
            let currPos = { x: 0, y: 0, z: 0 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(true);

            prevPos = { x: 0, y: 0, z: 0 };
            currPos = { x: 5, y: 0, z: 0 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('detects crossing on angled checkpoint (45-degree)', () => {
            const checkpoint = track.getCheckpoint(1);
            const crossAxis = { x: -checkpoint.tangent.z, z: checkpoint.tangent.x };
            const prevPos = {
                x: checkpoint.position.x - checkpoint.tangent.x * 5 + crossAxis.x * 3,
                y: 0,
                z: checkpoint.position.z - checkpoint.tangent.z * 5 + crossAxis.z * 3
            };
            const currPos = {
                x: checkpoint.position.x + checkpoint.tangent.x * 5 + crossAxis.x * 3,
                y: 0,
                z: checkpoint.position.z + checkpoint.tangent.z * 5 + crossAxis.z * 3
            };
            expect(track.checkCrossing(prevPos, currPos, 1)).toBe(true);
        });
    });

    describe('RaceSystem previous-position tracking', () => {
        it('passes previous and current positions into checkpoint crossing checks and updates the snapshot', () => {
            const calls = [];
            const trackStub = {
                defaultLaps: 3,
                finishLineIndex: 0,
                getCheckpointCount: () => 2,
                getNextCheckpointIndex: (index) => (index + 1) % 2,
                checkCrossing: (prevPosition, currPosition, checkpointIndex) => {
                    calls.push({ prevPosition, currPosition, checkpointIndex });
                    return false;
                }
            };

            const race = new RaceSystem({ track: trackStub });
            race.initialized = true;
            race.state = 'racing';

            const vehicle = {
                id: 'vehicle-1',
                position: { x: 0, y: 0, z: 0 },
                currentLap: 0,
                nextCheckpoint: 0,
                lapTimes: [],
                finished: false,
                isDead: false
            };

            race.registerVehicle(vehicle);
            vehicle.position = { x: 3, y: 0, z: 1 };
            race.update(1 / 60);

            expect(calls).toHaveLength(1);
            expect(calls[0].prevPosition).toEqual({ x: 0, y: 0, z: 0 });
            expect(calls[0].currPosition).toEqual({ x: 3, y: 0, z: 1 });
            expect(calls[0].checkpointIndex).toBe(1);
            expect(race.vehicles.get(vehicle.id).prevPosition).toEqual({ x: 3, y: 0, z: 1 });
        });
    });
});
