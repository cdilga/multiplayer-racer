//! P1-M03d jump scenarios on generated maps, through the real sim (rapier heightfield, the Cruz): a car at design speed
//! (the reference lap's 15 m/s, and faster) takes each placed jump and lands upright on its wheels; the autopilot clears
//! every placed jump on the standard line on 10 seeds. Set `JJ_EVIDENCE_DIR` to write the scenario table.
//! (`jump-land` on the S03 flat fixture is S03's; these run on the generated heightfield.)
#![cfg(not(target_arch = "wasm32"))]

use jj_map::{Biome, FeatureKind, LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::generate_recipe;
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile, route_spawn};

const S: u64 = TICK_HZ as u64;

/// Every biome that places jumps, using the same ten route seeds as the original landability bank.
fn jump_maps() -> impl Iterator<Item = (Biome, u64, LoadedMap)> {
    [
        Biome::Greybox,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ]
    .into_iter()
    .flat_map(|biome| {
        (0..10).map(move |seed| {
            let map = generate_recipe(seed, &[biome])
                .expect("one biome needs no boundary")
                .0;
            let loaded = load_canonical(&canonical_bytes(&map), &jj_procgen::registry())
                .expect("generated maps load");
            (biome, seed, loaded)
        })
    })
}

/// Route point index nearest a pose (metres apart at most a point spacing).
fn index_of(map: &LoadedMap, x: i32, z: i32) -> usize {
    let pts = &map.map.route.points;
    (0..pts.len())
        .min_by_key(|&i| {
            let (dx, dz) = (i64::from(pts[i].x - x), i64::from(pts[i].z - z));
            dx * dx + dz * dz
        })
        .unwrap()
}

struct Outcome {
    airborne_s: f64,
    landing_up_y: f32,
    min_up_y: f32,
    end_up_y: f32,
    recovered: bool,
    /// The car's distance from the centreline as it passed the ramp's base, m.
    lateral_at_ramp: f32,
    speed_at_lip: f32,
    boosting_at_lip: bool,
    flight_s: f64,
    /// Ground distance (m) covered during the longest flight: take-off to touchdown.
    flight_m: f32,
    /// Where the car was most tipped after landing: metres along the route from the ramp's base, metres left of the
    /// centerline, and its nose's and right side's height over a metre (pitch and roll as sines).
    worst: [f32; 4],
    reached_exit: bool,
}

/// Starts an autopilot car `run_up` route points before jump `k` at `speed` m/s and drives until 15 m past its landing.
fn take_jump(map: &LoadedMap, k: usize, speed: f32, sim_seed: u64, boost: bool) -> Outcome {
    take_jump_as(map, k, speed, sim_seed, boost, true, VehicleProfile::cruz())
}

/// [`take_jump`] with the vehicle, and with `pilot` off a player's run instead: full throttle, wheel straight, from the
/// same start (the entry and ramp are straight), so the car reaches the lip as fast as it can.
fn take_jump_as(
    map: &LoadedMap,
    k: usize,
    speed: f32,
    sim_seed: u64,
    boost: bool,
    pilot: bool,
    profile: VehicleProfile,
) -> Outcome {
    let f = &map.map.features[k];
    let base = index_of(map, f.pose.x, f.pose.z);
    let get = |key: &str| *f.params.get(key).unwrap() as f64 / 1000.0;
    let pts = &map.map.route.points;
    let n = pts.len();
    // Start 10 m before the ramp, inside its 12 m straight entry. Five points (12.5 m) can put the fixture back in
    // the preceding turn: seed 7 started heading 4.75 degrees toward a 12.3-degree ramp and flew off the landing's
    // side before the autopilot could align it. The stated speed tests a straight approach, not that artificial yaw.
    let start = (base + n - 4) % n;
    let mut sim = Sim::new(map, &jj_procgen::registry(), sim_seed, profile);
    let car = sim.spawn_grid(1)[0];
    let pose = route_spawn(map, start, 0.0, 0.5);
    let v = [speed * pose.heading.sin(), 0.0, speed * pose.heading.cos()];
    sim.place_car(car, pose, 0.0, v);
    sim.set_autopilot(car, pilot);
    sim.set_input(
        car,
        DriveInput {
            boost,
            throttle: if pilot { 0 } else { i16::MAX },
            ..Default::default()
        },
    );
    let life = sim.car_life(car);
    let end_at = |i: usize| {
        (base + ((get("rampLengthMm") + get("landingLengthMm") + 15.0) / 2.5) as usize) % n == i
    };
    let (mut airborne, mut was_air, mut landing_up_y, mut min_up_y) = (0u64, false, None, 1.0f32);
    let (bx, bz) = (pts[base].x as f32 / 1000.0, pts[base].z as f32 / 1000.0);
    let d = jj_map::jump::JumpDesign::of(f).expect("generated sharp jump");
    let lip = jj_map::jump::surface_point(&map.map, f, &d, d.ramp_m, 0.0);
    let (mut nearest_lip, mut speed_at_lip, mut boosting_at_lip) = (f32::MAX, 0.0, false);
    let (mut flight_ticks, mut longest_flight) = (0, 0);
    let (mut takeoff, mut flight_m) = ([0.0f32; 2], 0.0f32);
    let mut worst = [0.0f32; 4];
    let mut ticks = 0;
    // Air time counts from the first time all four wheels are down (the spawn's 0.5 m drop isn't a jump).
    let (mut settled, mut lateral_at_ramp, mut best) = (false, f32::NAN, f32::MAX);
    loop {
        sim.step();
        ticks += 1;
        let st = sim.car_state(car).unwrap();
        let to_lip = (st.position[0] - lip[0] as f32).hypot(st.position[2] - lip[2] as f32);
        if to_lip < nearest_lip {
            nearest_lip = to_lip;
            speed_at_lip = libm::sqrtf(st.linvel.iter().map(|v| v * v).sum());
            boosting_at_lip = sim.action_state(car).unwrap().boosting;
        }
        settled |= st.wheels_in_contact == 4;
        let to_base = (st.position[0] - bx).hypot(st.position[2] - bz);
        if to_base < best {
            best = to_base;
            lateral_at_ramp = to_base;
        }
        let air = settled && st.wheels_in_contact == 0;
        if air {
            airborne += 1;
            if flight_ticks == 0 {
                takeoff = [st.position[0], st.position[2]];
            }
            flight_ticks += 1;
            if flight_ticks > longest_flight {
                longest_flight = flight_ticks;
                flight_m = (st.position[0] - takeoff[0]).hypot(st.position[2] - takeoff[1]);
            }
        } else if was_air && landing_up_y.is_none() {
            landing_up_y = Some(st.up_y);
        }
        if !air {
            flight_ticks = 0;
        }
        was_air = air;
        // A player's straight-wheel run is judged on the jump itself and 10 m past it: beyond that the reserved
        // landing is plain road that may bend gently, which a fixed wheel can't follow (the autopilot runs steer it).
        let on_jump = pilot
            || (st.position[0] - bx).hypot(st.position[2] - bz) <= (d.length_m() + 10.0) as f32;
        if landing_up_y.is_some() && on_jump && st.up_y < min_up_y {
            min_up_y = st.up_y;
            let [qx, qy, qz, qw] = st.rotation;
            // Rotated +z (nose) and +x (right) y components.
            let nose_y = 2.0 * (qy * qz - qw * qx);
            let right_y = 2.0 * (qx * qy + qw * qz);
            let (dx, dz) = (st.position[0] - bx, st.position[2] - bz);
            let yaw = (f64::from(f.pose.yaw) / 100.0).to_radians();
            let (ux, uz) = (yaw.cos() as f32, yaw.sin() as f32);
            worst = [dx * ux + dz * uz, dz * ux - dx * uz, nose_y, right_y];
        }
        // Done once past the landing's end (nearest route point is the end point or beyond).
        let reached = (0..n).min_by(|&a, &b| {
            let d = |i: usize| {
                (pts[i].x as f32 / 1000.0 - st.position[0]).powi(2)
                    + (pts[i].z as f32 / 1000.0 - st.position[2]).powi(2)
            };
            d(a).total_cmp(&d(b))
        });
        let past_jump = !pilot && !on_jump && landing_up_y.is_some();
        if past_jump || reached.is_some_and(end_at) || ticks > 40 * S {
            let _ = (bx, bz);
            return Outcome {
                airborne_s: airborne as f64 / S as f64,
                landing_up_y: landing_up_y.unwrap_or(st.up_y),
                min_up_y,
                end_up_y: if past_jump { min_up_y } else { st.up_y },
                recovered: sim.car_life(car) != life,
                lateral_at_ramp,
                speed_at_lip,
                boosting_at_lip,
                flight_s: longest_flight as f64 / S as f64,
                flight_m,
                worst,
                reached_exit: past_jump || reached.is_some_and(end_at),
            };
        }
    }
}

#[test]
fn cars_land_every_placed_jump_upright_on_ten_seeds_at_design_speed_and_faster() {
    let mut rows = String::from(
        "biome seed jump lip(cm) ramp(m) width(m) speed  airborne(s) flight(s) flight(m)  landingUpY  minUpY  endUpY  offLine(m)\n",
    );
    let (mut jumps, mut bad, mut racing_air) = (0, Vec::new(), Vec::<f64>::new());
    for (biome, seed, map) in jump_maps() {
        for (k, f) in map
            .map
            .features
            .iter()
            .enumerate()
            .filter(|(_, f)| f.kind == FeatureKind::Jump)
        {
            // Slow (lands on the table), the autopilot's racing speeds and past them: every one lands on its wheels; at
            // racing speed every one launches, and on average they fly (old 8 % wedges: 0.35 s at 22 m/s). Jumps whose
            // lip the 2.5 m height grid used to round off now launch like the rest: the ramp is exact geometry
            // (jj_map::jump, br-gw74.7.1).
            for speed in [15.0f32, 22.0, 26.0, 30.0] {
                let o = take_jump(&map, k, speed, seed, false);
                rows += &format!(
                    "{biome:?} {seed:>4} {k:>4} {:>8} {:>8.1} {:>8.1} {speed:>5.0} {:>12.2} {:>9.2} {:>9.1} {:>11.2} {:>7.2} {:>7.2} {:>6.1}\n",
                    f.params["lipHeightCm"],
                    f.params["rampLengthMm"] as f64 / 1000.0,
                    f.params["rampWidthMm"] as f64 / 1000.0,
                    o.airborne_s,
                    o.flight_s,
                    o.flight_m,
                    o.landing_up_y,
                    o.min_up_y,
                    o.end_up_y,
                    o.lateral_at_ramp,
                );
                let id = format!("{biome:?} seed {seed} jump {k} @ {speed}");
                if (22.0..=26.0).contains(&speed) {
                    racing_air.push(o.flight_s);
                    if o.flight_s < 0.5 {
                        bad.push(format!(
                            "{id}: only {:.2} s in the air at racing speed; {:.1} m off the line at the ramp",
                            o.airborne_s, o.lateral_at_ramp
                        ));
                    }
                }
                // A slow car (the reference lap's 15 m/s) still leaves the lip.
                if speed == 15.0 && o.flight_s < 0.25 {
                    bad.push(format!(
                        "{id}: only {:.2} s in the air at 15 m/s",
                        o.airborne_s
                    ));
                }
                // Past the design speed (the validator's 26 m/s) a car may overshoot the landing and run off the road
                // afterwards; it still has to land on its wheels.
                if !o.reached_exit {
                    bad.push(format!("{id}: never reached the landing exit"));
                }
                if o.recovered && speed <= 26.0 {
                    bad.push(format!("{id}: the car needed a recovery"));
                }
                if o.landing_up_y <= 0.8 || o.min_up_y <= 0.8 || o.end_up_y <= 0.9 {
                    bad.push(format!(
                        "{id}: landed upY {:.2}, min {:.2}, end {:.2}",
                        o.landing_up_y, o.min_up_y, o.end_up_y
                    ));
                }
            }
            jumps += 1;
        }
    }
    println!("{rows}");
    assert!(jumps >= 10, "ten seeds place at least ten jumps: {jumps}");
    let mean = racing_air.iter().sum::<f64>() / racing_air.len().max(1) as f64;
    println!("mean continuous flight at racing speed {mean:.2} s");
    assert!(bad.is_empty(), "{bad:#?}");
    assert!(mean >= 0.8, "jumps fly at racing speed: mean {mean:.2} s");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("jump-scenarios.txt"), rows).unwrap();
    }
}

/// br-gw74.10: the ACTION boost goes through the actual autopilot/vehicle path, rather than labelling a placed
/// speed as "full boost". The same ten seeds as the landability bank must release every lip and land upright.
#[test]
fn every_generated_jump_releases_a_car_actually_boosting_at_the_lip() {
    let mut rows = String::from(
        "biome seed jump lipSpeed(m/s) boosting flight(s) totalAir(s) landingUpY minLandingUpY endUpY recovered\n",
    );
    let (mut count, mut failures) = (0, Vec::new());
    for (biome, seed, map) in jump_maps() {
        for (k, _) in map
            .map
            .features
            .iter()
            .enumerate()
            .filter(|(_, f)| f.kind == FeatureKind::Jump)
        {
            let o = take_jump(&map, k, 26.0, seed, true);
            rows += &format!(
                "{biome:?} {seed} {k} {:.3} {} {:.3} {:.3} {:.3} {:.3} {:.3} {}\n",
                o.speed_at_lip,
                o.boosting_at_lip,
                o.flight_s,
                o.airborne_s,
                o.landing_up_y,
                o.min_up_y,
                o.end_up_y,
                o.recovered
            );
            if !o.reached_exit
                || !o.boosting_at_lip
                || o.flight_s < 0.5
                || o.landing_up_y <= 0.8
                || o.min_up_y <= 0.8
                || o.end_up_y <= 0.9
                || o.recovered
            {
                failures.push(format!("{biome:?} seed {seed} jump {k}: boost {}, air {:.3}s, landing {:.3}, end {:.3}, recovered {}", o.boosting_at_lip, o.airborne_s, o.landing_up_y, o.end_up_y, o.recovered));
            }
            count += 1;
        }
    }
    println!("{rows}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(
            std::path::Path::new(&dir).join("boost-launch-scenarios.txt"),
            rows,
        )
        .unwrap();
    }
    assert!(
        count >= 10,
        "every generated jump in the ten-seed sample: {count}"
    );
    assert!(failures.is_empty(), "{failures:#?}");
}

/// The ramp's lip is where it was designed to be: the ground a car meets (the sim's own ray against the colliders) at
/// the lip is within 5 cm of the ground plus the designed lip height, on every jump of ten seeds.
#[test]
fn every_lip_is_within_5_cm_of_its_designed_height_on_ten_seeds() {
    use jj_map::jump::{JumpDesign, ground_height_m, surface_point};
    let (mut n, mut worst, mut bad) = (0, 0.0f32, Vec::new());
    for (biome, seed, map) in jump_maps() {
        let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        sim.step();
        for (k, f) in map.map.features.iter().enumerate() {
            // Line and road-wide jumps (a set piece's kicker has its own bank, tests/setpieces.rs).
            if f.kind != FeatureKind::Jump {
                continue;
            }
            let Some(d) = JumpDesign::of(f) else { continue };
            // 1 cm before the lip's edge, on the centreline and 1.5 m either side (inside the 4 m flat top).
            let u = d.ramp_m - 0.01;
            for lat in [-1.5, 0.0, 1.5] {
                let p = surface_point(&map.map, f, &d, u, lat);
                let designed = ground_height_m(&map.map.terrain, p[0], p[2]) + d.profile(u);
                let got = sim
                    .ground_height(p[0] as f32, p[2] as f32, p[1] as f32 + 5.0)
                    .expect("a ray down onto the lip hits");
                let err = (f64::from(got) - designed).abs() as f32;
                worst = worst.max(err);
                if err > 0.05 {
                    bad.push(format!(
                        "{biome:?} seed {seed} jump {k} lat {lat}: lip {got:.3} m vs designed {designed:.3} m"
                    ));
                }
            }
            n += 1;
        }
    }
    println!("{n} jumps, worst lip error {:.1} cm", worst * 100.0);
    assert!(n >= 10 && bad.is_empty(), "{n} jumps: {bad:#?}");
}

#[test]
fn a_reserved_landing_without_a_receiving_surface_is_rejected() {
    let original = generate_recipe(0, &[Biome::Greybox]).unwrap().0;
    let registry = jj_procgen::registry();
    assert!(jj_map::validate(&original, &registry).ok);
    let k = original
        .features
        .iter()
        .position(|f| f.kind == FeatureKind::Jump)
        .unwrap();
    for (param, value, rule) in [
        ("tableLengthMm", 0, jj_map::Rule::LandingEnvelope),
        ("landingLengthMm", 34_000, jj_map::Rule::LandingEnvelope),
        ("downSlopeMilli", 0, jj_map::Rule::FeatureParams),
        ("downBlendMm", -1, jj_map::Rule::FeatureParams),
        ("downBlendMm", 100_000, jj_map::Rule::FeatureParams),
    ] {
        let mut broken = original.clone();
        broken.features[k].params.insert(param.into(), value);
        let report = jj_map::validate(&broken, &registry);
        assert!(report.has(rule), "{param}={value}: {report:?}");
    }
}

#[test]
fn a_corner_inside_the_jump_approach_is_rejected() {
    // The first seed from 9 that places a jump (a set piece may take the straight a jump would have used, R132).
    let mut map = (9..)
        .map(|seed| generate_recipe(seed, &[Biome::Greybox]).unwrap().0)
        .find(|m| {
            m.features
                .iter()
                .any(|f| f.kind == FeatureKind::Jump && !f.params.contains_key("roofTarget"))
        })
        .unwrap();
    assert!(jj_procgen::features::check_envelope(&map).is_empty());
    let f = map
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Jump && !f.params.contains_key("roofTarget"))
        .unwrap();
    let base = map
        .route
        .points
        .iter()
        .position(|q| q.x == f.pose.x && q.z == f.pose.z)
        .unwrap();
    // A kink immediately before the ramp must not qualify as a straight entry, even when the landing is clear.
    map.route.points[base - 1].x += 300;
    assert!(
        jj_procgen::features::check_envelope(&map)
            .iter()
            .any(|p| p.contains("entry bends"))
    );
}

/// br-gw74.13.1: a player holding full throttle reaches the lip far faster than the autopilot's 26 m/s plan. Every
/// generated jump, line and road-wide, lands upright with no recovery for the Cruz at 30-40 m/s and the Tradie Ute at
/// 30-35 m/s (the ute tanks the big ones). Prints air time and flight distance per jump (`JJ_EVIDENCE_DIR` writes it).
#[test]
fn players_at_full_throttle_land_every_jump_line_and_road_wide() {
    let mut rows = String::from(
        "biome seed jump wide lip(cm) ramp(m) car speed lipSpeed(m/s) flight(s) flight(m) landingUpY minUpY endUpY recovered\n",
    );
    let (mut runs, mut wide_jumps, mut bad) = (0, 0, Vec::new());
    for (biome, seed, map) in jump_maps() {
        for (k, f) in map
            .map
            .features
            .iter()
            .enumerate()
            .filter(|(_, f)| f.kind == FeatureKind::Jump)
        {
            let wide = f.params.get("roadWide") == Some(&1);
            wide_jumps += usize::from(wide);
            for (car, profile, speeds) in [
                ("cruz", VehicleProfile::cruz(), &[30.0f32, 35.0, 40.0][..]),
                ("ute", VehicleProfile::tradie_ute(), &[30.0f32, 35.0][..]),
            ] {
                for &speed in speeds {
                    let o = take_jump_as(&map, k, speed, seed, false, false, profile.clone());
                    runs += 1;
                    rows += &format!(
                        "{biome:?} {seed} {k} {} {} {:.1} {car} {speed:.0} {:.2} {:.2} {:.1} {:.2} {:.2} {:.2} {}\n",
                        u8::from(wide),
                        f.params["lipHeightCm"],
                        f.params["rampLengthMm"] as f64 / 1000.0,
                        o.speed_at_lip,
                        o.flight_s,
                        o.flight_m,
                        o.landing_up_y,
                        o.min_up_y,
                        o.end_up_y,
                        o.recovered,
                    );
                    if !o.reached_exit
                        || o.recovered
                        || o.landing_up_y <= 0.8
                        || o.min_up_y <= 0.8
                        || o.end_up_y <= 0.9
                    {
                        bad.push(format!(
                            "{biome:?} seed {seed} jump {k} (wide {wide}) {car} @ {speed}: lip {:.1} m/s, flew {:.2} s {:.1} m, landing {:.2}, min {:.2} at {:.1} m along {:.1} m left (nose {:.2} right {:.2}), end {:.2}, recovered {}, exit {}; ramp {:.1} table {:.1} landing {:.1}",
                            o.speed_at_lip, o.flight_s, o.flight_m, o.landing_up_y, o.min_up_y, o.worst[0], o.worst[1], o.worst[2], o.worst[3], o.end_up_y, o.recovered, o.reached_exit,
                            f.params["rampLengthMm"] as f64 / 1000.0, f.params["tableLengthMm"] as f64 / 1000.0, f.params["landingLengthMm"] as f64 / 1000.0
                        ));
                    }
                }
            }
        }
    }
    println!("{rows}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(
            std::path::Path::new(&dir).join("player-jump-scenarios.txt"),
            &rows,
        )
        .unwrap();
    }
    assert!(
        wide_jumps >= 5,
        "the sample places road-wide jumps: {wide_jumps}"
    );
    assert!(bad.is_empty(), "{} of {runs} runs: {bad:#?}", bad.len());
}
