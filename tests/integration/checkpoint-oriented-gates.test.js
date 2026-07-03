import { describe, it, expect, beforeEach } from 'vitest';
import { generateTrackConfig } from '../../static/js/resources/ProceduralTrackGenerator.js';
import { Track } from '../../static/js/entities/Track.js';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';

/**
 * Integration: Checkpoint Oriented Gates
 *
 * Verifies that:
 * 1. Procedural tracks produce checkpoints with tangent vectors
 * 2. Oriented gate detection works correctly on curved tracks
 * 3. Airborne vehicles do NOT trigger checkpoints (height filtering)
 * 4. Bot following racing line crosses checkpoints in order
 */

describe('checkpoint oriented gates - integration', () => {
    let track;
    let ctx;

    beforeEach(() => {
        // Create a deterministic game context for reproducible track generation
        ctx = GameRunContext.create({
            seed: 12345,
            deterministic: true,
            ruleset: 'race'
        });
    });

    describe('procedural track checkpoint generation', () => {
        it('generates checkpoints with tangent vectors', () => {
            const trackConfig = generateTrackConfig(undefined, ctx);
            const track = new Track({ config: trackConfig });

            const checkpoints = trackConfig.checkpoints;
            expect(checkpoints.length).toBeGreaterThan(0);

            for (const cp of checkpoints) {
                // Each checkpoint should have tangent vector
                expect(cp.tangent).toBeDefined();
                expect(cp.tangent.x).toBeDefined();
                expect(cp.tangent.z).toBeDefined();
                // Tangent should be unit vector
                const len = Math.sqrt(cp.tangent.x ** 2 + cp.tangent.z ** 2);
                expect(Math.abs(len - 1) < 0.01).toBe(true);  // Near unit length
            }
        });

        it('generates checkpoints with height bands', () => {
            const trackConfig = generateTrackConfig(undefined, ctx);

            const checkpoints = trackConfig.checkpoints;
            for (const cp of checkpoints) {
                expect(cp.heightBand).toBeDefined();
                expect(cp.heightBand.min).toBeDefined();
                expect(cp.heightBand.max).toBeDefined();
                expect(cp.heightBand.min).toBeLessThan(cp.heightBand.max);
            }
        });

        it('produces stable checkpoints with same procedural seed', () => {
            // Generate same track twice with the explicit seed
            const config1 = generateTrackConfig(54321, ctx);
            const config2 = generateTrackConfig(54321, ctx);

            // Same explicit seed should produce same checkpoint positions
            expect(config1.checkpoints.length).toBe(config2.checkpoints.length);
            for (let i = 0; i < config1.checkpoints.length; i++) {
                const cp1 = config1.checkpoints[i];
                const cp2 = config2.checkpoints[i];
                expect(cp1.position.x).toBe(cp2.position.x);
                expect(cp1.position.z).toBe(cp2.position.z);
                expect(cp1.tangent.x).toBe(cp2.tangent.x);
                expect(cp1.tangent.z).toBe(cp2.tangent.z);
            }
        });
    });

    describe('airborne vehicle rejection', () => {
        beforeEach(() => {
            const trackConfig = generateTrackConfig(undefined, ctx);
            track = new Track({ config: trackConfig });
        });

        it('rejects vehicle flying high above checkpoint', () => {
            const cp0 = track.getCheckpoint(0);
            const highAirPos = {
                x: cp0.position.x,
                y: 50,  // Far above track
                z: cp0.position.z
            };

            expect(track.isInCheckpoint(highAirPos, 0)).toBe(false);
        });

        it('rejects vehicle phased below track', () => {
            const cp0 = track.getCheckpoint(0);
            const belowPos = {
                x: cp0.position.x,
                y: -10,  // Below ground
                z: cp0.position.z
            };

            expect(track.isInCheckpoint(belowPos, 0)).toBe(false);
        });

        it('accepts vehicle within valid height band', () => {
            const cp0 = track.getCheckpoint(0);
            const normalPos = {
                x: cp0.position.x,
                y: 1.0,  // Car height above ground
                z: cp0.position.z
            };

            expect(track.isInCheckpoint(normalPos, 0)).toBe(true);
        });
    });

    describe('checkpoint crossing on curved track', () => {
        let checkpointOrder;

        beforeEach(() => {
            const trackConfig = generateTrackConfig(undefined, ctx);
            track = new Track({ config: trackConfig });
            checkpointOrder = trackConfig.race?.checkpointOrder || [];
        });

        it('bot following centerline crosses checkpoints in order', () => {
            // Simulate a bot following the track centerline
            const centerline = track.config.geometry?.centerline || [];
            expect(centerline.length).toBeGreaterThan(0);

            const crossedCheckpoints = [];
            const vehicleHeight = 1.0;

            // Drive vehicle along centerline
            for (const centerPoint of centerline) {
                const pos = {
                    x: centerPoint.x,
                    y: vehicleHeight,
                    z: centerPoint.z
                };

                // Check each checkpoint
                for (let i = 0; i < track.getCheckpointCount(); i++) {
                    if (track.isInCheckpoint(pos, i)) {
                        // Record crossing (de-dupe)
                        if (crossedCheckpoints.length === 0 || crossedCheckpoints[crossedCheckpoints.length - 1] !== i) {
                            crossedCheckpoints.push(i);
                        }
                    }
                }
            }

            // Expect to cross checkpoints in order
            expect(crossedCheckpoints.length).toBeGreaterThan(0);
            // First checkpoint should be checkpoint 0 (finish line)
            expect(crossedCheckpoints[0]).toBe(0);
            // Should cross checkpoints in order (allowing wrap-around)
            for (let i = 1; i < crossedCheckpoints.length; i++) {
                const expected = (checkpointOrder[i] || i) % track.getCheckpointCount();
                expect(crossedCheckpoints[i]).toBe(expected);
            }
        });

        it('checkpoint gates work on curves (non-axis-aligned)', () => {
            // Find a checkpoint with non-axis-aligned tangent
            let curvedCheckpoint = null;
            let cpIndex = -1;
            for (let i = 0; i < track.getCheckpointCount(); i++) {
                const cp = track.getCheckpoint(i);
                const tangentAngle = Math.atan2(cp.tangent.z, cp.tangent.x);
                // Find one not aligned to X or Z axis
                if (Math.abs(tangentAngle) > 0.1 && Math.abs(tangentAngle) < Math.PI - 0.1) {
                    curvedCheckpoint = cp;
                    cpIndex = i;
                    break;
                }
            }

            if (curvedCheckpoint) {
                // Vehicle approaching perpendicular to tangent should trigger
                const perpDir = {
                    x: -curvedCheckpoint.tangent.z,
                    z: curvedCheckpoint.tangent.x
                };
                const approachPos = {
                    x: curvedCheckpoint.position.x + perpDir.x * 5,
                    y: 1.0,
                    z: curvedCheckpoint.position.z + perpDir.z * 5
                };

                expect(track.isInCheckpoint(approachPos, cpIndex)).toBe(true);
            }
        });
    });

    describe('determinism', () => {
        it('same seed produces identical checkpoint positions and tangents', () => {
            const config1 = generateTrackConfig(undefined, ctx);

            const ctx2 = GameRunContext.create({
                seed: ctx.seed,  // Use same seed
                deterministic: true,
                ruleset: 'race'
            });
            const config2 = generateTrackConfig(undefined, ctx2);

            expect(config1.checkpoints.length).toBe(config2.checkpoints.length);

            for (let i = 0; i < config1.checkpoints.length; i++) {
                const cp1 = config1.checkpoints[i];
                const cp2 = config2.checkpoints[i];

                expect(cp1.position.x).toBe(cp2.position.x);
                expect(cp1.position.z).toBe(cp2.position.z);
                expect(cp1.tangent.x).toBe(cp2.tangent.x);
                expect(cp1.tangent.z).toBe(cp2.tangent.z);
            }
        });

        it('different seeds produce different checkpoint tangents', () => {
            const config1 = generateTrackConfig(12345, ctx);

            const ctx2 = GameRunContext.create({
                seed: 54321,  // Different seed
                deterministic: true,
                ruleset: 'race'
            });
            const config2 = generateTrackConfig(undefined, ctx2);

            // At least some tangents should differ
            let atLeastOneDifferent = false;
            for (let i = 0; i < Math.min(config1.checkpoints.length, config2.checkpoints.length); i++) {
                const cp1 = config1.checkpoints[i];
                const cp2 = config2.checkpoints[i];

                if (Math.abs(cp1.tangent.x - cp2.tangent.x) > 0.01 ||
                    Math.abs(cp1.tangent.z - cp2.tangent.z) > 0.01) {
                    atLeastOneDifferent = true;
                    break;
                }
            }
            expect(atLeastOneDifferent).toBe(true);
        });
    });
});
