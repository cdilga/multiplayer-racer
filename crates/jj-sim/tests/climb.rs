//! P1-FL12 (R133): the Tradie Ute climbs off the road. A bank beside the greybox's far straight rises at a set grade over
//! off-track ground, its foot rounded the way a generated verge's is; a car at rest at its foot holds full throttle and
//! climbs it or stalls.
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;
/// The bank's foot (m, along +z), clear of the far straight's verge.
const FOOT_Z: f64 = 70.0;

/// The greybox on generated maps' terrain spacing (2.5 m), its terrain rising at `grade_deg` from `FOOT_Z` to the map's
/// edge, all of it off-track. The first cell rises at half the grade, the way a generated verge's foot rounds off.
fn bank(grade_deg: f64) -> LoadedMap {
    let mut m: serde_json::Value =
        serde_json::from_str(include_str!("../../../maps/greybox-loop.json")).unwrap();
    let t = &mut m["terrain"];
    let (oz, sp0, cols0, rows0) = (
        t["originZ"].as_f64().unwrap() / 1000.0,
        t["spacing"].as_f64().unwrap() / 1000.0,
        t["cols"].as_u64().unwrap() as usize,
        t["rows"].as_u64().unwrap() as usize,
    );
    let sp = 2.5;
    let k = (sp0 / sp) as usize;
    let (cols, rows) = ((cols0 - 1) * k + 1, (rows0 - 1) * k + 1);
    let old_surfaces: Vec<serde_json::Value> = t["surfaces"].as_array().unwrap().clone();
    let tan = grade_deg.to_radians().tan();
    let (mut heights, mut surfaces) = (Vec::new(), Vec::new());
    for r in 0..rows {
        let z = oz + sp * r as f64;
        let up = z - FOOT_Z;
        let h = if up <= 0.0 {
            0.0
        } else if up <= sp {
            up * tan * 0.5
        } else {
            sp * tan * 0.5 + (up - sp) * tan
        };
        for c in 0..cols {
            heights.push(serde_json::json!((h * 100.0).round() as i64));
            surfaces.push(if z >= FOOT_Z {
                serde_json::json!("off-track")
            } else {
                old_surfaces[(r / k) * cols0 + c / k].clone()
            });
        }
    }
    t["spacing"] = serde_json::json!((sp * 1000.0) as i64);
    t["cols"] = serde_json::json!(cols);
    t["rows"] = serde_json::json!(rows);
    t["heights"] = serde_json::Value::Array(heights);
    t["surfaces"] = serde_json::Value::Array(surfaces);
    m["header"]["gameplayHash"] = serde_json::Value::Null;
    load_json(&serde_json::to_vec(&m).unwrap(), &Registry::generic())
        .unwrap_or_else(|v| panic!("{:?}", v.violations))
}

/// A car at rest `before_m` short of the bank's foot, facing up it, holds full throttle for `secs`: the height it
/// gained (m) and when it first stood 10 m up (s).
#[derive(Debug)]
struct Climb {
    gained_m: f32,
    ten_m_s: Option<f32>,
    min_up: f32,
    /// Where it ended: height over the start (m) and its up's y.
    end_m: f32,
    end_up: f32,
}

fn climb(map: &LoadedMap, profile: VehicleProfile, before_m: f32, secs: u64) -> Climb {
    let mut sim = Sim::new(map, &Registry::generic(), 7, profile);
    let car = sim.spawn_car(SpawnPose {
        x: 40.0,
        y: 0.5,
        z: FOOT_Z as f32 - before_m,
        heading: 0.0,
    });
    for _ in 0..S {
        sim.step();
    }
    let y0 = sim.car_state(car).unwrap().position[1];
    let mut out = Climb {
        gained_m: 0.0,
        ten_m_s: None,
        min_up: 1.0,
        end_m: 0.0,
        end_up: 1.0,
    };
    for t in 0..secs * S {
        sim.set_input(
            car,
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        );
        sim.step();
        let st = sim.car_state(car).unwrap();
        out.gained_m = out.gained_m.max(st.position[1] - y0);
        if out.ten_m_s.is_none() && out.gained_m >= 10.0 {
            out.ten_m_s = Some((t + 1) as f32 / TICK_HZ as f32);
        }
        out.min_up = out.min_up.min(st.up_y);
        (out.end_m, out.end_up) = (st.position[1] - y0, st.up_y);
    }
    out
}

fn roster() -> Vec<(String, VehicleProfile)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    VehicleProfile::roster(&root)
        .unwrap()
        .into_iter()
        .filter(|(_, p)| p.tuning.arcade.is_some())
        .collect()
}

/// R133: the owner couldn't climb off the road's edge in the Ute. Generated verges rise at 40-65 degrees from a
/// rounded foot; the Ute stalled at the foot of anything past 35 (its bull bar and winch hook, slung 0.29 m up and
/// 1.33 m ahead of the front axle, met the bank before its front wheels did). Now it climbs a 50-degree bank from a
/// standstill, faster than every road car, and no car drives up a 65-degree wall, even from a run-up.
#[test]
fn the_ute_climbs_off_road_banks_from_rest_and_out_climbs_the_road_cars() {
    let cars = roster();
    let mut bad = Vec::new();
    let mut table = Vec::new();
    for grade in [40.0, 45.0, 50.0] {
        let map = bank(grade);
        let runs: Vec<(String, Climb)> = cars
            .iter()
            .map(|(n, p)| (n.clone(), climb(&map, p.clone(), 2.0, 8)))
            .collect();
        for (n, c) in &runs {
            table.push(format!("{grade}° {n}: {c:?}"));
        }
        let ute = &runs.iter().find(|(n, _)| n == "tradie-ute").unwrap().1;
        match ute.ten_m_s {
            Some(s) if s <= 6.0 && ute.min_up > 0.5 => {}
            _ => bad.push(format!(
                "{grade}°: the Ute doesn't climb 10 m in 6 s: {ute:?}"
            )),
        }
        for (n, c) in &runs {
            if n != "tradie-ute"
                && c.ten_m_s
                    .is_some_and(|s| s < ute.ten_m_s.unwrap_or(f32::MAX))
            {
                bad.push(format!(
                    "{grade}°: {n} out-climbs the Ute: {c:?} vs {ute:?}"
                ));
            }
        }
    }
    let wall = bank(65.0);
    for (n, p) in &cars {
        let c = climb(&wall, p.clone(), 15.0, 8);
        table.push(format!("65° {n} from 15 m: {c:?}"));
        // Momentum can lift a nose a few metres up the face; nothing gets up it.
        if c.gained_m > 6.0 || c.ten_m_s.is_some() {
            bad.push(format!("65°: {n} drives up a wall: {c:?}"));
        }
    }
    println!("{}", table.join("\n"));
    assert!(bad.is_empty(), "{bad:#?}\n{}", table.join("\n"));
}
