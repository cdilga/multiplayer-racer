//! P1-M03c seed bank: undulation keeps the route band drivable in every biome. For each of 100 seeds and every biome's
//! terrain data, the heightfield the car drives (bilinear) is sampled along the centerline and both edges: grade stays
//! inside the biome's `max_grade`, vertical curvature inside its `max_curvature`, banked corners lean toward the turn
//! within the biome's bank limit, and the road edge painted on the grid is smooth on diagonals. Set `JJ_EVIDENCE_DIR` to
//! write the seed-bank table and the edge image (`docs/evidence/P1-M03c/`).

use jj_map::{Biome, Map, Registry, Surface, validate};
use jj_procgen::generate;
use jj_procgen::seed::Rng;
use jj_procgen::terrain::{ground_height_m, params, undulate};

const BIOMES: [Biome; 5] = [
    Biome::Greybox,
    Biome::Town,
    Biome::OutbackBitumen,
    Biome::OutbackDirt,
    Biome::Rocks,
];
/// The bank: a sample, not a limit (`JJ_SEEDS=1000` widens it). 100 seeds in release; a debug build is ~20x slower, so
/// it samples 30 (CI's release lane and the evidence run use the full 100).
const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 30 } else { 100 };
fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

/// Grade is measured over this many route points (5 m); curvature over twice that (10 m): wide enough that centimetre
/// quantisation of the heights stays well under the limits.
const GRADE_STEP: usize = 2;
const CURV_STEP: usize = 4;

struct Route {
    pts: Vec<(f64, f64)>,
    normal: Vec<(f64, f64)>,
    half: f64,
}

fn route(map: &Map) -> Route {
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect();
    let n = pts.len();
    let normal = (0..n)
        .map(|i| {
            let (a, b) = (pts[(i + n - 1) % n], pts[(i + 1) % n]);
            let l = (b.0 - a.0).hypot(b.1 - a.1);
            (-(b.1 - a.1) / l, (b.0 - a.0) / l)
        })
        .collect();
    Route {
        pts,
        normal,
        half: f64::from(map.route.points[0].width) / 2000.0,
    }
}

/// Ground height at lateral offset `l` (m, + to the right of travel) from route point `i`.
fn at(map: &Map, r: &Route, i: usize, l: f64) -> ((f64, f64), f64) {
    let p = (
        r.pts[i].0 + r.normal[i].0 * l,
        r.pts[i].1 + r.normal[i].1 * l,
    );
    (p, ground_height_m(&map.terrain, p.0, p.1))
}

#[derive(Default, Debug)]
struct Worst {
    grade: f64,
    curvature: f64,
    bank_deg: f64,
    cross_err: f64,
    centre_err: f64,
}

fn measure(map: &Map) -> Worst {
    let r = route(map);
    let n = r.pts.len();
    let mut w = Worst::default();
    for i in 0..n {
        // Grade along the centerline and both edges (and between), in plan distance.
        for l in [-r.half, -r.half / 2.0, 0.0, r.half / 2.0, r.half] {
            let ((pa, ha), (pb, hb)) = (at(map, &r, i, l), at(map, &r, (i + GRADE_STEP) % n, l));
            let run = (pb.0 - pa.0).hypot(pb.1 - pa.1);
            if run > 1.0 {
                w.grade = w.grade.max((hb - ha).abs() / run);
            }
        }
        // Vertical curvature along the centerline.
        let (j0, j1) = ((i + n - CURV_STEP) % n, (i + CURV_STEP) % n);
        let (p0, p1, p2) = (r.pts[j0], r.pts[i], r.pts[j1]);
        let (d0, d1) = (
            (p1.0 - p0.0).hypot(p1.1 - p0.1),
            (p2.0 - p1.0).hypot(p2.1 - p1.1),
        );
        let (h0, h1, h2) = (
            ground_height_m(&map.terrain, p0.0, p0.1),
            ground_height_m(&map.terrain, p1.0, p1.1),
            ground_height_m(&map.terrain, p2.0, p2.1),
        );
        let kappa = ((h2 - h1) / d1 - (h1 - h0) / d0).abs() / ((d0 + d1) / 2.0);
        w.curvature = w.curvature.max(kappa);
        // Cross slope vs the stored bank (right edge minus left edge over the width; left lower for + bank).
        let (_, hr) = at(map, &r, i, r.half);
        let (_, hl) = at(map, &r, i, -r.half);
        let cross = (hr - hl) / (2.0 * r.half);
        let bank = f64::from(map.route.points[i].bank) * core::f64::consts::PI / 18_000.0;
        w.cross_err = w.cross_err.max((cross - bank.tan()).abs());
        w.bank_deg = w
            .bank_deg
            .max(f64::from(map.route.points[i].bank).abs() / 100.0);
        // The route's own height agrees with the heightfield under it.
        let centre = f64::from(map.route.points[i].y) / 1000.0 - h1;
        w.centre_err = w.centre_err.max(centre.abs());
    }
    w
}

/// Seed-bank maps: every seed's route with every biome's terrain applied to it.
fn bank() -> impl Iterator<Item = (u64, Biome, Map)> {
    (0..seeds()).flat_map(|seed| {
        let flat = generate(seed);
        BIOMES.into_iter().map(move |b| {
            let mut m = flat.clone();
            undulate(&mut m, &mut Rng::stream(seed, "terrain"), &params(b));
            (seed, b, m)
        })
    })
}

#[test]
fn grade_curvature_and_bank_stay_inside_each_biomes_limits_along_the_route_band() {
    let mut rows = String::from(
        "seed biome  grade%  limit%  curv(1/m)  limit  bank(deg)  limit  crossErr  centreErr(m)  relief(m)\n",
    );
    let mut peak: std::collections::BTreeMap<String, Worst> = Default::default();
    for (seed, biome, map) in bank() {
        let (p, w) = (params(biome), measure(&map));
        assert!(
            w.grade <= p.max_grade,
            "seed {seed} {biome:?}: grade {:.4} over {}",
            w.grade,
            p.max_grade
        );
        assert!(
            w.curvature <= p.max_curvature,
            "seed {seed} {biome:?}: curvature {:.5} over {}",
            w.curvature,
            p.max_curvature
        );
        assert!(
            w.bank_deg <= f64::from(p.max_bank_cdeg) / 100.0 + 0.011,
            "seed {seed} {biome:?}: bank {} deg",
            w.bank_deg
        );
        // The heightfield's cross slope is the route's bank (to a few percent of grade) and the route sits on the ground.
        assert!(
            w.cross_err < 0.02,
            "seed {seed} {biome:?}: cross slope off the bank by {}",
            w.cross_err
        );
        assert!(
            w.centre_err < 0.06,
            "seed {seed} {biome:?}: route y is {} m off the ground",
            w.centre_err
        );
        let h = &map.terrain.heights;
        let relief =
            f64::from(h.iter().max().copied().unwrap_or(0) - h.iter().min().copied().unwrap_or(0))
                / 100.0;
        assert!(
            map.terrain
                .heights
                .iter()
                .all(|&v| i32::from(v) * 10 > map.header.bounds.kill_y),
            "seed {seed} {biome:?}: ground below the kill height"
        );
        assert!(
            validate(&map, &Registry::generic()).ok,
            "seed {seed} {biome:?}"
        );
        if seed < 3 {
            rows += &format!(
                "{seed:>4} {:<15} {:>5.2}  {:>5.2}  {:>9.5}  {:>6.4}  {:>8.2}  {:>5.1}  {:>8.4}  {:>11.3}  {relief:>8.1}\n",
                format!("{biome:?}"),
                w.grade * 100.0,
                p.max_grade * 100.0,
                w.curvature,
                p.max_curvature,
                w.bank_deg,
                f64::from(p.max_bank_cdeg) / 100.0,
                w.cross_err,
                w.centre_err,
            );
        }
        let e = peak.entry(format!("{biome:?}")).or_default();
        e.grade = e.grade.max(w.grade);
        e.curvature = e.curvature.max(w.curvature);
        e.bank_deg = e.bank_deg.max(w.bank_deg);
    }
    rows += &format!("\nWorst over {} seeds (measured / limit):\n", seeds());
    for biome in BIOMES {
        let (p, w) = (params(biome), &peak[&format!("{biome:?}")]);
        rows += &format!(
            "{:<15} grade {:.2}% / {:.2}%   curvature {:.5} / {:.4}   bank {:.2} / {:.1} deg\n",
            format!("{biome:?}"),
            w.grade * 100.0,
            p.max_grade * 100.0,
            w.curvature,
            p.max_curvature,
            w.bank_deg,
            f64::from(p.max_bank_cdeg) / 100.0
        );
    }
    println!("{rows}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("seedbank.txt"), rows).unwrap();
    }
}

#[test]
fn town_and_bitumen_are_gentler_than_rocks() {
    let (town, bitumen, dirt, rocks) = (
        params(Biome::Town),
        params(Biome::OutbackBitumen),
        params(Biome::OutbackDirt),
        params(Biome::Rocks),
    );
    for gentle in [town, bitumen] {
        assert!(gentle.max_grade < rocks.max_grade);
        assert!(gentle.max_grade < dirt.max_grade);
        assert!(gentle.max_curvature < rocks.max_curvature);
        assert!(gentle.max_bank_cdeg < rocks.max_bank_cdeg);
    }
    // And the generated roads show it: town's steepest grade is under rocks' limit, across the bank.
    let worst = |b| {
        bank()
            .filter(|(_, bb, _)| *bb == b)
            .map(|(_, _, m)| measure(&m).grade)
            .fold(0.0, f64::max)
    };
    assert!(worst(Biome::Town) < rocks.max_grade);
    assert!(worst(Biome::OutbackBitumen) < rocks.max_grade);
}

#[test]
fn corners_bank_toward_the_turn_with_the_inside_edge_lower() {
    let mut banked = 0;
    for seed in 0..seeds() {
        let mut map = generate(seed);
        undulate(
            &mut map,
            &mut Rng::stream(seed, "terrain"),
            &params(Biome::Rocks),
        );
        let r = route(&map);
        let n = r.pts.len();
        for i in 0..n {
            let b = map.route.points[i].bank;
            if b.abs() < 150 {
                continue;
            }
            // Judge only well inside a corner: the turn keeps one sign over ±12 points (30 m). The bank ramps out
            // onto a straight, and across a chicane's reversal, at a limited rate, so there it lags the turn.
            // With +x on the car's left (sim handedness), a plan cross < 0 is a left turn.
            let turn = |j: usize| {
                let (t0, m, t1) = (r.pts[(j + n - 3) % n], r.pts[j], r.pts[(j + 3) % n]);
                (m.0 - t0.0) * (t1.1 - m.1) - (m.1 - t0.1) * (t1.0 - m.0)
            };
            let first = turn(i);
            if first.abs() < 5.0
                || (0..25).any(|j| {
                    turn((i + n + j - 12) % n) * first <= 0.0
                        || turn((i + n + j - 12) % n).abs() < 5.0
                })
            {
                continue;
            }
            assert_eq!(
                first < 0.0,
                b > 0,
                "seed {seed} point {i}: bank {b} against the turn"
            );
            // Positive bank: the left edge (the −normal side, normal is to the right) is the lower one.
            let ((_, hl), (_, hr)) = (at(&map, &r, i, -r.half), at(&map, &r, i, r.half));
            assert!(
                (b > 0) == (hl < hr),
                "seed {seed} point {i}: bank {b}, left {hl} right {hr}"
            );
            banked += 1;
        }
    }
    assert!(
        banked > 2 * seeds() as usize,
        "the bank has banked corners to check: {banked}"
    );
}

#[test]
fn the_painted_road_edge_has_no_cell_sized_saw_tooth() {
    // Every grid cell is road iff its corner is within half the road width of the route, and the grid is fine enough
    // that the road edge's worst error against the ideal edge is under 1.8 m (a 10 m grid made it 7 m).
    for seed in 0..seeds() {
        let map = generate(seed);
        let t = &map.terrain;
        assert!(t.spacing <= 2_500, "terrain spacing {} mm", t.spacing);
        let r = route(&map);
        let sp = f64::from(t.spacing) / 1000.0;
        let mut worst: f64 = 0.0;
        for (k, &s) in t.surfaces.iter().enumerate() {
            let (c, row) = ((k as u32 % t.cols) as f64, (k as u32 / t.cols) as f64);
            let p = (
                f64::from(t.origin_x) / 1000.0 + c * sp,
                f64::from(t.origin_z) / 1000.0 + row * sp,
            );
            let d = jj_procgen::assemble::distance_to_loop(&r.pts, p);
            // Only cells near the edge matter.
            if (d - r.half).abs() < 6.0 && (d - r.half).abs() > 2e-3 {
                assert_eq!(
                    s != Surface::OffTrack,
                    d <= r.half,
                    "seed {seed} cell {k}: d {d} half {}",
                    r.half
                );
                if s != Surface::OffTrack {
                    worst = worst.max(d - r.half);
                } else {
                    worst = worst.max(r.half - d);
                }
            }
        }
        assert!(
            worst <= 0.0 + 1e-9,
            "seed {seed}: a cell on the wrong side of the edge by {worst}"
        );
        // The stair-step amplitude is bounded by the cell diagonal's half.
        assert!(sp * std::f64::consts::SQRT_2 / 2.0 < 1.8);
    }
}

#[test]
fn undulation_is_idempotent_and_leaves_the_route_plan_alone() {
    for seed in [0u64, 7, 42, u64::MAX] {
        let base = generate(seed);
        // Undulation then features is the generator's pipeline: running it again on the map gives the same map.
        let mut again = base.clone();
        undulate(
            &mut again,
            &mut Rng::stream(seed, "terrain"),
            &params(Biome::Greybox),
        );
        jj_procgen::features::place(
            &mut again,
            &mut Rng::stream(seed, "features"),
            Biome::Greybox,
        );
        assert_eq!(base, again, "seed {seed}");
        let mut other = base.clone();
        undulate(
            &mut other,
            &mut Rng::stream(seed, "terrain"),
            &params(Biome::Rocks),
        );
        for (a, b) in base.route.points.iter().zip(&other.route.points) {
            assert_eq!((a.x, a.z, a.width), (b.x, b.z, b.width));
        }
        assert_ne!(base.terrain.heights, other.terrain.heights);
    }
}

/// Evidence images (only with `JJ_EVIDENCE_DIR`): a hill-shaded overview per biome and a diagonal-straight crop showing
/// the painted road edge on the old 10 m grid against the 2.5 m grid, each with the true edge drawn over it. PPM files;
/// `docs/evidence/P1-M03c/` keeps the PNG conversions.
#[test]
fn writes_the_evidence_images() {
    let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    let ppm = |name: &str, w: usize, h: usize, px: &[[u8; 3]]| {
        let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
        out.extend(px.iter().flatten());
        std::fs::write(dir.join(name), out).unwrap();
    };
    for biome in BIOMES {
        let mut map = generate(1);
        undulate(&mut map, &mut Rng::stream(1, "terrain"), &params(biome));
        let t = &map.terrain;
        let (w, h) = (t.cols as usize, t.rows as usize);
        let z = |c: usize, r: usize| f64::from(t.heights[r.min(h - 1) * w + c.min(w - 1)]) / 100.0;
        let mut px = Vec::with_capacity(w * h);
        for r in 0..h {
            for c in 0..w {
                let (dx, dz) = (
                    z(c + 1, r) - z(c.saturating_sub(1), r),
                    z(c, r + 1) - z(c, r.saturating_sub(1)),
                );
                let shade = (0.62 - 0.09 * (dx + dz)).clamp(0.2, 1.0);
                let height = ((z(c, r) + 6.0) / 12.0).clamp(0.0, 1.0);
                let ground = [
                    0.45 + 0.35 * height,
                    0.62 - 0.1 * height,
                    0.35 + 0.1 * height,
                ];
                let on_road = t.surfaces[r * w + c] != Surface::OffTrack;
                let base = if on_road { [0.28, 0.28, 0.3] } else { ground };
                px.push(base.map(|v| (v * shade * 255.0).round().clamp(0.0, 255.0) as u8));
            }
        }
        ppm(
            &format!("overview-{biome:?}-seed1.ppm").to_lowercase(),
            w,
            h,
            &px,
        );
    }
    let mut best: Option<(f64, Map, usize)> = None;
    for seed in 0..40 {
        let map = generate(seed);
        let r = route(&map);
        let n = r.pts.len();
        for i in 0..n {
            let (a, b) = (r.pts[i], r.pts[(i + 12) % n]);
            let straight: f64 = (0..12)
                .map(|k| {
                    let (p, q) = (r.pts[(i + k) % n], r.pts[(i + k + 1) % n]);
                    (p.0 - q.0).hypot(p.1 - q.1)
                })
                .sum();
            let chord = (a.0 - b.0).hypot(a.1 - b.1);
            let ang = (b.1 - a.1).atan2(b.0 - a.0).to_degrees().abs() % 90.0;
            let score = (straight - chord) + (ang - 45.0).abs() * 0.05;
            if best.as_ref().is_none_or(|(s, _, _)| score < *s) {
                best = Some((score, map.clone(), i));
            }
        }
    }
    let (_, map, i) = best.unwrap();
    let r = route(&map);
    let centre = r.pts[(i + 6) % r.pts.len()];
    let paint = |spacing: f64| {
        let (size, scale) = (40.0f64, 8.0f64);
        let wpx = (size * scale) as usize;
        let mut px = Vec::with_capacity(wpx * wpx);
        for py in 0..wpx {
            for pxx in 0..wpx {
                let p = (
                    centre.0 + (pxx as f64 / scale - size / 2.0),
                    centre.1 + (py as f64 / scale - size / 2.0),
                );
                let g = (
                    (p.0 / spacing).round() * spacing,
                    (p.1 / spacing).round() * spacing,
                );
                let road = jj_procgen::assemble::distance_to_loop(&r.pts, g) <= r.half;
                let edge =
                    (jj_procgen::assemble::distance_to_loop(&r.pts, p) - r.half).abs() < 0.08;
                px.push(if edge {
                    [255, 60, 40]
                } else if road {
                    [70, 70, 76]
                } else {
                    [196, 170, 120]
                });
            }
        }
        (wpx, px)
    };
    let (w, a) = paint(10.0);
    let (_, b) = paint(f64::from(map.terrain.spacing) / 1000.0);
    let mut both = Vec::new();
    for y in 0..w {
        both.extend_from_slice(&a[y * w..(y + 1) * w]);
        both.extend_from_slice(&[[255, 255, 255]; 4]);
        both.extend_from_slice(&b[y * w..(y + 1) * w]);
    }
    ppm("road-edge-10m-vs-2.5m.ppm", 2 * w + 4, w, &both);
}
