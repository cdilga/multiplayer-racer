const EPSILON = 1e-9;
const HASH_DECIMALS = 6;
const DEFAULT_GATE_DEPTH = 4;
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });

function isFiniteNumber(value) {
    return Number.isFinite(value);
}

function sanitizeNumber(value, fallback = 0) {
    return isFiniteNumber(value) ? value : fallback;
}

function cloneVec3(point = {}) {
    return {
        x: sanitizeNumber(point.x, 0),
        y: sanitizeNumber(point.y, 0),
        z: sanitizeNumber(point.z, 0)
    };
}

function addVec3(a, b) {
    return {
        x: sanitizeNumber(a.x, 0) + sanitizeNumber(b.x, 0),
        y: sanitizeNumber(a.y, 0) + sanitizeNumber(b.y, 0),
        z: sanitizeNumber(a.z, 0) + sanitizeNumber(b.z, 0)
    };
}

function subtractVec3(a, b) {
    return {
        x: sanitizeNumber(a.x, 0) - sanitizeNumber(b.x, 0),
        y: sanitizeNumber(a.y, 0) - sanitizeNumber(b.y, 0),
        z: sanitizeNumber(a.z, 0) - sanitizeNumber(b.z, 0)
    };
}

function scaleVec3(vector, scalar) {
    return {
        x: sanitizeNumber(vector.x, 0) * scalar,
        y: sanitizeNumber(vector.y, 0) * scalar,
        z: sanitizeNumber(vector.z, 0) * scalar
    };
}

function negateVec3(vector) {
    return scaleVec3(vector, -1);
}

function planarLength(vector) {
    return Math.hypot(sanitizeNumber(vector.x, 0), sanitizeNumber(vector.z, 0));
}

function planarDistance(a, b) {
    return planarLength(subtractVec3(a, b));
}

function dotXZ(a, b) {
    return sanitizeNumber(a.x, 0) * sanitizeNumber(b.x, 0) +
        sanitizeNumber(a.z, 0) * sanitizeNumber(b.z, 0);
}

function normalizeVec3(vector, fallback = DEFAULT_UP) {
    const x = sanitizeNumber(vector.x, 0);
    const y = sanitizeNumber(vector.y, 0);
    const z = sanitizeNumber(vector.z, 0);
    const length = Math.hypot(x, y, z);

    if (length < EPSILON) {
        return cloneVec3(fallback);
    }

    return {
        x: x / length,
        y: y / length,
        z: z / length
    };
}

function normalizePlanar(vector, fallback = { x: 1, y: 0, z: 0 }) {
    const x = sanitizeNumber(vector.x, 0);
    const z = sanitizeNumber(vector.z, 0);
    const length = Math.hypot(x, z);

    if (length < EPSILON) {
        const normalizedFallback = normalizePlanar(fallback, { x: 1, y: 0, z: 0 });
        return {
            x: normalizedFallback.x,
            y: 0,
            z: normalizedFallback.z
        };
    }

    return {
        x: x / length,
        y: 0,
        z: z / length
    };
}

function leftNormalFromTangent(tangent) {
    return normalizePlanar({
        x: -sanitizeNumber(tangent.z, 0),
        y: 0,
        z: sanitizeNumber(tangent.x, 0)
    });
}

function stripClosingDuplicate(points) {
    if (points.length < 2) return points.slice();

    const first = points[0];
    const last = points[points.length - 1];
    const samePoint = Math.abs(first.x - last.x) < EPSILON &&
        Math.abs(first.y - last.y) < EPSILON &&
        Math.abs(first.z - last.z) < EPSILON;

    return samePoint ? points.slice(0, -1) : points.slice();
}

function clonePointArray(points = []) {
    return stripClosingDuplicate(points.map((point) => cloneVec3(point)));
}

function quantizeNumber(value, decimals = HASH_DECIMALS) {
    if (!isFiniteNumber(value)) return value;
    const factor = 10 ** decimals;
    const quantized = Math.round(value * factor) / factor;
    return Object.is(quantized, -0) ? 0 : quantized;
}

function stableCanonicalize(value, options = {}) {
    const decimals = sanitizeNumber(options.decimals, HASH_DECIMALS);

    if (value === null) {
        return null;
    }

    if (typeof value === 'number') {
        return quantizeNumber(value, decimals);
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => stableCanonicalize(entry, options));
    }

    if (typeof value === 'object') {
        const output = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] === undefined) continue;
            output[key] = stableCanonicalize(value[key], options);
        }
        return output;
    }

    return value;
}

function stableStringify(value, options = {}) {
    return JSON.stringify(stableCanonicalize(value, options));
}

function xmur3(str) {
    let hash = 1779033703 ^ str.length;
    for (let index = 0; index < str.length; index++) {
        hash = Math.imul(hash ^ str.charCodeAt(index), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
    }
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

function hashGeometryBundle(bundle, options = {}) {
    const serialized = stableStringify(bundle, options);
    return xmur3(serialized).toString(16).padStart(8, '0');
}

function signedArea2D(points = []) {
    const loop = clonePointArray(points);
    if (loop.length < 3) return 0;

    let area = 0;
    for (let index = 0; index < loop.length; index++) {
        const current = loop[index];
        const next = loop[(index + 1) % loop.length];
        area += current.x * next.z - next.x * current.z;
    }

    return area / 2;
}

function canonicalizeLoop(points = []) {
    const loop = clonePointArray(points);
    const originalSignedArea = signedArea2D(loop);
    const absoluteArea = Math.abs(originalSignedArea);

    let inputWinding = 'degenerate';
    if (originalSignedArea > EPSILON) {
        inputWinding = 'ccw';
    } else if (originalSignedArea < -EPSILON) {
        inputWinding = 'cw';
    }

    const reversed = inputWinding === 'cw';
    const canonicalPoints = reversed ? loop.slice().reverse() : loop.slice();

    return {
        points: canonicalPoints,
        inputWinding,
        winding: inputWinding === 'degenerate' ? 'degenerate' : 'ccw',
        reversed,
        signedArea: absoluteArea,
        originalSignedArea
    };
}

function deriveTrackFrames(centerline = [], options = {}) {
    const closed = options.closed !== false;
    const up = normalizeVec3(options.up || DEFAULT_UP, DEFAULT_UP);
    const source = closed
        ? canonicalizeLoop(centerline)
        : {
            points: clonePointArray(centerline),
            inputWinding: 'open',
            winding: 'open',
            reversed: false,
            signedArea: 0,
            originalSignedArea: 0
        };

    const points = source.points;
    if (points.length === 0) {
        return {
            closed,
            points: [],
            frames: [],
            degenerateIndices: [],
            winding: source.winding,
            inputWinding: source.inputWinding,
            reversed: source.reversed,
            signedArea: source.signedArea,
            originalSignedArea: source.originalSignedArea,
            totalLength: 0
        };
    }

    const degenerateIndices = [];
    const frames = [];

    let totalLength = 0;
    for (let index = 1; index < points.length; index++) {
        totalLength += planarDistance(points[index - 1], points[index]);
    }
    if (closed && points.length > 1) {
        totalLength += planarDistance(points[points.length - 1], points[0]);
    }

    let arcLength = 0;
    let lastTangent = { x: 1, y: 0, z: 0 };

    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const prev = closed
            ? points[(index - 1 + points.length) % points.length]
            : points[Math.max(0, index - 1)];
        const next = closed
            ? points[(index + 1) % points.length]
            : points[Math.min(points.length - 1, index + 1)];

        const tangentSource = closed
            ? subtractVec3(next, prev)
            : (index === 0
                ? subtractVec3(next, current)
                : (index === points.length - 1
                    ? subtractVec3(current, prev)
                    : subtractVec3(next, prev)));

        const tangentLength = planarLength(tangentSource);
        const tangent = tangentLength < EPSILON
            ? cloneVec3(lastTangent)
            : normalizePlanar(tangentSource, lastTangent);

        if (tangentLength < EPSILON) {
            degenerateIndices.push(index);
        }

        const leftNormal = leftNormalFromTangent(tangent);
        const rightNormal = negateVec3(leftNormal);

        if (index > 0) {
            arcLength += planarDistance(points[index - 1], current);
        }

        frames.push({
            index,
            point: cloneVec3(current),
            tangent,
            normal: leftNormal,
            leftNormal,
            rightNormal,
            up: cloneVec3(up),
            arcLength: quantizeNumber(arcLength)
        });

        lastTangent = tangent;
    }

    return {
        closed,
        points: points.map((point) => cloneVec3(point)),
        frames,
        degenerateIndices,
        winding: source.winding,
        inputWinding: source.inputWinding,
        reversed: source.reversed,
        signedArea: source.signedArea,
        originalSignedArea: source.originalSignedArea,
        totalLength: quantizeNumber(totalLength)
    };
}

function deriveEdgesFromFrames(frameSource, halfWidth) {
    const frames = Array.isArray(frameSource) ? frameSource : frameSource?.frames || [];
    const distance = sanitizeNumber(halfWidth, 0);

    return {
        halfWidth: distance,
        leftEdge: frames.map((frame) => addVec3(frame.point, scaleVec3(frame.leftNormal || frame.normal, distance))),
        rightEdge: frames.map((frame) => addVec3(frame.point, scaleVec3(frame.rightNormal || negateVec3(frame.normal), distance)))
    };
}

function normalizeHeightBand(heightBand) {
    if (!heightBand) return null;

    const min = sanitizeNumber(heightBand.min, -Infinity);
    const max = sanitizeNumber(heightBand.max, Infinity);

    return { min, max };
}

function makeOrientedGate(frameOrGate = {}, options = {}) {
    const width = sanitizeNumber(options.width ?? frameOrGate.width, 0);
    const depth = sanitizeNumber(options.depth ?? frameOrGate.depth, DEFAULT_GATE_DEPTH);
    const tangent = normalizePlanar(frameOrGate.tangent || { x: 1, y: 0, z: 0 });
    const basisLeftNormal = leftNormalFromTangent(tangent);

    const preferredNormal = frameOrGate.normal || frameOrGate.leftNormal || basisLeftNormal;
    const preferredAlignment = dotXZ(preferredNormal, basisLeftNormal);
    const normal = preferredAlignment < 0 ? negateVec3(basisLeftNormal) : basisLeftNormal;

    const center = cloneVec3(frameOrGate.point || frameOrGate.center || {});
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    return {
        id: options.id ?? frameOrGate.id ?? null,
        center,
        tangent,
        normal,
        width,
        depth,
        halfWidth,
        halfDepth,
        heightBand: normalizeHeightBand(options.heightBand ?? frameOrGate.heightBand ?? null),
        isFinishLine: Boolean(options.isFinishLine ?? frameOrGate.isFinishLine),
        spanStart: addVec3(center, scaleVec3(normal, -halfWidth)),
        spanEnd: addVec3(center, scaleVec3(normal, halfWidth))
    };
}

function projectPointToGate(point, gate) {
    const delta = subtractVec3(cloneVec3(point), gate.center);
    return {
        lateral: dotXZ(delta, gate.normal),
        longitudinal: dotXZ(delta, gate.tangent),
        vertical: sanitizeNumber(delta.y, 0)
    };
}

function isPointWithinHeightBand(point, gate) {
    if (!gate.heightBand) return true;
    const y = sanitizeNumber(point.y, 0);
    return y >= gate.heightBand.min - EPSILON && y <= gate.heightBand.max + EPSILON;
}

function containsPointInGate(point, gate) {
    const projection = projectPointToGate(point, gate);

    return Math.abs(projection.lateral) <= gate.halfWidth + EPSILON &&
        Math.abs(projection.longitudinal) <= gate.halfDepth + EPSILON &&
        isPointWithinHeightBand(point, gate);
}

function segmentCrossesGate(start, end, gate) {
    if (containsPointInGate(start, gate) || containsPointInGate(end, gate)) {
        return true;
    }

    const startProjection = projectPointToGate(start, gate);
    const endProjection = projectPointToGate(end, gate);
    const longitudinalDelta = endProjection.longitudinal - startProjection.longitudinal;

    if (Math.abs(longitudinalDelta) < EPSILON) {
        return false;
    }

    const interpolation = -startProjection.longitudinal / longitudinalDelta;
    if (interpolation < 0 || interpolation > 1) {
        return false;
    }

    const lateral = startProjection.lateral + (endProjection.lateral - startProjection.lateral) * interpolation;
    const y = sanitizeNumber(start.y, 0) + (sanitizeNumber(end.y, 0) - sanitizeNumber(start.y, 0)) * interpolation;

    return Math.abs(lateral) <= gate.halfWidth + EPSILON &&
        (!gate.heightBand || (y >= gate.heightBand.min - EPSILON && y <= gate.heightBand.max + EPSILON));
}

function normalizeSupportHit(rawHit) {
    if (!rawHit || rawHit.hit === false) {
        return {
            hit: false,
            y: null,
            distance: null,
            normal: null,
            source: rawHit?.source ?? null
        };
    }

    const point = rawHit.point || rawHit.position || {};
    const normal = rawHit.normal ? normalizeVec3(rawHit.normal, DEFAULT_UP) : null;

    return {
        hit: true,
        y: isFiniteNumber(rawHit.y) ? rawHit.y : sanitizeNumber(point.y, 0),
        distance: isFiniteNumber(rawHit.distance) ? rawHit.distance : null,
        normal,
        source: rawHit.source ?? null
    };
}

function measurePairwiseSpawnDistances(spawns = []) {
    const pairwise = [];
    const perSpawn = spawns.map((spawn, index) => ({
        id: spawn.id ?? `spawn-${index}`,
        minPairDistance: null,
        nearestSpawnId: null
    }));

    let minDistance = Infinity;

    for (let leftIndex = 0; leftIndex < spawns.length; leftIndex++) {
        const leftPosition = cloneVec3(spawns[leftIndex].position || spawns[leftIndex]);

        for (let rightIndex = leftIndex + 1; rightIndex < spawns.length; rightIndex++) {
            const rightPosition = cloneVec3(spawns[rightIndex].position || spawns[rightIndex]);
            const distance = planarDistance(leftPosition, rightPosition);
            const pair = {
                aId: perSpawn[leftIndex].id,
                bId: perSpawn[rightIndex].id,
                distance: quantizeNumber(distance)
            };

            pairwise.push(pair);
            minDistance = Math.min(minDistance, distance);

            if (perSpawn[leftIndex].minPairDistance === null || distance < perSpawn[leftIndex].minPairDistance) {
                perSpawn[leftIndex].minPairDistance = quantizeNumber(distance);
                perSpawn[leftIndex].nearestSpawnId = perSpawn[rightIndex].id;
            }

            if (perSpawn[rightIndex].minPairDistance === null || distance < perSpawn[rightIndex].minPairDistance) {
                perSpawn[rightIndex].minPairDistance = quantizeNumber(distance);
                perSpawn[rightIndex].nearestSpawnId = perSpawn[leftIndex].id;
            }
        }
    }

    return {
        minDistance: Number.isFinite(minDistance) ? quantizeNumber(minDistance) : null,
        pairwise,
        perSpawn
    };
}

function buildFailure(code, details = {}) {
    return stableCanonicalize({
        code,
        ...details
    });
}

function validateSpawnSet(spawns = [], options = {}) {
    const minPairDistance = sanitizeNumber(options.minPairDistance, 0);
    const minClearance = sanitizeNumber(options.minClearance, 0);
    const requireSupport = options.requireSupport !== false;

    const pairwise = measurePairwiseSpawnDistances(spawns);
    const failures = [];

    const reports = spawns.map((spawn, index) => {
        const id = spawn.id ?? `spawn-${index}`;
        const position = cloneVec3(spawn.position || spawn);
        const support = normalizeSupportHit(spawn.support);
        const clearance = isFiniteNumber(spawn.clearance) ? quantizeNumber(spawn.clearance) : null;
        const headingRad = isFiniteNumber(spawn.headingRad)
            ? quantizeNumber(spawn.headingRad)
            : (isFiniteNumber(spawn.rotation) ? quantizeNumber(spawn.rotation) : null);
        const pairMetrics = pairwise.perSpawn[index] || {
            minPairDistance: null,
            nearestSpawnId: null
        };

        const reasons = [];

        if (requireSupport && !support.hit) {
            reasons.push(buildFailure('support_missing', {
                spawnId: id,
                actual: false,
                expected: true
            }));
        }

        if (clearance !== null && clearance < minClearance - EPSILON) {
            reasons.push(buildFailure('clearance_below_min', {
                spawnId: id,
                actual: clearance,
                minimum: quantizeNumber(minClearance)
            }));
        }

        if (pairMetrics.minPairDistance !== null && pairMetrics.minPairDistance < minPairDistance - EPSILON) {
            reasons.push(buildFailure('pair_distance_below_min', {
                spawnId: id,
                nearestSpawnId: pairMetrics.nearestSpawnId,
                actual: pairMetrics.minPairDistance,
                minimum: quantizeNumber(minPairDistance)
            }));
        }

        failures.push(...reasons);

        return {
            id,
            position,
            headingRad,
            minPairDistance: pairMetrics.minPairDistance,
            nearestSpawnId: pairMetrics.nearestSpawnId,
            clearance,
            support,
            valid: reasons.length === 0,
            reasons
        };
    });

    return {
        valid: reports.every((report) => report.valid),
        constraints: {
            minPairDistance: quantizeNumber(minPairDistance),
            minClearance: quantizeNumber(minClearance),
            requireSupport
        },
        minPairDistance: pairwise.minDistance,
        pairwise: pairwise.pairwise,
        spawns: reports,
        failures
    };
}

function buildGeometryDiagnostics(input = {}) {
    const frameState = input.centerline
        ? deriveTrackFrames(input.centerline, {
            closed: input.closed !== false,
            up: input.up || DEFAULT_UP
        })
        : {
            closed: input.closed !== false,
            points: [],
            frames: [],
            degenerateIndices: [],
            winding: null,
            inputWinding: null,
            reversed: false,
            signedArea: 0,
            originalSignedArea: 0,
            totalLength: 0
        };

    const failures = frameState.degenerateIndices.map((index) => buildFailure('frame_degenerate', { frameIndex: index }));
    const gates = [];

    for (let index = 0; index < (input.gateSpecs || []).length; index++) {
        const spec = input.gateSpecs[index];
        const sourceFrame = Number.isInteger(spec.frameIndex) ? frameState.frames[spec.frameIndex] : null;

        if (Number.isInteger(spec.frameIndex) && !sourceFrame) {
            failures.push(buildFailure('gate_frame_missing', {
                gateId: spec.id ?? index,
                frameIndex: spec.frameIndex
            }));
        }

        const gate = makeOrientedGate(sourceFrame || spec, {
            id: spec.id ?? index,
            width: spec.width,
            depth: spec.depth,
            heightBand: spec.heightBand,
            isFinishLine: spec.isFinishLine
        });

        if (gate.width <= EPSILON || gate.depth <= EPSILON) {
            failures.push(buildFailure('gate_degenerate', {
                gateId: gate.id,
                width: quantizeNumber(gate.width),
                depth: quantizeNumber(gate.depth)
            }));
        }

        gates.push(gate);
    }

    const spawnValidation = validateSpawnSet(input.spawns || [], input.constraints || {});
    failures.push(...spawnValidation.failures);

    const gateArtifacts = gates.map((gate) => ({
        id: gate.id,
        center: stableCanonicalize(gate.center),
        tangent: stableCanonicalize(gate.tangent),
        normal: stableCanonicalize(gate.normal),
        width: quantizeNumber(gate.width),
        depth: quantizeNumber(gate.depth),
        heightBand: gate.heightBand ? stableCanonicalize(gate.heightBand) : null,
        isFinishLine: gate.isFinishLine
    }));

    const source = stableCanonicalize(input.source || {});
    const geometryHash = hashGeometryBundle(input.geometryHashSource || {
        source,
        centerline: frameState.points,
        gates: gateArtifacts,
        spawns: spawnValidation.spawns.map((spawn) => ({
            id: spawn.id,
            position: spawn.position,
            headingRad: spawn.headingRad
        }))
    });

    return stableCanonicalize({
        schema: 'geometry-kernel/v1',
        source,
        geometryHash,
        valid: failures.length === 0,
        winding: frameState.winding,
        frames: {
            count: frameState.frames.length,
            closed: frameState.closed,
            degenerateIndices: frameState.degenerateIndices,
            totalLength: frameState.totalLength
        },
        pairwiseDistances: spawnValidation.pairwise,
        spawns: spawnValidation.spawns,
        gates: gateArtifacts,
        failures
    });
}

export {
    DEFAULT_GATE_DEPTH,
    DEFAULT_UP,
    EPSILON,
    HASH_DECIMALS,
    buildGeometryDiagnostics,
    canonicalizeLoop,
    containsPointInGate,
    deriveEdgesFromFrames,
    deriveTrackFrames,
    hashGeometryBundle,
    makeOrientedGate,
    measurePairwiseSpawnDistances,
    normalizeSupportHit,
    projectPointToGate,
    quantizeNumber,
    segmentCrossesGate,
    signedArea2D,
    stableCanonicalize,
    stableStringify,
    validateSpawnSet
};
