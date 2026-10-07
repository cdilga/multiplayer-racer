//! Terrain undulation (P1-M03c): the algorithm P1-M02 recommended (`route`), as production code with limits.
//!
//! The route gets a closed height profile with a bounded grade and vertical curvature; corners are banked where they
//! turn; the road bed is level across its width (tilted by the bank) and the ground off the road blends from the road's
//! height into fBm value noise over a per-biome distance.
//!
//! - **The profile is designed in the derivative domain.** Three sines whose cycle counts divide the loop give a slope
//!   `p0'(s)`. Slope is damped in tight corners by `f = 1 - |κ|·half` (the inner edge of a corner is shorter than the
//!   centerline, so the same rise is steeper there), the mean is removed so the loop closes exactly, and the whole is
//!   scaled so the steepest *inner-edge* grade, the vertical curvature and the relief all sit inside the biome's limits.
//! - **Banking** follows the signed plan curvature (positive bank = the left edge is lower, a left turn), is smoothed and
//!   rate-limited so the road's edges never get steeper than the grade budget, and is stored on the route points.
//! - **Off-road heights** are an inverse-distance blend of every nearby route point's tilted bed plane (so two road
//!   parts that pass close ramp smoothly between them, and a hairpin's interior has no cliff), faded into noise.
//!
//! Output is integer (centimetre heights, millimetre route `y`, centidegree bank); the maths is `libm` and plain `f64`
//! operations in a fixed order, so the bytes are identical natively and in WASM. The stream is `Streams::terrain`.

use jj_map::{Biome, Map, Terrain};

use crate::assemble::arc_lengths;
use crate::seed::Rng;

/// Share of the biome's grade limit the centerline profile may use (inner edge included).
pub const PROFILE_GRADE_SHARE: f64 = 0.55;
/// Share the bank's change of cross slope may add at an edge. The rest absorbs centimetre quantisation.
pub const BANK_GRADE_SHARE: f64 = 0.25;
/// Share of the curvature limit the profile may use (the rest absorbs the damping's kinks and quantisation).
pub const CURVATURE_SHARE: f64 = 0.8;
/// A corner this tight (radius 1/κ, m) gets the biome's full bank.
pub const FULL_BANK_RADIUS_M: f64 = 40.0;
/// The road bed extends this many grid spacings past the road edge, so every vertex a road point's cell touches is bed.
const BED_SPACINGS: f64 = 1.5;
/// Extra distance past `bed + blend` that route points still reach, so no cell inside the blend has an empty sum.
const REACH_EXTRA_M: f64 = 8.0;

/// A biome's terrain, as data. `max_grade` is rise over run along the road band (centerline and both edges);
/// `max_curvature` is 1/radius of the vertical profile; `max_bank_cdeg` is the largest road bank.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainParams {
    /// Peak-to-peak road height budget, m (the grade and curvature limits usually bind first).
    pub relief_m: f64,
    /// Amplitude of the off-road noise, m.
    pub ground_relief_m: f64,
    pub wavelength_m: f64,
    pub max_grade: f64,
    pub max_curvature: f64,
    pub max_bank_cdeg: i16,
    /// Distance over which the ground fades from the road bed into noise, m.
    pub blend_m: f64,
}

/// The biome's terrain data (each biome's numbers live in its own `biome/<name>.rs`).
pub fn params(biome: Biome) -> TerrainParams {
    crate::biome::def(biome).data().terrain
}

impl TerrainParams {
    /// Blend toward `to` by `t` in 0..=1 (a transition between biomes).
    pub fn lerp(&self, to: &Self, t: f64) -> Self {
        let m = |a: f64, b: f64| a + (b - a) * t;
        Self {
            relief_m: m(self.relief_m, to.relief_m),
            ground_relief_m: m(self.ground_relief_m, to.ground_relief_m),
            wavelength_m: m(self.wavelength_m, to.wavelength_m),
            max_grade: m(self.max_grade, to.max_grade),
            max_curvature: m(self.max_curvature, to.max_curvature),
            max_bank_cdeg: libm::round(m(
                f64::from(self.max_bank_cdeg),
                f64::from(to.max_bank_cdeg),
            )) as i16,
            blend_m: m(self.blend_m, to.blend_m),
        }
    }
}

/// Applies undulation to `map`: heights, route `y` and `bank`, and every dressing and prop pose's `y` (grounded).
/// Idempotent: it overwrites what an earlier call set.
pub fn undulate(map: &mut Map, rng: &mut Rng, p: &TerrainParams) {
    undulate_along(map, rng, &vec![*p; map.route.points.len()]);
}

/// [`undulate`] with a biome's parameters at every route point (`along[i]` for point `i`), for a route that crosses
/// biomes. The profile's relief, grade and curvature limits are the strictest along the route (so every stretch stays
/// inside its own biome's limits); the bank limit follows each point; ground relief, wavelength and blend distance are
/// blended smoothly into the cells around the road by the same inverse-distance weights as the heights, so there is no
/// step where two biomes meet.
pub fn undulate_along(map: &mut Map, rng: &mut Rng, along: &[TerrainParams]) {
    let min = |f: &dyn Fn(&TerrainParams) -> f64| along.iter().map(f).fold(f64::INFINITY, f64::min);
    let p = &TerrainParams {
        relief_m: min(&|q| q.relief_m),
        max_grade: min(&|q| q.max_grade),
        max_curvature: min(&|q| q.max_curvature),
        blend_m: along.iter().map(|q| q.blend_m).fold(0.0, f64::max),
        ..along[0]
    };
    let uniform = along.windows(2).all(|w| w[0] == w[1]);
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let n = pts.len();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let (s, total) = arc_lengths(&pts);
    let ds: Vec<f64> = (0..n)
        .map(|i| {
            if i + 1 < n {
                s[i + 1] - s[i]
            } else {
                total - s[i]
            }
        })
        .collect();

    // Plan curvature, signed (+ = turning left), at each point, smoothed over a few points.
    let tangent = |i: usize| {
        let (a, b) = (pts[i], pts[(i + 1) % n]);
        let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    };
    let raw_k: Vec<f64> = (0..n)
        .map(|i| {
            let (t0, t1) = (tangent((i + n - 1) % n), tangent(i));
            let turn = libm::atan2(t1.0 * t0.1 - t1.1 * t0.0, t0.0 * t1.0 + t0.1 * t1.1);
            turn / ((ds[(i + n - 1) % n] + ds[i]) / 2.0).max(1e-9)
        })
        .collect();
    let kappa = circular_mean(&raw_k, 3);
    // Largest |κ| within the road's half width either side: the inner edge's worst squeeze.
    let reach = libm::ceil(half / (total / n as f64)) as usize + 1;
    let k_edge: Vec<f64> = (0..n)
        .map(|i| {
            (0..=2 * reach)
                .map(|j| kappa[(i + n + j - reach) % n].abs())
                .fold(0.0, f64::max)
        })
        .collect();
    // Slope damping per segment i (point i to i+1).
    let f: Vec<f64> = (0..n)
        .map(|i| {
            let k = k_edge[i].max(k_edge[(i + 1) % n]);
            (1.0 - k * half).clamp(0.05, 1.0)
        })
        .collect();

    // Unit-gain slope: three sines (cycle counts are integers, so the loop closes), damped, mean removed.
    let waves: Vec<(f64, f64, f64)> = (0..3)
        .map(|k| {
            let cycles = (2 + 2 * k) as f64 + libm::floor(rng.range(0.0, 2.0));
            (
                cycles,
                rng.range(0.0, core::f64::consts::TAU),
                1.0 / (1.0 + k as f64),
            )
        })
        .collect();
    let slope0 = |sm: f64| -> f64 {
        waves
            .iter()
            .map(|&(c, ph, a)| {
                let w = core::f64::consts::TAU * c / total;
                a * w * libm::cos(w * sm + ph)
            })
            .sum()
    };
    let raw: Vec<f64> = (0..n).map(|i| slope0(s[i] + ds[i] / 2.0)).collect();
    let (mut num, mut den) = (0.0, 0.0);
    for i in 0..n {
        num += f[i] * raw[i] * ds[i];
        den += f[i] * ds[i];
    }
    let mean = num / den.max(1e-9);
    let d: Vec<f64> = (0..n).map(|i| f[i] * (raw[i] - mean)).collect();
    let mut h = vec![0.0; n];
    for i in 1..n {
        h[i] = h[i - 1] + d[i - 1] * ds[i - 1];
    }
    let lo = h.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = h.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let steepest = (0..n).map(|i| d[i].abs() / f[i]).fold(1e-12, f64::max);
    let sharpest = (0..n)
        .map(|i| {
            (d[i] - d[(i + n - 1) % n]).abs() / ((ds[i] + ds[(i + n - 1) % n]) / 2.0).max(1e-9)
        })
        .fold(1e-12, f64::max);
    let gain = (p.relief_m / (hi - lo).max(1e-9))
        .min(PROFILE_GRADE_SHARE * p.max_grade / steepest)
        .min(CURVATURE_SHARE * p.max_curvature / sharpest);
    let h: Vec<f64> = h.iter().map(|v| v * gain).collect();

    // Bank (as tan of the angle): toward the corner, then rate-limited so the edges stay inside the grade budget.
    let target: Vec<f64> = (0..n)
        .map(|i| {
            let max_tan =
                libm::tan(f64::from(along[i].max_bank_cdeg) * core::f64::consts::PI / 18_000.0);
            max_tan * (kappa[i] * FULL_BANK_RADIUS_M).clamp(-1.0, 1.0)
        })
        .collect();
    let rate = BANK_GRADE_SHARE * p.max_grade / half;
    let mut bank = target;
    for _ in 0..3 {
        for i in 0..2 * n {
            let (a, b) = (i % n, (i + 1) % n);
            let lim = rate * ds[a] * f[a];
            bank[b] = bank[b].clamp(bank[a] - lim, bank[a] + lim);
        }
        for i in (0..2 * n).rev() {
            let (a, b) = (i % n, (i + n - 1) % n);
            let lim = rate * ds[b] * f[b];
            bank[b] = bank[b].clamp(bank[a] - lim, bank[a] + lim);
        }
    }
    // The stored bank is what the heights use, so the route and the heightfield agree.
    let bank_cdeg: Vec<i16> = bank
        .iter()
        .map(|&t| libm::round(libm::atan(t) * 18_000.0 / core::f64::consts::PI) as i16)
        .collect();
    let bank: Vec<f64> = bank_cdeg
        .iter()
        .map(|&c| libm::tan(f64::from(c) * core::f64::consts::PI / 18_000.0))
        .collect();

    // Bank sign (jj.map.v1 `bank`, centidegrees): positive leans the road toward its LEFT, i.e. the left edge is the
    // lower one, which is what a left-hand corner wants. "Left" is the left of travel; with the sim's handedness (+y up,
    // a car facing +z has +x on its left) that is the (tz, -tx) side of the tangent, and `lateral` in the validator's
    // `Near` (positive on (-tz, tx)) is the right. A right-hand corner gets a negative bank.
    for (i, q) in map.route.points.iter_mut().enumerate() {
        q.y = libm::round(h[i] * 1000.0) as i32;
        q.bank = bank_cdeg[i];
    }

    // Heightfield.
    let t = &map.terrain;
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let bed = half + BED_SPACINGS * sp;
    let reach_m = bed + p.blend_m + REACH_EXTRA_M;
    let kernel = |d2: f64| 1.0 / ((d2 + 1.0) * (d2 + 1.0) * (d2 + 1.0));
    let edge = kernel(reach_m * reach_m);
    let mut wsum = vec![0.0f64; cols * rows];
    let mut hsum = vec![0.0f64; cols * rows];
    let mut dmin = vec![f64::INFINITY; cols * rows];
    // Ground relief, wavelength and blend per cell: the same weights, so biome changes are continuous.
    let mut gsum = vec![[0.0f64; 3]; if uniform { 0 } else { cols * rows }];
    for i in 0..n {
        let (px, pz) = pts[i];
        let (tx, tz) = tangent(i);
        // Unit vector toward the right of travel (+ lateral); the left edge is lower for positive bank.
        let (nx, nz) = (-tz, tx);
        let c0 = libm::floor(((px - reach_m - ox) / sp).max(0.0)) as usize;
        let c1 = (libm::ceil(((px + reach_m - ox) / sp).max(0.0)) as usize).min(cols - 1);
        let r0 = libm::floor(((pz - reach_m - oz) / sp).max(0.0)) as usize;
        let r1 = (libm::ceil(((pz + reach_m - oz) / sp).max(0.0)) as usize).min(rows - 1);
        for r in r0..=r1 {
            for c in c0..=c1 {
                let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
                let d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
                if d2 >= reach_m * reach_m {
                    continue;
                }
                let w = kernel(d2) - edge;
                let lateral = ((x - px) * nx + (z - pz) * nz).clamp(-half, half);
                let at = r * cols + c;
                wsum[at] += w;
                hsum[at] += w * (h[i] + lateral * bank[i]);
                if !uniform {
                    let q = &along[i];
                    gsum[at][0] += w * q.ground_relief_m;
                    gsum[at][1] += w * q.wavelength_m;
                    gsum[at][2] += w * q.blend_m;
                }
                dmin[at] = dmin[at].min(d2);
            }
        }
    }
    let nseed = rng.next_u64();
    let mut heights = Vec::with_capacity(cols * rows);
    for r in 0..rows {
        for c in 0..cols {
            let at = r * cols + c;
            let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
            let (relief, wavelength, blend) = if uniform || wsum[at] <= 0.0 {
                (along[0].ground_relief_m, along[0].wavelength_m, p.blend_m)
            } else {
                let g = gsum[at];
                (g[0] / wsum[at], g[1] / wsum[at], g[2] / wsum[at])
            };
            let ground = relief * fbm(nseed, x, z, wavelength);
            let v = if wsum[at] > 0.0 {
                let road = hsum[at] / wsum[at];
                let k = ((libm::sqrt(dmin[at]) - bed) / blend).clamp(0.0, 1.0);
                let k = k * k * (3.0 - 2.0 * k);
                road + (ground - road) * k
            } else {
                ground
            };
            heights.push(libm::round(v * 100.0) as i16);
        }
    }
    map.terrain.heights = heights;

    // Everything placed stands on the ground.
    let terrain = map.terrain.clone();
    for pose in map
        .dressing
        .iter_mut()
        .map(|d| &mut d.pose)
        .chain(map.props.iter_mut().map(|q| &mut q.pose))
    {
        let y = ground_height_m(
            &terrain,
            f64::from(pose.x) / 1000.0,
            f64::from(pose.z) / 1000.0,
        );
        pose.y = libm::round(y * 1000.0) as i32;
    }
}

/// The ground height (m) at world `(x, z)` m, bilinear on the heightfield the way the car drives it (clamped to the
/// grid's edge).
pub fn ground_height_m(t: &Terrain, x: f64, z: f64) -> f64 {
    let sp = f64::from(t.spacing) / 1000.0;
    let c = ((x - f64::from(t.origin_x) / 1000.0) / sp).clamp(0.0, f64::from(t.cols - 1));
    let r = ((z - f64::from(t.origin_z) / 1000.0) / sp).clamp(0.0, f64::from(t.rows - 1));
    let (c0, r0) = (libm::floor(c) as usize, libm::floor(r) as usize);
    let (c1, r1) = (
        (c0 + 1).min(t.cols as usize - 1),
        (r0 + 1).min(t.rows as usize - 1),
    );
    let (fc, fr) = (c - c0 as f64, r - r0 as f64);
    let g = |cc: usize, rr: usize| f64::from(t.heights[rr * t.cols as usize + cc]) / 100.0;
    let top = g(c0, r0) + (g(c1, r0) - g(c0, r0)) * fc;
    let bot = g(c0, r1) + (g(c1, r1) - g(c0, r1)) * fc;
    top + (bot - top) * fr
}

/// Mean over `±w` neighbours on a closed loop.
fn circular_mean(v: &[f64], w: usize) -> Vec<f64> {
    let n = v.len();
    (0..n)
        .map(|i| (0..=2 * w).map(|j| v[(i + n + j - w) % n]).sum::<f64>() / (2 * w + 1) as f64)
        .collect()
}

fn hash2(seed: u64, x: i64, z: i64) -> f64 {
    let mut h = seed
        ^ (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (z as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    h ^= h >> 33;
    h = h.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    h ^= h >> 33;
    h = h.wrapping_mul(0xC4CE_B9FE_1A85_EC53);
    h ^= h >> 33;
    (h >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
}

/// Smooth value noise in [-1, 1].
fn value_noise(seed: u64, x: f64, z: f64) -> f64 {
    let (xi, zi) = (libm::floor(x), libm::floor(z));
    let (fx, fz) = (x - xi, z - zi);
    let sm = |t: f64| t * t * (3.0 - 2.0 * t);
    let (sx, sz) = (sm(fx), sm(fz));
    let (xi, zi) = (xi as i64, zi as i64);
    let (a, b) = (hash2(seed, xi, zi), hash2(seed, xi + 1, zi));
    let (c, d) = (hash2(seed, xi, zi + 1), hash2(seed, xi + 1, zi + 1));
    let top = a + (b - a) * sx;
    let bot = c + (d - c) * sx;
    top + (bot - top) * sz
}

/// Three-octave fBm value noise, amplitude about 1.
fn fbm(seed: u64, x: f64, z: f64, wavelength: f64) -> f64 {
    let mut sum = 0.0;
    let (mut amp, mut freq) = (1.0, 1.0 / wavelength);
    for o in 0..3u64 {
        sum += amp * value_noise(seed.wrapping_add(o * 7919), x * freq, z * freq);
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / 1.75
}
