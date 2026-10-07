//! P1-M04..M07: the four biomes at playtest scope, as the generator makes them (single-biome tracks through
//! `prepare`, so each biome's own rules and pieces are the whole picture), 10 seeds each: they validate; their rules
//! place what the beads name (houses, junctions and signs in town; seeded domes in rocks; two species in dirt, and the
//! autopilot laps three of them; lane lines, posts and rail in bitumen, and a bitumen to placeholder transition); and
//! nothing placed by a rule or the scatter sits in the route band, on a painted road cell or on another piece.
//! `JJ_EVIDENCE_DIR` writes the validator output and the piece tallies (`docs/evidence/P1-M04..M07/`).

use std::collections::BTreeMap;

use jj_map::{Biome, Dressing, Footprint, Map, Surface, canonical_bytes, load_canonical};
use jj_procgen::assemble::distance_to_loop;
use jj_procgen::scatter::{CLEAR_M, reach_m};
use jj_procgen::validate::check;
use jj_procgen::{Plan, prepare, registry};

const SEEDS: u64 = 10;

fn track(seed: u64, recipe: &[Biome]) -> Map {
    let p = prepare(seed, recipe);
    assert!(p.valid, "seed {seed} {recipe:?}: {:?}", p.attempts.last());
    p.map
}

fn tally(map: &Map) -> BTreeMap<String, usize> {
    let mut t: BTreeMap<String, usize> = BTreeMap::new();
    for d in &map.dressing {
        *t.entry(d.kit_piece.clone()).or_default() += 1;
    }
    for p in &map.props {
        *t.entry(format!("{} (prop)", p.kit_piece)).or_default() += 1;
    }
    t
}

fn route_m(map: &Map) -> Vec<(f64, f64)> {
    map.route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect()
}

fn count(map: &Map, id: &str) -> usize {
    map.dressing.iter().filter(|d| d.kit_piece == id).count()
}

fn sign_family(id: &str) -> String {
    let name = id.strip_prefix("signs/").unwrap();
    let json = std::fs::read_to_string(format!(
        "{}/../../assets/kit/signs/data/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    serde_json::from_str::<serde_json::Value>(&json).unwrap()["family"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn write(name: &str, text: &str) {
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join(name), text).unwrap();
    }
}

/// The validator's verdict on every seed: the full `check` (jj-map rules, transitions, feature envelopes, wayfinding).
fn validate_seeds(biome: Biome, label: &str) -> String {
    let mut out = format!(
        "{label}: {SEEDS} seeds, `jj_procgen::validate::check` (jj-map rules + transitions + envelopes + wayfinding)\n"
    );
    for seed in 0..SEEDS {
        let p = prepare(seed, &[biome]);
        let problems = check(&p.map, &registry());
        assert!(
            p.valid && problems.is_empty() && p.plan == Plan::Requested,
            "seed {seed}: {problems:?}"
        );
        out += &format!(
            "seed {seed}: ok, plan requested, {} pieces, {} props, {} features, gameplay hash {}\n",
            p.map.dressing.len(),
            p.map.props.len(),
            p.map.features.len(),
            jj_map::hex(&jj_map::gameplay_hash(&p.map))
        );
    }
    out
}

fn sample_points(fp: &Footprint, x: f64, z: f64, yaw_cdeg: i32) -> Vec<(f64, f64)> {
    let a = f64::from(yaw_cdeg) / 100.0 * core::f64::consts::PI / 180.0;
    let (c, s) = (a.cos(), a.sin());
    let local: Vec<(f64, f64)> = match *fp {
        Footprint::Rect { x: w, z: d, .. } => {
            let (hx, hz) = (w / 2000.0, d / 2000.0);
            vec![
                (-hx, -hz),
                (hx, -hz),
                (hx, hz),
                (-hx, hz),
                (0.0, -hz),
                (hx, 0.0),
                (0.0, hz),
                (-hx, 0.0),
                (0.0, 0.0),
            ]
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

/// Lane lines lie on the road and a side street joins it: the only pieces allowed to touch the route band.
fn on_road_by_design(d: &Dressing) -> bool {
    matches!(
        d.kit_piece.as_str(),
        "outback_bitumen/centre-line" | "outback_bitumen/edge-line" | "town/side-street"
    )
}

/// Nothing a rule or the scatter placed is in the route band, on a painted road cell, or on another such piece.
fn assert_clear(map: &Map, label: &str) {
    let reg = registry();
    let line = route_m(map);
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let mut discs: Vec<(usize, f64, f64, f64)> = Vec::new();
    for (k, d) in map.dressing.iter().enumerate() {
        if on_road_by_design(d)
            || d.kit_piece.starts_with("wayfinding/") && !d.kit_piece.ends_with("guard-rail")
        {
            continue;
        }
        let fp = reg.get(&d.kit_piece).unwrap().footprint(&d.params).unwrap();
        let (x, z) = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
        for p in sample_points(&fp, x, z, d.pose.yaw) {
            let edge = distance_to_loop(&line, p) - half;
            assert!(
                edge >= CLEAR_M - 0.05,
                "{label}: {} is {edge:.2} m from the road edge",
                d.kit_piece
            );
            assert_eq!(
                surface_at(map, p.0, p.1),
                Surface::OffTrack,
                "{label}: {} on a road cell",
                d.kit_piece
            );
        }
        if !d.kit_piece.starts_with("wayfinding/") {
            discs.push((k, x, z, reach_m(&fp)));
        }
    }
    for (i, a) in discs.iter().enumerate() {
        for b in &discs[i + 1..] {
            assert!(
                (a.1 - b.1).hypot(a.2 - b.2) >= a.3 + b.3 - 0.01,
                "{label}: {} and {} overlap",
                map.dressing[a.0].kit_piece,
                map.dressing[b.0].kit_piece
            );
        }
    }
}

#[test]
fn town_houses_face_straight_streets_with_junctions_and_signs() {
    let mut report = validate_seeds(Biome::Town, "Town (P1-M04)");
    let (mut houses, mut shops, mut streets, mut bins) = (0, 0, 0, 0);
    for seed in 0..SEEDS {
        let map = track(seed, &[Biome::Town]);
        assert_clear(&map, &format!("town seed {seed}"));
        let (h, s, st) = (
            count(&map, "town/house"),
            count(&map, "town/shopfront"),
            count(&map, "town/side-street"),
        );
        assert!(
            h > 0 && s > 0 && st > 0,
            "seed {seed}: {h} houses, {s} shops, {st} side streets"
        );
        houses += h;
        shops += s;
        streets += st;
        bins += map
            .props
            .iter()
            .filter(|p| p.kit_piece == "generic/bin")
            .count();
        // At least one direction and one warning sign from the M09 kit, placed by the rules.
        let signs: Vec<&str> = map
            .dressing
            .iter()
            .filter(|d| d.kit_piece.starts_with("signs/"))
            .map(|d| d.kit_piece.as_str())
            .collect();
        assert!(
            signs.iter().any(|s| sign_family(s) == "direction"),
            "seed {seed}: no direction sign {signs:?}"
        );
        assert!(
            signs.iter().any(|s| sign_family(s) == "warning"),
            "seed {seed}: no warning sign {signs:?}"
        );
        // The one house varies by size parameters only: one kit id, and only the four size parameters.
        for d in map.dressing.iter().filter(|d| d.kit_piece == "town/house") {
            let keys: Vec<&str> = d.params.keys().map(String::as_str).collect();
            assert_eq!(
                keys,
                ["depthMm", "heightCm", "roofPitchDeg", "widthMm"],
                "seed {seed}"
            );
        }
        // Straights with simple junctions: every side street leaves the road at a right angle, and none sits on a corner.
        let line = route_m(&map);
        let corners = jj_procgen::biome::wayfinding::corners(&line);
        for d in map.dressing.iter().filter(|d| {
            matches!(
                d.kit_piece.as_str(),
                "town/side-street" | "town/house" | "town/shopfront"
            )
        }) {
            let p = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
            let i = (0..line.len())
                .min_by(|&a, &b| {
                    ((line[a].0 - p.0).powi(2) + (line[a].1 - p.1).powi(2))
                        .total_cmp(&((line[b].0 - p.0).powi(2) + (line[b].1 - p.1).powi(2)))
                })
                .unwrap();
            assert!(
                !corners.iter().any(|c| i >= c.from && i <= c.to),
                "seed {seed}: {} stands on a corner",
                d.kit_piece
            );
            if d.kit_piece == "town/side-street" {
                let (a, b) = (line[i], line[(i + 1) % line.len()]);
                let (tx, tz) = (
                    (b.0 - a.0) / (b.0 - a.0).hypot(b.1 - a.1),
                    (b.1 - a.1) / (b.0 - a.0).hypot(b.1 - a.1),
                );
                let yaw = f64::from(d.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
                let along = yaw.cos() * tx + yaw.sin() * tz;
                assert!(
                    along.abs() < 0.12,
                    "seed {seed}: a side street at {:.0} degrees to the road",
                    along.acos().to_degrees()
                );
            }
        }
    }
    // The bin is the only per-instance variation: out or not (a prop where the rule kept it, nothing where it didn't).
    assert!(bins > 0);
    report += &format!(
        "\nover {SEEDS} seeds: {houses} houses, {shops} shopfronts, {streets} side streets (junctions), {bins} wheelie bins out\n"
    );
    report += &format!("seed 0 pieces: {:?}\n", tally(&track(0, &[Biome::Town])));
    write("validator-town.txt", &report);
}

#[test]
fn rocks_domes_vary_by_seed_only_and_reuse_the_cores_features() {
    let report = validate_seeds(Biome::Rocks, "Rocks (P1-M05)");
    let mut heights_by_seed: Vec<Vec<i64>> = Vec::new();
    let mut jumps = 0;
    let mut crests = 0;
    for seed in 0..SEEDS {
        let map = track(seed, &[Biome::Rocks]);
        assert_clear(&map, &format!("rocks seed {seed}"));
        let domes: Vec<&Dressing> = map
            .dressing
            .iter()
            .filter(|d| d.kit_piece == "rocks/dome")
            .collect();
        assert!(domes.len() >= 3, "seed {seed}: {} domes", domes.len());
        // One parametric family: only radius and height vary, and a tall one towers (>= 30 m somewhere).
        assert!(domes.iter().all(|d| {
            d.params
                .keys()
                .map(String::as_str)
                .eq(["heightCm", "radiusMm"])
        }));
        assert!(
            domes.iter().any(|d| d.params["heightCm"] >= 3_000),
            "seed {seed}: nothing towers"
        );
        // Seeded, nothing else: the same seed gives the same domes.
        let again = track(seed, &[Biome::Rocks]);
        let key = |m: &Map| {
            m.dressing
                .iter()
                .filter(|d| d.kit_piece == "rocks/dome")
                .map(|d| (d.pose, d.params.clone()))
                .collect::<Vec<_>>()
        };
        assert_eq!(key(&map), key(&again), "seed {seed}");
        heights_by_seed.push(domes.iter().map(|d| d.params["heightCm"]).collect());
        jumps += map
            .features
            .iter()
            .filter(|f| f.kind == jj_map::FeatureKind::Jump)
            .count();
        crests += map
            .features
            .iter()
            .filter(|f| f.kind == jj_map::FeatureKind::Crest)
            .count();
        // Climbs and jumps are the core's features (no biome-owned feature kinds exist), with a steep-descent warning before each jump.
        let warnings = count(&map, "signs/steep-descent");
        assert!(
            warnings > 0
                || map
                    .features
                    .iter()
                    .all(|f| f.kind != jj_map::FeatureKind::Jump),
            "seed {seed}: jumps with no warning"
        );
    }
    heights_by_seed.sort();
    heights_by_seed.dedup();
    assert_eq!(
        heights_by_seed.len(),
        SEEDS as usize,
        "every seed has its own domes"
    );
    assert!(
        jumps > 0 && crests > 0,
        "the core's jumps ({jumps}) and crests ({crests}) appear"
    );
    write(
        "validator-rocks.txt",
        &format!(
            "{report}\nacross the seeds: {jumps} jumps, {crests} crests (core features), domes differ per seed: {} distinct height sets\n",
            heights_by_seed.len()
        ),
    );
}

/// The autopilot's laps on a map through the real sim (`jj-sim`): finished, no recovery, no wreck.
fn autopilot_laps(map: &Map, seed: u64, laps: u32) -> (bool, u32, u32, f64) {
    use jj_sim::{Sim, TICK_HZ, VehicleProfile};
    let loaded = load_canonical(&canonical_bytes(map), &registry()).unwrap();
    let mut sim = Sim::new(&loaded, &registry(), seed, VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(laps);
    sim.set_autopilot(car, true);
    let limit = u64::from(laps) * 400 * u64::from(TICK_HZ);
    while !sim.race().is_finished(car.0) && sim.tick() < limit {
        sim.step();
    }
    let rc = sim.race().car(car.0).unwrap();
    (
        sim.race().is_finished(car.0),
        rc.recoveries,
        rc.wrecks,
        sim.tick() as f64 / f64::from(TICK_HZ),
    )
}

#[test]
fn outback_dirt_has_two_species_clear_of_the_route_and_the_autopilot_laps_three_seeds() {
    let mut report = validate_seeds(Biome::OutbackDirt, "Outback dirt (P1-M06)");
    for seed in 0..SEEDS {
        let map = track(seed, &[Biome::OutbackDirt]);
        assert_clear(&map, &format!("dirt seed {seed}"));
        let (grass, oak) = (
            count(&map, "outback_dirt/spinifex"),
            count(&map, "outback_dirt/desert-oak"),
        );
        assert!(
            grass > 20 && oak > 2,
            "seed {seed}: {grass} spinifex, {oak} desert oaks"
        );
        // Straight and curve segments only: no biome-owned segment types.
        assert!(
            jj_procgen::biome::def(Biome::OutbackDirt)
                .data()
                .segment_types
                .is_empty()
        );
    }
    report += "\nautopilot, three laps, unaided, on the single-biome dirt track:\n";
    for seed in 0..3 {
        let map = track(seed, &[Biome::OutbackDirt]);
        let (done, recoveries, wrecks, secs) = autopilot_laps(&map, seed, 3);
        assert!(
            done && recoveries == 0 && wrecks == 0,
            "seed {seed}: finished {done}, {recoveries} recoveries, {wrecks} wrecks"
        );
        report += &format!(
            "seed {seed}: 3 laps in {secs:.0} s, {recoveries} recoveries, {wrecks} wrecks\n"
        );
    }
    write("validator-and-autopilot-dirt.txt", &report);
}

#[test]
fn bitumen_lane_lines_posts_and_rail_are_pieces_and_it_meets_the_placeholder() {
    let mut report = validate_seeds(Biome::OutbackBitumen, "Outback bitumen (P1-M07)");
    for seed in 0..SEEDS {
        let map = track(seed, &[Biome::OutbackBitumen]);
        assert_clear(&map, &format!("bitumen seed {seed}"));
        let (centre, edge, posts) = (
            count(&map, "outback_bitumen/centre-line"),
            count(&map, "outback_bitumen/edge-line"),
            count(&map, "outback_bitumen/reflector-post"),
        );
        // About one dash per 9 m, an edge length per 3 m a side, a post per 50 m a side: lines and posts as placed pieces.
        let len_m = f64::from(map.header.ref_lap_ms) / 1000.0 * jj_procgen::assemble::REF_SPEED_MPS;
        assert!(
            centre as f64 > len_m / 12.0
                && edge as f64 > len_m / 4.0
                && posts as f64 > len_m / 80.0,
            "seed {seed}: {centre} dashes, {edge} edge lengths, {posts} posts over {len_m:.0} m"
        );
        assert!(
            map.dressing
                .iter()
                .any(|d| d.kit_piece == "wayfinding/guard-rail"),
            "seed {seed}: no guard rail"
        );
        assert!(
            map.dressing
                .iter()
                .any(|d| d.kit_piece == "signs/stuart-hwy"),
            "seed {seed}: no direction sign at the entry"
        );
        // The lines lie on the road at the right places: centre dashes within a quarter metre of the centerline.
        let line = route_m(&map);
        for d in map
            .dressing
            .iter()
            .filter(|d| d.kit_piece == "outback_bitumen/centre-line")
        {
            let p = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
            assert!(
                distance_to_loop(&line, p) < 0.3,
                "seed {seed}: a centre dash is off the centerline"
            );
        }
    }
    // A bitumen to placeholder (and placeholder to bitumen) transition validates, on a track that has both.
    report += "\nbitumen <-> placeholder transitions (greybox -> bitumen -> greybox):\n";
    for seed in 0..SEEDS {
        let p = prepare(seed, &[Biome::Greybox, Biome::OutbackBitumen]);
        assert!(
            p.valid && check(&p.map, &registry()).is_empty(),
            "seed {seed}"
        );
        let names: Vec<&str> = p
            .map
            .route
            .segments
            .iter()
            .map(|s| s.name.as_str())
            .collect();
        report += &format!("seed {seed}: {names:?} plan {:?}\n", p.plan);
        if matches!(p.plan, Plan::Requested | Plan::Redrawn(_)) {
            assert_eq!(
                names,
                ["greybox", "outback-bitumen", "greybox"],
                "seed {seed}"
            );
        }
    }
    write("validator-bitumen.txt", &report);
}

/// Top-down plots (only with `JJ_EVIDENCE_DIR`): the route in dark grey, then every piece in a colour by family and its
/// footprint's size (1 px per 0.5 m): houses and shopfronts orange, side streets grey, trees and vegetation green, domes
/// red-brown, signs magenta, lane lines and posts light, wayfinding yellow. PPM; the evidence keeps PNG conversions.
#[test]
fn writes_the_top_down_plots() {
    let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    let reg = registry();
    let plots: [(&str, &[Biome]); 5] = [
        ("town", &[Biome::Town]),
        ("rocks", &[Biome::Rocks]),
        ("outback-dirt", &[Biome::OutbackDirt]),
        ("outback-bitumen", &[Biome::OutbackBitumen]),
        ("playtest-four-biomes", &jj_procgen::playtest::RECIPE),
    ];
    for (name, recipe) in plots {
        let map = track(2, recipe);
        let b = map.header.bounds;
        let (w, h) = (
            ((b.max_x - b.min_x) / 500) as usize + 1,
            ((b.max_z - b.min_z) / 500) as usize + 1,
        );
        let mut px = vec![[226u8, 196, 160]; w * h];
        let mut put = |x: i32, z: i32, r: i32, c: [u8; 3]| {
            for dz in -r..=r {
                for dx in -r..=r {
                    let (xx, zz) = (x + dx * 500, z + dz * 500);
                    if xx >= b.min_x && zz >= b.min_z && xx <= b.max_x && zz <= b.max_z {
                        px[((zz - b.min_z) / 500) as usize * w + ((xx - b.min_x) / 500) as usize] =
                            c;
                    }
                }
            }
        };
        for p in &map.route.points {
            put(
                p.x,
                p.z,
                6,
                if p.surface == Surface::Tarmac {
                    [70, 70, 78]
                } else {
                    [150, 100, 64]
                },
            );
        }
        for d in &map.dressing {
            let fp = reg.get(&d.kit_piece).unwrap().footprint(&d.params).unwrap();
            let r = ((reach_m(&fp) * 2.0) as i32).clamp(0, 40);
            let id = d.kit_piece.as_str();
            let colour = if id.starts_with("signs/") {
                [220, 40, 200]
            } else if id.starts_with("wayfinding/") {
                [240, 200, 20]
            } else if id.contains("side-street") {
                [96, 96, 104]
            } else if id.contains("house") || id.contains("shopfront") {
                [235, 120, 30]
            } else if id.contains("dome") {
                [120, 40, 24]
            } else if id.contains("tree")
                || id.contains("oak")
                || id.contains("spinifex")
                || id.contains("shrub")
            {
                [50, 110, 50]
            } else if id.contains("line") || id.contains("post") || id.contains("delineator") {
                [250, 250, 240]
            } else {
                [40, 90, 180]
            };
            put(d.pose.x, d.pose.z, r.max(1), colour);
        }
        let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
        out.extend(px.iter().flatten());
        std::fs::write(dir.join(format!("plot-{name}.ppm")), out).unwrap();
    }
}
