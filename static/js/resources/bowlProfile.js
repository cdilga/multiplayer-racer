/**
 * bowlProfile.js - Shared deterministic derby-bowl surface generator.
 *
 * ONE radial profile bowlProfile(r) is revolved into a single vertex grid that
 * feeds BOTH the visual BufferGeometry (TrackFactory) AND the Rapier trimesh
 * collider (PhysicsSystem) - exactly the dunes precedent in terrain.js. No more
 * flat-cuboid floor that disagrees with a concave-looking visual, and no hard
 * crease where a CircleGeometry rim meets a separate cylinder wall.
 *
 * The profile is concave (a real bowl: low centre, rim rising outward), the
 * opposite of the old `setZ(-height)` inverted DOME, and C1 (tangent-continuous)
 * across the floor->fillet seam so wheel raycasts never hit a normal step:
 *
 *   dish  [0, r1]   y = -floorDepth * 0.5*(1 + cos(pi * r/r1))   slope 0 at 0 and r1
 *   fillet[r1, R]   quarter circle radius = filletRadius          slope 0 at r1 -> vertical at R
 *
 * with r1 = R - filletRadius. The moving shrink wall (br-fb-derbywall-shrink-7r5)
 * still owns containment above the rim; this module owns the static driven
 * surface only.
 */

export const BOWL_DEFAULTS = {
    diameter: 80,       // arena diameter; radius R = diameter / 2
    floorConcavity: 0.1, // centre dip as a fraction of R (depth = floorConcavity * R)
    filletRadius: 8,    // radius of the floor->rim fillet arc (world units)
    radialSegments: 32, // rings from centre to rim
    angularSegments: 64, // sectors around (matches the 64-segment wall ring)
    wallHeight: 15,     // vertical containment wall height above the rim
    wallRings: 4,       // ring subdivisions of the vertical wall
    lipWidth: 2.5       // flat horizontal lip cap width past the rim (containment)
};

/**
 * Resolve raw geometry config into bowl profile params, clamped to sane ranges.
 * @param {Object} [params]
 * @returns {Object}
 */
export function resolveBowlParams(params = {}) {
    const p = { ...BOWL_DEFAULTS, ...params };
    const R = Math.max(1, (p.diameter || BOWL_DEFAULTS.diameter) / 2);
    // Fillet must leave a non-zero dish region: 0 < filletRadius < R.
    const filletRadius = Math.min(Math.max(0.5, p.filletRadius), R * 0.9);
    const floorDepth = Math.max(0, p.floorConcavity) * R;
    return {
        ...p,
        R,
        filletRadius,
        floorDepth,
        r1: R - filletRadius,
        radialSegments: Math.max(4, Math.floor(p.radialSegments)),
        angularSegments: Math.max(8, Math.floor(p.angularSegments)),
        wallHeight: Math.max(0, p.wallHeight ?? BOWL_DEFAULTS.wallHeight),
        wallRings: Math.max(1, Math.floor(p.wallRings ?? BOWL_DEFAULTS.wallRings)),
        lipWidth: Math.max(0, p.lipWidth ?? BOWL_DEFAULTS.lipWidth)
    };
}

/**
 * Radial cross-section as ordered (r, y) rings: the concave dish + fillet floor,
 * then a VERTICAL containment wall at the rim, then a FLAT horizontal lip cap
 * (br-bowl-containment-lip). Revolving this makes both the visual mesh and the
 * physics trimesh share one containment profile, so cars hit a vertical wall +
 * lip instead of riding a shallow fillet out the sides.
 * @param {Object} rp - resolved params
 * @returns {Array<{r:number,y:number,zone:string}>}
 */
export function bowlContainmentProfile(rp) {
    const rings = [];
    for (let i = 1; i <= rp.radialSegments; i++) {
        const r = (i / rp.radialSegments) * rp.R;
        rings.push({ r, y: bowlProfile(r, rp), zone: r <= rp.r1 ? 'dish' : 'fillet' });
    }
    const rimY = bowlProfile(rp.R, rp);
    // Vertical wall: constant r = R, rising by wallHeight.
    for (let k = 1; k <= rp.wallRings; k++) {
        rings.push({ r: rp.R, y: rimY + (rp.wallHeight * k) / rp.wallRings, zone: 'wall' });
    }
    // Flat lip cap: horizontal segment past the rim at the wall top.
    if (rp.lipWidth > 0) {
        rings.push({ r: rp.R + rp.lipWidth, y: rimY + rp.wallHeight, zone: 'lip' });
    }
    return rings;
}

/**
 * Surface height y at radial distance r (world units). Concave: y(0) is the
 * global minimum (-floorDepth), rising to +filletRadius at the rim.
 * @param {number} r - radial distance from centre (>= 0)
 * @param {Object} rp - resolved params (resolveBowlParams)
 * @returns {number}
 */
export function bowlProfile(r, rp) {
    const { R, r1, filletRadius, floorDepth } = rp;
    const rr = Math.min(Math.max(0, r), R);
    if (rr <= r1) {
        // Concave dish: cosine dip, slope 0 at centre and at the seam r1.
        return -floorDepth * 0.5 * (1 + Math.cos((Math.PI * rr) / r1));
    }
    // Quarter-circle fillet, centre at (r1, filletRadius), tangent to the flat
    // floor level (y=0, slope 0) at r1 and reaching y=filletRadius at the rim.
    const dr = rr - r1;
    const inside = Math.max(0, filletRadius * filletRadius - dr * dr);
    return filletRadius - Math.sqrt(inside);
}

/**
 * Analytic slope dy/dr of the profile. Continuous across the floor->fillet seam
 * (both sides are 0 there), diverging to vertical only at the very rim.
 * @param {number} r
 * @param {Object} rp - resolved params
 * @returns {number}
 */
export function bowlProfileSlope(r, rp) {
    const { R, r1, filletRadius, floorDepth } = rp;
    const rr = Math.min(Math.max(0, r), R);
    if (rr <= r1) {
        return floorDepth * (Math.PI / (2 * r1)) * Math.sin((Math.PI * rr) / r1);
    }
    const dr = rr - r1;
    const inside = filletRadius * filletRadius - dr * dr;
    if (inside <= 1e-9) return Number.POSITIVE_INFINITY; // vertical at the rim
    return dr / Math.sqrt(inside);
}

/**
 * Sample the cross-section (r, y, slope, zone) for diagnostics / debug render.
 * @param {Object} rp - resolved params
 * @param {number} [samples]
 * @returns {Array<{r:number,y:number,slope:number,zone:string}>}
 */
export function bowlCrossSection(rp, samples = 32) {
    const out = [];
    for (let i = 0; i <= samples; i++) {
        const r = (i / samples) * rp.R;
        out.push({
            r,
            y: bowlProfile(r, rp),
            slope: bowlProfileSlope(r, rp),
            zone: r <= rp.r1 ? 'dish' : 'fillet'
        });
    }
    return out;
}

/**
 * Revolve the profile into a polar vertex grid: one centre vertex plus
 * radialSegments rings of angularSegments vertices. Both the render mesh and
 * the physics trimesh consume these arrays directly, so they cannot drift.
 * @param {Object} [params]
 * @returns {{vertices: Float32Array, indices: Uint32Array, params: Object}}
 */
export function buildBowlGrid(params = {}) {
    const rp = resolveBowlParams(params);
    const na = rp.angularSegments;
    // Ordered rings: dish + fillet floor, then the vertical containment wall,
    // then the flat lip cap. Revolving all of them feeds mesh AND trimesh.
    const rings = bowlContainmentProfile(rp);
    const nr = rings.length;

    const vertexCount = 1 + nr * na;
    const vertices = new Float32Array(vertexCount * 3);

    // Centre vertex (index 0).
    vertices[0] = 0;
    vertices[1] = bowlProfile(0, rp);
    vertices[2] = 0;

    // Index of ring i (1..nr), sector j (0..na-1).
    const idx = (i, j) => 1 + (i - 1) * na + (j % na);

    for (let i = 1; i <= nr; i++) {
        const { r, y } = rings[i - 1];
        for (let j = 0; j < na; j++) {
            const theta = (j / na) * Math.PI * 2;
            const v = idx(i, j) * 3;
            vertices[v] = r * Math.cos(theta);
            vertices[v + 1] = y;
            vertices[v + 2] = r * Math.sin(theta);
        }
    }

    const indices = [];
    // Centre fan to the first ring (CCW from above -> upward normals).
    for (let j = 0; j < na; j++) {
        indices.push(0, idx(1, j + 1), idx(1, j));
    }
    // Quad strips between successive rings.
    for (let i = 1; i < nr; i++) {
        for (let j = 0; j < na; j++) {
            const a = idx(i, j);
            const b = idx(i, j + 1);
            const c = idx(i + 1, j);
            const d = idx(i + 1, j + 1);
            indices.push(a, d, c, a, b, d);
        }
    }

    return { vertices, indices: new Uint32Array(indices), params: rp };
}

// Expose globally for any non-module consumer (mirrors terrain.js).
if (typeof window !== 'undefined') {
    window.MR_bowl = { bowlProfile, bowlProfileSlope, buildBowlGrid, bowlCrossSection, bowlContainmentProfile, resolveBowlParams, BOWL_DEFAULTS };
}
