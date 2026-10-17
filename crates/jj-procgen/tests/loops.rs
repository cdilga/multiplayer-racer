//! br-xlvx.6.4: a loop laid into a generated map. On a stadium course (two long straights), `loops::jog` moves the
//! centreline under and after the loop, the map is assembled and its terrain undulated as the generator does, and
//! `loops::place` lays the loop: the map validates (the loop's contract included), and a bot laps it through the loop
//! upside down at the top without a recovery.
//!   cargo test -p jj-procgen --test loops --release

use jj_map::model::{Biome, FeatureKind, Surface};
use jj_map::{LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::assemble::{TrackSpec, arc_lengths, assemble};
use jj_procgen::course::{STEP_M, WIDTH_M};
use jj_procgen::seed::Rng;
use jj_procgen::{loops, terrain};
use jj_sim::{Sim, TICK_HZ, VehicleProfile};

const STRAIGHT_M: f64 = 240.0;
const BEND_R_M: f64 = 60.0;

/// A centreline, m (x, z).
type Line = Vec<(f64, f64)>;

/// A stadium: two straights joined by half circles, evenly spaced at `STEP_M`, starting at the left bend's middle (so
/// neither straight crosses the lap's seam). Returns the points and the straights' arc-length spans.
fn stadium() -> (Line, Vec<(f64, f64)>) {
    let half = STRAIGHT_M / 2.0;
    let mut dense = Vec::new();
    let arc = |dense: &mut Vec<(f64, f64)>, cx: f64, from: f64, to: f64| {
        for k in 0..200 {
            let a = from + (to - from) * f64::from(k) / 200.0;
            dense.push((
                cx + BEND_R_M * libm::cos(a),
                BEND_R_M + BEND_R_M * libm::sin(a),
            ));
        }
    };
    let pi = core::f64::consts::PI;
    arc(&mut dense, -half, pi, 1.5 * pi);
    for k in 0..400 {
        dense.push((-half + STRAIGHT_M * f64::from(k) / 400.0, 0.0));
    }
    arc(&mut dense, half, 1.5 * pi, 2.5 * pi);
    for k in 0..400 {
        dense.push((half - STRAIGHT_M * f64::from(k) / 400.0, 2.0 * BEND_R_M));
    }
    arc(&mut dense, -half, 0.5 * pi, pi);
    let (s, total) = arc_lengths(&dense);
    let count = libm::round(total / STEP_M) as usize;
    let mut pts = Vec::with_capacity(count);
    let mut j = 0;
    for k in 0..count {
        let want = total * k as f64 / count as f64;
        while j + 1 < s.len() && s[j + 1] < want {
            j += 1;
        }
        let (a, b) = (dense[j], dense[(j + 1) % dense.len()]);
        let seg = if j + 1 < s.len() {
            s[j + 1] - s[j]
        } else {
            total - s[j]
        };
        let t = if seg > 0.0 { (want - s[j]) / seg } else { 0.0 };
        pts.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    }
    let quarter = pi / 2.0 * BEND_R_M;
    let spans = vec![
        (quarter, quarter + STRAIGHT_M),
        (3.0 * quarter + STRAIGHT_M, 3.0 * quarter + 2.0 * STRAIGHT_M),
    ];
    (pts, spans)
}

fn generated(seed: u64) -> (LoadedMap, usize) {
    let data = loops::shipped();
    let (mut centerline, spans) = stadium();
    let (sites, rejects) = loops::jog(
        &mut centerline,
        &spans,
        WIDTH_M,
        &mut Rng::stream(seed, "loops"),
        data,
    );
    assert_eq!(sites.len(), data.per_lap as usize, "{rejects:?}");
    let mut map = assemble(&TrackSpec {
        seed,
        generator_id: "loops-test".into(),
        generator_version: "1".into(),
        biomes: vec![Biome::OutbackDirt],
        centerline,
        width_m: WIDTH_M,
        surface: Surface::PackedDirt,
        point_surfaces: Vec::new(),
        dressing: Vec::new(),
        props: Vec::new(),
    });
    terrain::undulate(
        &mut map,
        &mut Rng::stream(seed, "terrain"),
        &terrain::params(Biome::OutbackDirt),
    );
    let (placed, rejects) = loops::place(&mut map, &sites, data);
    loops::clear_footprints(&mut map);
    let placed = placed.len();
    assert!(
        placed > 0 || !rejects.is_empty(),
        "a site neither placed nor rejected"
    );
    (
        load_canonical(&canonical_bytes(&map), &jj_procgen::registry())
            .unwrap_or_else(|r| panic!("seed {seed}: {:?}", r.violations)),
        placed,
    )
}

#[test]
fn a_loop_laid_on_a_generated_straight_validates() {
    let mut placed = 0;
    for seed in 0..8 {
        let (m, n) = generated(seed);
        placed += n;
        let report = jj_map::validate(&m.map, &jj_procgen::registry());
        assert!(report.ok, "seed {seed}: {:?}", report.violations);
        assert_eq!(
            m.map
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Loop)
                .count(),
            n
        );
    }
    assert!(placed >= 6, "loops placed on {placed} of 8 seeds");
}

#[test]
fn a_bot_laps_a_generated_loop_upside_down_at_the_top() {
    for seed in [1, 4] {
        let (m, n) = generated(seed);
        assert_eq!(n, 1, "seed {seed}");
        let mut sim = Sim::new(&m, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        let car = sim.spawn_grid(1)[0];
        sim.start_race(1);
        sim.set_autopilot(car, true);
        let mut min_up = 1.0f32;
        while !sim.race().is_finished(car.0) && sim.tick() < 120 * u64::from(TICK_HZ) {
            sim.step();
            min_up = min_up.min(sim.car_state(car).unwrap().up_y);
        }
        let rc = sim.race().car(car.0).unwrap();
        assert!(
            rc.finished_at.is_some(),
            "seed {seed}: the bot never finished"
        );
        assert_eq!((rc.recoveries, rc.wrecks), (0, 0), "seed {seed}");
        assert!(min_up < -0.9, "seed {seed}: never upside down ({min_up})");
    }
}

// ---- The procgen bank (br-xlvx.6.4 AC1): loops in the generated, race-prepared maps.

const BIOMES: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];
const BANK_SEEDS: u64 = if cfg!(debug_assertions) { 2 } else { 16 };

/// A seed's race-prepared map, loaded as the game loads it.
fn prepared(seed: u64, biome: Biome) -> (LoadedMap, jj_procgen::Prepared) {
    let p = jj_procgen::prepare(seed, &[biome]);
    let m = load_canonical(&canonical_bytes(&p.map), &jj_procgen::registry())
        .unwrap_or_else(|r| panic!("{biome:?} seed {seed}: {:?}", r.violations));
    (m, p)
}

#[test]
fn loops_appear_in_the_prepared_maps_and_every_one_validates() {
    let mut lines = Vec::new();
    for biome in BIOMES {
        let mut with = 0;
        for seed in 0..BANK_SEEDS {
            let (m, p) = prepared(seed, biome);
            assert!(p.valid, "{biome:?} seed {seed}: {:?}", p.attempts);
            let loops: Vec<_> = m
                .map
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Loop)
                .collect();
            for f in &loops {
                let problems = jj_map::looping::problems(&m.map, &f.params);
                assert!(problems.is_empty(), "{biome:?} seed {seed}: {problems:?}");
            }
            let report = jj_map::validate(&m.map, &jj_procgen::registry());
            assert!(report.ok, "{biome:?} seed {seed}: {:?}", report.violations);
            let rhythm = jj_procgen::rhythm::of(&m.map);
            let notes = jj_procgen::rhythm::notes(&rhythm, jj_procgen::rhythm::shipped());
            eprintln!(
                "{biome:?} seed {seed}: {} loop(s), {} set piece(s) {:?}, {:.0} m {:?}, plan {:?}, loop rejects {:?}, notes {notes:?}",
                loops.len(),
                p.course.set_pieces.len(),
                p.course.set_pieces,
                p.course.length_m,
                p.course.preset,
                p.plan,
                p.course.loop_rejects,
            );
            with += usize::from(!loops.is_empty());
        }
        lines.push(format!("{biome:?}: loops on {with} of {BANK_SEEDS} seeds"));
        assert!(
            with >= 1,
            "{biome:?}: no loop on any of {BANK_SEEDS} seeds at the shipped loopsPerLap"
        );
    }
    eprintln!("{}", lines.join("\n"));
}
