//! P1-M03d jump scenarios on generated maps, through the real sim (rapier heightfield, the Cruz): a car at design speed
//! (the reference lap's 15 m/s, and faster) takes each placed jump and lands upright on its wheels; the autopilot clears
//! every placed jump on the standard line on 10 seeds. Set `JJ_EVIDENCE_DIR` to write the scenario table.
//! (`jump-land` on the S03 flat fixture is S03's; these run on the generated heightfield.)
#![cfg(not(target_arch = "wasm32"))]

use jj_map::{FeatureKind, LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::generate;
use jj_sim::{Sim, TICK_HZ, VehicleProfile, route_spawn};

const S: u64 = TICK_HZ as u64;

fn loaded(seed: u64) -> LoadedMap {
    load_canonical(&canonical_bytes(&generate(seed)), &jj_procgen::registry())
        .expect("generated maps load")
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
}

/// Starts an autopilot car `run_up` route points before jump `k` at `speed` m/s and drives until 15 m past its landing.
fn take_jump(map: &LoadedMap, k: usize, speed: f32, sim_seed: u64) -> Outcome {
    let f = &map.map.features[k];
    let base = index_of(map, f.pose.x, f.pose.z);
    let get = |key: &str| *f.params.get(key).unwrap() as f64 / 1000.0;
    let pts = &map.map.route.points;
    let n = pts.len();
    // 12.5 m before the ramp (the generator keeps the entry straight that far): the car meets it at the stated speed (the autopilot slows for a bend, so a longer run-up
    // would test the corner speed, not the ramp).
    let start = (base + n - 5) % n;
    let mut sim = Sim::new(
        map,
        &jj_procgen::registry(),
        sim_seed,
        VehicleProfile::cruz(),
    );
    let car = sim.spawn_grid(1)[0];
    let pose = route_spawn(map, start, 0.0, 0.5);
    let v = [speed * pose.heading.sin(), 0.0, speed * pose.heading.cos()];
    sim.place_car(car, pose, 0.0, v);
    sim.set_autopilot(car, true);
    let life = sim.car_life(car);
    let end_at = |i: usize| {
        (base + ((get("rampLengthMm") + get("landingLengthMm") + 15.0) / 2.5) as usize) % n == i
    };
    let (mut airborne, mut was_air, mut landing_up_y, mut min_up_y) = (0u64, false, None, 1.0f32);
    let (bx, bz) = (pts[base].x as f32 / 1000.0, pts[base].z as f32 / 1000.0);
    let mut ticks = 0;
    // Air time counts from the first time all four wheels are down (the spawn's 0.5 m drop isn't a jump).
    let (mut settled, mut lateral_at_ramp, mut best) = (false, f32::NAN, f32::MAX);
    loop {
        sim.step();
        ticks += 1;
        let st = sim.car_state(car).unwrap();
        settled |= st.wheels_in_contact == 4;
        let to_base = (st.position[0] - bx).hypot(st.position[2] - bz);
        if to_base < best {
            best = to_base;
            lateral_at_ramp = to_base;
        }
        let air = settled && st.wheels_in_contact == 0;
        if air {
            airborne += 1;
        } else if was_air && landing_up_y.is_none() {
            landing_up_y = Some(st.up_y);
        }
        was_air = air;
        if ticks > 10 * S {
            min_up_y = min_up_y.min(st.up_y);
        }
        // Done once past the landing's end (nearest route point is the end point or beyond).
        let reached = (0..n).min_by(|&a, &b| {
            let d = |i: usize| {
                (pts[i].x as f32 / 1000.0 - st.position[0]).powi(2)
                    + (pts[i].z as f32 / 1000.0 - st.position[2]).powi(2)
            };
            d(a).total_cmp(&d(b))
        });
        if reached.is_some_and(end_at) || ticks > 40 * S {
            let _ = (bx, bz);
            return Outcome {
                airborne_s: airborne as f64 / S as f64,
                landing_up_y: landing_up_y.unwrap_or(st.up_y),
                min_up_y,
                end_up_y: st.up_y,
                recovered: sim.car_life(car) != life,
                lateral_at_ramp,
            };
        }
    }
}

#[test]
fn cars_land_every_placed_jump_upright_on_ten_seeds_at_design_speed_and_faster() {
    let mut rows = String::from(
        "seed jump lip(cm) ramp(m) speed  airborne(s)  landingUpY  minUpY  endUpY  offLine(m)\n",
    );
    let (mut jumps, mut bad, mut racing_air) = (0, Vec::new(), Vec::<f64>::new());
    for seed in 0..10u64 {
        let map = loaded(seed);
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
                let o = take_jump(&map, k, speed, seed);
                rows += &format!(
                    "{seed:>4} {k:>4} {:>8} {:>8.1} {speed:>5.0} {:>12.2} {:>11.2} {:>7.2} {:>7.2} {:>6.1}\n",
                    f.params["lipHeightCm"],
                    f.params["rampLengthMm"] as f64 / 1000.0,
                    o.airborne_s,
                    o.landing_up_y,
                    o.min_up_y,
                    o.end_up_y,
                    o.lateral_at_ramp,
                );
                let id = format!("seed {seed} jump {k} @ {speed}");
                if (22.0..=26.0).contains(&speed) {
                    racing_air.push(o.airborne_s);
                    if o.airborne_s < 0.5 {
                        bad.push(format!(
                            "{id}: only {:.2} s in the air at racing speed; {:.1} m off the line at the ramp",
                            o.airborne_s, o.lateral_at_ramp
                        ));
                    }
                }
                // A slow car (the reference lap's 15 m/s) still leaves the lip.
                if speed == 15.0 && o.airborne_s < 0.25 {
                    bad.push(format!("{id}: only {:.2} s in the air at 15 m/s", o.airborne_s));
                }
                // Past the design speed (the validator's 26 m/s) a car may overshoot the landing and run off the road
                // afterwards; it still has to land on its wheels.
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
    println!("mean air time at racing speed {mean:.2} s");
    assert!(bad.is_empty(), "{bad:#?}");
    assert!(mean >= 0.8, "jumps fly at racing speed: mean {mean:.2} s");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("jump-scenarios.txt"), rows).unwrap();
    }
}

/// The ramp's lip is where it was designed to be: the ground a car meets (the sim's own ray against the colliders) at
/// the lip is within 5 cm of the ground plus the designed lip height, on every jump of ten seeds.
#[test]
fn every_lip_is_within_5_cm_of_its_designed_height_on_ten_seeds() {
    use jj_map::jump::{JumpDesign, ground_height_m, surface_point};
    let (mut n, mut worst, mut bad) = (0, 0.0f32, Vec::new());
    for seed in 0..10u64 {
        let map = loaded(seed);
        let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        sim.step();
        for (k, f) in map.map.features.iter().enumerate() {
            let Some(d) = JumpDesign::of(f) else { continue };
            // 1 cm before the lip's edge, on the centreline and 1.5 m either side (inside the 4 m flat top).
            let u = d.ramp_m - 0.01;
            for lat in [-1.5, 0.0, 1.5] {
                let p = surface_point(&map.map, f, &d, u, lat);
                let designed = ground_height_m(&map.map.terrain, p[0], p[2])
                    + d.profile(u);
                let got = sim
                    .ground_height(p[0] as f32, p[2] as f32, p[1] as f32 + 5.0)
                    .expect("a ray down onto the lip hits");
                let err = (f64::from(got) - designed).abs() as f32;
                worst = worst.max(err);
                if err > 0.05 {
                    bad.push(format!(
                        "seed {seed} jump {k} lat {lat}: lip {got:.3} m vs designed {designed:.3} m"
                    ));
                }
            }
            n += 1;
        }
    }
    println!("{n} jumps, worst lip error {:.1} cm", worst * 100.0);
    assert!(n >= 10 && bad.is_empty(), "{n} jumps: {bad:#?}");
}
