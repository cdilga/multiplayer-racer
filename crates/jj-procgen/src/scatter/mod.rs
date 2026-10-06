//! Dressing scatter (P1-M03e): natural-looking seeded placement of kit pieces around the route, from the dressing stream.
//!
//! Two point distributions, chosen per biome as data ([`Algorithm`]; P1-M02's recommendation):
//! - **Poisson-disc** (Bridson): even cover with a minimum spacing; no clumps.
//! - **Cluster** (Thomas process): Poisson parents, each with a random number of Gaussian-scattered children: clumps
//!   separated by clearings.
//!
//! Which kit pieces a biome scatters is the biome beads' business (M04-M07); [`spec`] holds placeholder tables over the
//! generic kit until they land. What this module guarantees for any table:
//! - **Clearance:** a piece's whole footprint (its circumradius) is at least [`CLEAR_M`] and its setback minimum from the
//!   road edge, so nothing sits in the route band, on a painted road cell, in the start corridor or on a jump landing,
//!   and tall pieces keep the validator's chase-camera margin. The route is never moved to suit the scatter.
//! - **Spacing:** no two pieces' footprints overlap.
//! - **No caps:** the number of pieces follows from the distribution's parameters and the map's area, never a budget.
//!
//! Integers out, `libm` maths in a fixed order: identical natively and in WASM. Call after features, so placed pieces
//! stand on the final ground.

use std::collections::BTreeMap;

use jj_map::{Biome, Dressing, Footprint, Map, Pose, Registry};

use crate::seed::Rng;
use crate::terrain::ground_height_m;

/// Nothing's footprint comes closer than this to the road edge, whatever its setback: the validator's camera margin
/// (2 m) plus slack for the mm rounding of the route.
pub const CLEAR_M: f64 = 2.5;
/// Footprints keep at least this much air between them.
pub const GAP_M: f64 = 0.5;
/// How many times a Bridson parent tries to place a neighbour.
const TRIES: usize = 30;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Algorithm {
    /// Minimum centre spacing, m.
    Poisson { radius_m: f64 },
    /// Parents at least `parent_radius_m` apart, each with `children` (inclusive range) pieces at Gaussian `sigma_m`.
    Cluster {
        parent_radius_m: f64,
        children: (u32, u32),
        sigma_m: f64,
    },
}

/// A kit piece a biome scatters: its weight, parameter ranges (inclusive, integers in the kit's units) and the band of
/// distances from the road edge to its footprint where it may stand.
#[derive(Clone, Copy, Debug)]
pub struct PieceSpec {
    pub kit_piece: &'static str,
    pub weight: f64,
    pub params: &'static [(&'static str, i64, i64)],
    pub setback_m: (f64, f64),
    pub collides: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Spec {
    pub algorithm: Algorithm,
    pub pieces: &'static [PieceSpec],
}

const fn piece(
    kit_piece: &'static str,
    weight: f64,
    params: &'static [(&'static str, i64, i64)],
    setback_m: (f64, f64),
    collides: bool,
) -> PieceSpec {
    PieceSpec {
        kit_piece,
        weight,
        params,
        setback_m,
        collides,
    }
}

const TOWN: &[PieceSpec] = &[
    piece(
        "generic/box-building",
        5.0,
        &[
            ("widthMm", 8_000, 18_000),
            ("depthMm", 6_000, 12_000),
            ("heightCm", 350, 900),
        ],
        (3.0, 150.0),
        true,
    ),
    piece(
        "generic/post",
        2.0,
        &[("heightCm", 400, 700), ("radiusMm", 130, 200)],
        (3.0, 6.0),
        true,
    ),
];
const ROCKS: &[PieceSpec] = &[
    piece(
        "generic/box-building",
        3.0,
        &[
            ("widthMm", 18_000, 42_000),
            ("depthMm", 16_000, 36_000),
            ("heightCm", 900, 2_400),
        ],
        (18.0, 90.0),
        true,
    ),
    piece(
        "generic/post",
        2.0,
        &[("heightCm", 80, 200), ("radiusMm", 300, 600)],
        (4.0, 40.0),
        true,
    ),
];
const DIRT: &[PieceSpec] = &[
    piece(
        "generic/post",
        6.0,
        &[("heightCm", 60, 160), ("radiusMm", 250, 550)],
        (3.0, 70.0),
        false,
    ),
    piece(
        "generic/box-building",
        0.3,
        &[
            ("widthMm", 6_000, 10_000),
            ("depthMm", 5_000, 8_000),
            ("heightCm", 300, 450),
        ],
        (20.0, 60.0),
        true,
    ),
];
const BITUMEN: &[PieceSpec] = &[
    piece(
        "generic/post",
        4.0,
        &[("heightCm", 100, 140), ("radiusMm", 60, 90)],
        (4.0, 8.0),
        false,
    ),
    piece(
        "generic/box-building",
        0.6,
        &[
            ("widthMm", 6_000, 12_000),
            ("depthMm", 5_000, 9_000),
            ("heightCm", 300, 500),
        ],
        (25.0, 70.0),
        true,
    ),
    piece(
        "generic/post",
        3.0,
        &[("heightCm", 50, 120), ("radiusMm", 250, 500)],
        (8.0, 80.0),
        false,
    ),
];

/// A biome's scatter (placeholder pieces over the generic kit). Town and rocks clump, dirt and bitumen are even; bitumen's
/// Poisson radius is the one the P1-M03e evidence settled (see `docs/evidence/P1-M03e/`).
pub fn spec(biome: Biome) -> Spec {
    match biome {
        Biome::Town => Spec {
            algorithm: Algorithm::Cluster {
                parent_radius_m: 120.0,
                children: (10, 30),
                sigma_m: 14.0,
            },
            pieces: TOWN,
        },
        Biome::Rocks => Spec {
            algorithm: Algorithm::Cluster {
                parent_radius_m: 150.0,
                children: (10, 30),
                sigma_m: 22.0,
            },
            pieces: ROCKS,
        },
        Biome::OutbackDirt => Spec {
            algorithm: Algorithm::Poisson { radius_m: 9.0 },
            pieces: DIRT,
        },
        Biome::OutbackBitumen | Biome::Greybox => Spec {
            algorithm: Algorithm::Poisson {
                radius_m: BITUMEN_RADIUS_M,
            },
            pieces: BITUMEN,
        },
    }
}

/// Bitumen's Poisson radius, m (M02 recommended "a larger radius than the 12 m the spike drew with").
pub const BITUMEN_RADIUS_M: f64 = 18.0;

/// Fast "how far is this point from the route": segments bucketed on a grid, searched in rings.
struct RoadIndex {
    pts: Vec<(f64, f64)>,
    cell: f64,
    x0: f64,
    z0: f64,
    cols: usize,
    rows: usize,
    buckets: Vec<Vec<u32>>,
}

impl RoadIndex {
    fn new(pts: Vec<(f64, f64)>, x0: f64, z0: f64, w: f64, h: f64) -> Self {
        let cell = 16.0;
        let (cols, rows) = (
            libm::ceil(w / cell) as usize + 1,
            libm::ceil(h / cell) as usize + 1,
        );
        let mut buckets = vec![Vec::new(); cols * rows];
        let n = pts.len();
        for i in 0..n {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            let c = |v: f64, o: f64, max: usize| {
                ((libm::floor((v - o) / cell)).max(0.0) as usize).min(max - 1)
            };
            for r in c(a.1.min(b.1), z0, rows)..=c(a.1.max(b.1), z0, rows) {
                for cc in c(a.0.min(b.0), x0, cols)..=c(a.0.max(b.0), x0, cols) {
                    buckets[r * cols + cc].push(i as u32);
                }
            }
        }
        Self {
            pts,
            cell,
            x0,
            z0,
            cols,
            rows,
            buckets,
        }
    }

    fn seg_distance(&self, i: usize, p: (f64, f64)) -> f64 {
        let n = self.pts.len();
        let (a, b) = (self.pts[i], self.pts[(i + 1) % n]);
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let len2 = dx * dx + dz * dz;
        let t = if len2 == 0.0 {
            0.0
        } else {
            (((p.0 - a.0) * dx + (p.1 - a.1) * dz) / len2).clamp(0.0, 1.0)
        };
        libm::hypot(p.0 - (a.0 + t * dx), p.1 - (a.1 + t * dz))
    }

    /// Distance from `p` to the nearest route segment.
    fn distance(&self, p: (f64, f64)) -> f64 {
        let cx = (libm::floor((p.0 - self.x0) / self.cell) as i64).clamp(0, self.cols as i64 - 1);
        let cz = (libm::floor((p.1 - self.z0) / self.cell) as i64).clamp(0, self.rows as i64 - 1);
        let mut best = f64::INFINITY;
        let max_ring = self.cols.max(self.rows) as i64;
        for ring in 0..=max_ring {
            for r in (cz - ring).max(0)..=(cz + ring).min(self.rows as i64 - 1) {
                for c in (cx - ring).max(0)..=(cx + ring).min(self.cols as i64 - 1) {
                    if (r - cz).abs().max((c - cx).abs()) != ring {
                        continue;
                    }
                    for &i in &self.buckets[r as usize * self.cols + c as usize] {
                        best = best.min(self.seg_distance(i as usize, p));
                    }
                }
            }
            // Everything in a farther ring is at least `ring * cell` away.
            if best <= ring as f64 * self.cell {
                break;
            }
        }
        best
    }
}

/// Bridson Poisson-disc points in the rectangle, at least `r` apart.
fn poisson(rng: &mut Rng, x0: f64, z0: f64, w: f64, h: f64, r: f64) -> Vec<(f64, f64)> {
    let cell = r / core::f64::consts::SQRT_2;
    let (gw, gh) = (
        libm::floor(w / cell) as usize + 1,
        libm::floor(h / cell) as usize + 1,
    );
    let mut grid: Vec<Option<usize>> = vec![None; gw * gh];
    let mut out: Vec<(f64, f64)> = Vec::new();
    let mut active: Vec<usize> = Vec::new();
    let at = |p: (f64, f64)| {
        (
            (libm::floor((p.0 - x0) / cell) as usize).min(gw - 1),
            (libm::floor((p.1 - z0) / cell) as usize).min(gh - 1),
        )
    };
    let first = (x0 + rng.range(0.0, w), z0 + rng.range(0.0, h));
    let (gx, gz) = at(first);
    grid[gz * gw + gx] = Some(0);
    out.push(first);
    active.push(0);
    while !active.is_empty() {
        let k = (rng.next_u64() % active.len() as u64) as usize;
        let base = out[active[k]];
        let mut found = false;
        for _ in 0..TRIES {
            let a = rng.range(0.0, core::f64::consts::TAU);
            let d = rng.range(r, 2.0 * r);
            let p = (base.0 + d * libm::cos(a), base.1 + d * libm::sin(a));
            if p.0 < x0 || p.1 < z0 || p.0 >= x0 + w || p.1 >= z0 + h {
                continue;
            }
            let (px, pz) = at(p);
            let mut ok = true;
            'n: for nz in pz.saturating_sub(2)..(pz + 3).min(gh) {
                for nx in px.saturating_sub(2)..(px + 3).min(gw) {
                    if let Some(j) = grid[nz * gw + nx] {
                        let q = out[j];
                        if (q.0 - p.0) * (q.0 - p.0) + (q.1 - p.1) * (q.1 - p.1) < r * r {
                            ok = false;
                            break 'n;
                        }
                    }
                }
            }
            if ok {
                grid[pz * gw + px] = Some(out.len());
                active.push(out.len());
                out.push(p);
                found = true;
                break;
            }
        }
        if !found {
            active.swap_remove(k);
        }
    }
    out
}

/// Candidate centres for the algorithm over the rectangle.
fn candidates(alg: Algorithm, rng: &mut Rng, x0: f64, z0: f64, w: f64, h: f64) -> Vec<(f64, f64)> {
    match alg {
        Algorithm::Poisson { radius_m } => poisson(rng, x0, z0, w, h, radius_m),
        Algorithm::Cluster {
            parent_radius_m,
            children: (lo, hi),
            sigma_m,
        } => {
            let mut out = Vec::new();
            for p in poisson(rng, x0, z0, w, h, parent_radius_m) {
                let kids = lo + (rng.next_u64() % u64::from(hi - lo + 1)) as u32;
                for _ in 0..kids {
                    // Box-Muller.
                    let (u1, u2) = (rng.unit().max(1e-12), rng.unit());
                    let m = sigma_m * libm::sqrt(-2.0 * libm::log(u1));
                    out.push((
                        p.0 + m * libm::cos(core::f64::consts::TAU * u2),
                        p.1 + m * libm::sin(core::f64::consts::TAU * u2),
                    ));
                }
            }
            out
        }
    }
}

/// The footprint's circumradius, m.
pub fn reach_m(fp: &Footprint) -> f64 {
    match *fp {
        Footprint::Rect { x, z, .. } => libm::hypot(x, z) / 2000.0,
        Footprint::Circle { radius, .. } => radius / 1000.0,
    }
}

/// Replaces `map.dressing` with the spec's scatter: clear of the road, the start corridor and each other, standing on
/// the ground. Draws only from `rng` (the dressing stream).
pub fn scatter(map: &mut Map, rng: &mut Rng, spec: &Spec, registry: &Registry) {
    map.dressing.clear();
    let b = map.header.bounds;
    let (x0, z0) = (f64::from(b.min_x) / 1000.0, f64::from(b.min_z) / 1000.0);
    let (w, h) = (
        f64::from(b.max_x - b.min_x) / 1000.0,
        f64::from(b.max_z - b.min_z) / 1000.0,
    );
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let road = RoadIndex::new(pts, x0, z0, w, h);
    let total_weight: f64 = spec.pieces.iter().map(|p| p.weight).sum();

    // Placed footprints, bucketed for the overlap test.
    let cell = 24.0;
    let (gc, gr) = (
        libm::ceil(w / cell) as usize + 1,
        libm::ceil(h / cell) as usize + 1,
    );
    let mut placed: Vec<Vec<(f64, f64, f64)>> = vec![Vec::new(); gc * gr];
    let max_reach = 60.0;

    for c in candidates(spec.algorithm, rng, x0, z0, w, h) {
        // Every draw happens whether or not the candidate survives, so one rejection never shifts the stream.
        let mut u = rng.unit() * total_weight;
        let piece = spec
            .pieces
            .iter()
            .find(|p| {
                u -= p.weight;
                u <= 0.0
            })
            .unwrap_or(&spec.pieces[0]);
        let params: BTreeMap<String, i64> = piece
            .params
            .iter()
            .map(|&(k, lo, hi)| {
                (
                    k.to_string(),
                    lo + (rng.next_u64() % (hi - lo + 1) as u64) as i64,
                )
            })
            .collect();
        let yaw = (rng.next_u64() % 36_000) as i32;
        if c.0 < x0 || c.1 < z0 || c.0 > x0 + w || c.1 > z0 + h {
            continue;
        }
        let Some(fp) = registry
            .get(piece.kit_piece)
            .and_then(|k| k.footprint(&params))
        else {
            continue;
        };
        let reach = reach_m(&fp);
        let edge = road.distance(c) - half;
        if edge - reach < piece.setback_m.0.max(CLEAR_M) || edge > piece.setback_m.1 + reach {
            continue;
        }
        // The whole footprint (and the piece's own reach) stays inside the bounds the validator checks.
        if c.0 - reach < x0 || c.1 - reach < z0 || c.0 + reach > x0 + w || c.1 + reach > z0 + h {
            continue;
        }
        let (gx, gz) = (((c.0 - x0) / cell) as usize, ((c.1 - z0) / cell) as usize);
        let span = libm::ceil((reach + max_reach) / cell) as usize;
        let clash = (gz.saturating_sub(span)..=(gz + span).min(gr - 1)).any(|r| {
            (gx.saturating_sub(span)..=(gx + span).min(gc - 1)).any(|cc| {
                placed[r * gc + cc]
                    .iter()
                    .any(|&(px, pz, pr)| libm::hypot(c.0 - px, c.1 - pz) < reach + pr + GAP_M)
            })
        });
        if clash {
            continue;
        }
        placed[gz * gc + gx].push((c.0, c.1, reach));
        // Poses are whole millimetres, and the ground is read at that rounded spot (what a later re-grounding reads).
        let (px, pz) = (
            libm::round(c.0 * 1000.0) as i32,
            libm::round(c.1 * 1000.0) as i32,
        );
        let y = ground_height_m(&map.terrain, f64::from(px) / 1000.0, f64::from(pz) / 1000.0);
        map.dressing.push(Dressing {
            kit_piece: piece.kit_piece.into(),
            pose: Pose {
                x: px,
                y: libm::round(y * 1000.0) as i32,
                z: pz,
                yaw,
            },
            params,
            collides: piece.collides,
        });
    }
    map.dressing.sort();
}

/// Clark-Evans ratio: mean nearest-neighbour distance over the `0.5 / sqrt(density)` a random scatter of the same
/// density would have, over `area_m2`. Below 1 is clumped, about 1 is random, above 1 is evenly spaced.
pub fn clark_evans(dressing: &[Dressing], area_m2: f64) -> f64 {
    if dressing.len() < 2 {
        return 1.0;
    }
    let (mean, _) = nn_stats(dressing);
    mean / (0.5 * libm::sqrt(area_m2 / dressing.len() as f64))
}

/// Nearest-neighbour distance between pieces: (mean in m, coefficient of variation). Low CV is even; high is clumped.
pub fn nn_stats(dressing: &[Dressing]) -> (f64, f64) {
    let p: Vec<(f64, f64)> = dressing
        .iter()
        .map(|d| (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0))
        .collect();
    if p.len() < 2 {
        return (0.0, 0.0);
    }
    let nn: Vec<f64> = (0..p.len())
        .map(|i| {
            (0..p.len())
                .filter(|&j| j != i)
                .map(|j| libm::hypot(p[i].0 - p[j].0, p[i].1 - p[j].1))
                .fold(f64::INFINITY, f64::min)
        })
        .collect();
    let mean = nn.iter().sum::<f64>() / nn.len() as f64;
    let var = nn.iter().map(|d| (d - mean) * (d - mean)).sum::<f64>() / nn.len() as f64;
    (mean, libm::sqrt(var) / mean)
}
