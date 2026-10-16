//! br-xlvx.5 (R124): huge jumps over another part of the track. On generated figure-eights the crossing's upper road
//! becomes an overpass leap (`overpass::place`) in place of its bridge: the map validates (the leap's contract: the
//! landable band against the sculpted ground, the lower road through the gap with clearance), a car leaving the lip
//! anywhere in the band clears the lower road and lands upright, a car well under it falls and respawns, and the cars on
//! the lower road beneath never count as fallen in.
//!   cargo test -p jj-procgen --test overpass --release
//!
//! Until the generator's hook lands (after FL15c), the leap is laid on the generated map with its bridge, dressing and
//! props taken off (the hook lays it where `crossings::place` would build the bridge, before any dressing).

use jj_map::model::{Biome, FeatureKind, Map};
use jj_map::setpiece::{GapLeap, PieceKind};
use jj_map::{LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::overpass;
use jj_procgen::tuning::{GeneratorData, PresetName};
use jj_sim::{DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};

fn data() -> GeneratorData {
    let mut d = GeneratorData::shipped().clone();
    for p in PresetName::ALL {
        d.course
            .presets
            .set_weight(p, f64::from(p == PresetName::FigureEight));
    }
    d
}

const BIOMES: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];

/// A generated figure-eight with its bridge turned into an overpass leap, or why it kept the bridge.
fn leap(seed: u64, biome: Biome) -> Result<LoadedMap, String> {
    let mut map: Map = jj_procgen::prepare_tuned(seed, &[biome], 8, &data()).map;
    let k = map
        .features
        .iter()
        .position(|f| f.kind == FeatureKind::Bridge)
        .ok_or("no bridge")?;
    let b = jj_map::bridge::BridgeDesign::of(&map.features[k]).ok_or("bridge params")?;
    map.features.remove(k);
    map.dressing.clear();
    map.props.clear();
    let span = |s: jj_map::model::Span| (s.from as usize, s.to as usize);
    let f = overpass::place(&mut map, span(b.upper), span(b.lower), overpass::shipped())
        .map_err(|e| format!("{e:?}"))?;
    map.features.push(f);
    load_canonical(&canonical_bytes(&map), &jj_procgen::registry())
        .map_err(|r| format!("invalid: {:?}", r.violations))
}

fn piece(m: &LoadedMap) -> (usize, GapLeap) {
    m.map
        .features
        .iter()
        .enumerate()
        .find_map(|(k, f)| {
            GapLeap::of(f)
                .filter(|d| d.kind == PieceKind::OverpassLeap)
                .map(|d| (k, d))
        })
        .expect("an overpass leap")
}

#[test]
fn overpass_leaps_lay_and_validate_on_generated_eights() {
    let mut rows = Vec::new();
    let mut laid = 0;
    for biome in BIOMES {
        for seed in 0..5 {
            match leap(seed, biome) {
                Ok(m) => {
                    laid += 1;
                    let (_, d) = piece(&m);
                    rows.push(format!(
                        "{biome:?} {seed}: gap {:.1} m, band {:.1}..{:.1} m/s, landing {:.1} m",
                        d.gap_m, d.min_speed, d.max_speed, d.landing_m
                    ));
                }
                Err(e) => rows.push(format!("{biome:?} {seed}: kept the bridge: {e}")),
            }
        }
    }
    eprintln!("{}", rows.join("\n"));
    assert!(
        laid >= 16,
        "leaps laid on {laid} of 20 eights:\n{}",
        rows.join("\n")
    );
}

/// What a car did over the leap: whether it respawned, how far past the lip it came down, and how upright it ended.
struct Run {
    /// The car's speed as it left the lip (the band is in lip speeds).
    lip_speed: f32,
    respawned: bool,
    past_rim: bool,
    end_up_y: f32,
}

/// Starts a car on the level 12 m before the kicker's base, heading along the road at `speed` (about its speed at the
/// lip: the ramp costs little), with the race's gate state of that point, and drives it flat out (straight) until it
/// has been down past the rim for 2 s (R17's run-out), or 8 s.
fn take(m: &LoadedMap, speed: f32) -> Run {
    let (k, d) = piece(m);
    let f = &m.map.features[k];
    let (lip, t, _) = jj_map::setpiece::take_off(&m.map, f, &d);
    let back = d.kicker.ramp_m + 12.0;
    let (x, z) = (lip[0] - t[0] * back, lip[2] - t[1] * back);
    let y = jj_map::jump::ground_height_m(&m.map.terrain, x, z) as f32 + 0.4;
    let mut sim = Sim::new(m, &jj_procgen::registry(), 1, VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    let heading = libm::atan2(t[0], t[1]) as f32;
    sim.place_car(
        car,
        SpawnPose {
            x: x as f32,
            y,
            z: z as f32,
            heading,
        },
        0.0,
        [speed * t[0] as f32, 0.0, speed * t[1] as f32],
    );
    let gate = sim.race().next_gate_after(d.from as usize);
    sim.set_gates_passed(car, gate as u32 + sim.race().course.gate_count() as u32);
    let life = sim.car_life(car);
    let flat_out = DriveInput {
        throttle: i16::MAX,
        steer: 0,
        brake: 0,
        boost: false,
        no_reverse: false,
    };
    let mut past_rim = false;
    let mut respawned = false;
    let mut down_for = 0;
    let mut lip_speed = None;
    for _ in 0..8 * TICK_HZ {
        sim.set_input(car, flat_out);
        sim.step();
        let st = sim.car_state(car).unwrap();
        let u = (f64::from(st.position[0]) - lip[0]) * t[0]
            + (f64::from(st.position[2]) - lip[2]) * t[1];
        if st.wheels_in_contact > 0 && u > d.gap_m {
            past_rim = true;
        }
        if past_rim {
            down_for += 1;
            if down_for > 2 * TICK_HZ {
                break;
            }
        }
        if lip_speed.is_none() && u >= 0.0 {
            lip_speed = Some(st.forward_speed);
        }
        if sim.car_life(car) != life {
            respawned = true;
            break;
        }
    }
    Run {
        lip_speed: lip_speed.unwrap_or(0.0),
        respawned,
        past_rim,
        end_up_y: sim.car_state(car).unwrap().up_y,
    }
}

#[test]
fn a_car_in_the_band_clears_the_lower_road_and_lands_upright() {
    for (biome, seed) in [(Biome::OutbackDirt, 0), (Biome::Town, 1), (Biome::Rocks, 2)] {
        let m = leap(seed, biome).expect("an overpass leap");
        let (_, d) = piece(&m);
        let mut in_band = 0;
        // The kicker costs a car some speed: start it faster, and judge each run by its speed at the lip.
        for v in [
            d.min_speed + 4.0,
            d.min_speed + 7.0,
            (d.min_speed + d.max_speed) / 2.0 + 5.0,
            d.max_speed + 4.0,
        ] {
            let r = take(&m, v as f32);
            let lip = f64::from(r.lip_speed);
            if lip < d.min_speed || lip > d.max_speed {
                continue;
            }
            in_band += 1;
            let what = format!(
                "{biome:?} {seed}: lip {lip:.1} m/s (band {:.1}..{:.1})",
                d.min_speed, d.max_speed
            );
            assert!(!r.respawned, "{what} respawned");
            assert!(r.past_rim, "{what} never landed past the rim");
            assert!(r.end_up_y > 0.8, "{what} ended up_y {}", r.end_up_y);
        }
        assert!(
            in_band >= 2,
            "{biome:?} {seed}: only {in_band} runs reached the lip inside the band"
        );
    }
}

#[test]
fn a_car_well_under_the_band_falls_and_respawns() {
    for (biome, seed) in [(Biome::OutbackDirt, 0), (Biome::Town, 1)] {
        let m = leap(seed, biome).expect("an overpass leap");
        let (_, d) = piece(&m);
        let r = take(&m, (d.min_speed * 0.7) as f32);
        assert!(
            f64::from(r.lip_speed) < d.min_speed - 3.0,
            "{biome:?} {seed}: lip {}",
            r.lip_speed
        );
        assert!(
            r.respawned,
            "{biome:?} {seed}: a slow car fell short and should respawn"
        );
    }
}

#[test]
fn the_validator_keeps_the_lower_road_clear_and_out_from_under_the_ramps() {
    let m = leap(1, Biome::Town).expect("an overpass leap");
    let (k, d) = piece(&m);
    let (a, b) = d.lower.expect("a lower road");
    let problems = |map: &Map| jj_map::setpiece::problems(map, &map.features[k]);
    assert!(problems(&m.map).is_empty(), "{:?}", problems(&m.map));
    // The lower road raised under the flight (a defect injection: it would rise into the flight's path).
    let mut raised = m.map.clone();
    let n = raised.route.points.len();
    for j in 0..=((b as usize + n - a as usize) % n) {
        raised.route.points[(a as usize + j) % n].y += 9_000;
    }
    assert!(
        problems(&raised)
            .iter()
            .any(|p| p.contains("clears the lower road")),
        "{:?}",
        problems(&raised)
    );
    // The leap moved back along its road so its landing stands over the lower road.
    let mut moved = m.map.clone();
    let lip = jj_map::setpiece::take_off(&moved, &moved.features[k], &d).1;
    let back = d.gap_m * 0.8;
    moved.features[k].pose.x += (lip[0] * back * 1000.0) as i32;
    moved.features[k].pose.z += (lip[1] * back * 1000.0) as i32;
    assert!(
        problems(&moved)
            .iter()
            .any(|p| p.contains("under the kicker or the landing")),
        "{:?}",
        problems(&moved)
    );
}

#[test]
fn a_car_on_the_lower_road_drives_under_the_leap_and_is_never_taken_as_fallen_in() {
    let m = leap(1, Biome::Town).expect("an overpass leap");
    let (_, d) = piece(&m);
    let (a, b) = d.lower.expect("a lower road");
    let n = m.map.route.points.len();
    // 30 points before the middle of the lower span, racing it, along the road at 20 m/s and on the autopilot.
    let mid = (a as usize + ((b as usize + n - a as usize) % n) / 2) % n;
    let start = (mid + n - 30) % n;
    let spawn = jj_sim::route_spawn(&m, start, 0.0, 0.3);
    let mut sim = Sim::new(&m, &jj_procgen::registry(), 1, VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    let h = spawn.heading;
    sim.place_car(car, spawn, 0.0, [20.0 * h.sin(), 0.0, 20.0 * h.cos()]);
    let gate = sim.race().next_gate_after(start);
    sim.set_gates_passed(car, gate as u32 + sim.race().course.gate_count() as u32);
    sim.set_autopilot(car, true);
    let life = sim.car_life(car);
    let mut passed = false;
    for _ in 0..6 * TICK_HZ {
        sim.step();
        assert_eq!(
            sim.car_life(car),
            life,
            "a car on the lower road was respawned under the leap"
        );
        let p = sim.car_state(car).unwrap().position;
        let q = &m.map.route.points[mid];
        if ((p[0] - q.x as f32 / 1000.0).powi(2) + (p[2] - q.z as f32 / 1000.0).powi(2)).sqrt()
            < 6.0
        {
            passed = true;
        }
    }
    assert!(passed, "the car drove under the leap");
}
