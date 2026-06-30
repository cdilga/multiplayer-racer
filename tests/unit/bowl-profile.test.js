import { describe, expect, it } from 'vitest';
import {
    BOWL_DEFAULTS,
    resolveBowlParams,
    bowlProfile,
    bowlProfileSlope,
    bowlCrossSection,
    buildBowlGrid
} from '../../static/js/resources/bowlProfile.js';

// derby-bowl.json ships diameter 80, floorConcavity 0.1.
const BOWL = { diameter: 80, floorConcavity: 0.1, filletRadius: 8 };

function numericSlope(r, rp, h = 1e-4) {
    return (bowlProfile(r + h, rp) - bowlProfile(r - h, rp)) / (2 * h);
}

describe('bowlProfile (br-fb-bowltransition-3ij)', () => {
    it('is a concave BOWL, not an inverted dome: centre is the global minimum', () => {
        const rp = resolveBowlParams(BOWL);
        const yCentre = bowlProfile(0, rp);
        const ySeam = bowlProfile(rp.r1, rp);
        const yRim = bowlProfile(rp.R, rp);

        // Old bug: rim sat BELOW centre (a raised-centre dome). Now centre dips.
        expect(yCentre).toBeLessThan(ySeam);
        expect(ySeam).toBeLessThanOrEqual(yRim);
        expect(yCentre).toBeLessThan(yRim);

        // Depth matches floorConcavity * R (~= -4u for the shipped bowl).
        expect(yCentre).toBeCloseTo(-BOWL.floorConcavity * rp.R, 6);

        // Sampled across the radius, height is monotonically non-decreasing
        // outward (a smooth dish, no dome hump).
        let prev = -Infinity;
        for (let i = 0; i <= 200; i++) {
            const y = bowlProfile((i / 200) * rp.R, rp);
            expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = y;
        }
    });

    it('is C1 (tangent-continuous) across the floor->fillet seam', () => {
        const rp = resolveBowlParams(BOWL);

        // Both pieces are flat (slope 0) at the seam r1 -> no normal step.
        expect(bowlProfileSlope(rp.r1 - 1e-6, rp)).toBeCloseTo(0, 5);
        expect(bowlProfileSlope(rp.r1 + 1e-6, rp)).toBeCloseTo(0, 5);
        expect(bowlProfileSlope(0, rp)).toBeCloseTo(0, 9);

        // Analytic slope agrees with the numeric derivative everywhere except
        // the vertical rim - proves the analytic seam math is the real tangent.
        for (let i = 1; i < 100; i++) {
            const r = (i / 100) * rp.R * 0.985; // stay off the vertical rim
            expect(bowlProfileSlope(r, rp)).toBeCloseTo(numericSlope(r, rp), 3);
        }
    });

    it('rises to the fillet top at the rim and turns vertical there', () => {
        const rp = resolveBowlParams(BOWL);
        expect(bowlProfile(rp.R, rp)).toBeCloseTo(rp.filletRadius, 6);
        expect(bowlProfileSlope(rp.R, rp)).toBe(Number.POSITIVE_INFINITY);
    });

    it('clamps degenerate params (fillet never swallows the whole floor)', () => {
        const rp = resolveBowlParams({ diameter: 80, floorConcavity: 0.1, filletRadius: 1000 });
        expect(rp.filletRadius).toBeLessThan(rp.R);
        expect(rp.r1).toBeGreaterThan(0);
        expect(Number.isFinite(bowlProfile(0, rp))).toBe(true);
    });

    describe('buildBowlGrid - one grid feeds mesh + trimesh', () => {
        it('produces a valid, finite, in-range vertex/index grid', () => {
            const { vertices, indices, params } = buildBowlGrid(BOWL);
            const vertexCount = vertices.length / 3;

            expect(vertexCount).toBe(1 + params.radialSegments * params.angularSegments);
            expect(indices.length % 3).toBe(0);
            for (const v of vertices) expect(Number.isFinite(v)).toBe(true);
            for (const i of indices) {
                expect(i).toBeGreaterThanOrEqual(0);
                expect(i).toBeLessThan(vertexCount);
            }
        });

        it('places the centre vertex at the lowest point and the rim ring at radius R', () => {
            const { vertices, params } = buildBowlGrid(BOWL);
            const vertexCount = vertices.length / 3;

            // Centre (index 0) is the global minimum height.
            const centreY = vertices[1];
            let minY = Infinity;
            for (let k = 0; k < vertexCount; k++) minY = Math.min(minY, vertices[k * 3 + 1]);
            expect(centreY).toBeCloseTo(minY, 6);
            expect(centreY).toBeCloseTo(-BOWL.floorConcavity * params.R, 5);

            // Outermost ring vertices sit on the rim circle of radius R.
            const last = vertexCount - 1;
            const rimR = Math.hypot(vertices[last * 3], vertices[last * 3 + 2]);
            expect(rimR).toBeCloseTo(params.R, 4);
        });

        it('is deterministic (same params -> identical arrays)', () => {
            const a = buildBowlGrid(BOWL);
            const b = buildBowlGrid(BOWL);
            expect(Array.from(a.vertices)).toEqual(Array.from(b.vertices));
            expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
        });

        it('has no large face-normal discontinuity across the dish->fillet seam', () => {
            const { vertices, indices, params } = buildBowlGrid(BOWL);

            const faceNormal = (ia, ib, ic) => {
                const ax = vertices[ia * 3], ay = vertices[ia * 3 + 1], az = vertices[ia * 3 + 2];
                const bx = vertices[ib * 3], by = vertices[ib * 3 + 1], bz = vertices[ib * 3 + 2];
                const cx = vertices[ic * 3], cy = vertices[ic * 3 + 1], cz = vertices[ic * 3 + 2];
                const ux = bx - ax, uy = by - ay, uz = bz - az;
                const vx = cx - ax, vy = cy - ay, vz = cz - az;
                let nx = uy * vz - uz * vy;
                let ny = uz * vx - ux * vz;
                let nz = ux * vy - uy * vx;
                const len = Math.hypot(nx, ny, nz) || 1;
                nx /= len; ny /= len; nz /= len;
                if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // orient upward
                return [nx, ny, nz];
            };

            // Walk consecutive triangles; the largest angle between neighbouring
            // face normals on this smooth surface must stay small (no crease).
            let maxAngleDeg = 0;
            let prev = null;
            for (let t = 0; t + 5 < indices.length; t += 3) {
                const n = faceNormal(indices[t], indices[t + 1], indices[t + 2]);
                if (prev) {
                    const dot = Math.min(1, Math.max(-1, prev[0] * n[0] + prev[1] * n[1] + prev[2] * n[2]));
                    maxAngleDeg = Math.max(maxAngleDeg, (Math.acos(dot) * 180) / Math.PI);
                }
                prev = n;
            }
            // Generous threshold: the rim turns steep, but there is no hard
            // crease (the old flat-floor/wall join was a ~60deg dihedral).
            expect(maxAngleDeg).toBeLessThan(45);
            expect(params.r1).toBeGreaterThan(0);
        });
    });

    it('exposes a cross-section for diagnostics (floor/fillet zones + slope)', () => {
        const rp = resolveBowlParams(BOWL);
        const xs = bowlCrossSection(rp, 16);
        expect(xs[0]).toMatchObject({ zone: 'dish' });
        expect(xs[xs.length - 1].zone).toBe('fillet');
        expect(xs.every((s) => Number.isFinite(s.r) && Number.isFinite(s.y))).toBe(true);
        expect(BOWL_DEFAULTS.diameter).toBe(80);
    });
});
