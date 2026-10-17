//! P1-FL15b set pieces (R132, R129) on generated maps, through the real sim (rapier heightfield + the kicker's
//! triangles, the Cruz): the gap-leap kit validates as data; every prepared track carries at least one piece per lap; the
//! autopilot at design speed lands every placed piece upright on its far rim; a car that commits too slowly falls into
//! the pit and respawns (it never clips through); each piece's landmark is in view at least 10 s before the commitment
//! point. Set `JJ_EVIDENCE_DIR` to write the table.
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::fmt::Write as _;

use jj_map::setpiece::{GapLeap, PieceKind};
use jj_map::{Biome, LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::{prepare, setpieces};
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile, route_spawn};

const S: u64 = TICK_HZ as u64;

const BIOMES: [Biome; 4] = [
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
    Biome::Town,
];

fn loaded(seed: u64, biome: Biome) -> LoadedMap {
    let p = prepare(seed, &[biome]);
    assert!(p.valid, "{biome:?} seed {seed}: {:?}", p.attempts);
    load_canonical(&canonical_bytes(&p.map), &jj_procgen::registry()).expect("prepared maps load")
}

fn evidence(name: &str, body: &str) {
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/{name}"), body).unwrap();
    }
}

#[test]
fn the_shipped_set_piece_data_validates() {
    assert_eq!(
        setpieces::validate_data(setpieces::shipped()),
        Vec::<String>::new()
    );
    // A broken copy is caught: an inverted range and an unknown kind.
    let mut bad = setpieces::shipped().clone();
    bad.pieces.get_mut("canyon-leap").unwrap().gap_m = [18.0, 10.0];
    bad.biomes
        .get_mut("rocks")
        .unwrap()
        .push("loop-de-loop".into());
    let problems = setpieces::validate_data(&bad);
    assert!(problems.iter().any(|p| p.contains("gapM")), "{problems:?}");
    assert!(
        problems.iter().any(|p| p.contains("loop-de-loop")),
        "{problems:?}"
    );
}

#[test]
fn every_prepared_track_has_a_set_piece_per_lap_on_20_seeds_per_biome() {
    let mut table = String::from("biome seed pieces kinds\n");
    let mut kinds: BTreeMap<&str, u32> = BTreeMap::new();
    let mut missing = Vec::new();
    for biome in BIOMES {
        for seed in 0..20 {
            let map = loaded(seed, biome);
            let pieces: Vec<GapLeap> = map.map.features.iter().filter_map(GapLeap::of).collect();
            for p in &pieces {
                *kinds.entry(p.kind.name()).or_default() += 1;
            }
            writeln!(
                table,
                "{biome:?} {seed} {} {:?}",
                pieces.len(),
                pieces.iter().map(|p| p.kind.name()).collect::<Vec<_>>()
            )
            .unwrap();
            // A loop-the-loop is one of the lap's set pieces too (br-xlvx.6.4, R132), and so is a loop-over's spiral
            // over its own road (br-xlvx.10.2).
            if pieces.is_empty()
                && jj_procgen::loops::count(&map.map) == 0
                && jj_procgen::rhythm::loop_overs(&map.map).is_empty()
            {
                missing.push(format!("{biome:?} {seed}"));
            }
        }
    }
    writeln!(table, "kinds {kinds:?}").unwrap();
    evidence("placement.txt", &table);
    assert!(
        missing.is_empty(),
        "no set piece on the lap: {missing:?}\n{table}"
    );
    for k in [
        PieceKind::CanyonLeap,
        PieceKind::MesaDrop,
        PieceKind::CreekWashout,
    ] {
        assert!(
            kinds.contains_key(k.name()),
            "{} never placed: {kinds:?}",
            k.name()
        );
    }
}

struct Run {
    /// Where the car ended: metres past the lip along the flight line, and its height over the take-off ground.
    end: (f64, f64),
    landed_past_rim: bool,
    respawned: bool,
    speed_at_lip: f32,
    flight_m: f32,
    end_up_y: f32,
}

/// Starts a car `back` route points before piece `k`'s kicker at `speed` (or, with `launch`, leaving its lip at `speed`
/// along the ramp's angle), on the autopilot (or at full throttle with the wheel straight when `pilot` is off), and runs
/// it until it's well past the landing, it respawns, or 12 s pass.
fn take(map: &LoadedMap, k: usize, speed: f32, pilot: bool, back: usize, launch: bool) -> Run {
    let f = map
        .map
        .features
        .iter()
        .filter(|f| GapLeap::of(f).is_some())
        .nth(k)
        .unwrap();
    let d = GapLeap::of(f).unwrap();
    let base = jj_map::jump::feature_base(&map.map, f);
    let n = map.map.route.points.len();
    let start = (base + n - back) % n;
    let mut sim = Sim::new(map, &jj_procgen::registry(), 7, VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    let mut pose = route_spawn(map, start, 0.0, 0.3);
    let (lip0, t0, _) = jj_map::setpiece::take_off(&map.map, f, &d);
    if launch {
        // Leaving the lip: just above it, heading along the flight line, pitched like the ramp (velocity only).
        pose.x = lip0[0] as f32;
        pose.y = lip0[1] as f32 + 0.6;
        pose.z = lip0[2] as f32;
        pose.heading = libm::atan2(t0[0], t0[1]) as f32;
    }
    sim.place_car(car, pose, 0.0, {
        let a = if launch { d.launch_angle() as f32 } else { 0.0 };
        let h = speed * a.cos();
        [
            h * pose.heading.sin(),
            speed * a.sin(),
            h * pose.heading.cos(),
        ]
    });
    sim.set_autopilot(car, pilot);
    sim.set_input(
        car,
        DriveInput {
            throttle: if pilot { 0 } else { i16::MAX },
            ..Default::default()
        },
    );
    let life = sim.car_life(car);
    let (lip, t, ground) = jj_map::setpiece::take_off(&map.map, f, &d);
    let along = |p: [f32; 3]| (f64::from(p[0]) - lip[0]) * t[0] + (f64::from(p[2]) - lip[2]) * t[1];
    let (mut speed_at_lip, mut took_off_at, mut flight_m) = (0.0f32, None, 0.0f32);
    let (mut landed_past_rim, mut was_air) = (false, false);
    // The car's lowest up through the 1.5 s after it lands (a tumble shows; the run-out's own slopes don't).
    let (mut end_up_y, mut landed_tick) = (1.0f32, None);
    for _ in 0..30 * S {
        sim.step();
        let st = sim.car_state(car).unwrap();
        if landed_tick.is_some_and(|t| sim.tick() <= t + 3 * S / 2) {
            end_up_y = end_up_y.min(st.up_y);
        }
        if sim.car_life(car) != life {
            return Run {
                end: (along(st.position), f64::from(st.position[1]) - ground),
                landed_past_rim,
                respawned: true,
                speed_at_lip,
                flight_m,
                end_up_y,
            };
        }
        let u = along(st.position);
        if u < 0.0 {
            speed_at_lip = libm::sqrtf(st.linvel.iter().map(|v| v * v).sum());
        }
        let air = st.wheels_in_contact == 0;
        if air && !was_air && u > -2.0 && took_off_at.is_none() {
            took_off_at = Some(u);
        }
        if !air
            && was_air
            && u > d.gap_m
            && !landed_past_rim
            && let Some(t0) = took_off_at
        {
            // Down past the gap (the pit is only inside it), on the ground under the car.
            let g = jj_map::jump::ground_height_m(
                &map.map.terrain,
                f64::from(st.position[0]),
                f64::from(st.position[2]),
            );
            landed_past_rim = libm::fabs(f64::from(st.position[1]) - g) < 2.0;
            flight_m = (u - t0) as f32;
            landed_tick = Some(sim.tick());
        }
        was_air = air;
        if u > d.end_u() - d.lip_u() + 10.0 {
            break;
        }
    }
    let st = sim.car_state(car).unwrap();
    Run {
        end: (along(st.position), f64::from(st.position[1]) - ground),
        landed_past_rim,
        respawned: false,
        speed_at_lip,
        flight_m,
        end_up_y,
    }
}

#[test]
fn the_autopilot_lands_every_placed_piece_at_design_speed_on_10_seeds_per_biome() {
    let mut table = String::from("biome seed piece kind gap_m lip_mps flight_m end_up\n");
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in 0..10 {
            let map = loaded(seed, biome);
            let pieces: Vec<GapLeap> = map.map.features.iter().filter_map(GapLeap::of).collect();
            for (k, d) in pieces.iter().enumerate() {
                // From 75 m out at a modest 22 m/s: the autopilot settles onto the line and brings its own speed to the lip.
                let r = take(&map, k, 22.0, true, 30, false);
                writeln!(
                    table,
                    "{biome:?} {seed} {k} {} {:.1} {:.1} {:.1} {:.2}",
                    d.kind.name(),
                    d.gap_m,
                    r.speed_at_lip,
                    r.flight_m,
                    r.end_up_y
                )
                .unwrap();
                if r.respawned || !r.landed_past_rim || r.end_up_y < 0.8 {
                    bad.push(format!(
                        "{biome:?} seed {seed} piece {k} ({}): respawned {} landed {} lip {:.1} m/s flight {:.1} m end up {:.2} ended at u {:.0} dy {:.1} (landing ends at {:.0})",
                        d.kind.name(),
                        r.respawned,
                        r.landed_past_rim,
                        r.speed_at_lip,
                        r.flight_m,
                        r.end_up_y,
                        r.end.0,
                        r.end.1,
                        d.gap_m + d.landing_m
                    ));
                }
            }
        }
    }
    evidence("landings.txt", &table);
    assert!(bad.is_empty(), "{}\n{table}", bad.join("\n"));
}

#[test]
fn a_car_too_slow_to_clear_the_gap_falls_into_the_pit_and_respawns() {
    let mut table = String::from("biome seed kind speed respawned\n");
    for biome in BIOMES {
        for seed in 0..3 {
            let map = loaded(seed, biome);
            let f = map
                .map
                .features
                .iter()
                .find(|f| GapLeap::of(f).is_some())
                .unwrap();
            let d = GapLeap::of(f).unwrap();
            // A car leaving the lip too slowly: its ballistic flight comes down 3 m short of the far rim.
            let mut v_miss = d.min_speed;
            while jj_map::setpiece::touchdown(&map.map, f, &d, v_miss)
                .is_none_or(|(x, _)| x > d.gap_m - 3.0)
            {
                v_miss -= 0.25;
            }
            let mut r = take(&map, 0, v_miss as f32, false, 0, true);
            r.speed_at_lip = v_miss as f32;
            let v = r.speed_at_lip;
            writeln!(
                table,
                "{biome:?} {seed} {} {v:.1} {}",
                d.kind.name(),
                r.respawned
            )
            .unwrap();
            assert!(
                r.respawned && !r.landed_past_rim,
                "{biome:?} seed {seed} {}: a car leaving the lip at {v:.1} m/s should fall into the pit and respawn; ended {:.1} m past the lip, {:.1} m over the take-off ground (gap {:.1} m)",
                d.kind.name(),
                r.end.0,
                r.end.1,
                d.gap_m
            );
        }
    }
    evidence("misses.txt", &table);
}

#[test]
fn every_piece_is_in_view_10_s_before_the_commitment_point() {
    let mut table = String::from("biome seed piece kind sight_s\n");
    let data = setpieces::shipped();
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in 0..20 {
            let map = loaded(seed, biome);
            for (k, f) in map
                .map
                .features
                .iter()
                // An overpass leap is in plain sight (its road climbs onto an embankment over the other road), as
                // `setpieces::check_minimum` counts it; it has no landmark.
                .filter(|f| GapLeap::of(f).is_some_and(|g| g.lower.is_none()))
                .enumerate()
            {
                let s = setpieces::sight_seconds(&map.map, f, data);
                let kind = GapLeap::of(f).unwrap().kind.name();
                writeln!(table, "{biome:?} {seed} {k} {kind} {s:.1}").unwrap();
                if s < data.min_sight_s {
                    bad.push(format!("{biome:?} seed {seed} piece {k} {kind}: {s:.1} s"));
                }
            }
        }
    }
    evidence("sight.txt", &table);
    assert!(
        bad.is_empty(),
        "landmark in view too briefly before the commitment point: {bad:?}"
    );
}

/// Diagnostics (run with --ignored): why each piece's landmarks are or aren't seen, looking back from its commitment
/// point (0, 50, 100, 150 and 200 m before it).
#[test]
#[ignore]
fn diag_sight() {
    let data = setpieces::shipped();
    for biome in BIOMES {
        for seed in 0..6 {
            let map = loaded(seed, biome);
            for f in map.map.features.iter().filter(|f| GapLeap::of(f).is_some()) {
                let d = GapLeap::of(f).unwrap();
                let n = map.map.route.points.len();
                let s = setpieces::sight_seconds(&map.map, f, data);
                let rows: Vec<String> = [0usize, 20, 40, 60, 80]
                    .iter()
                    .map(|&b| {
                        let i = (d.from as usize + n - b) % n;
                        let why: Vec<String> = setpieces::why_unseen(&map.map, f, data, i)
                            .iter()
                            .map(|(w, a, c)| format!("{w} {a:.0} {c:.1}"))
                            .collect();
                        format!("{}m:{why:?}", b as f64 * 2.5)
                    })
                    .collect();
                eprintln!(
                    "{biome:?} {seed} {} {s:.1}s | {}",
                    d.kind.name(),
                    rows.join(" | ")
                );
            }
        }
    }
}

/// Diagnostics (run with --ignored): the seeds' own course draw, its straights and why set-piece sites were refused.
#[test]
#[ignore]
fn diag_rejects() {
    let seeds: Vec<u64> = std::env::var("JJ_SEEDS").map_or(vec![3, 8], |v| {
        v.split(',').map(|x| x.parse().unwrap()).collect()
    });
    for seed in seeds {
        for biome in [Biome::Rocks, Biome::Town] {
            let (_, r) = jj_procgen::generate_recipe(seed, &[biome]).unwrap();
            eprintln!(
                "REJ {biome:?} {seed} {:?} {:?} straights {:?} pieces {:?} rejects {:?}",
                r.class,
                r.preset,
                r.straights_m.iter().map(|s| s.round()).collect::<Vec<_>>(),
                r.set_pieces,
                r.set_piece_rejects
            );
        }
    }
}

/// Every set piece's kicker and landing stand in the sim where the map says (the trimesh built: a mesh rapier rejects
/// is silently left out), on 10 seeds per biome: a ray down onto the lip and onto the landing hits the designed surface.
#[test]
fn every_kicker_and_landing_is_a_collider_where_the_map_says() {
    use jj_map::jump::{ground_height_m, surface_point};
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in 0..10 {
            let (map, _) = jj_procgen::generate_recipe(seed, &[biome]).unwrap();
            let map = load_canonical(&canonical_bytes(&map), &jj_procgen::registry()).unwrap();
            let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
            sim.step();
            for (k, f) in map.map.features.iter().enumerate() {
                let Some(d) = GapLeap::of(f) else { continue };
                let lip = surface_point(&map.map, f, &d.kicker, d.lip_u() - 0.01, 0.0);
                let (c, t) = jj_map::jump::route_along(&map.map, f, d.rim_u() + d.landing_m / 2.0);
                let land = [c[0], 0.0, c[1]];
                let want_land = ground_height_m(&map.map.terrain, land[0], land[2])
                    + jj_map::setpiece::landing_lift(&d, d.rim_u() + d.landing_m / 2.0, 0.0);
                let _ = t;
                for (what, p, want) in [("lip", lip, lip[1]), ("landing", land, want_land)] {
                    let got = sim.ground_height(p[0] as f32, p[2] as f32, want as f32 + 5.0);
                    if got.is_none_or(|g| (f64::from(g) - want).abs() > 0.25) {
                        bad.push(format!(
                            "{biome:?} seed {seed} feature {k} {what}: got {got:?}, want {want:.2}"
                        ));
                    }
                }
            }
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

/// Diagnostics (run with --ignored): where each jump sits relative to the set pieces, and a straight full-throttle run
/// at it from 10 m out (the jump bank's player run), with the car's trail.
#[test]
#[ignore]
fn diag_jumps() {
    use jj_map::FeatureKind;
    for (biome, seed) in [(Biome::OutbackDirt, 7u64), (Biome::Rocks, 0)] {
        let (map, _) = jj_procgen::generate_recipe(seed, &[biome]).unwrap();
        let map = load_canonical(&canonical_bytes(&map), &jj_procgen::registry()).unwrap();
        let n = map.map.route.points.len();
        let spans: Vec<(u32, u32)> = map
            .map
            .features
            .iter()
            .filter_map(GapLeap::of)
            .map(|d| (d.from, d.to))
            .collect();
        let off: Vec<(usize, f64)> = (0..n)
            .map(|i| {
                let q = &map.map.route.points[i];
                let g = jj_map::jump::ground_height_m(
                    &map.map.terrain,
                    q.x as f64 / 1000.0,
                    q.z as f64 / 1000.0,
                );
                (i, q.y as f64 / 1000.0 - g)
            })
            .filter(|(_, d)| d.abs() > 0.3)
            .collect();
        eprintln!(
            "{biome:?} {seed} route-y off the ground at {} points: {:?}",
            off.len(),
            off.iter()
                .step_by(5)
                .take(40)
                .map(|(i, d)| format!("{i}:{d:.1}"))
                .collect::<Vec<_>>()
        );
        for f in map
            .map
            .features
            .iter()
            .filter(|f| f.kind == FeatureKind::Jump)
        {
            let base = jj_map::jump::feature_base(&map.map, f);
            eprintln!(
                "{biome:?} {seed} jump at {base} ramp {} pieces {spans:?} n {n}",
                f.params["rampLengthMm"]
            );
            let start = (base + n - 4) % n;
            let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
            let car = sim.spawn_grid(1)[0];
            let pose = route_spawn(&map, start, 0.0, 0.5);
            sim.place_car(
                car,
                pose,
                0.0,
                [35.0 * pose.heading.sin(), 0.0, 35.0 * pose.heading.cos()],
            );
            sim.set_input(
                car,
                DriveInput {
                    throttle: i16::MAX,
                    ..Default::default()
                },
            );
            for k in 0..(S / 2) {
                sim.step();
                if k % 6 == 0 {
                    let st = sim.car_state(car).unwrap();
                    let near = (0..n)
                        .min_by_key(|&i| {
                            let q = &map.map.route.points[i];
                            ((q.x as f32 / 1000.0 - st.position[0]).powi(2)
                                + (q.z as f32 / 1000.0 - st.position[2]).powi(2))
                                as i64
                        })
                        .unwrap();
                    let g = jj_map::jump::ground_height_m(
                        &map.map.terrain,
                        f64::from(st.position[0]),
                        f64::from(st.position[2]),
                    );
                    eprintln!(
                        "  t {:.2} pt {near} v {:.1} wheels {} up {:.2} y-ground {:.2}",
                        k as f64 / S as f64,
                        libm::sqrtf(st.linvel.iter().map(|v| v * v).sum()),
                        st.wheels_in_contact,
                        st.up_y,
                        f64::from(st.position[1]) - g
                    );
                }
            }
        }
    }
}

/// Diagnostics (run with --ignored): dressing standing on a road-class cell, with the cell's class and where it is
/// relative to each set piece.
#[test]
#[ignore]
fn diag_road_cells() {
    use jj_map::Surface;
    let cases: Vec<(Biome, u64)> = std::env::var("JJ_CASES").map_or_else(
        |_| vec![(Biome::Rocks, 1u64), (Biome::Town, 6)],
        |v| {
            v.split(',')
                .map(|c| {
                    let (b, s) = c.split_once(':').unwrap();
                    (
                        serde_json::from_value(serde_json::Value::String(b.into())).unwrap(),
                        s.parse().unwrap(),
                    )
                })
                .collect()
        },
    );
    for (biome, seed) in cases {
        let map = prepare(seed, &[biome]).map;
        let forks = map
            .features
            .iter()
            .filter(|f| f.kind == jj_map::FeatureKind::Fork)
            .count();
        eprintln!(
            "CASE {biome:?} {seed}: {forks} forks, {} set pieces",
            map.features
                .iter()
                .filter(|f| GapLeap::of(f).is_some())
                .count()
        );
        let t = &map.terrain;
        let sp = f64::from(t.spacing) / 1000.0;
        let cell = |x: f64, z: f64| {
            let c = ((x - f64::from(t.origin_x) / 1000.0) / sp).round() as usize;
            let r = ((z - f64::from(t.origin_z) / 1000.0) / sp).round() as usize;
            t.surfaces[r * t.cols as usize + c]
        };
        for d in &map.dressing {
            let Some(fp) = jj_procgen::registry()
                .get(&d.kit_piece)
                .and_then(|k| k.footprint(&d.params))
            else {
                continue;
            };
            let (x, z) = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
            let a = f64::from(d.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
            let pts: Vec<(f64, f64)> = match fp {
                jj_map::Footprint::Rect { x: w, z: dd, .. } => [
                    (-1.0, -1.0),
                    (1.0, -1.0),
                    (1.0, 1.0),
                    (-1.0, 1.0),
                    (0.0, 0.0),
                ]
                .iter()
                .map(|(i, j)| {
                    let (lx, lz) = (i * w / 2000.0, j * dd / 2000.0);
                    (
                        x + lx * a.cos() - lz * a.sin(),
                        z + lx * a.sin() + lz * a.cos(),
                    )
                })
                .collect(),
                jj_map::Footprint::Circle { radius, .. } => {
                    let r = radius / 1000.0;
                    (0..8)
                        .map(|k| {
                            let t = f64::from(k) * core::f64::consts::TAU / 8.0;
                            (x + r * t.cos(), z + r * t.sin())
                        })
                        .chain([(x, z)])
                        .collect()
                }
            };
            for (px, pz) in pts {
                let s = cell(px, pz);
                if !matches!(s, Surface::OffTrack | Surface::Rock)
                    && (!d.kit_piece.starts_with("wayfinding/")
                        || d.kit_piece.ends_with("guard-rail"))
                    && !d.kit_piece.contains("item-station")
                    && d.kit_piece != "outback_bitumen/centre-line"
                {
                    let forks: Vec<String> = map
                        .features
                        .iter()
                        .filter(|f| f.kind == jj_map::FeatureKind::Fork)
                        .map(|f| {
                            format!(
                                "fork at ({:.0},{:.0}) d {:.0}",
                                f64::from(f.pose.x) / 1000.0,
                                f64::from(f.pose.z) / 1000.0,
                                (f64::from(f.pose.x) / 1000.0 - px)
                                    .hypot(f64::from(f.pose.z) / 1000.0 - pz)
                            )
                        })
                        .collect();
                    eprintln!("   forks {forks:?}");
                    let near: Vec<String> = map
                        .features
                        .iter()
                        .filter_map(|f| GapLeap::of(f).map(|g| (f, g)))
                        .map(|(f, g)| {
                            let (c, tt) = jj_map::jump::route_along(&map, f, 0.0);
                            let (dx, dz) = (px - c[0], pz - c[1]);
                            format!(
                                "{} side {} base-rel ({:.0},{:.0})",
                                g.kind.name(),
                                g.detour_side,
                                dx * tt[0] + dz * tt[1],
                                -dx * tt[1] + dz * tt[0]
                            )
                        })
                        .collect();
                    eprintln!(
                        "ROAD {biome:?} {seed} {} on {s:?} near {near:?}",
                        d.kit_piece
                    );
                    break;
                }
            }
        }
    }
}

/// Diagnostics (run with --ignored, release): generation time with set pieces on and off.
#[test]
#[ignore]
fn diag_time() {
    for biome in BIOMES {
        for on in [true, false] {
            let mut data = jj_procgen::tuning::GeneratorData::shipped().clone();
            data.set_pieces = on;
            let t0 = std::time::Instant::now();
            for seed in 0..4 {
                let _ = jj_procgen::generate_tuned_from(
                    jj_procgen::seed::Streams::new(seed),
                    &[biome],
                    &data,
                );
            }
            eprintln!(
                "TIME {biome:?} pieces {on}: {:.0} ms/map",
                t0.elapsed().as_secs_f64() * 250.0
            );
        }
    }
}

/// Diagnostics (run with --ignored): a playtest lap on `JJ_SEEDS`; where each respawn or stuck second happens,
/// relative to the set pieces (metres past the lip along the flight line, to its left, over the take-off ground).
#[test]
#[ignore]
fn diag_lap() {
    let seeds: Vec<u64> = std::env::var("JJ_SEEDS").map_or(vec![93], |v| {
        v.split(',').map(|x| x.parse().unwrap()).collect()
    });
    // JJ_BIOME (rocks, dirt, bitumen, town): that biome's bank map instead, the car starting as the landing bank's does.
    let biome = std::env::var("JJ_BIOME").ok().map(|b| match b.as_str() {
        "rocks" => Biome::Rocks,
        "dirt" => Biome::OutbackDirt,
        "bitumen" => Biome::OutbackBitumen,
        _ => Biome::Town,
    });
    for seed in seeds {
        let map = match biome {
            Some(b) => loaded(seed, b),
            None if std::env::var("JJ_ROCKSTOWN").is_ok() => {
                let p = jj_procgen::validate::prepare_with(seed, &[Biome::Rocks, Biome::Town], 8);
                load_canonical(&canonical_bytes(&p.map), &jj_procgen::registry()).unwrap()
            }
            None => {
                let p = jj_procgen::playtest::prepare(seed);
                load_canonical(&canonical_bytes(&p.map), &jj_procgen::registry()).unwrap()
            }
        };
        let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        let car = sim.spawn_grid(1)[0];
        sim.start_race(1);
        if biome.is_some() {
            let f = map
                .map
                .features
                .iter()
                .find(|f| GapLeap::of(f).is_some())
                .unwrap();
            let n = map.map.route.points.len();
            let start = (jj_map::jump::feature_base(&map.map, f) + n - 12) % n;
            let pose = route_spawn(&map, start, 0.0, 0.3);
            sim.place_car(
                car,
                pose,
                0.0,
                [24.0 * pose.heading.sin(), 0.0, 24.0 * pose.heading.cos()],
            );
        }
        sim.set_autopilot(car, true);
        let pieces: Vec<_> = map
            .map
            .features
            .iter()
            .filter_map(|f| {
                GapLeap::of(f).map(|d| (d, jj_map::setpiece::take_off(&map.map, f, &d)))
            })
            .collect();
        let place = |pos: [f32; 3]| -> Vec<String> {
            pieces
                .iter()
                .map(|(d, (lip, t, g))| {
                    let (dx, dz) = (f64::from(pos[0]) - lip[0], f64::from(pos[2]) - lip[2]);
                    format!(
                        "{} u {:.0} lat {:.0} dy {:.1}",
                        d.kind.name(),
                        dx * t[0] + dz * t[1],
                        -dx * t[1] + dz * t[0],
                        f64::from(pos[1]) - g
                    )
                })
                .collect()
        };
        for (d, (lip, t, g)) in &pieces {
            let prof: Vec<String> = (-16..=((d.end_u() - d.lip_u()) / 5.0) as i32 + 8)
                .map(|k| {
                    let u = f64::from(k) * 5.0;
                    let (x, z) = (lip[0] + t[0] * u, lip[2] + t[1] * u);
                    format!(
                        "{u:.0}:{:.1}",
                        jj_map::jump::ground_height_m(&map.map.terrain, x, z) - g
                    )
                })
                .collect();
            eprintln!(
                "seed {seed} {} gap {:.1} landing {:.1} profile {}",
                d.kind.name(),
                d.gap_m,
                d.landing_m,
                prof.join(" ")
            );
            if std::env::var("JJ_GRID").is_ok() {
                for k in 6..10 {
                    let u = f64::from(k) * 5.0;
                    let row: Vec<String> = (-6..=6)
                        .map(|l| {
                            let lat = f64::from(l);
                            let (x, z) = (
                                lip[0] + t[0] * u - t[1] * lat,
                                lip[2] + t[1] * u + t[0] * lat,
                            );
                            format!(
                                "{:.1}",
                                jj_map::jump::ground_height_m(&map.map.terrain, x, z) - g
                            )
                        })
                        .collect();
                    eprintln!("GRID u {u:.0}: {}", row.join(" "));
                }
                for dr in &map.map.dressing {
                    let (dx, dz) = (
                        f64::from(dr.pose.x) / 1000.0 - lip[0],
                        f64::from(dr.pose.z) / 1000.0 - lip[2],
                    );
                    let (u, lat) = (dx * t[0] + dz * t[1], -dx * t[1] + dz * t[0]);
                    if u > 0.0 && u < 80.0 && lat.abs() < 15.0 {
                        eprintln!(
                            "DRESS {} collides {} u {u:.1} lat {lat:.1}",
                            dr.kit_piece, dr.collides
                        );
                    }
                }
                for f2 in &map.map.features {
                    let (dx, dz) = (
                        f64::from(f2.pose.x) / 1000.0 - lip[0],
                        f64::from(f2.pose.z) / 1000.0 - lip[2],
                    );
                    let (u, lat) = (dx * t[0] + dz * t[1], -dx * t[1] + dz * t[0]);
                    if u > -40.0 && u < 120.0 && lat.abs() < 15.0 {
                        eprintln!("FEAT {:?} u {u:.1} lat {lat:.1}", f2.kind);
                    }
                }
            }
        }
        let (mut life, mut slow, mut last) = (sim.car_life(car), 0u64, [0.0f32; 3]);
        let mut trail: Vec<(f64, [f32; 3], f32, usize, f32)> = Vec::new();
        while !sim.race().is_finished(car.0) && sim.tick() < 400 * S {
            sim.step();
            let st = sim.car_state(car).unwrap();
            let now = sim.tick() as f64 / S as f64;
            if sim.car_life(car) != life {
                eprintln!(
                    "seed {seed} t {now:.1} RESPAWN from {last:?} {:?}",
                    place(last)
                );
                for (t, p, v, w, up) in &trail {
                    eprintln!(
                        "  trail t {t:.2} v {v:.1} wheels {w} up {up:.2} {:?}",
                        place(*p)
                    );
                }
                life = sim.car_life(car);
            }
            if sim.tick() > 3 * S
                && !sim.race().is_held(car.0, sim.tick())
                && st.forward_speed.abs() < 1.0
            {
                slow += 1;
                if slow == S {
                    eprintln!(
                        "seed {seed} t {now:.1} STUCK at {:?} {:?}",
                        st.position,
                        place(st.position)
                    );
                    for (t, p, v, w, up) in &trail {
                        eprintln!(
                            "  trail t {t:.2} v {v:.1} wheels {w} up {up:.2} {:?}",
                            place(*p)
                        );
                    }
                }
            } else {
                slow = 0;
            }
            // Lateral offset and heading off the flight line at the lip, and at each touchdown nearby.
            for (d, (lip, t, _)) in &pieces {
                let (dx, dz) = (
                    f64::from(st.position[0]) - lip[0],
                    f64::from(st.position[2]) - lip[2],
                );
                let (u, lat) = (dx * t[0] + dz * t[1], -dx * t[1] + dz * t[0]);
                let (vx, vz) = (f64::from(st.linvel[0]), f64::from(st.linvel[2]));
                let off = libm::atan2(-vx * t[1] + vz * t[0], vx * t[0] + vz * t[1]).to_degrees();
                if (-0.5..0.5).contains(&u) {
                    eprintln!(
                        "seed {seed} {} LIP lat {lat:.1} heading-off {off:.1} wheels {}",
                        d.kind.name(),
                        st.wheels_in_contact
                    );
                }
                if u > 0.0
                    && u < d.gap_m + d.landing_m
                    && st.wheels_in_contact > 0
                    && sim.tick().is_multiple_of(15)
                {
                    eprintln!(
                        "seed {seed} {} u {u:.0} lat {lat:.1} heading-off {off:.1} wheels {} v {:.1}",
                        d.kind.name(),
                        st.wheels_in_contact,
                        libm::hypot(vx, vz)
                    );
                }
            }
            last = st.position;
            if sim.tick().is_multiple_of(S / 12) {
                trail.push((
                    now,
                    st.position,
                    libm::sqrtf(st.linvel.iter().map(|v| v * v).sum()),
                    usize::from(st.wheels_in_contact),
                    st.up_y,
                ));
                if trail.len() > 200 {
                    trail.remove(0);
                }
            }
        }
        eprintln!(
            "seed {seed} done finished {} pieces {}",
            sim.race().is_finished(car.0),
            pieces.len()
        );
    }
}

/// The ground across a set piece's landing, middle and edges (`JJ_SEEDS=<seed>`, Rocks; default 7): where the landing
/// collider (a strip on the edges) and the ground under the middle part.
#[test]
#[ignore]
fn diag_landing_cross_section() {
    use jj_map::jump::ground_height_m;
    let seed: u64 = std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7);
    let (map, _) = jj_procgen::generate_recipe(seed, &[Biome::Rocks]).unwrap();
    for (k, f) in map.features.iter().enumerate() {
        let Some(d) = GapLeap::of(f) else { continue };
        for frac in [0.1, 0.3, 0.5, 0.7, 0.9] {
            let u = d.rim_u() + d.landing_m * frac;
            let (c, t) = jj_map::jump::route_along(&map, f, u);
            let w = d.kicker.land_w / 2.0;
            let at = |lat: f64| ground_height_m(&map.terrain, c[0] - t[1] * lat, c[1] + t[0] * lat);
            eprintln!(
                "feature {k} {:?} lower {:?} frac {frac}: ground -w {:.2} mid {:.2} +w {:.2}",
                d.kind,
                d.lower,
                at(-w),
                at(0.0),
                at(w)
            );
        }
    }
}
