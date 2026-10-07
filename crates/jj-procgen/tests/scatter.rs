//! P1-M03e seed bank: the scatter never puts anything in the route band, on a painted road cell, in the start corridor
//! or on a jump landing; pieces never overlap; Poisson biomes are even and cluster biomes clump with clearings between;
//! and the bitumen Poisson radius is checked against M02's recommendation. `JJ_EVIDENCE_DIR` writes the tables and the
//! capture (`docs/evidence/P1-M03e/`).

use jj_map::{Biome, FeatureKind, Footprint, Map, Surface, validate};
use jj_procgen::assemble::distance_to_loop;
use jj_procgen::features::place;
use jj_procgen::generate;
use jj_procgen::scatter::{
    Algorithm, BITUMEN_RADIUS_M, CLEAR_M, GAP_M, Spec, clark_evans, nn_stats, reach_m, scatter,
    spec,
};
use jj_procgen::seed::Rng;
use jj_procgen::terrain::{params, undulate};

const BIOMES: [Biome; 5] = [
    Biome::Greybox,
    Biome::Town,
    Biome::OutbackBitumen,
    Biome::OutbackDirt,
    Biome::Rocks,
];
/// The bank: a sample, not a limit (`JJ_SEEDS=N` widens it). A debug build is ~20x slower, so it samples fewer.
const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 20 } else { 100 };

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

/// The seed's route with `biome`'s terrain and features, and the given scatter spec applied.
fn map_with(seed: u64, biome: Biome, spec: &Spec) -> Map {
    let mut m = generate(seed);
    undulate(&mut m, &mut Rng::stream(seed, "terrain"), &params(biome));
    place(&mut m, &mut Rng::stream(seed, "features"), biome);
    scatter(
        &mut m,
        &mut Rng::stream(seed, "dressing.test"),
        spec,
        &jj_procgen::registry(),
    );
    m
}

/// The scatter's own pieces (not the road furniture the core places).
fn scattered(map: &Map) -> Vec<jj_map::Dressing> {
    map.dressing
        .iter()
        .filter(|d| !d.kit_piece.starts_with("wayfinding/"))
        .cloned()
        .collect()
}

fn biome_map(seed: u64, biome: Biome) -> Map {
    map_with(seed, biome, &spec(biome))
}

fn route_m(map: &Map) -> Vec<(f64, f64)> {
    map.route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect()
}

/// A piece's footprint sample points (corners, edge midpoints, centre; or a ring), world metres.
fn sample_points(fp: &Footprint, x: f64, z: f64, yaw_cdeg: i32) -> Vec<(f64, f64)> {
    let a = f64::from(yaw_cdeg) / 100.0 * core::f64::consts::PI / 180.0;
    let (c, s) = (a.cos(), a.sin());
    let local: Vec<(f64, f64)> = match *fp {
        Footprint::Rect { x: w, z: d, .. } => {
            let (hx, hz) = (w / 2000.0, d / 2000.0);
            [
                (-1.0, -1.0),
                (1.0, -1.0),
                (1.0, 1.0),
                (-1.0, 1.0),
                (0.0, -1.0),
                (1.0, 0.0),
                (0.0, 1.0),
                (-1.0, 0.0),
                (0.0, 0.0),
            ]
            .iter()
            .map(|(p, q)| (p * hx, q * hz))
            .collect()
        }
        Footprint::Circle { radius, .. } => (0..8)
            .map(|k| {
                let t = f64::from(k) * core::f64::consts::TAU / 8.0;
                (radius / 1000.0 * t.cos(), radius / 1000.0 * t.sin())
            })
            .chain([(0.0, 0.0)])
            .collect(),
    };
    local
        .iter()
        .map(|(lx, lz)| (x + lx * c - lz * s, z + lx * s + lz * c))
        .collect()
}

fn surface_at(map: &Map, x: f64, z: f64) -> Surface {
    let t = &map.terrain;
    let sp = f64::from(t.spacing) / 1000.0;
    let c = ((x - f64::from(t.origin_x) / 1000.0) / sp)
        .round()
        .clamp(0.0, f64::from(t.cols - 1)) as usize;
    let r = ((z - f64::from(t.origin_z) / 1000.0) / sp)
        .round()
        .clamp(0.0, f64::from(t.rows - 1)) as usize;
    t.surfaces[r * t.cols as usize + c]
}

#[test]
fn nothing_is_placed_in_the_route_band_corridor_surfaces_or_landings_across_the_seed_bank() {
    let registry = jj_procgen::registry();
    let mut total = 0;
    for seed in 0..seeds() {
        for biome in BIOMES {
            let map = biome_map(seed, biome);
            let line = route_m(&map);
            let half = f64::from(map.route.points[0].width) / 2000.0;
            assert!(
                !map.dressing.is_empty(),
                "seed {seed} {biome:?}: nothing scattered"
            );
            total += map.dressing.len();
            let r = validate(&map, &registry);
            assert!(r.ok, "seed {seed} {biome:?}: {:?}", r.violations);
            // The start corridor: from the start point back along the route, at the corridor's width.
            let st = map.route.start;
            let n = line.len();
            let corridor: Vec<(f64, f64)> = (0..=(f64::from(st.length) / 2500.0) as usize + 2)
                .map(|k| line[(st.at as usize + n - k) % n])
                .collect();
            let mut reaches = Vec::new();
            for d in &map.dressing {
                let fp = registry
                    .get(&d.kit_piece)
                    .unwrap()
                    .footprint(&d.params)
                    .unwrap();
                let (x, z) = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
                for p in sample_points(&fp, x, z, d.pose.yaw) {
                    let edge = distance_to_loop(&line, p) - half;
                    assert!(
                        edge >= CLEAR_M - 0.02,
                        "seed {seed} {biome:?}: {} {edge:.2} m from the road edge",
                        d.kit_piece
                    );
                    assert_eq!(
                        surface_at(&map, p.0, p.1),
                        Surface::OffTrack,
                        "seed {seed} {biome:?}: {} on a road cell",
                        d.kit_piece
                    );
                    let to_corridor = corridor
                        .iter()
                        .map(|c| (c.0 - p.0).hypot(c.1 - p.1))
                        .fold(f64::INFINITY, f64::min);
                    assert!(
                        to_corridor > f64::from(st.width) / 2000.0,
                        "seed {seed} {biome:?}: {} in the start corridor",
                        d.kit_piece
                    );
                    for f in map.features.iter().filter(|f| f.kind == FeatureKind::Jump) {
                        let far = (f64::from(f.pose.x) / 1000.0 - p.0)
                            .hypot(f64::from(f.pose.z) / 1000.0 - p.1);
                        assert!(far > 3.0, "seed {seed} {biome:?}: a piece stands on a jump");
                    }
                }
                if !d.kit_piece.starts_with("wayfinding/") {
                    reaches.push((x, z, reach_m(&fp)));
                }
            }
            // No two footprints overlap (circumradii, so conservative).
            for i in 0..reaches.len() {
                for j in i + 1..reaches.len() {
                    let (a, b) = (reaches[i], reaches[j]);
                    assert!(
                        (a.0 - b.0).hypot(a.1 - b.1) >= a.2 + b.2 + GAP_M - 1e-3,
                        "seed {seed} {biome:?}: pieces {i} and {j} overlap"
                    );
                }
            }
        }
    }
    println!("{total} pieces scattered over {} seeds x 5 biomes", seeds());
}

#[test]
fn scatter_is_a_pure_function_of_the_dressing_stream() {
    for seed in [0u64, 9, u64::MAX] {
        for biome in BIOMES {
            assert_eq!(
                biome_map(seed, biome).dressing,
                biome_map(seed, biome).dressing
            );
        }
        let a = biome_map(seed, Biome::OutbackDirt);
        let mut b = generate(seed);
        undulate(
            &mut b,
            &mut Rng::stream(seed, "terrain"),
            &params(Biome::OutbackDirt),
        );
        place(
            &mut b,
            &mut Rng::stream(seed, "features"),
            Biome::OutbackDirt,
        );
        scatter(
            &mut b,
            &mut Rng::stream(seed ^ 1, "dressing.test"),
            &spec(Biome::OutbackDirt),
            &jj_procgen::registry(),
        );
        assert_ne!(
            a.dressing, b.dressing,
            "another dressing stream scatters differently"
        );
        assert_eq!(a.route, b.route, "and never moves the route");
    }
}

/// Fraction of 30 m squares over the bounds that hold no piece (clearings).
fn clearing_share(map: &Map) -> f64 {
    let b = map.header.bounds;
    let cell = 30_000;
    let (cols, rows) = (
        ((b.max_x - b.min_x) / cell + 1) as usize,
        ((b.max_z - b.min_z) / cell + 1) as usize,
    );
    let mut used = vec![false; cols * rows];
    for d in &scattered(map) {
        used[((d.pose.z - b.min_z) / cell) as usize * cols
            + ((d.pose.x - b.min_x) / cell) as usize] = true;
    }
    used.iter().filter(|u| !**u).count() as f64 / used.len() as f64
}

#[test]
fn poisson_biomes_are_even_and_cluster_biomes_clump_with_clearings() {
    let mut table = String::from(
        "biome            algorithm  pieces(mean)  nnCv(mean)  Clark-Evans R  empty 30 m squares(mean)\n",
    );
    for biome in BIOMES {
        let n = seeds().min(30);
        let (mut count, mut cv, mut empty, mut ce) = (0.0, 0.0, 0.0, 0.0);
        for seed in 0..n {
            let m = biome_map(seed, biome);
            count += scattered(&m).len() as f64;
            cv += nn_stats(&scattered(&m)).1;
            empty += clearing_share(&m);
            let bb = m.header.bounds;
            ce += clark_evans(
                &scattered(&m),
                f64::from(bb.max_x - bb.min_x) * f64::from(bb.max_z - bb.min_z) / 1.0e6,
            );
        }
        let (count, cv, empty, ce) = (
            count / n as f64,
            cv / n as f64,
            empty / n as f64,
            ce / n as f64,
        );
        let clustered = matches!(spec(biome).algorithm, Algorithm::Cluster { .. });
        table += &format!(
            "{:<16} {:<10} {count:>12.0}  {cv:>10.2}  {ce:>13.2}  {empty:>10.2}\n",
            format!("{biome:?}"),
            if clustered { "cluster" } else { "poisson" }
        );
        if clustered {
            assert!(ce < 1.0, "{biome:?} should clump: Clark-Evans {ce:.2}");
            assert!(empty > 0.3, "{biome:?} should leave clearings: {empty:.2}");
        } else {
            assert!(
                cv < 0.45 && ce > 1.0,
                "{biome:?} should be even: nnCv {cv:.2}, Clark-Evans {ce:.2}"
            );
        }
    }
    println!("{table}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("distribution.txt"), table).unwrap();
    }
}

#[test]
fn bitumen_poisson_radius_confirms_m02s_recommendation() {
    // M02 (8 seeds, bitumen): Poisson at 12 m nnCv 0.25; Mitchell best-candidate 0.30; cluster 0.68. Its recommendation:
    // bitumen ships Poisson at a larger radius and not a third algorithm. Confirmed if a larger radius is no clumpier
    // than best-candidate (0.30) and stays well under cluster's.
    let mut table = String::from(
        "radius(m)  pieces(mean)  nnCv(mean)   (M02: poisson 12 m 0.25, best-candidate 0.30, cluster 0.68)\n",
    );
    let n = seeds().min(40);
    let mut at_chosen = f64::NAN;
    for radius_m in [8.0, 12.0, 18.0, 24.0, 32.0] {
        let sp = Spec {
            algorithm: Algorithm::Poisson { radius_m },
            ..spec(Biome::OutbackBitumen)
        };
        let (mut count, mut cv) = (0.0, 0.0);
        for seed in 0..n {
            let m = map_with(seed, Biome::OutbackBitumen, &sp);
            count += scattered(&m).len() as f64;
            cv += nn_stats(&scattered(&m)).1;
        }
        let (count, cv) = (count / n as f64, cv / n as f64);
        table += &format!(
            "{radius_m:>9.0}  {count:>12.0}  {cv:>10.2}{}\n",
            if radius_m == BITUMEN_RADIUS_M {
                "   <- shipped"
            } else {
                ""
            }
        );
        if radius_m == BITUMEN_RADIUS_M {
            at_chosen = cv;
        }
    }
    println!("{table}");
    assert!(
        at_chosen <= 0.30,
        "bitumen at {BITUMEN_RADIUS_M} m should be as even as best-candidate: nnCv {at_chosen:.2}"
    );
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("bitumen-radius.txt"), table).unwrap();
    }
}

/// Capture (only with `JJ_EVIDENCE_DIR`): top-down plots of one seed per distribution, route in dark grey, each piece a
/// dot (buildings orange, posts blue), 1 px per 0.5 m. PPM.
#[test]
fn writes_the_capture() {
    let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    for (name, biome) in [
        ("town-cluster", Biome::Town),
        ("rocks-cluster", Biome::Rocks),
        ("dirt-poisson", Biome::OutbackDirt),
        ("bitumen-poisson", Biome::OutbackBitumen),
    ] {
        let m = biome_map(1, biome);
        let b = m.header.bounds;
        let (w, h) = (
            ((b.max_x - b.min_x) / 500) as usize + 1,
            ((b.max_z - b.min_z) / 500) as usize + 1,
        );
        let mut px = vec![[222u8, 214, 190]; w * h];
        let inside = |x: i32, z: i32| x >= b.min_x && z >= b.min_z && x <= b.max_x && z <= b.max_z;
        let at =
            |x: i32, z: i32| ((z - b.min_z) / 500) as usize * w + ((x - b.min_x) / 500) as usize;
        for p in &m.route.points {
            for dz in -6..=6i32 {
                for dx in -6..=6i32 {
                    let (x, z) = (p.x + dx * 500, p.z + dz * 500);
                    if dx * dx + dz * dz <= 36 && inside(x, z) {
                        px[at(x, z)] = [70, 70, 76];
                    }
                }
            }
        }
        for d in &m.dressing {
            let big = d.kit_piece == "generic/box-building";
            let (colour, r) = if big {
                ([220, 110, 30], 4)
            } else {
                ([40, 90, 180], 2)
            };
            for dz in -r..=r {
                for dx in -r..=r {
                    let (x, z) = (d.pose.x + dx * 500, d.pose.z + dz * 500);
                    if inside(x, z) {
                        px[at(x, z)] = colour;
                    }
                }
            }
        }
        let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
        out.extend(px.iter().flatten());
        std::fs::write(dir.join(format!("scatter-{name}-seed1.ppm")), out).unwrap();
    }
}
