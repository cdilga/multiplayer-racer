/**
 * Pure screen-space Voronoi geometry for the shared host camera.
 *
 * Each camera group owns the portion of the TV closer to its directional seed
 * than to any other seed. Cells are calculated by repeatedly clipping the full
 * screen rectangle against perpendicular-bisector half-planes. The output is
 * deterministic, convex, gapless, and independent of Three.js / the DOM.
 */

const EPSILON = 1e-7;
const DEFAULT_PADDING_RATIO = 0.14;

function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function quantize(value) {
    const rounded = Math.round(value * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function clipPolygonToHalfPlane(polygon, a, b, c) {
    if (polygon.length === 0) return [];

    const output = [];
    const signedDistance = (point) => a * point.x + b * point.y - c;
    let previous = polygon[polygon.length - 1];
    let previousDistance = signedDistance(previous);
    let previousInside = previousDistance <= EPSILON;

    for (const current of polygon) {
        const currentDistance = signedDistance(current);
        const currentInside = currentDistance <= EPSILON;

        if (currentInside !== previousInside) {
            const denominator = previousDistance - currentDistance;
            const t = Math.abs(denominator) <= EPSILON
                ? 0
                : previousDistance / denominator;
            output.push({
                x: quantize(previous.x + (current.x - previous.x) * t),
                y: quantize(previous.y + (current.y - previous.y) * t)
            });
        }
        if (currentInside) {
            output.push({ x: quantize(current.x), y: quantize(current.y) });
        }

        previous = current;
        previousDistance = currentDistance;
        previousInside = currentInside;
    }

    return output;
}

function polygonAreaAndCentroid(polygon) {
    let twiceArea = 0;
    let centroidX = 0;
    let centroidY = 0;

    for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        const cross = current.x * next.y - next.x * current.y;
        twiceArea += cross;
        centroidX += (current.x + next.x) * cross;
        centroidY += (current.y + next.y) * cross;
    }

    if (Math.abs(twiceArea) <= EPSILON) {
        const fallback = polygon.reduce((sum, point) => ({
            x: sum.x + point.x,
            y: sum.y + point.y
        }), { x: 0, y: 0 });
        const divisor = Math.max(1, polygon.length);
        return {
            area: 0,
            centroid: { x: fallback.x / divisor, y: fallback.y / divisor }
        };
    }

    return {
        area: Math.abs(twiceArea) / 2,
        centroid: {
            x: centroidX / (3 * twiceArea),
            y: centroidY / (3 * twiceArea)
        }
    };
}

function polygonBounds(polygon) {
    return polygon.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y)
    }), {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    });
}

function toClipPath(polygon, width, height) {
    const points = polygon.map((point) => {
        const x = quantize((point.x / Math.max(1, width)) * 100);
        const y = quantize((point.y / Math.max(1, height)) * 100);
        return `${x}% ${y}%`;
    });
    return `polygon(${points.join(', ')})`;
}

function separateCoincidentSeeds(seeds, width, height) {
    const seen = new Map();
    const nudge = Math.max(1, Math.min(width, height) * 0.012);

    return seeds.map((seed, index) => {
        const key = `${quantize(seed.x)}:${quantize(seed.y)}`;
        const collisionIndex = seen.get(key) || 0;
        seen.set(key, collisionIndex + 1);
        if (collisionIndex === 0) return seed;

        const angle = (index * 2.399963229728653) + collisionIndex;
        return {
            ...seed,
            x: clamp(seed.x + Math.cos(angle) * nudge * collisionIndex, 0, width),
            y: clamp(seed.y + Math.sin(angle) * nudge * collisionIndex, 0, height)
        };
    });
}

/**
 * Build a gapless Voronoi partition inside a screen rectangle.
 * @param {Array<{id:string|number,x:number,y:number}>} rawSeeds
 * @param {{width:number,height:number}} bounds
 */
export function buildVoronoiLayout(rawSeeds = [], bounds = {}) {
    const width = Math.max(1, finiteNumber(bounds.width, 1920));
    const height = Math.max(1, finiteNumber(bounds.height, 1080));
    const normalizedSeeds = rawSeeds.map((seed, index) => ({
        id: seed?.id ?? `cell-${index + 1}`,
        x: clamp(finiteNumber(seed?.x, width / 2), 0, width),
        y: clamp(finiteNumber(seed?.y, height / 2), 0, height)
    }));
    const seeds = separateCoincidentSeeds(
        normalizedSeeds.length > 0
            ? normalizedSeeds
            : [{ id: 'whole', x: width / 2, y: height / 2 }],
        width,
        height
    );

    const screenPolygon = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
    ];

    const cells = seeds.map((seed, seedIndex) => {
        let polygon = screenPolygon.map((point) => ({ ...point }));
        seeds.forEach((other, otherIndex) => {
            if (seedIndex === otherIndex || polygon.length === 0) return;

            // |p-seed|² <= |p-other|² becomes a*x + b*y <= c. The
            // boundary is the exact perpendicular bisector of the two seeds.
            const a = 2 * (other.x - seed.x);
            const b = 2 * (other.y - seed.y);
            const c = other.x * other.x + other.y * other.y
                - seed.x * seed.x - seed.y * seed.y;
            polygon = clipPolygonToHalfPlane(polygon, a, b, c);
        });

        const geometry = polygonAreaAndCentroid(polygon);
        const cellBounds = polygonBounds(polygon);
        return {
            index: seedIndex,
            id: seed.id,
            seed: { x: quantize(seed.x), y: quantize(seed.y) },
            polygon,
            area: quantize(geometry.area),
            centroid: {
                x: quantize(geometry.centroid.x),
                y: quantize(geometry.centroid.y)
            },
            bounds: {
                x: quantize(cellBounds.minX),
                y: quantize(cellBounds.minY),
                width: quantize(cellBounds.maxX - cellBounds.minX),
                height: quantize(cellBounds.maxY - cellBounds.minY)
            },
            clipPath: toClipPath(polygon, width, height)
        };
    });

    return {
        mode: cells.length === 1 ? 'whole' : 'voronoi',
        width,
        height,
        count: cells.length,
        seeds: seeds.map((seed) => ({
            id: seed.id,
            x: quantize(seed.x),
            y: quantize(seed.y)
        })),
        cells
    };
}

/**
 * Map ground-plane cluster centroids into the safe middle of the host screen.
 * This preserves world direction while avoiding seeds pinned under TV overscan.
 * @param {Array<{id:string|number,centroid:{x:number,z:number}}>} groups
 * @param {{width:number,height:number,paddingRatio?:number}} bounds
 */
export function projectGroupCentroids(groups = [], bounds = {}) {
    const width = Math.max(1, finiteNumber(bounds.width, 1920));
    const height = Math.max(1, finiteNumber(bounds.height, 1080));
    const paddingRatio = clamp(
        finiteNumber(bounds.paddingRatio, DEFAULT_PADDING_RATIO),
        0,
        0.45
    );
    if (groups.length === 0) return [];

    const world = groups.map((group, index) => ({
        id: group?.id ?? `group-${index + 1}`,
        x: finiteNumber(group?.centroid?.x, 0),
        z: finiteNumber(group?.centroid?.z, 0)
    }));
    const extents = world.reduce((result, point) => ({
        minX: Math.min(result.minX, point.x),
        maxX: Math.max(result.maxX, point.x),
        minZ: Math.min(result.minZ, point.z),
        maxZ: Math.max(result.maxZ, point.z)
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const rangeX = extents.maxX - extents.minX;
    const rangeZ = extents.maxZ - extents.minZ;
    const left = width * paddingRatio;
    const top = height * paddingRatio;
    const usableWidth = width * (1 - paddingRatio * 2);
    const usableHeight = height * (1 - paddingRatio * 2);

    return world.map((point) => ({
        id: point.id,
        x: quantize(rangeX <= EPSILON
            ? width / 2
            : left + ((point.x - extents.minX) / rangeX) * usableWidth),
        y: quantize(rangeZ <= EPSILON
            ? height / 2
            : top + ((point.z - extents.minZ) / rangeZ) * usableHeight)
    }));
}

