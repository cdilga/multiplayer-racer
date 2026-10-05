//! P1-M02 · G-PROCSPIKE: candidates for terrain undulation and dressing scatter, on the real stack (jj-procgen's seeded
//! course, jj-map's jj.map.v1 and validator), for all four Playtest-1 biomes. Throwaway: the procgen core (M03c–g) is
//! written from the report's findings, not from this code.
//!
//! - Undulation: `noise` (fBm value noise over the whole map; the road follows the ground) vs `route` (a closed height
//!   profile along the route with a bounded grade; off-road ground blends from the road's height into noise).
//! - Scatter: `poisson` (Bridson Poisson-disc) vs `blue` (Mitchell best-candidate) vs `cluster` (Thomas process:
//!   Poisson parents, Gaussian children), all kept off the road corridor.
//! - Biomes: presets of road surface, ground surface, densities and generic kit pieces (the biome kits are M04–M07).
//!
//! Everything is a pure function of (seed, biome, candidates), in libm maths, so native and WASM give the same bytes.

use jj_map::model::{Biome, Dressing, Map, Params, Pose, Surface};
use jj_procgen::assemble::{arc_lengths, distance_to_loop};
use jj_procgen::seed::Rng;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Undulation {
    Flat,
    Noise,
    Route,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scatter {
    Poisson,
    Blue,
    Cluster,
}

pub const BIOMES: [Biome; 4] = [Biome::Town, Biome::Rocks, Biome::OutbackDirt, Biome::OutbackBitumen];
pub const UNDULATIONS: [Undulation; 3] = [Undulation::Flat, Undulation::Noise, Undulation::Route];
pub const SCATTERS: [Scatter; 3] = [Scatter::Poisson, Scatter::Blue, Scatter::Cluster];

impl Undulation {
    pub fn name(self) -> &'static str {
        match self {
            Self::Flat => "flat",
            Self::Noise => "noise",
            Self::Route => "route",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        UNDULATIONS.into_iter().find(|u| u.name() == s)
    }
}

impl Scatter {
    pub fn name(self) -> &'static str {
        match self {
            Self::Poisson => "poisson",
            Self::Blue => "blue",
            Self::Cluster => "cluster",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        SCATTERS.into_iter().find(|c| c.name() == s)
    }
}

pub fn biome_name(b: Biome) -> &'static str {
    match b {
        Biome::Greybox => "greybox",
        Biome::Town => "town",
        Biome::Rocks => "rocks",
        Biome::OutbackDirt => "outback-dirt",
        Biome::OutbackBitumen => "outback-bitumen",
    }
}

pub fn parse_biome(s: &str) -> Option<Biome> {
    BIOMES.into_iter().find(|b| biome_name(*b) == s)
}

/// One kind of piece a biome scatters: the kit piece, how often (weight), its params' ranges, how far from the road.
struct Piece {
    kit: &'static str,
    weight: f64,
    /// (param, min, max): drawn uniformly, rounded.
    params: &'static [(&'static str, i64, i64)],
    /// Distance from the road edge, metres (min, max).
    setback: (f64, f64),
    collides: bool,
}

/// A biome preset: surfaces, relief, density and pieces.
struct Preset {
    road: Surface,
    ground: Surface,
    /// Relief amplitude (metres) and the main wavelength of the ground.
    relief_m: f64,
    wavelength_m: f64,
    /// Minimum spacing between pieces (Poisson radius), metres: sets the density for every scatter candidate.
    spacing_m: f64,
    pieces: &'static [Piece],
}

fn preset(b: Biome) -> Preset {
    match b {
        // Town: buildings close along the road, poles; gentle relief.
        Biome::Town => Preset {
            road: Surface::Tarmac,
            ground: Surface::OffTrack,
            relief_m: 2.0,
            wavelength_m: 140.0,
            spacing_m: 14.0,
            pieces: &[
                Piece { kit: "generic/box-building", weight: 5.0, params: &[("widthMm", 8000, 18000), ("depthMm", 6000, 12000), ("heightCm", 350, 900)], setback: (5.0, 40.0), collides: true },
                Piece { kit: "generic/post", weight: 2.0, params: &[("heightCm", 400, 700), ("radiusMm", 130, 200)], setback: (3.0, 6.0), collides: true },
                Piece { kit: "generic/bin", weight: 1.0, params: &[], setback: (2.0, 8.0), collides: false },
            ],
        },
        // Rocks (the Olgas): big domes far off, red rock ground, more relief.
        Biome::Rocks => Preset {
            road: Surface::PackedDirt,
            ground: Surface::Rock,
            relief_m: 7.0,
            wavelength_m: 110.0,
            spacing_m: 26.0,
            pieces: &[
                Piece { kit: "generic/box-building", weight: 3.0, params: &[("widthMm", 18000, 42000), ("depthMm", 16000, 36000), ("heightCm", 900, 2400)], setback: (18.0, 90.0), collides: true },
                Piece { kit: "generic/post", weight: 2.0, params: &[("heightCm", 80, 200), ("radiusMm", 300, 600)], setback: (4.0, 40.0), collides: true },
            ],
        },
        // Outback dirt: open plain, scattered scrub, a packed-dirt road.
        Biome::OutbackDirt => Preset {
            road: Surface::PackedDirt,
            ground: Surface::OffTrack,
            relief_m: 3.5,
            wavelength_m: 160.0,
            spacing_m: 9.0,
            pieces: &[
                Piece { kit: "generic/post", weight: 6.0, params: &[("heightCm", 60, 160), ("radiusMm", 250, 550)], setback: (3.0, 70.0), collides: false },
                Piece { kit: "generic/box-building", weight: 0.3, params: &[("widthMm", 6000, 10000), ("depthMm", 5000, 8000), ("heightCm", 300, 450)], setback: (20.0, 60.0), collides: true },
            ],
        },
        // Outback bitumen: a sealed road through flat country, fence posts and the odd shed.
        Biome::OutbackBitumen | Biome::Greybox => Preset {
            road: Surface::Tarmac,
            ground: Surface::OffTrack,
            relief_m: 1.5,
            wavelength_m: 220.0,
            spacing_m: 12.0,
            pieces: &[
                Piece { kit: "generic/post", weight: 4.0, params: &[("heightCm", 100, 140), ("radiusMm", 60, 90)], setback: (4.0, 8.0), collides: false },
                Piece { kit: "generic/box-building", weight: 0.6, params: &[("widthMm", 6000, 12000), ("depthMm", 5000, 9000), ("heightCm", 300, 500)], setback: (25.0, 70.0), collides: true },
                Piece { kit: "generic/post", weight: 3.0, params: &[("heightCm", 50, 120), ("radiusMm", 250, 500)], setback: (8.0, 80.0), collides: false },
            ],
        },
    }
}

// ───────────── noise ─────────────

fn hash2(seed: u64, x: i64, z: i64) -> f64 {
    let mut h = seed ^ (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (z as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
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
    let s = |t: f64| t * t * (3.0 - 2.0 * t);
    let (sx, sz) = (s(fx), s(fz));
    let (xi, zi) = (xi as i64, zi as i64);
    let a = hash2(seed, xi, zi);
    let b = hash2(seed, xi + 1, zi);
    let c = hash2(seed, xi, zi + 1);
    let d = hash2(seed, xi + 1, zi + 1);
    let top = a + (b - a) * sx;
    let bot = c + (d - c) * sx;
    top + (bot - top) * sz
}

/// Fractal (fBm) value noise: three octaves, amplitude ~1.
fn fbm(seed: u64, x: f64, z: f64, wavelength: f64) -> f64 {
    let mut sum = 0.0;
    let (mut amp, mut freq) = (1.0, 1.0 / wavelength);
    for o in 0..3 {
        sum += amp * value_noise(seed.wrapping_add(o * 7919), x * freq, z * freq);
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / 1.75
}

// ───────────── undulation ─────────────

/// The route's height profile for `Route`: three sines whose periods divide the loop, scaled so the steepest grade is
/// `max_grade`.
fn route_profile(rng: &mut Rng, total: f64, relief: f64, max_grade: f64) -> impl Fn(f64) -> f64 {
    let waves: Vec<(f64, f64, f64)> = (0..3)
        .map(|k| {
            let cycles = (2 + 2 * k) as f64 + libm::floor(rng.range(0.0, 2.0));
            (cycles, rng.range(0.0, core::f64::consts::TAU), 1.0 / (1.0 + k as f64))
        })
        .collect();
    // Steepest slope of the unscaled profile: Σ |amp · 2π·cycles / total|.
    let slope: f64 = waves.iter().map(|(c, _, a)| a * core::f64::consts::TAU * c / total).sum();
    let gain = (relief).min(max_grade / slope.max(1e-9));
    move |s: f64| {
        gain * waves
            .iter()
            .map(|(c, ph, a)| a * libm::sin(core::f64::consts::TAU * c * s / total + ph))
            .sum::<f64>()
    }
}

/// Heights (metres) for the terrain grid and the route, by the chosen candidate.
fn undulate(map: &mut Map, seed: u64, kind: Undulation, p: &Preset) -> (f64, f64) {
    let t = &map.terrain;
    let (cols, rows, sp) = (t.cols as usize, t.rows as usize, f64::from(t.spacing) / 1000.0);
    let (ox, oz) = (f64::from(t.origin_x) / 1000.0, f64::from(t.origin_z) / 1000.0);
    let pts: Vec<(f64, f64)> = map.route.points.iter().map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0)).collect();
    let (s, total) = arc_lengths(&pts);
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let mut rng = Rng::stream(seed, "spike.undulation");
    let profile = route_profile(&mut rng, total, p.relief_m, 0.06);
    let nseed = seed ^ 0x5EED_0F_6E0D;
    let ground = |x: f64, z: f64| p.relief_m * fbm(nseed, x, z, p.wavelength_m);
    // Nearest route point (index) to (x, z).
    let nearest = |x: f64, z: f64| {
        let mut best = (f64::INFINITY, 0usize);
        for (i, &(px, pz)) in pts.iter().enumerate() {
            let d = (px - x) * (px - x) + (pz - z) * (pz - z);
            if d < best.0 {
                best = (d, i);
            }
        }
        (libm::sqrt(best.0), best.1)
    };
    let height = |x: f64, z: f64| -> f64 {
        match kind {
            Undulation::Flat => 0.0,
            Undulation::Noise => ground(x, z),
            Undulation::Route => {
                let (d, i) = nearest(x, z);
                let road = profile(s[i]);
                // The road's own height out past its shoulders (a road bed wider than one heightfield cell's diagonal,
                // so no off-road vertex can lift the ground over the road), then a 40 m blend into the noise.
                let k = ((d - half - 1.5 * sp) / 40.0).clamp(0.0, 1.0);
                let k = k * k * (3.0 - 2.0 * k);
                road + (ground(x, z) - road) * k
            }
        }
    };
    let mut heights = Vec::with_capacity(cols * rows);
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for r in 0..rows {
        for c in 0..cols {
            let h = height(ox + c as f64 * sp, oz + r as f64 * sp);
            lo = lo.min(h);
            hi = hi.max(h);
            heights.push(libm::round(h * 100.0) as i16);
        }
    }
    map.terrain.heights = heights;
    for (i, q) in map.route.points.iter_mut().enumerate() {
        let h = height(pts[i].0, pts[i].1);
        q.y = libm::round(h * 1000.0) as i32;
    }
    (lo, hi)
}

// ───────────── scatter ─────────────

/// Candidate points in the rectangle, at least `r` apart (Bridson's Poisson-disc, 30 tries).
fn poisson(rng: &mut Rng, x0: f64, z0: f64, w: f64, h: f64, r: f64) -> Vec<(f64, f64)> {
    let cell = r / libm::sqrt(2.0);
    let (gw, gh) = ((w / cell) as usize + 1, (h / cell) as usize + 1);
    let mut grid: Vec<Option<usize>> = vec![None; gw * gh];
    let mut out: Vec<(f64, f64)> = Vec::new();
    let mut active: Vec<usize> = Vec::new();
    let at = |p: (f64, f64)| (((p.0 - x0) / cell) as usize, ((p.1 - z0) / cell) as usize);
    let first = (x0 + rng.range(0.0, w), z0 + rng.range(0.0, h));
    let (gx, gz) = at(first);
    grid[gz * gw + gx] = Some(0);
    out.push(first);
    active.push(0);
    while !active.is_empty() {
        let k = (rng.unit() * active.len() as f64) as usize % active.len();
        let base = out[active[k]];
        let mut found = false;
        for _ in 0..30 {
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

/// `n` points by Mitchell's best-candidate (each new point the farthest of 10 random candidates from those placed).
fn blue(rng: &mut Rng, x0: f64, z0: f64, w: f64, h: f64, n: usize) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(n);
    for _ in 0..n {
        let mut best = ((0.0, 0.0), -1.0);
        for _ in 0..10 {
            let p = (x0 + rng.range(0.0, w), z0 + rng.range(0.0, h));
            let d = out.iter().map(|q| (q.0 - p.0) * (q.0 - p.0) + (q.1 - p.1) * (q.1 - p.1)).fold(f64::INFINITY, f64::min);
            if d > best.1 {
                best = (p, d);
            }
        }
        out.push(best.0);
    }
    out
}

/// A Thomas process: Poisson-disc parents (spacing 4r), each with a few children in a Gaussian of σ = r.
fn cluster(rng: &mut Rng, x0: f64, z0: f64, w: f64, h: f64, r: f64) -> Vec<(f64, f64)> {
    let parents = poisson(rng, x0, z0, w, h, 4.0 * r);
    let mut out = Vec::new();
    for p in parents {
        let kids = 8 + (rng.unit() * 16.0) as usize;
        for _ in 0..kids {
            // Box–Muller.
            let (u1, u2) = (rng.unit().max(1e-12), rng.unit());
            let m = r * libm::sqrt(-2.0 * libm::log(u1));
            out.push((p.0 + m * libm::cos(core::f64::consts::TAU * u2), p.1 + m * libm::sin(core::f64::consts::TAU * u2)));
        }
    }
    out
}

/// Replaces the map's dressing with the biome's pieces scattered by the candidate, off the road corridor.
fn scatter(map: &mut Map, seed: u64, kind: Scatter, p: &Preset) -> usize {
    let b = &map.header.bounds;
    let (x0, z0) = (f64::from(b.min_x) / 1000.0, f64::from(b.min_z) / 1000.0);
    let (w, h) = (f64::from(b.max_x - b.min_x) / 1000.0, f64::from(b.max_z - b.min_z) / 1000.0);
    let pts: Vec<(f64, f64)> = map.route.points.iter().map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0)).collect();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let mut rng = Rng::stream(seed, "spike.scatter");
    // The same number of candidates for every algorithm (Poisson's count at the biome's spacing), so the comparison is
    // of distributions, not densities.
    let count = poisson(&mut Rng::stream(seed, "spike.count"), x0, z0, w, h, p.spacing_m).len();
    let cands = match kind {
        Scatter::Poisson => poisson(&mut rng, x0, z0, w, h, p.spacing_m),
        Scatter::Blue => blue(&mut rng, x0, z0, w, h, count.max(1)),
        Scatter::Cluster => {
            let mut c = cluster(&mut rng, x0, z0, w, h, p.spacing_m);
            c.truncate(count);
            c
        }
    };
    let total_w: f64 = p.pieces.iter().map(|q| q.weight).sum();
    let mut pick = Rng::stream(seed, "spike.pieces");
    let mut dressing = Vec::new();
    for c in cands {
        if c.0 < x0 || c.1 < z0 || c.0 > x0 + w || c.1 > z0 + h {
            continue;
        }
        let edge = distance_to_loop(&pts, c) - half;
        // Choose a piece by weight, then keep it only inside that piece's setback band.
        let mut u = pick.unit() * total_w;
        let piece = p.pieces.iter().find(|q| {
            u -= q.weight;
            u <= 0.0
        }).unwrap_or(&p.pieces[0]);
        let params: Params = piece
            .params
            .iter()
            .map(|(k, lo, hi)| ((*k).to_string(), *lo + (pick.unit() * (*hi - *lo) as f64) as i64))
            .collect();
        let yaw = (pick.unit() * 36_000.0) as i32;
        if edge < piece.setback.0 || edge > piece.setback.1 {
            continue;
        }
        // Keep the whole footprint off the road: the piece's half-diagonal must fit inside its setback.
        let reach = params
            .get("widthMm")
            .zip(params.get("depthMm"))
            .map(|(w, d)| libm::hypot(*w as f64, *d as f64) / 2000.0)
            .or_else(|| params.get("radiusMm").map(|r| *r as f64 / 1000.0))
            .unwrap_or(0.5);
        // The validator's camera rule wants tall pieces 2 m clear of the road edge; keep 2.5 m.
        if edge - reach < 2.5 {
            continue;
        }
        dressing.push(Dressing {
            kit_piece: piece.kit.into(),
            pose: Pose { x: (c.0 * 1000.0) as i32, y: 0, z: (c.1 * 1000.0) as i32, yaw },
            params,
            collides: piece.collides,
        });
    }
    let n = dressing.len();
    map.dressing = dressing;
    n
}

/// Sits every piece on the ground (its pose y = the terrain under it).
fn ground_pieces(map: &mut Map) {
    let t = &map.terrain;
    let at = |x: i32, z: i32| -> i32 {
        let c = (((x - t.origin_x) as f64 / f64::from(t.spacing)).round() as i64).clamp(0, i64::from(t.cols) - 1) as usize;
        let r = (((z - t.origin_z) as f64 / f64::from(t.spacing)).round() as i64).clamp(0, i64::from(t.rows) - 1) as usize;
        i32::from(t.heights[r * t.cols as usize + c]) * 10
    };
    let ys: Vec<i32> = map.dressing.iter().map(|d| at(d.pose.x, d.pose.z)).collect();
    for (d, y) in map.dressing.iter_mut().zip(ys) {
        d.pose.y = y;
    }
    let ys: Vec<i32> = map.props.iter().map(|d| at(d.pose.x, d.pose.z)).collect();
    for (d, y) in map.props.iter_mut().zip(ys) {
        d.pose.y = y;
    }
}

/// What one generation measured.
#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub pieces: usize,
    pub relief_m: f64,
    /// Steepest grade along the route on the heightfield (rise over 10 m), as a fraction.
    pub max_grade: f64,
    /// Nearest-neighbour distance between pieces: mean (m) and coefficient of variation (lower = more regular).
    pub nn_mean_m: f64,
    pub nn_cv: f64,
}

/// The map for (seed, biome, candidates), and what it measured.
pub fn generate(seed: u64, biome: Biome, und: Undulation, sc: Scatter) -> (Map, Stats) {
    let mut map = jj_procgen::generate(seed);
    let p = preset(biome);
    map.header.biomes = vec![biome];
    map.header.generator.id = "jj.procgen.spike".into();
    map.header.generator.version = format!("m02-{}-{}", und.name(), sc.name());
    for q in &mut map.route.points {
        q.surface = p.road;
    }
    for s in &mut map.terrain.surfaces {
        *s = if *s == Surface::OffTrack { p.ground } else { p.road };
    }
    let (lo, hi) = undulate(&mut map, seed, und, &p);
    let pieces = scatter(&mut map, seed, sc, &p);
    ground_pieces(&mut map);
    let mut stats = Stats { pieces, relief_m: hi - lo, ..Stats::default() };
    stats.max_grade = route_grade(&map);
    let (m, cv) = nn_stats(&map);
    stats.nn_mean_m = m;
    stats.nn_cv = cv;
    (map, stats)
}

fn route_grade(map: &Map) -> f64 {
    let t = &map.terrain;
    let h = |x: f64, z: f64| -> f64 {
        let c = ((x * 1000.0 - f64::from(t.origin_x)) / f64::from(t.spacing)).clamp(0.0, f64::from(t.cols - 1));
        let r = ((z * 1000.0 - f64::from(t.origin_z)) / f64::from(t.spacing)).clamp(0.0, f64::from(t.rows - 1));
        // Bilinear on the heightfield, as the car drives it.
        let (c0, r0) = (libm::floor(c) as usize, libm::floor(r) as usize);
        let (c1, r1) = ((c0 + 1).min(t.cols as usize - 1), (r0 + 1).min(t.rows as usize - 1));
        let (fc, fr) = (c - c0 as f64, r - r0 as f64);
        let g = |cc: usize, rr: usize| f64::from(t.heights[rr * t.cols as usize + cc]) / 100.0;
        let top = g(c0, r0) + (g(c1, r0) - g(c0, r0)) * fc;
        let bot = g(c0, r1) + (g(c1, r1) - g(c0, r1)) * fc;
        top + (bot - top) * fr
    };
    let pts: Vec<(f64, f64)> = map.route.points.iter().map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0)).collect();
    let mut worst: f64 = 0.0;
    for i in 0..pts.len() {
        let (a, b) = (pts[i], pts[(i + 4) % pts.len()]);
        let run = libm::hypot(b.0 - a.0, b.1 - a.1);
        if run > 1.0 {
            worst = worst.max((h(b.0, b.1) - h(a.0, a.1)).abs() / run);
        }
    }
    worst
}

fn nn_stats(map: &Map) -> (f64, f64) {
    let p: Vec<(f64, f64)> = map.dressing.iter().map(|d| (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0)).collect();
    if p.len() < 2 {
        return (0.0, 0.0);
    }
    let nn: Vec<f64> = p
        .iter()
        .enumerate()
        .map(|(i, a)| p.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, b)| libm::hypot(a.0 - b.0, a.1 - b.1)).fold(f64::INFINITY, f64::min))
        .collect();
    let mean = nn.iter().sum::<f64>() / nn.len() as f64;
    let var = nn.iter().map(|d| (d - mean) * (d - mean)).sum::<f64>() / nn.len() as f64;
    (mean, libm::sqrt(var) / mean)
}

/// FNV-1a 64 over bytes: the determinism fingerprint native and WASM both compute.
pub fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// The map's canonical bytes (jj-map's postcard encoding), which a seed must reproduce exactly.
pub fn canonical(map: &Map) -> Vec<u8> {
    jj_map::canon::canonical_bytes(map)
}

// ───────────── WASM: one C-ABI call, the result in linear memory ─────────────
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    static mut OUT: Vec<u8> = Vec::new();

    /// Generates (seed, biome index, undulation index, scatter index) and keeps its JSON; returns its length.
    /// Also returns the canonical bytes' FNV in the high word through `spike_fnv`.
    #[unsafe(no_mangle)]
    pub extern "C" fn spike_generate(seed_lo: u32, seed_hi: u32, biome: u32, und: u32, sc: u32) -> u32 {
        let seed = u64::from(seed_lo) | (u64::from(seed_hi) << 32);
        let (map, _) = generate(seed, BIOMES[biome as usize], UNDULATIONS[und as usize], SCATTERS[sc as usize]);
        let canon = canonical(&map);
        let mut out = format!("{:016x}\n", fnv(&canon)).into_bytes();
        out.extend(serde_json::to_vec(&map).unwrap_or_default());
        // SAFETY: single-threaded WASM; the JS caller reads OUT before the next call.
        unsafe {
            OUT = out;
            #[allow(static_mut_refs)]
            let n = OUT.len() as u32;
            n
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spike_out() -> *const u8 {
        // SAFETY: as above.
        #[allow(static_mut_refs)]
        unsafe {
            OUT.as_ptr()
        }
    }
}
