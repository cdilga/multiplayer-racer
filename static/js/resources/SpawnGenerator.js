/**
 * SpawnGenerator - deterministic, map-aware spawn generation.
 *
 * The runtime and the tests both use this module to generate validated spawn
 * sets for authored tracks and procedural layouts without modulo wrapping.
 */

import {
    deriveTrackFrames,
    quantizeNumber,
    validateSpawnSet as validateSpawnSetKernel
} from '../geometry/GeometryKernel.js';
import { dunesHeight } from './terrain.js';
import { bowlProfile, bowlProfileSlope, resolveBowlParams } from './bowlProfile.js';
import { RngStream, hashSeed } from '../engine/Rng.js';

const DEFAULT_MIN_PAIR_DISTANCE = 3.5;
const DEFAULT_MIN_CLEARANCE = 2.0;
const DEFAULT_SPAWN_HEIGHT = 1.5;
const DEFAULT_HEADING = 0;
const DEFAULT_VALIDATED_CAPACITY = 64;
const MAX_REJECT_LOG = 256;
const SURFACE_EPSILON = 1e-4;
const MIN_SPAWN_LIFT = 1.0;
const MAX_SPAWN_LIFT = 5.0;

function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function cloneVec3(point = {}) {
    return {
        x: finiteNumber(point.x),
        y: finiteNumber(point.y),
        z: finiteNumber(point.z)
    };
}

function planarDistance(a, b) {
    const dx = finiteNumber(a.x) - finiteNumber(b.x);
    const dz = finiteNumber(a.z) - finiteNumber(b.z);
    return Math.hypot(dx, dz);
}

function normalizeVec3(vector = {}) {
    const x = finiteNumber(vector.x);
    const y = finiteNumber(vector.y);
    const z = finiteNumber(vector.z);
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
}

function headingFromTangent(tangent = {}) {
    return Math.atan2(finiteNumber(tangent.x), finiteNumber(tangent.z));
}

function headingTowardPoint(point = {}, target = { x: 0, z: 0 }) {
    const dx = finiteNumber(target.x) - finiteNumber(point.x);
    const dz = finiteNumber(target.z) - finiteNumber(point.z);
    if (Math.hypot(dx, dz) < SURFACE_EPSILON) return DEFAULT_HEADING;
    return Math.atan2(dx, dz);
}

function wrapArcLength(value, totalLength) {
    if (!(totalLength > 0)) return 0;
    let wrapped = value % totalLength;
    if (wrapped < 0) wrapped += totalLength;
    return wrapped;
}

function buildSupportHit(hit, y, normal, source, distance = null) {
    if (!hit) {
        return {
            hit: false,
            y: null,
            distance: null,
            normal: null,
            source: source || null
        };
    }

    return {
        hit: true,
        y: quantizeNumber(finiteNumber(y)),
        distance: Number.isFinite(distance) ? quantizeNumber(distance) : null,
        normal: normal ? normalizeVec3(normal) : { x: 0, y: 1, z: 0 },
        source: source || null
    };
}

function rotatePoint(point, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
        x: point.x * c - point.z * s,
        z: point.x * s + point.z * c
    };
}

function distanceToRectangle(point, halfWidth, halfLength) {
    const dx = Math.max(Math.abs(point.x) - halfWidth, 0);
    const dz = Math.max(Math.abs(point.z) - halfLength, 0);
    return Math.hypot(dx, dz);
}

function measureRampClearance(x, z, ramps = [], extraPadding = 0) {
    if (!Array.isArray(ramps) || ramps.length === 0) return Number.POSITIVE_INFINITY;

    let minClearance = Number.POSITIVE_INFINITY;
    for (const ramp of ramps) {
        const heading = finiteNumber(ramp.heading);
        const tangent = { x: Math.sin(heading), z: Math.cos(heading) };
        const leftNormal = { x: -tangent.z, z: tangent.x };
        const delta = { x: x - finiteNumber(ramp.x), z: z - finiteNumber(ramp.z) };
        const local = {
            x: delta.x * leftNormal.x + delta.z * leftNormal.z,
            z: delta.x * tangent.x + delta.z * tangent.z
        };
        const halfWidth = finiteNumber(ramp.width, 7) / 2 + extraPadding;
        const halfLength = finiteNumber(ramp.length, 10) / 2 + extraPadding;
        const distance = distanceToRectangle(local, halfWidth, halfLength);
        minClearance = Math.min(minClearance, distance);
    }

    return minClearance;
}

function buildRejectRecorder() {
    const counts = new Map();
    const samples = [];

    return {
        push(reason, candidate, details = {}) {
            counts.set(reason, (counts.get(reason) || 0) + 1);
            if (samples.length < MAX_REJECT_LOG) {
                samples.push({
                    reason,
                    position: {
                        x: quantizeNumber(finiteNumber(candidate.x)),
                        y: quantizeNumber(finiteNumber(candidate.y)),
                        z: quantizeNumber(finiteNumber(candidate.z))
                    },
                    ...details
                });
            }
        },
        summary() {
            return {
                counts: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
                samples
            };
        }
    };
}

function sortByCenterOut(values = []) {
    return values
        .slice()
        .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

function sampleFrameAtArc(frames = [], arcLength = 0) {
    if (!frames.length) return null;
    let best = frames[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const frame of frames) {
        const distance = Math.abs(finiteNumber(frame.arcLength) - arcLength);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = frame;
        }
    }

    return best;
}

function reverseFrameState(frameState) {
    const frames = frameState.frames.slice().reverse().map((frame, index, source) => ({
        ...frame,
        index,
        tangent: {
            x: -finiteNumber(frame.tangent?.x),
            y: -finiteNumber(frame.tangent?.y),
            z: -finiteNumber(frame.tangent?.z)
        },
        leftNormal: {
            x: finiteNumber(frame.rightNormal?.x),
            y: finiteNumber(frame.rightNormal?.y),
            z: finiteNumber(frame.rightNormal?.z)
        },
        rightNormal: {
            x: finiteNumber(frame.leftNormal?.x),
            y: finiteNumber(frame.leftNormal?.y),
            z: finiteNumber(frame.leftNormal?.z)
        },
        arcLength: source.length > 0
            ? quantizeNumber(finiteNumber(frameState.totalLength) - finiteNumber(frame.arcLength))
            : 0
    }));

    frames.sort((left, right) => finiteNumber(left.arcLength) - finiteNumber(right.arcLength));
    return {
        ...frameState,
        frames
    };
}

function alignFrameStateWithHeading(frameState, preferredHeading) {
    if (!frameState?.frames?.length || !Number.isFinite(preferredHeading)) return frameState;

    const currentHeading = headingFromTangent(frameState.frames[0].tangent);
    const dot = Math.cos(currentHeading - preferredHeading);
    return dot < 0 ? reverseFrameState(frameState) : frameState;
}

function resolveRaceAnchor(state, frames) {
    const checkpoints = state.config?.checkpoints || [];
    const authored = state.authoredSpawns || [];
    const target = checkpoints[0]?.position || authored[0] || frames[0]?.point || { x: 0, z: 0 };

    let best = frames[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const frame of frames) {
        const distance = planarDistance(frame.point, target);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = frame;
        }
    }

    return best || frames[0];
}

function resolveSpawnLift(authoredSpawns, evaluate, defaultSpawnHeight) {
    const lifts = [];
    for (const spawn of authoredSpawns) {
        const surface = evaluate(finiteNumber(spawn.x), finiteNumber(spawn.z));
        if (!surface.support.hit) continue;
        const authoredY = finiteNumber(spawn.y, defaultSpawnHeight);
        lifts.push(authoredY - finiteNumber(surface.support.y));
    }

    if (!lifts.length) {
        return clamp(defaultSpawnHeight, MIN_SPAWN_LIFT, MAX_SPAWN_LIFT);
    }

    lifts.sort((left, right) => left - right);
    const median = lifts[Math.floor(lifts.length / 2)];
    return clamp(median, MIN_SPAWN_LIFT, MAX_SPAWN_LIFT);
}

function gridDimensionForCount(count, multiplier) {
    return Math.max(4, Math.ceil(Math.sqrt(Math.max(1, count) * multiplier)));
}

function buildSquareRingCandidates(halfExtent, count, center = { x: 0, z: 0 }, angleOffset = 0) {
    const candidates = [];
    for (let index = 0; index < count; index++) {
        const t = index / count;
        const edge = Math.floor(t * 4);
        const localT = (t * 4) - edge;
        let x;
        let z;

        if (edge === 0) {
            x = halfExtent;
            z = halfExtent - localT * halfExtent * 2;
        } else if (edge === 1) {
            x = halfExtent - localT * halfExtent * 2;
            z = -halfExtent;
        } else if (edge === 2) {
            x = -halfExtent;
            z = -halfExtent + localT * halfExtent * 2;
        } else {
            x = -halfExtent + localT * halfExtent * 2;
            z = halfExtent;
        }

        const rotated = rotatePoint({ x, z }, angleOffset);
        candidates.push({ x: center.x + rotated.x, y: 0, z: center.z + rotated.z });
    }

    return candidates;
}

function buildSquareGridCandidates(halfExtent, count, center = { x: 0, z: 0 }, angleOffset = 0) {
    const dimension = gridDimensionForCount(count, 1.25);
    const step = dimension > 1 ? (halfExtent * 2) / (dimension - 1) : 0;
    const values = Array.from({ length: dimension }, (_, index) => -halfExtent + step * index);
    const ordered = sortByCenterOut(values);
    const candidates = [];

    for (const x of ordered) {
        for (const z of ordered) {
            const rotated = rotatePoint({ x, z }, angleOffset);
            candidates.push({ x: center.x + rotated.x, y: 0, z: center.z + rotated.z });
        }
    }

    return candidates;
}

function buildCircularRingCandidates(radius, count, angleOffset = 0) {
    const candidates = [];
    for (let index = 0; index < count; index++) {
        const angle = angleOffset + ((Math.PI * 2 * index) / count);
        candidates.push({
            x: Math.cos(angle) * radius,
            y: 0,
            z: Math.sin(angle) * radius
        });
    }
    return candidates;
}

function buildCircularGridCandidates(radius, count, angleOffset = 0) {
    const dimension = gridDimensionForCount(count, 1.8);
    const step = dimension > 1 ? (radius * 2) / (dimension - 1) : 0;
    const values = Array.from({ length: dimension }, (_, index) => -radius + step * index);
    const ordered = sortByCenterOut(values);
    const candidates = [];

    for (const x of ordered) {
        for (const z of ordered) {
            if (Math.hypot(x, z) <= radius + SURFACE_EPSILON) {
                const rotated = rotatePoint({ x, z }, angleOffset);
                candidates.push({ x: rotated.x, y: 0, z: rotated.z });
            }
        }
    }

    return candidates;
}

function buildRibbonCandidates(frameState, options = {}) {
    const frames = frameState?.frames || [];
    if (!frames.length) return [];

    const targetCount = Math.max(1, options.targetCount || 1);
    const laneCount = Math.max(1, options.laneCount || 1);
    const halfWidth = Math.max(0, options.halfWidth || 0);
    const totalLength = finiteNumber(frameState.totalLength);
    const rowSpacing = Math.max(options.rowSpacing || 0, 1);
    const anchorArc = finiteNumber(options.anchorArc);
    const anchorPhase = finiteNumber(options.anchorPhase);

    let laneOffsets = [0];
    if (laneCount > 1) {
        const spacing = (halfWidth * 2) / (laneCount + 1);
        laneOffsets = Array.from({ length: laneCount }, (_, index) => -halfWidth + spacing * (index + 1));
        laneOffsets = sortByCenterOut(laneOffsets);
    }

    const rowCount = Math.max(8, Math.ceil(targetCount / laneCount) * 3);
    const candidates = [];

    for (let row = 0; row < rowCount; row++) {
        const arc = wrapArcLength(anchorArc + anchorPhase - row * rowSpacing, totalLength);
        const frame = sampleFrameAtArc(frames, arc);
        if (!frame) continue;

        for (const laneOffset of laneOffsets) {
            candidates.push({
                x: finiteNumber(frame.point.x) + finiteNumber(frame.leftNormal.x) * laneOffset,
                y: finiteNumber(frame.point.y),
                z: finiteNumber(frame.point.z) + finiteNumber(frame.leftNormal.z) * laneOffset,
                headingRad: headingFromTangent(frame.tangent)
            });
        }
    }

    return candidates;
}

function buildOvalSurface(state, constraints) {
    const geometry = state.geometry;
    const innerRadius = finiteNumber(geometry.innerRadius, 35);
    const outerRadius = finiteNumber(geometry.outerRadius, 55);
    const centerRadius = (innerRadius + outerRadius) / 2;
    const preferredPoint = state.authoredSpawns[0] || state.config?.checkpoints?.[0]?.position || { x: 0, z: -centerRadius };
    const startAngle = Math.atan2(finiteNumber(preferredPoint.z), finiteNumber(preferredPoint.x));
    const centerline = Array.from({ length: 256 }, (_, index) => {
        const angle = startAngle + ((Math.PI * 2 * index) / 256);
        return {
            x: Math.cos(angle) * centerRadius,
            y: 0,
            z: Math.sin(angle) * centerRadius
        };
    });
    const frameState = deriveTrackFrames(centerline, { closed: true });
    const trackWidth = outerRadius - innerRadius;
    const usableHalfWidth = Math.max(0, (trackWidth / 2) - Math.max(constraints.minClearance, 1.5));
    const anchor = resolveRaceAnchor(state, frameState.frames);
    const rampPadding = constraints.minClearance + 0.75;

    return {
        descriptor: {
            geometryType: 'oval',
            trackWidth: quantizeNumber(trackWidth),
            innerRadius: quantizeNumber(innerRadius),
            outerRadius: quantizeNumber(outerRadius)
        },
        evaluate(x, z) {
            const radius = Math.hypot(x, z);
            const wallClearance = Math.min(radius - innerRadius, outerRadius - radius);
            const rampClearance = measureRampClearance(x, z, geometry.ramps || [], rampPadding);
            const clearance = Math.min(wallClearance, rampClearance);
            const tangent = radius > SURFACE_EPSILON
                ? { x: -z / radius, y: 0, z: x / radius }
                : { x: 0, y: 0, z: 1 };

            return {
                inBounds: radius >= innerRadius - SURFACE_EPSILON && radius <= outerRadius + SURFACE_EPSILON,
                clearance,
                headingRad: headingFromTangent(tangent),
                support: buildSupportHit(true, 0, { x: 0, y: 1, z: 0 }, 'oval-track'),
                details: {
                    radius: quantizeNumber(radius),
                    wallClearance: quantizeNumber(wallClearance),
                    rampClearance: Number.isFinite(rampClearance) ? quantizeNumber(rampClearance) : null
                }
            };
        },
        generateCandidates(targetCount, stream) {
            const laneCount = clamp(Math.floor(trackWidth / Math.max(constraints.minPairDistance, 4)), 2, 4);
            return buildRibbonCandidates(frameState, {
                targetCount,
                laneCount,
                halfWidth: usableHalfWidth,
                rowSpacing: Math.max(constraints.minPairDistance + 1, 5),
                anchorArc: finiteNumber(anchor.arcLength),
                anchorPhase: stream?.range ? stream.range(-1.5, 1.5) : 0
            });
        }
    };
}

function buildSplineSurface(state, constraints) {
    const geometry = state.geometry;
    const centerline = geometry.centerline || [];
    let frameState = deriveTrackFrames(centerline, { closed: true });
    frameState = alignFrameStateWithHeading(frameState, finiteNumber(state.authoredSpawns[0]?.rotation, NaN));

    const halfWidth = geometry.trackWidth
        ? finiteNumber(geometry.trackWidth) / 2
        : Math.max(6, inferHalfWidthFromEdges(geometry.leftEdge, geometry.rightEdge));
    const usableHalfWidth = Math.max(0, halfWidth - Math.max(constraints.minClearance, 1.5));
    const anchor = resolveRaceAnchor(state, frameState.frames);
    const rampPadding = constraints.minClearance + 0.75;

    return {
        descriptor: {
            geometryType: 'spline',
            halfWidth: quantizeNumber(halfWidth),
            frameCount: frameState.frames.length,
            totalLength: quantizeNumber(frameState.totalLength)
        },
        evaluate(x, z) {
            const nearest = findNearestFrame(frameState.frames, x, z);
            if (!nearest) {
                return {
                    inBounds: false,
                    clearance: Number.NEGATIVE_INFINITY,
                    headingRad: DEFAULT_HEADING,
                    support: buildSupportHit(false, null, null, 'spline-track'),
                    details: {}
                };
            }

            const delta = {
                x: x - finiteNumber(nearest.point.x),
                z: z - finiteNumber(nearest.point.z)
            };
            const lateral = delta.x * finiteNumber(nearest.leftNormal.x) + delta.z * finiteNumber(nearest.leftNormal.z);
            const clearance = Math.min(halfWidth - Math.abs(lateral), measureRampClearance(x, z, geometry.ramps || [], rampPadding));

            return {
                inBounds: Math.abs(lateral) <= halfWidth + SURFACE_EPSILON,
                clearance,
                headingRad: headingFromTangent(nearest.tangent),
                support: buildSupportHit(true, 0, { x: 0, y: 1, z: 0 }, 'spline-track'),
                details: {
                    lateral: quantizeNumber(lateral),
                    frameIndex: nearest.index,
                    frameArcLength: quantizeNumber(nearest.arcLength)
                }
            };
        },
        generateCandidates(targetCount, stream) {
            const laneCount = clamp(Math.floor((halfWidth * 2) / Math.max(constraints.minPairDistance, 4)), 2, 4);
            return buildRibbonCandidates(frameState, {
                targetCount,
                laneCount,
                halfWidth: usableHalfWidth,
                rowSpacing: Math.max(constraints.minPairDistance + 1, 5),
                anchorArc: finiteNumber(anchor.arcLength),
                anchorPhase: stream?.range ? stream.range(-1.5, 1.5) : 0
            });
        }
    };
}

function buildSquareSurface(state, constraints) {
    const geometry = state.geometry;
    const halfSize = finiteNumber(geometry.diameter || geometry.size, 70) / 2;
    const wallPadding = Math.max(constraints.minClearance + 1, 5);
    const ringExtent = Math.max(halfSize - wallPadding, constraints.minPairDistance * 2);
    const gridExtent = Math.max(halfSize - wallPadding, constraints.minPairDistance);

    return {
        descriptor: {
            geometryType: 'square',
            halfSize: quantizeNumber(halfSize),
            ringExtent: quantizeNumber(ringExtent)
        },
        evaluate(x, z) {
            const clearance = Math.min(halfSize - Math.abs(x), halfSize - Math.abs(z));
            return {
                inBounds: Math.abs(x) <= halfSize + SURFACE_EPSILON && Math.abs(z) <= halfSize + SURFACE_EPSILON,
                clearance,
                headingRad: headingTowardPoint({ x, z }),
                support: buildSupportHit(true, 0, { x: 0, y: 1, z: 0 }, 'square-arena'),
                details: {
                    wallClearance: quantizeNumber(clearance)
                }
            };
        },
        generateCandidates(targetCount, stream) {
            const angleOffset = stream?.range ? stream.range(-Math.PI / 24, Math.PI / 24) : 0;
            return [
                ...buildSquareRingCandidates(ringExtent, Math.min(16, Math.max(8, targetCount)), { x: 0, z: 0 }, angleOffset),
                ...buildSquareGridCandidates(gridExtent, targetCount * 2, { x: 0, z: 0 }, angleOffset)
            ];
        }
    };
}

function buildBowlSurface(state, constraints) {
    const geometry = state.geometry;
    const params = resolveBowlParams(geometry);
    const radius = params.R;
    const wallPadding = Math.max(constraints.minClearance + 2, 4);
    const ringRadius = Math.min(radius * 0.9, radius - wallPadding);
    const gridRadius = Math.max(constraints.minPairDistance * 2, ringRadius - constraints.minPairDistance - 1);
    const angleOffset = Math.atan2(finiteNumber(state.authoredSpawns[0]?.z), finiteNumber(state.authoredSpawns[0]?.x));

    return {
        descriptor: {
            geometryType: 'bowl',
            radius: quantizeNumber(radius),
            ringRadius: quantizeNumber(ringRadius),
            floorConcavity: quantizeNumber(params.floorConcavity),
            filletRadius: quantizeNumber(params.filletRadius)
        },
        evaluate(x, z) {
            const radial = Math.hypot(x, z);
            const groundY = bowlProfile(radial, params);
            const slope = bowlProfileSlope(radial, params);
            const angle = Math.atan2(z, x);
            const normal = Number.isFinite(slope)
                ? normalizeVec3({
                    x: -Math.cos(angle) * slope,
                    y: 1,
                    z: -Math.sin(angle) * slope
                })
                : { x: 0, y: 1, z: 0 };
            const clearance = radius - radial;

            return {
                inBounds: radial <= radius + SURFACE_EPSILON,
                clearance,
                headingRad: headingTowardPoint({ x, z }),
                support: buildSupportHit(true, groundY, normal, 'bowl-profile'),
                details: {
                    radial: quantizeNumber(radial),
                    wallClearance: quantizeNumber(clearance),
                    slope: Number.isFinite(slope) ? quantizeNumber(slope) : null
                }
            };
        },
        generateCandidates(targetCount, stream) {
            const seedOffset = stream?.range ? stream.range(-Math.PI / 18, Math.PI / 18) : 0;
            return [
                ...buildCircularRingCandidates(ringRadius, Math.min(16, Math.max(8, targetCount)), angleOffset + seedOffset),
                ...buildCircularGridCandidates(gridRadius, targetCount * 2, seedOffset * 0.5)
            ];
        }
    };
}

function buildDunesSurface(state, constraints) {
    const geometry = state.geometry;
    const radius = finiteNumber(geometry.radius || geometry.diameter / 2, 70);
    const safeRadius = Math.min(radius - Math.max(constraints.minClearance + 4, 10), finiteNumber(geometry.rimStart, radius) - 1);
    const ringRadius = Math.min(safeRadius, radius * 0.62);
    const angleOffset = Math.atan2(finiteNumber(state.authoredSpawns[0]?.z), finiteNumber(state.authoredSpawns[0]?.x));

    return {
        descriptor: {
            geometryType: 'dunes',
            radius: quantizeNumber(radius),
            safeRadius: quantizeNumber(safeRadius),
            amp: quantizeNumber(geometry.amp),
            freq: quantizeNumber(geometry.freq),
            rimStart: quantizeNumber(geometry.rimStart)
        },
        evaluate(x, z) {
            const radial = Math.hypot(x, z);
            const groundY = dunesHeight(x, z, geometry);
            const delta = 0.25;
            const dx = dunesHeight(x + delta, z, geometry) - dunesHeight(x - delta, z, geometry);
            const dz = dunesHeight(x, z + delta, geometry) - dunesHeight(x, z - delta, geometry);
            const normal = normalizeVec3({
                x: -(dx / (delta * 2)),
                y: 1,
                z: -(dz / (delta * 2))
            });
            const wallClearance = radius - radial;
            const rampClearance = measureRampClearance(x, z, geometry.ramps || [], constraints.minClearance + 1);
            const clearance = Math.min(wallClearance, rampClearance);

            return {
                inBounds: radial <= safeRadius + SURFACE_EPSILON,
                clearance,
                headingRad: headingTowardPoint({ x, z }),
                support: buildSupportHit(true, groundY, normal, 'dunes-heightfield'),
                details: {
                    radial: quantizeNumber(radial),
                    wallClearance: quantizeNumber(wallClearance),
                    rampClearance: Number.isFinite(rampClearance) ? quantizeNumber(rampClearance) : null
                }
            };
        },
        generateCandidates(targetCount, stream) {
            const seedOffset = stream?.range ? stream.range(-Math.PI / 18, Math.PI / 18) : 0;
            return [
                ...buildCircularRingCandidates(ringRadius, Math.min(16, Math.max(8, targetCount)), angleOffset + seedOffset),
                ...buildCircularGridCandidates(safeRadius, targetCount * 2, seedOffset * 0.5)
            ];
        }
    };
}

function inferHalfWidthFromEdges(leftEdge = [], rightEdge = []) {
    if (!leftEdge.length || !rightEdge.length || leftEdge.length !== rightEdge.length) {
        return 10;
    }

    let total = 0;
    let samples = 0;
    for (let index = 0; index < leftEdge.length; index++) {
        total += planarDistance(leftEdge[index], rightEdge[index]) / 2;
        samples++;
    }
    return samples > 0 ? total / samples : 10;
}

function findNearestFrame(frames = [], x = 0, z = 0) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const frame of frames) {
        const distance = planarDistance(frame.point, { x, z });
        if (distance < bestDistance) {
            bestDistance = distance;
            best = frame;
        }
    }

    return best;
}

function resolveSurface(state, constraints) {
    switch (state.geometry?.type) {
        case 'oval':
            return buildOvalSurface(state, constraints);
        case 'square':
            return buildSquareSurface(state, constraints);
        case 'bowl':
            return buildBowlSurface(state, constraints);
        case 'dunes':
            return buildDunesSurface(state, constraints);
        case 'spline':
            return buildSplineSurface(state, constraints);
        default:
            return buildSquareSurface(state, constraints);
    }
}

function resolveTrackState(track) {
    const config = track?.config || track || {};
    const spawnConfig = config.spawn || {};
    const authoredSpawns = Array.isArray(track?.spawnPositions)
        ? track.spawnPositions
        : (Array.isArray(spawnConfig.positions) ? spawnConfig.positions : []);

    return {
        config,
        geometry: config.geometry || {},
        authoredSpawns,
        defaultSpawnHeight: finiteNumber(spawnConfig.defaultHeight, finiteNumber(track?.defaultSpawnHeight, DEFAULT_SPAWN_HEIGHT)),
        trackId: config.id || track?.configId || 'track',
        ruleset: config.type === 'derby' ? 'derby' : 'race'
    };
}

function recordCandidateRejection(rejections, reason, candidate, surfaceData = null) {
    rejections.push(reason, candidate, surfaceData ? {
        clearance: Number.isFinite(surfaceData.clearance) ? quantizeNumber(surfaceData.clearance) : null,
        details: surfaceData.details || {}
    } : {});
}

function buildSpawnRecord(index, candidate, surfaceData, spawnLift) {
    const supportY = finiteNumber(surfaceData.support.y);
    const spawnY = supportY + spawnLift;
    const headingRad = Number.isFinite(candidate.headingRad)
        ? finiteNumber(candidate.headingRad)
        : finiteNumber(surfaceData.headingRad, DEFAULT_HEADING);

    return {
        id: `spawn-${index}`,
        position: {
            x: quantizeNumber(finiteNumber(candidate.x)),
            y: quantizeNumber(spawnY),
            z: quantizeNumber(finiteNumber(candidate.z))
        },
        headingRad: quantizeNumber(headingRad),
        rotation: quantizeNumber(headingRad),
        support: surfaceData.support,
        clearance: Number.isFinite(surfaceData.clearance) ? quantizeNumber(surfaceData.clearance) : null
    };
}

function validateSpatialConstraints(candidate, accepted, minPairDistance) {
    for (const spawn of accepted) {
        const distance = planarDistance(candidate, spawn.position);
        if (distance < minPairDistance - SURFACE_EPSILON) {
            return {
                ok: false,
                distance,
                nearestId: spawn.id
            };
        }
    }

    return { ok: true, distance: null, nearestId: null };
}

function augmentValidation(validation, spawns, surface, constraints) {
    const baseReports = validation.spawns || [];
    const failures = [...(validation.failures || [])];

    const reports = baseReports.map((report, index) => {
        const spawn = spawns[index];
        const surfaceData = surface.evaluate(
            finiteNumber(spawn.position?.x),
            finiteNumber(spawn.position?.z)
        );
        const reasons = [...(report.reasons || [])];

        if (!surfaceData.inBounds) {
            reasons.push({
                code: 'out_of_bounds',
                spawnId: report.id
            });
        }

        if (!Number.isFinite(report.headingRad)) {
            reasons.push({
                code: 'heading_invalid',
                spawnId: report.id
            });
        }

        const floorGap = finiteNumber(spawn.position?.y) - finiteNumber(surfaceData.support?.y);
        if (surfaceData.support.hit && floorGap < MIN_SPAWN_LIFT - SURFACE_EPSILON) {
            reasons.push({
                code: 'spawn_below_surface_gap',
                spawnId: report.id,
                actual: quantizeNumber(floorGap),
                minimum: quantizeNumber(MIN_SPAWN_LIFT)
            });
        }

        if (Number.isFinite(surfaceData.clearance) && surfaceData.clearance < constraints.minClearance - SURFACE_EPSILON) {
            reasons.push({
                code: 'surface_clearance_below_min',
                spawnId: report.id,
                actual: quantizeNumber(surfaceData.clearance),
                minimum: quantizeNumber(constraints.minClearance)
            });
        }

        failures.push(...reasons.filter((reason) => !report.reasons?.includes(reason)));

        return {
            ...report,
            valid: reasons.length === 0,
            reasons,
            clearance: Number.isFinite(surfaceData.clearance) ? quantizeNumber(surfaceData.clearance) : report.clearance,
            support: surfaceData.support
        };
    });

    return {
        ...validation,
        valid: spawns.length > 0 && reports.length === spawns.length && reports.every((report) => report.valid),
        constraints: {
            ...validation.constraints,
            minClearance: quantizeNumber(constraints.minClearance),
            minPairDistance: quantizeNumber(constraints.minPairDistance),
            requireSupport: constraints.requireSupport !== false
        },
        spawns: reports,
        failures
    };
}

function resolveSpawnStream(context, trackId, playerCount) {
    if (!context?.stream) {
        return {
            seed: null,
            range(min, max) {
                return min + (max - min) * 0.5;
            },
            child() {
                return this;
            }
        };
    }

    const stream = context.stream('spawn');
    if (typeof stream?.child === 'function') {
        return stream.child(`${trackId}:${playerCount}`);
    }
    return stream;
}

/**
 * Generate a validated spawn set for a track and player count.
 *
 * @param {Object} track
 * @param {number} playerCount
 * @param {import('../engine/GameRunContext.js').GameRunContext} context
 * @param {Object} [options]
 * @returns {{spawns:Object[], valid:boolean, diagnostics:Object}}
 */
export function generateSpawnsForTrack(track, playerCount, context, options = {}) {
    const startedAt = typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now();
    const state = resolveTrackState(track);
    const targetCount = Math.max(0, Math.floor(playerCount || 0));
    const constraints = {
        minPairDistance: finiteNumber(options.minPairDistance, DEFAULT_MIN_PAIR_DISTANCE),
        minClearance: finiteNumber(options.minClearance, DEFAULT_MIN_CLEARANCE),
        requireSupport: options.requireSupport !== false
    };
    const stream = resolveSpawnStream(context, state.trackId, targetCount);
    const surface = resolveSurface(state, constraints);
    const spawnLift = resolveSpawnLift(state.authoredSpawns, surface.evaluate, state.defaultSpawnHeight);
    const rejections = buildRejectRecorder();
    const candidates = targetCount > 0 ? surface.generateCandidates(targetCount, stream) : [];
    const spawns = [];
    const baseCount = Math.min(targetCount, state.authoredSpawns.length);
    const generatedCount = Math.max(0, targetCount - baseCount);

    for (const candidate of candidates) {
        if (spawns.length >= targetCount) break;

        const surfaceData = surface.evaluate(finiteNumber(candidate.x), finiteNumber(candidate.z));
        if (!surfaceData.inBounds) {
            recordCandidateRejection(rejections, 'out_of_bounds', candidate, surfaceData);
            continue;
        }
        if (!surfaceData.support.hit) {
            recordCandidateRejection(rejections, 'support_missing', candidate, surfaceData);
            continue;
        }
        if (!Number.isFinite(surfaceData.clearance) || surfaceData.clearance < constraints.minClearance - SURFACE_EPSILON) {
            recordCandidateRejection(rejections, 'clearance_below_min', candidate, surfaceData);
            continue;
        }

        const spatial = validateSpatialConstraints(candidate, spawns, constraints.minPairDistance);
        if (!spatial.ok) {
            recordCandidateRejection(rejections, 'pair_distance_below_min', candidate, {
                ...surfaceData,
                details: {
                    ...(surfaceData.details || {}),
                    nearestSpawnId: spatial.nearestId,
                    actualDistance: quantizeNumber(spatial.distance)
                }
            });
            continue;
        }

        spawns.push(buildSpawnRecord(spawns.length, candidate, surfaceData, spawnLift));
    }

    const validation = augmentValidation(
        validateSpawnSetKernel(spawns, constraints),
        spawns,
        surface,
        constraints
    );
    const elapsedMs = (typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now()) - startedAt;

    return {
        spawns,
        valid: (targetCount === 0) || (spawns.length === targetCount && validation.valid),
        diagnostics: {
            trackId: state.trackId,
            ruleset: state.ruleset,
            geometry: surface.descriptor,
            playerCount: targetCount,
            baseCount,
            authoredCount: state.authoredSpawns.length,
            generatedCount,
            spawnCount: spawns.length,
            seed: Number.isFinite(context?.seed) ? context.seed : null,
            streamSeed: Number.isFinite(stream?.seed) ? stream.seed : null,
            spawnLift: quantizeNumber(spawnLift),
            constraints,
            validation,
            rejectedCandidates: rejections.summary(),
            elapsedMs: quantizeNumber(elapsedMs, 2)
        }
    };
}

/**
 * Get a spawn position by index without modulo wrapping.
 *
 * @param {Object[]} spawns
 * @param {number} playerIndex
 * @returns {{x:number,y:number,z:number,rotation:number}|null}
 */
export function getSpawnPosition(spawns, playerIndex) {
    if (!Array.isArray(spawns) || spawns.length === 0) return null;
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= spawns.length) return null;

    const spawn = spawns[playerIndex];
    return {
        x: finiteNumber(spawn.position?.x, finiteNumber(spawn.x)),
        y: finiteNumber(spawn.position?.y, finiteNumber(spawn.y, DEFAULT_SPAWN_HEIGHT)),
        z: finiteNumber(spawn.position?.z, finiteNumber(spawn.z)),
        rotation: finiteNumber(spawn.headingRad, finiteNumber(spawn.rotation, DEFAULT_HEADING))
    };
}

/**
 * Promoted no-cap spawn generator (br-nocap-spawn-generator): produce N valid
 * spawns for ARBITRARY N on any track — no player cap. Non-overlap, on-ground,
 * sane headings, and derby ring layouts are guaranteed by generateSpawnsForTrack;
 * this is the clean public seam that late-join, respawn, and the map-validity
 * gate share (no player-17-on-player-1 modulo reuse).
 *
 * @param {Object} track - resolved track/entity
 * @param {number} n - number of spawns to generate (any N >= 0)
 * @param {Object} [options]
 * @param {number|string} [options.seed] - deterministic seed (same seed -> same set)
 * @param {Object} [options.context] - an existing GameRunContext (overrides seed)
 * @returns {{spawns: Object[], validation: Object, metadata: Object}}
 */
export function generateSpawns(track, n, options = {}) {
    let context = options.context || null;
    if (!context && options.seed != null) {
        const root = new RngStream(hashSeed(String(options.seed)), 'spawn');
        context = { stream: () => root };
    }
    return generateSpawnsForTrack(track, Math.max(0, Math.floor(n || 0)), context, options);
}

export {
    DEFAULT_MIN_PAIR_DISTANCE,
    DEFAULT_MIN_CLEARANCE,
    DEFAULT_VALIDATED_CAPACITY
};
