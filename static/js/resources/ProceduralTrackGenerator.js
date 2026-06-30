/**
 * ProceduralTrackGenerator - Generates random closed-circuit race tracks
 *
 * Produces a track config object compatible with TrackFactory/Track/PhysicsSystem,
 * using geometry.type = 'spline' with a precomputed centerline and edge loops.
 *
 * The construction is radial (control points at increasing angles around the
 * origin), which guarantees the circuit never self-intersects.
 *
 * Usage:
 *   import { generateTrackConfig } from './ProceduralTrackGenerator.js';
 *   const config = generateTrackConfig();          // random seed
 *   const config = generateTrackConfig(12345);     // reproducible
 */

import { resolveRunContext } from '../engine/determinism.js';

// Neon palettes the generator picks from - keeps random tracks on-theme
const PALETTES = [
    {
        name: 'Midnight Neon',
        ground: '#0d1b2a',
        track: '#2a2a35', trackEmissive: '#00e5ff',
        barrier: '#1b263b', barrierEmissive: '#ff2079',
        line: '#ffffff', lineEmissive: '#00e5ff',
        ambient: '#8090ff', sun: '#aaccff'
    },
    {
        name: 'Sunset Drift',
        ground: '#1a0f1f',
        track: '#33252b', trackEmissive: '#ff9e00',
        barrier: '#2b1a22', barrierEmissive: '#ff5400',
        line: '#ffe97f', lineEmissive: '#ffca3a',
        ambient: '#ffaa66', sun: '#ffcc88'
    },
    {
        name: 'Toxic Rush',
        ground: '#0f1a12',
        track: '#222a22', trackEmissive: '#39ff14',
        barrier: '#16201a', barrierEmissive: '#ccff00',
        line: '#eaffea', lineEmissive: '#39ff14',
        ambient: '#88ffaa', sun: '#cfffdd'
    },
    {
        name: 'Vapor Ice',
        ground: '#101025',
        track: '#262640', trackEmissive: '#b026ff',
        barrier: '#1c1c33', barrierEmissive: '#00f0ff',
        line: '#f0e9ff', lineEmissive: '#b026ff',
        ambient: '#aa88ff', sun: '#ccbbff'
    }
];

/**
 * Deterministic PRNG (mulberry32)
 * @param {number} seed
 * @returns {Function} random() in [0, 1)
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Closed Catmull-Rom interpolation between control points
 * @param {Object[]} pts - Control points [{x, z}]
 * @param {number} samples - Total samples for the loop
 * @returns {Object[]} Sampled centerline points
 */
function sampleClosedCatmullRom(pts, samples) {
    const n = pts.length;
    const result = [];
    const perSegment = samples / n;

    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];

        for (let j = 0; j < perSegment; j++) {
            const t = j / perSegment;
            const t2 = t * t;
            const t3 = t2 * t;

            const x = 0.5 * ((2 * p1.x) +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const z = 0.5 * ((2 * p1.z) +
                (-p0.z + p2.z) * t +
                (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
                (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

            result.push({ x, z });
        }
    }

    return result;
}

/**
 * Compute left/right edge loops from a centerline using 2D normals
 * @param {Object[]} centerline
 * @param {number} halfWidth
 * @returns {Object} { leftEdge, rightEdge }
 */
function computeEdges(centerline, halfWidth) {
    const n = centerline.length;
    const leftEdge = [];
    const rightEdge = [];

    for (let i = 0; i < n; i++) {
        const prev = centerline[(i - 1 + n) % n];
        const next = centerline[(i + 1) % n];

        // Tangent direction
        let tx = next.x - prev.x;
        let tz = next.z - prev.z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;
        tx /= len;
        tz /= len;

        // Normal (perpendicular, pointing left of travel direction)
        const nx = -tz;
        const nz = tx;

        const point = centerline[i];
        leftEdge.push({ x: point.x + nx * halfWidth, z: point.z + nz * halfWidth });
        rightEdge.push({ x: point.x - nx * halfWidth, z: point.z - nz * halfWidth });
    }

    return { leftEdge, rightEdge };
}

/**
 * Generate a random race track config.
 *
 * Determinism: a track is fully determined by its seed. When no seed is given,
 * the fallback seed is drawn from the run context's `map` RNG stream (not
 * Math.random), so map generation is reproducible from the run seed. Pass the
 * GameRunContext as the second arg to tie generation to a specific run.
 *
 * @param {number} [seed] - Optional explicit seed for reproducible tracks
 * @param {import('../engine/GameRunContext.js').GameRunContext} [ctx] - run context for the fallback seed
 * @returns {Object} Track config (same shape as the JSON track assets)
 */
function generateTrackConfig(seed, ctx) {
    const actualSeed = (seed != null)
        ? (seed >>> 0)
        : resolveRunContext(ctx).stream('map').nextU32();
    const rng = mulberry32(actualSeed);

    // Radial control points - random radius per angle, gentle angle jitter
    const controlCount = 9 + Math.floor(rng() * 4);   // 9-12 corners
    const baseRadius = 48 + rng() * 14;               // 48-62
    const radiusVariance = 14 + rng() * 10;           // 14-24
    const trackWidth = 17 + rng() * 5;                // 17-22

    const controls = [];
    for (let i = 0; i < controlCount; i++) {
        const angle = (i / controlCount) * Math.PI * 2 +
            (rng() - 0.5) * (Math.PI / controlCount);
        const radius = Math.max(28, baseRadius + (rng() - 0.5) * 2 * radiusVariance);
        controls.push({
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius
        });
    }

    const centerline = sampleClosedCatmullRom(controls, 192);
    const { leftEdge, rightEdge } = computeEdges(centerline, trackWidth / 2);

    // Start line at centerline[0]; grid spawns trail backwards from it
    const spawnPositions = [];
    const gridRows = 8;
    const laneOffset = trackWidth / 4.5;
    for (let row = 0; row < gridRows; row++) {
        // Walk backwards along the loop, 7 samples (~3.5% of lap) per row
        const idx = (centerline.length - 8 - row * 7) % centerline.length;
        const point = centerline[idx];
        const next = centerline[(idx + 1) % centerline.length];

        let tx = next.x - point.x;
        let tz = next.z - point.z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;
        tx /= len;
        tz /= len;

        // Facing along travel direction; atan2(x, z) matches mesh yaw convention
        const rotation = Math.atan2(tx, tz);
        const nx = -tz;
        const nz = tx;

        for (const side of [-1, 1]) {
            spawnPositions.push({
                x: point.x + nx * laneOffset * side,
                y: 1.5,
                z: point.z + nz * laneOffset * side,
                rotation
            });
        }
    }

    // Checkpoints: finish line at index 0, then evenly spaced around the lap
    // Each checkpoint stores tangent (track-flow direction) and height band for oriented gate detection
    const checkpointCount = 6;
    const checkpoints = [];
    for (let i = 0; i < checkpointCount; i++) {
        const idx = Math.floor((i / checkpointCount) * centerline.length);
        const point = centerline[idx];

        // Compute tangent as direction to next point (or previous if at end)
        let tangent = { x: 1, z: 0 };  // Default fallback
        if (idx < centerline.length - 1) {
            const next = centerline[idx + 1];
            const dx = next.x - point.x;
            const dz = next.z - point.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.001) {
                tangent = { x: dx / len, z: dz / len };
            }
        } else if (idx > 0) {
            const prev = centerline[idx - 1];
            const dx = point.x - prev.x;
            const dz = point.z - prev.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.001) {
                tangent = { x: dx / len, z: dz / len };
            }
        }

        checkpoints.push({
            id: i,
            position: { x: point.x, y: 0, z: point.z },
            width: trackWidth * 1.3,
            tangent,  // NEW: track-flow direction for oriented gate detection
            heightBand: { min: -1, max: 5 },  // NEW: allow vehicles from below to above track level
            isFinishLine: i === 0
        });
    }

    const palette = PALETTES[Math.floor(rng() * PALETTES.length)];

    return {
        id: `procedural-${actualSeed}`,
        name: `${palette.name} Circuit`,
        description: 'Procedurally generated circuit',
        seed: actualSeed,
        geometry: {
            type: 'spline',
            centerline,
            leftEdge,
            rightEdge,
            trackWidth,
            barrierHeight: 1.4,
            barrierThickness: 1.0
        },
        visual: {
            track: {
                color: palette.track,
                roughness: 0.85,
                emissive: palette.trackEmissive,
                emissiveIntensity: 0.12
            },
            ground: {
                color: palette.ground,
                size: 280
            },
            barriers: {
                color: palette.barrier,
                roughness: 0.6,
                emissive: palette.barrierEmissive,
                emissiveIntensity: 0.7
            },
            lineMarkings: {
                color: palette.line,
                width: 0.3,
                emissive: palette.lineEmissive,
                emissiveIntensity: 1.0
            }
        },
        spawn: {
            positions: spawnPositions,
            defaultHeight: 1.5
        },
        checkpoints,
        race: {
            defaultLaps: 3,
            checkpointOrder: checkpoints.map(cp => cp.id),
            countdownSeconds: 3
        },
        weapons: {
            enabled: true,
            spawnInterval: [8, 12],
            maxActive: 4,
            spawnHeight: 1.5
        },
        physics: {
            groundFriction: 0.8,
            barrierRestitution: 0.4
        },
        lighting: {
            ambient: {
                color: palette.ambient,
                intensity: 0.45
            },
            directional: {
                color: palette.sun,
                intensity: 0.7,
                position: { x: 60, y: 120, z: 40 },
                castShadow: true
            }
        }
    };
}

// Export for ES Modules
export { generateTrackConfig };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.generateTrackConfig = generateTrackConfig;
}
