import { describe, it, expect, beforeEach } from 'vitest';
import { Track } from '../../static/js/entities/Track.js';

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

    describe('Perpendicular gate detection (axis-aligned)', () => {
        it('accepts vehicles perpendicular to gate (facing +X)', () => {
            // Gate at (0,0,0) facing +X, width 20 -> perpendicular tolerance is 10
            const pos = { x: 0, y: 1, z: 5 };
            expect(track.isInCheckpoint(pos, 0)).toBe(true);
        });

        it('rejects vehicles beyond perpendicular tolerance', () => {
            // Beyond width/2 = 10
            const pos = { x: 0, y: 1, z: 15 };
            expect(track.isInCheckpoint(pos, 0)).toBe(false);
        });

        it('accepts vehicles along-track near gate', () => {
            // Within along-track tolerance (halfWidth * 2 = 20)
            const pos = { x: 15, y: 1, z: 0 };
            expect(track.isInCheckpoint(pos, 0)).toBe(true);
        });

        it('rejects vehicles far along-track', () => {
            // Beyond along-track tolerance
            const pos = { x: 50, y: 1, z: 0 };
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

        it('stores height band from config', () => {
            const cp = track.getCheckpoint(0);
            expect(cp.heightBand).toEqual({ min: -1, max: 5 });
        });

        it('provides defaults when tangent is missing', () => {
            const configNoTangent = {
                id: 'test',
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
            // Checkpoint 0: position (0,0,0), tangent (1,0) facing +X
            // Perpendicular to tangent is Z direction
            // Vehicle crosses from negative Z to positive Z
            const prevPos = { x: 0, y: 0, z: -5 }; // Before (perpendicular direction)
            const currPos = { x: 0, y: 0, z: 5 };  // After
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(true);
        });

        it('rejects vehicle moving parallel to gate (no crossing)', () => {
            // Moving along the tangent direction (X axis for checkpoint 0)
            // perpDist stays at 0, no sign change
            const prevPos = { x: -10, y: 0, z: 0 };
            const currPos = { x: 10, y: 0, z: 0 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('rejects vehicle far along the tangent (far-ahead false positive prevention)', () => {
            // Vehicle far ahead on tangent line, within perpendicular width but never crosses plane
            const prevPos = { x: 30, y: 0, z: -2 }; // Far along tangent, slightly off perpendicular
            const currPos = { x: 35, y: 0, z: -2 };
            // This is beyond the along-track tolerance (halfWidth * 2 = 20)
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('detects high-speed crossing that skips frame', () => {
            // Vehicle moves very fast from negative Z to positive Z, also moving along X
            // Still crosses the gate plane perpendicular
            const prevPos = { x: -100, y: 0, z: -50 };
            const currPos = { x: 100, y: 0, z: 50 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(true);
        });

        it('rejects crossing outside the gate width', () => {
            // Checkpoint 0 has width 20, so perpendicular tolerance is 10
            // Vehicle crosses the plane but at Z=-20 (beyond width/2=10)
            const prevPos = { x: 0, y: 0, z: -20 }; // Outside gate width
            const currPos = { x: 0, y: 0, z: -15 }; // Still outside (only 5 units from checkpoint center)
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('rejects crossing when height is out of band', () => {
            const prevPos = { x: 0, y: 10, z: -5 }; // Above band
            const currPos = { x: 0, y: 10, z: 5 };  // Still above band
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('prevents double-triggers when vehicle stays in checkpoint region', () => {
            // First frame: vehicle enters and crosses perpendicular plane
            let prevPos = { x: 0, y: 0, z: -5 };
            let currPos = { x: 0, y: 0, z: 5 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(true);

            // Second frame: vehicle stays past the checkpoint (no plane crossing, stays on positive Z side)
            prevPos = { x: 2, y: 0, z: 5 };
            currPos = { x: 4, y: 0, z: 7 };
            expect(track.checkCrossing(prevPos, currPos, 0)).toBe(false);
        });

        it('detects crossing on angled checkpoint (45-degree)', () => {
            // Checkpoint 1 is at (50, 0, 0) facing 45 degrees (0.707, 0.707)
            // Perpendicular direction: (-0.707, 0.707)
            // Vehicle crossing from one side to the other
            const prevPos = { x: 50, y: 0, z: -5 }; // Before
            const currPos = { x: 50, y: 0, z: 5 };   // After
            expect(track.checkCrossing(prevPos, currPos, 1)).toBe(true);
        });
    });
});
