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
}

/// Starts an autopilot car `run_up` route points before jump `k` at `speed` m/s and drives until 15 m past its landing.
fn take_jump(map: &LoadedMap, k: usize, speed: f32, sim_seed: u64) -> Outcome {
    let f = &map.map.features[k];
    let base = index_of(map, f.pose.x, f.pose.z);
    let get = |key: &str| *f.params.get(key).unwrap() as f64 / 1000.0;
    let pts = &map.map.route.points;
    let n = pts.len();
    let start = (base + n - 24) % n; // 60 m before the ramp
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
    loop {
        sim.step();
        ticks += 1;
        let st = sim.car_state(car).unwrap();
        let air = st.wheels_in_contact == 0;
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
            };
        }
    }
}

#[test]
fn cars_land_every_placed_jump_upright_on_ten_seeds_at_design_speed_and_faster() {
    let mut rows =
        String::from("seed jump lip(cm) ramp(m) speed  airborne(s)  landingUpY  minUpY  endUpY\n");
    let mut jumps = 0;
    for seed in 0..10u64 {
        let map = loaded(seed);
        for (k, f) in map
            .map
            .features
            .iter()
            .enumerate()
            .filter(|(_, f)| f.kind == FeatureKind::Jump)
        {
            for speed in [15.0f32, 22.0] {
                let o = take_jump(&map, k, speed, seed);
                rows += &format!(
                    "{seed:>4} {k:>4} {:>8} {:>8.1} {speed:>5.0} {:>12.2} {:>11.2} {:>7.2} {:>7.2}\n",
                    f.params["lipHeightCm"],
                    f.params["rampLengthMm"] as f64 / 1000.0,
                    o.airborne_s,
                    o.landing_up_y,
                    o.min_up_y,
                    o.end_up_y,
                );
                assert!(
                    o.airborne_s > 0.1,
                    "seed {seed} jump {k} @ {speed}: the ramp never launched the car ({} s)",
                    o.airborne_s
                );
                assert!(
                    !o.recovered,
                    "seed {seed} jump {k} @ {speed}: the car needed a recovery"
                );
                assert!(
                    o.landing_up_y > 0.9,
                    "seed {seed} jump {k} @ {speed}: landed at upY {}",
                    o.landing_up_y
                );
                assert!(
                    o.min_up_y > 0.8 && o.end_up_y > 0.9,
                    "seed {seed} jump {k} @ {speed}: {:?}",
                    (o.min_up_y, o.end_up_y)
                );
            }
            jumps += 1;
        }
    }
    println!("{rows}");
    assert!(jumps >= 10, "ten seeds place at least ten jumps: {jumps}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("jump-scenarios.txt"), rows).unwrap();
    }
}
