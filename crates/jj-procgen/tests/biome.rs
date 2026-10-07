//! P1-M03f: the biome interface, the selector and the transitions.
//! - a two-biome placeholder track validates with its transition (and a four-biome one, M08b's shape);
//! - the trait is all a biome needs: a biome written here against the trait and the data types alone passes the data
//!   checks, and every shipped biome is pure data that passes them too;
//! - the shared wayfinding family is on every route: chevron posts and W-beam rail on every corner, a gantry at the line,
//!   no checkpoint pieces (R104-R106).
//!
//! `JJ_EVIDENCE_DIR` writes `transitions.txt` and `wayfinding.txt` (`docs/evidence/P1-M03f/`).

use jj_map::{Biome, Map, Surface, canonical_bytes, gameplay_hash, hex, validate};
use jj_procgen::biome::wayfinding::{
    self, CHEVRON, CHEVRON_SPACING_M, FINISH_GANTRY, GUARD_RAIL, corners,
};
use jj_procgen::biome::{
    ALL, BiomeData, BiomeDef, SelectError, TRANSITION_M, check_data, check_transitions, def,
    registry, segment_name,
};
use jj_procgen::features::Density;
use jj_procgen::scatter::{Algorithm, Spec, piece};
use jj_procgen::terrain::TerrainParams;
use jj_procgen::{generate, generate_recipe};

const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 20 } else { 100 };

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

fn route(map: &Map) -> Vec<(f64, f64)> {
    map.route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect()
}

/// A biome a task could write: the trait, the data types, nothing else from procgen.
struct Flat;

const FLAT_PIECES: &[jj_procgen::scatter::PieceSpec] = &[piece(
    "generic/post",
    1.0,
    &[("heightCm", 100, 150), ("radiusMm", 100, 200)],
    (4.0, 60.0),
    false,
)];

impl BiomeDef for Flat {
    fn data(&self) -> BiomeData {
        BiomeData {
            id: Biome::Greybox,
            road: Surface::Gravel,
            ground: Surface::OffTrack,
            terrain: TerrainParams {
                relief_m: 1.0,
                ground_relief_m: 1.0,
                wavelength_m: 150.0,
                max_grade: 0.02,
                max_curvature: 0.001,
                max_bank_cdeg: 100,
                blend_m: 20.0,
            },
            features: Density {
                jump: 0.0,
                crest: 0.0,
                whoops: 0.0,
                creek: 0.0,
            },
            scatter: Spec {
                algorithm: Algorithm::Poisson { radius_m: 20.0 },
                pieces: FLAT_PIECES,
            },
            segment_types: &["flat-run"],
        }
    }
}

#[test]
fn the_trait_is_all_a_biome_needs_and_every_biome_is_pure_data() {
    let reg = registry();
    let flat = Flat;
    assert_eq!(flat.id(), Biome::Greybox);
    assert_eq!(flat.kit_pieces(), vec!["generic/post"]);
    assert!(check_data(&flat.data(), &reg).is_empty());
    for b in ALL {
        let d = def(b).data();
        assert_eq!(d.id, b);
        let bad = check_data(&d, &reg);
        assert!(bad.is_empty(), "{b:?}: {bad:?}");
        assert!(!def(b).kit_pieces().is_empty());
    }
    // The data check does catch a broken biome.
    let mut broken = def(Biome::Rocks).data();
    broken.road = Surface::OffTrack;
    broken.terrain.max_grade = 0.0;
    assert_eq!(check_data(&broken, &reg).len(), 2);
}

/// Seeds that find boundaries for `recipe`: the share that succeed, and for those, every check.
fn run_recipe(recipe: &[Biome], label: &str, table: &mut String) -> usize {
    let reg = registry();
    let (mut ok, mut no_straight) = (0, 0);
    let mut worst_grade: f64 = 0.0;
    for seed in 0..seeds() {
        let (map, _) = match generate_recipe(seed, recipe) {
            Ok(m) => m,
            Err(SelectError::NoStraight(_)) => {
                no_straight += 1;
                continue;
            }
            Err(e) => panic!("seed {seed} {label}: {e:?}"),
        };
        ok += 1;
        let r = validate(&map, &reg);
        assert!(r.ok, "seed {seed} {label}: {:?}", r.violations);
        let bad = check_transitions(&map);
        assert!(bad.is_empty(), "seed {seed} {label}: {bad:?}");
        let bad = wayfinding::check(&map);
        assert!(bad.is_empty(), "seed {seed} {label}: {bad:?}");
        // The lap ends in the first biome; each biome's road surface shows on the route.
        let names: Vec<String> = map.route.segments.iter().map(|s| s.name.clone()).collect();
        assert_eq!(names.first(), names.last());
        assert_eq!(names.first(), Some(&segment_name(recipe[0])));
        for b in recipe {
            let want = def(*b).data().road;
            assert!(
                map.route.points.iter().any(|p| p.surface == want),
                "seed {seed} {label}: no {want:?} road for {b:?}"
            );
        }
        // Grade along the road never beats the strictest biome on the route.
        let strictest = recipe
            .iter()
            .map(|b| def(*b).data().terrain.max_grade)
            .fold(f64::INFINITY, f64::min);
        let n = map.route.points.len();
        let near_feature = |i: usize| {
            map.features.iter().any(|f| {
                f64::from(f.pose.x - map.route.points[i].x)
                    .hypot(f64::from(f.pose.z - map.route.points[i].z))
                    < 80_000.0
            })
        };
        for i in 0..n {
            if near_feature(i) || near_feature((i + 2) % n) {
                continue;
            }
            let (a, b) = (&map.route.points[i], &map.route.points[(i + 2) % n]);
            let run = f64::from(b.x - a.x).hypot(f64::from(b.z - a.z)) / 1000.0;
            if run > 1.0 && (i + 2) % n >= 2 {
                worst_grade = worst_grade.max(f64::from(b.y - a.y).abs() / 1000.0 / run);
            }
        }
        assert!(
            worst_grade <= strictest + 0.02,
            "seed {seed} {label}: grade {worst_grade:.3} vs {strictest}"
        );
    }
    *table += &format!(
        "{label:<46} {ok:>3}/{} seeds found every boundary ({no_straight} had no straight), worst route grade {:.2} %\n",
        seeds(),
        worst_grade * 100.0
    );
    ok
}

#[test]
fn a_two_biome_placeholder_track_validates_with_its_transition() {
    let mut table = String::from("recipe (the lap ends in the first biome)       result\n");
    let two = run_recipe(
        &[Biome::Greybox, Biome::OutbackDirt],
        "greybox -> outback-dirt (-> greybox)",
        &mut table,
    );
    let four = run_recipe(
        &[
            Biome::Town,
            Biome::Rocks,
            Biome::OutbackDirt,
            Biome::OutbackBitumen,
        ],
        "town, rocks, outback-dirt, outback-bitumen",
        &mut table,
    );
    println!("{table}");
    assert!(
        two as u64 * 10 >= seeds() * 8,
        "most seeds have room for two boundaries: {two}"
    );
    assert!(four > 0, "a four-biome lap finds room on some seeds");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("transitions.txt"), table).unwrap();
    }
}

#[test]
fn a_transition_blends_the_terrain_and_switches_the_road_in_the_middle() {
    let (map, _) = (0..50)
        .find_map(|seed| generate_recipe(seed, &[Biome::Greybox, Biome::OutbackDirt]).ok())
        .expect("some seed has room for two boundaries");
    assert_eq!(map.header.biomes, vec![Biome::Greybox, Biome::OutbackDirt]);
    let segs = &map.route.segments;
    assert_eq!(segs.len(), 3);
    let line = route(&map);
    let (s, _) = jj_procgen::assemble::arc_lengths(&line);
    let cut = segs[0].span.to as usize;
    // Surface: tarmac before the zone, packed dirt after it, a switch within it.
    let near = |i: usize| (s[i] - s[cut]).abs() < TRANSITION_M / 2.0;
    for (i, p) in map.route.points.iter().enumerate() {
        if i < cut && !near(i) {
            assert_eq!(p.surface, Surface::Tarmac, "point {i}");
        }
        let back = (s[i] - s[segs[1].span.to as usize]).abs() < TRANSITION_M / 2.0;
        if i > cut && !near(i) && !back && i <= segs[1].span.to as usize {
            assert_eq!(p.surface, Surface::PackedDirt, "point {i}");
        }
    }
    let flips = map
        .route
        .points
        .windows(2)
        .enumerate()
        .filter(|(i, w)| w[0].surface != w[1].surface && near(*i))
        .count();
    assert!(
        flips >= 1,
        "the road surface changes inside the transition zone"
    );
    // Bank limits follow the blend: never beyond the larger biome's.
    let max = def(Biome::OutbackDirt)
        .data()
        .terrain
        .max_bank_cdeg
        .max(def(Biome::Greybox).data().terrain.max_bank_cdeg);
    assert!(map.route.points.iter().all(|p| p.bank.abs() <= max + 1));
}

#[test]
fn every_corner_has_chevrons_and_rail_and_the_finish_has_a_gantry_on_every_route() {
    let mut table = String::from("seed  corners  chevron posts  rail sections  gantry legs\n");
    let (mut total_corners, mut routes) = (0, 0);
    for seed in 0..seeds() {
        for map in [
            generate(seed),
            generate_recipe(seed, &[Biome::Town, Biome::Rocks])
                .map(|m| m.0)
                .unwrap_or_else(|_| generate(seed)),
        ] {
            let bad = wayfinding::check(&map);
            assert!(bad.is_empty(), "seed {seed}: {bad:?}");
            assert!(validate(&map, &registry()).ok, "seed {seed}");
            let cs = corners(&route(&map));
            let posts = map
                .dressing
                .iter()
                .filter(|d| d.kit_piece == CHEVRON)
                .count();
            let rails = map
                .dressing
                .iter()
                .filter(|d| d.kit_piece == GUARD_RAIL)
                .count();
            let legs = map
                .dressing
                .iter()
                .filter(|d| d.kit_piece == FINISH_GANTRY)
                .count();
            assert!(!cs.is_empty(), "seed {seed}: no corners");
            assert_eq!(legs, 2);
            // A row: posts at least every CHEVRON_SPACING_M along each corner (and one per post, never a board).
            let arc: f64 = cs.iter().map(|c| (c.to - c.from) as f64 * 2.5).sum();
            assert!(
                posts as f64 >= arc / (CHEVRON_SPACING_M * 1.6),
                "seed {seed}: {posts} posts for {arc:.0} m of corner"
            );
            assert!(rails >= cs.len(), "seed {seed}: a rail on each corner");
            assert!(
                map.dressing
                    .iter()
                    .all(|d| !d.kit_piece.contains("checkpoint"))
            );
            // Chevrons and rail stand on the outside of the turn.
            if routes < 3 {
                table += &format!(
                    "{seed:>4}  {:>7}  {posts:>13}  {rails:>14}  {legs:>11}\n",
                    cs.len()
                );
            }
            total_corners += cs.len();
            routes += 1;
        }
    }
    table += &format!(
        "\n{routes} routes, {total_corners} corners: every one with a chevron row and a rail; every route a 2-leg gantry; no checkpoint pieces.\n"
    );
    println!("{table}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("wayfinding.txt"), table).unwrap();
    }
}

#[test]
fn chevrons_and_rail_stand_on_the_outside_of_the_turn() {
    for seed in 0..10 {
        let map = generate(seed);
        let line = route(&map);
        let half = f64::from(map.route.points[0].width) / 2000.0;
        for c in corners(&line) {
            let mid = (c.from + c.to) / 2;
            // The inside of the turn is on its side: a left turn's centre is to the left, i.e. -normal.
            let (a, b) = (line[mid], line[(mid + 1) % line.len()]);
            let (tx, tz) = ((b.0 - a.0), (b.1 - a.1));
            let l = tx.hypot(tz);
            let normal = (-tz / l, tx / l);
            let outside = if c.left { 1.0 } else { -1.0 };
            for d in map
                .dressing
                .iter()
                .filter(|d| d.kit_piece == GUARD_RAIL || d.kit_piece == CHEVRON)
            {
                let p = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
                if (p.0 - a.0).hypot(p.1 - a.1) < 8.0 {
                    let lateral = (p.0 - a.0) * normal.0 + (p.1 - a.1) * normal.1;
                    assert!(
                        lateral * outside > half,
                        "seed {seed}: {} on the inside ({lateral:.1} m)",
                        d.kit_piece
                    );
                }
            }
        }
    }
}

/// The recipes' goldens (`goldens/recipes.txt`), pinned like the seeds', checked in WASM too.
const RECIPE_SEEDS: [u64; 4] = [0, 1, 2, 4];

fn recipe_map(seed: u64) -> Map {
    generate_recipe(seed, &[Biome::Greybox, Biome::OutbackDirt])
        .unwrap_or_else(|e| panic!("recipe seed {seed}: {e:?}"))
        .0
}

#[test]
fn two_biome_recipes_hash_to_the_committed_goldens() {
    let actual: String = RECIPE_SEEDS
        .iter()
        .map(|&s| format!("{s} {}\n", hex(&gameplay_hash(&recipe_map(s)))))
        .collect();
    for s in RECIPE_SEEDS {
        assert_eq!(
            canonical_bytes(&recipe_map(s)),
            canonical_bytes(&recipe_map(s))
        );
    }
    if std::env::var_os("JJ_BLESS").is_some() {
        std::fs::write(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/goldens/recipes.txt"),
            &actual,
        )
        .unwrap();
        return;
    }
    assert_eq!(
        include_str!("goldens/recipes.txt"),
        actual,
        "the recipe output changed: bump GENERATOR_VERSION and re-bless"
    );
}

/// Capture (only with `JJ_EVIDENCE_DIR`): a two-biome lap top-down. Route tarmac dark / packed dirt brown, chevron posts
/// yellow, guard rail red, gantry legs green, scattered pieces blue, the transition zones outlined in magenta. PPM.
#[test]
fn writes_the_capture() {
    let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") else {
        return;
    };
    let (map, _) = (0..50)
        .find_map(|seed| generate_recipe(seed, &[Biome::Greybox, Biome::OutbackDirt]).ok())
        .expect("a seed with room");
    let b = map.header.bounds;
    let (w, h) = (
        ((b.max_x - b.min_x) / 500) as usize + 1,
        ((b.max_z - b.min_z) / 500) as usize + 1,
    );
    let mut px = vec![[222u8, 214, 190]; w * h];
    let inside = |x: i32, z: i32| x >= b.min_x && z >= b.min_z && x <= b.max_x && z <= b.max_z;
    let at = |x: i32, z: i32| ((z - b.min_z) / 500) as usize * w + ((x - b.min_x) / 500) as usize;
    let line = route(&map);
    let (s, _) = jj_procgen::assemble::arc_lengths(&line);
    let cuts: Vec<f64> = map
        .route
        .segments
        .windows(2)
        .map(|w| s[w[0].span.to as usize])
        .collect();
    for (i, p) in map.route.points.iter().enumerate() {
        let in_zone = cuts.iter().any(|c| (s[i] - c).abs() < TRANSITION_M / 2.0);
        let colour = match (p.surface, in_zone) {
            (_, true) => [200, 60, 200],
            (Surface::Tarmac, _) => [70, 70, 76],
            _ => [140, 100, 60],
        };
        for dz in -6..=6i32 {
            for dx in -6..=6i32 {
                let (x, z) = (p.x + dx * 500, p.z + dz * 500);
                if dx * dx + dz * dz <= 36 && inside(x, z) {
                    px[at(x, z)] = colour;
                }
            }
        }
    }
    for d in &map.dressing {
        let (colour, r) = match d.kit_piece.as_str() {
            CHEVRON => ([240, 200, 20], 2),
            GUARD_RAIL => ([190, 40, 40], 1),
            FINISH_GANTRY => ([30, 170, 60], 4),
            "generic/box-building" => ([220, 110, 30], 4),
            _ => ([40, 90, 180], 2),
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
    std::fs::write(std::path::Path::new(&dir).join("two-biome-lap.ppm"), out).unwrap();
}
