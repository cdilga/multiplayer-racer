/**
 * terrain.js - Shared deterministic dunes terrain generator.
 *
 * The visual mesh (TrackFactory) and the physics trimesh (PhysicsSystem) are
 * both built from the SAME vertex grid produced here, so they always line up
 * exactly - no heightfield index-convention guesswork, no drift between what
 * you see and what you collide with.
 */

export const DUNES_DEFAULTS = {
    radius: 70,        // arena radius (terrain + containment wall)
    segments: 48,      // grid resolution (segments x segments quads)
    amp: 1.4,          // rolling bump amplitude
    freq: 0.07,        // bump spatial frequency
    base: 1.8,         // vertical offset so terrain never dips below ~0.4
    rimStart: 50,      // radius where the climbable rim begins to rise
    rimHeight: 7       // how high the rim rises at the arena edge
};

/**
 * Height of the terrain at a world (x, z) point. Deterministic - no RNG - so
 * physics and visuals agree and replays/tests are stable.
 * @param {number} x
 * @param {number} z
 * @param {Object} p - resolved params (see DUNES_DEFAULTS)
 * @returns {number} world-space height (y)
 */
export function dunesHeight(x, z, p) {
    const r = Math.sqrt(x * x + z * z);

    // Two octaves of rolling dunes - enough variation to get air over crests
    let h = p.base + p.amp * (
        Math.sin(x * p.freq) * Math.cos(z * p.freq) +
        0.5 * Math.sin(x * p.freq * 2.3 + 1.7) * Math.cos(z * p.freq * 1.7 - 0.9)
    );

    // Climbable rim: the ground curves up toward the edge so cars can ride up
    // and launch. Quadratic ramp from rimStart out to the arena radius.
    if (r > p.rimStart) {
        const t = Math.min(1, (r - p.rimStart) / (p.radius - p.rimStart));
        h += t * t * p.rimHeight;
    }

    return h;
}

/**
 * Build the dunes vertex grid in world space. Both the render mesh and the
 * physics trimesh consume these arrays directly.
 * @param {Object} [params] - overrides for DUNES_DEFAULTS
 * @returns {{ vertices: Float32Array, indices: Uint32Array, params: Object }}
 */
export function buildDunesGrid(params = {}) {
    const p = { ...DUNES_DEFAULTS, ...params };
    const n = p.segments;
    const span = p.radius * 2;
    const half = p.radius;
    const cols = n + 1;

    const vertices = new Float32Array(cols * cols * 3);
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
            const x = -half + (i / n) * span;
            const z = -half + (j / n) * span;
            const idx = (i * cols + j) * 3;
            vertices[idx] = x;
            vertices[idx + 1] = dunesHeight(x, z, p);
            vertices[idx + 2] = z;
        }
    }

    const indices = [];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const a = i * cols + j;
            const b = a + 1;
            const c = (i + 1) * cols + j;
            const d = c + 1;
            // Two triangles per quad (CCW so normals face up)
            indices.push(a, c, b, b, c, d);
        }
    }

    return { vertices, indices: new Uint32Array(indices), params: p };
}

// Expose globally for any non-module consumer
if (typeof window !== 'undefined') {
    window.MR_terrain = { dunesHeight, buildDunesGrid, DUNES_DEFAULTS };
}
