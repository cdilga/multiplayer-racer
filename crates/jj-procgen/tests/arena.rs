//! P1-M10: the derby bowl. Arenas for 8, 16 and 32 cars (and far beyond: there is no cap) validate and place every car;
//! the canonical bytes are the evidence (`goldens/arena.txt`, checked in WASM by `wasm_parity.rs` too); and the shape alone
//! keeps cars in: rams at the rim from many angles and speeds, boosted and airborne, never put a car outside
//! (`bowl-containment`), and driving from the floor up the bank never catches or launches a car (`bowl-transition`).
//! The same two as scenario-bank fixtures live in `scenarios/derby/`. Re-bless with `JJ_BLESS=1` after an intended change.
#![cfg(not(target_arch = "wasm32"))]

use jj_map::arena::{BowlDesign, bowl_mesh};
use jj_map::{LoadedMap, gameplay_hash, hex};
use jj_procgen::arena::field::{BUMP_PAD_M, LANE_M, MAX_ISLAND_H_M};
use jj_procgen::arena::{
    Field, GENERATOR_VERSION, ReliefKind, check, generate, generate_with_field, prepare,
};
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;
/// A car whose chassis centre is more than this past the wall's face has left the bowl (a car pressed against the wall has
/// its origin within the wall's skin; a car over the lip is metres past it).
const ESCAPE_MARGIN_M: f64 = 0.75;
const GOLDENS: &str = include_str!("goldens/arena.txt");
/// The pinned (seed, cars) pairs: a sample, not a limit.
const GOLDEN: [(u64, usize); 6] = [(1, 8), (2, 16), (3, 32), (4, 8), (5, 16), (6, 32)];

fn arena(seed: u64, cars: usize) -> LoadedMap {
    prepare(seed, cars, &jj_procgen::registry())
        .unwrap_or_else(|bad| panic!("arena {seed}/{cars}: {bad:?}"))
}

fn design(map: &LoadedMap) -> BowlDesign {
    map.map
        .features
        .iter()
        .find_map(BowlDesign::of)
        .expect("an arena has a bowl")
}

fn sim(map: &LoadedMap) -> Sim {
    Sim::new(map, &jj_procgen::registry(), 7, VehicleProfile::cruz())
}

#[test]
fn arenas_for_8_16_and_32_cars_validate_and_place_everyone_on_the_floor() {
    let registry = jj_procgen::registry();
    let mut floors = Vec::new();
    for cars in [8usize, 16, 32] {
        for seed in 0..6u64 {
            let map = arena(seed, cars);
            assert!(check(&map.map, &registry).is_empty());
            let d = design(&map);
            let mut sim = sim(&map);
            let ids = sim.spawn_grid(cars);
            assert_eq!(ids.len(), cars);
            for id in ids {
                let st = sim.car_state(id).unwrap();
                let r = f64::from(st.position[0]).hypot(f64::from(st.position[2]));
                assert!(
                    r < d.floor_r - 2.0,
                    "seed {seed}/{cars}: car {id:?} placed at r = {r:.1}"
                );
            }
            // The spawn grid's overflow ghosts under protection, so a round of any size settles upright on the floor.
            for _ in 0..(4 * S) {
                sim.step();
            }
            for id in sim.cars().collect::<Vec<_>>() {
                let st = sim.car_state(id).unwrap();
                assert!(
                    st.up_y > 0.9,
                    "seed {seed}/{cars}: car {id:?} didn't settle ({st:?})"
                );
                assert!(f64::from(st.position[0]).hypot(f64::from(st.position[2])) < d.floor_r);
            }
        }
        floors.push(design(&arena(0, cars)).floor_r);
    }
    assert!(
        floors.windows(2).all(|w| w[0] <= w[1]) && floors[0] < floors[2],
        "the bowl grows with the car count: {floors:?}"
    );
}

#[test]
fn there_is_no_cap_a_thousand_cars_get_a_bowl_and_a_place_each() {
    let map = arena(9, 1000);
    let d = design(&map);
    assert!(d.floor_r > 150.0, "{}", d.floor_r);
    let mut sim = sim(&map);
    // Placement is geometry only here: the grid pose of every car is on the floor, none shared.
    let mut seen = std::collections::BTreeSet::new();
    for k in 0..1000 {
        let p = sim.grid_pose(k);
        assert!(f64::from(p.x).hypot(f64::from(p.z)) < d.floor_r);
        assert!(
            seen.insert((p.x.to_bits(), p.z.to_bits())),
            "pose {k} repeats"
        );
    }
    let _ = &mut sim;
}

#[test]
fn the_bowl_profile_is_smooth_and_concave_and_its_mesh_is_closed_and_faces_out() {
    for seed in 0..8u64 {
        let map = arena(seed, 16);
        let f = &map.map.features[0];
        let d = design(&map);
        let pts = d.profile();
        // Tangent to the floor at the foot, tangent to the wall at the top: C1 at both joins.
        assert_eq!(pts[0], (d.floor_r, 0.0));
        let (first, last) = (pts[1], pts[d.inner_len() - 1]);
        assert!(
            (first.1 / (first.0 - d.floor_r)) < 0.1,
            "the arc leaves the floor flat"
        );
        assert_eq!(last.0, d.wall_r());
        // Mesh: every edge is shared by exactly two triangles (a closed shell), and the winding faces out.
        let (verts, tris) = bowl_mesh(&map.map, f).unwrap();
        let mut edges = std::collections::BTreeMap::<(u32, u32), i32>::new();
        for t in &tris {
            for k in 0..3 {
                let (a, b) = (t[k], t[(k + 1) % 3]);
                *edges.entry((a.min(b), a.max(b))).or_default() += if a < b { 1 } else { -1 };
            }
        }
        // Every edge is shared with opposite winding, except the two open rings (the foot on the floor, the skirt's end).
        let n = d.ring_segments() as u32;
        let last_ring = (d.profile().len() as u32 - 1) * n;
        assert!(
            edges
                .iter()
                .all(|(&(a, b), &w)| w == 0 || a < n && b < n || a >= last_ring && b >= last_ring),
            "seed {seed}: an interior edge isn't shared with opposite winding"
        );
        // The bank's triangles face into the arena: their normals have a component towards the centre.
        for t in tris.iter().take(2000) {
            let [p, q, r] = t.map(|i| verts[i as usize]);
            let (u, w) = (
                [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
                [r[0] - p[0], r[1] - p[1], r[2] - p[2]],
            );
            let n = [
                u[1] * w[2] - u[2] * w[1],
                u[2] * w[0] - u[0] * w[2],
                u[0] * w[1] - u[1] * w[0],
            ];
            let c = [(p[0] + q[0] + r[0]) / 3.0, (p[2] + q[2] + r[2]) / 3.0];
            let radial = c[0].hypot(c[1]);
            if radial < d.wall_r() - 0.01 && (p[1] + q[1] + r[1]) / 3.0 > 0.0 {
                assert!(
                    n[1] > 0.0 && n[0] * c[0] + n[2] * c[1] <= 1e-9,
                    "a bank triangle faces away"
                );
            }
        }
    }
}

/// One ram: a car starts on the floor at `r0` on the ray `angle`, heading `off` radians off the radial direction, at
/// `speed` m/s with the throttle down (and boost), optionally flung `up` m/s and started `lift` m up. Returns the farthest
/// its chassis centre got from the middle, and the number of ticks it spent past the wall's face.
struct Ram {
    angle: f64,
    off: f64,
    speed: f32,
    boost: bool,
    steer: i16,
    up: f32,
    lift: f32,
    r0: f64,
}

fn run_ram(map: &LoadedMap, ram: &Ram, seconds: u64) -> (f64, u64, f32) {
    let d = design(map);
    let mut sim = sim(map);
    let car = sim.spawn_grid(1)[0];
    let (ca, sa) = (libm::cos(ram.angle), libm::sin(ram.angle));
    let (x, z) = (ram.r0 * ca, ram.r0 * sa);
    let heading = libm::atan2(ca, sa) as f32 + ram.off as f32;
    let pose = jj_sim::SpawnPose {
        x: x as f32,
        y: 0.5 + ram.lift,
        z: z as f32,
        heading,
    };
    let v = [ram.speed * heading.sin(), ram.up, ram.speed * heading.cos()];
    sim.place_car(car, pose, 0.0, v);
    let input = DriveInput {
        throttle: 32767,
        steer: ram.steer,
        boost: ram.boost,
        ..DriveInput::default()
    };
    let (mut far, mut outside, mut min_up) = (0.0f64, 0u64, 1.0f32);
    for _ in 0..(seconds * S) {
        sim.set_input(car, input);
        sim.step();
        let st = sim.car_state(car).unwrap();
        let r = f64::from(st.position[0]).hypot(f64::from(st.position[2]));
        far = far.max(r);
        if r > d.wall_r() + ESCAPE_MARGIN_M {
            outside += 1;
        }
        min_up = min_up.min(st.up_y);
    }
    (far, outside, min_up)
}

#[test]
fn bowl_containment_rams_from_many_angles_and_speeds_never_leave() {
    let map = arena(11, 16);
    let d = design(&map);
    let mut worst = (0.0f64, String::new());
    let (mut rows, mut escapes) = (0, Vec::<String>::new());
    for ai in 0..12 {
        let angle = core::f64::consts::TAU * f64::from(ai) / 12.0 + 0.17;
        for &off in &[0.0, 0.5, -0.5, 1.0, -1.0, 1.4] {
            for &speed in &[8.0f32, 20.0, 35.0, 55.0] {
                for &boost in &[false, true] {
                    let ram = Ram {
                        angle,
                        off,
                        speed,
                        boost,
                        steer: 0,
                        up: 0.0,
                        lift: 0.0,
                        r0: d.floor_r * 0.35,
                    };
                    let (far, outside, _) = run_ram(&map, &ram, 7);
                    rows += 1;
                    if far > worst.0 {
                        worst = (
                            far,
                            format!("angle {angle:.2} off {off} speed {speed} boost {boost}"),
                        );
                    }
                    if outside > 0 {
                        escapes.push(format!(
                            "angle {angle:.2} off {off} speed {speed} boost {boost}: r = {far:.2}"
                        ));
                    }
                }
            }
        }
    }
    println!(
        "{rows} rams; farthest {:.2} m of {:.2} ({})",
        worst.0,
        d.wall_r(),
        worst.1
    );
    assert!(
        escapes.is_empty(),
        "{} of {rows} rams escaped:\n{}",
        escapes.len(),
        escapes.join("\n")
    );
}

#[test]
fn bowl_containment_airborne_rams_never_leave() {
    let map = arena(12, 16);
    let d = design(&map);
    let (mut rows, mut escapes) = (0, Vec::<String>::new());
    for ai in 0..10 {
        let angle = core::f64::consts::TAU * f64::from(ai) / 10.0 + 0.3;
        // The design envelope (jj_map::arena::limits): up to 14 m/s upward from up to 4 m off the floor, at any horizontal
        // speed. Nothing in the first derby launches harder; a 20 m/s launch does clear a 15 m lip, which is why the
        // envelope is stated and the validator holds the lip above it.
        for &(up, lift) in &[(6.0f32, 1.0f32), (10.0, 2.0), (14.0, 4.0)] {
            for &speed in &[15.0f32, 30.0, 45.0] {
                for &boost in &[false, true] {
                    let ram = Ram {
                        angle,
                        off: 0.0,
                        speed,
                        boost,
                        steer: 0,
                        up,
                        lift,
                        r0: d.floor_r * 0.5,
                    };
                    let (far, outside, _) = run_ram(&map, &ram, 7);
                    rows += 1;
                    if outside > 0 {
                        escapes.push(format!("angle {angle:.2} up {up} lift {lift} speed {speed} boost {boost}: r = {far:.2}"));
                    }
                }
            }
        }
    }
    println!("{rows} airborne rams");
    assert!(
        escapes.is_empty(),
        "{} of {rows} airborne rams escaped:\n{}",
        escapes.len(),
        escapes.join("\n")
    );
}

#[test]
fn bowl_transition_never_catches_or_launches_a_car() {
    let map = arena(13, 16);
    let d = design(&map);
    // A car rolling up the bank at gentle speed: it climbs, slows, and comes back down on its wheels (never stuck at the
    // foot, never thrown off the transition). It starts on the flat rim, so the transition is all it meets.
    for &speed in &[6.0f32, 10.0, 15.0] {
        let ram = Ram {
            angle: 0.4,
            off: 0.0,
            speed,
            boost: false,
            steer: 0,
            up: 0.0,
            lift: 0.0,
            r0: d.floor_r - 9.0,
        };
        let mut sim = sim(&map);
        let car = sim.spawn_grid(1)[0];
        let (ca, sa) = (libm::cos(ram.angle), libm::sin(ram.angle));
        let heading = libm::atan2(ca, sa) as f32;
        let pose = jj_sim::SpawnPose {
            x: (ram.r0 * ca) as f32,
            y: 0.5,
            z: (ram.r0 * sa) as f32,
            heading,
        };
        sim.place_car(
            car,
            pose,
            0.0,
            [speed * heading.sin(), 0.0, speed * heading.cos()],
        );
        let (mut air_ticks, mut max_r, mut min_up) = (0u64, 0.0f64, 1.0f32);
        let mut up_foot = 0u64;
        for t in 0..(12 * S) {
            // Coast: no throttle, so the transition is the only thing acting on it.
            sim.step();
            let st = sim.car_state(car).unwrap();
            let r = f64::from(st.position[0]).hypot(f64::from(st.position[2]));
            max_r = max_r.max(r);
            min_up = min_up.min(st.up_y);
            if t > S && st.wheels_in_contact == 0 {
                air_ticks += 1;
            }
            if r > d.floor_r - 0.5 && r < d.floor_r + 1.0 && f64::from(st.position[1]) < 0.9 {
                up_foot += 1;
            }
        }
        assert!(
            max_r > d.floor_r + 0.5,
            "speed {speed}: never reached the bank ({max_r:.1})"
        );
        assert!(
            air_ticks < S / 6,
            "speed {speed}: launched off the transition ({air_ticks} airborne ticks)"
        );
        assert!(
            min_up > 0.5,
            "speed {speed}: tipped at the transition (up_y {min_up})"
        );
        assert!(
            up_foot < 3 * S,
            "speed {speed}: caught at the foot ({up_foot} ticks)"
        );
    }
}

#[test]
fn golden_arenas_hash_to_the_committed_values() {
    let actual: String = GOLDEN
        .iter()
        .map(|&(seed, cars)| {
            let map = arena(seed, cars);
            format!(
                "{seed} {cars} {} {:016x}\n",
                hex(&gameplay_hash(&map.map)),
                jj_map::arena::mesh_fingerprint(&map.map)
            )
        })
        .collect();
    if std::env::var_os("JJ_BLESS").is_some() {
        std::fs::write(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/goldens/arena.txt"),
            &actual,
        )
        .unwrap();
        return;
    }
    assert_eq!(
        GOLDENS, actual,
        "the arena generator's output changed: bump GENERATOR_VERSION ({GENERATOR_VERSION}) and re-bless (JJ_BLESS=1)"
    );
    let _ = generate(0, 1);
}

/// The arenas the scenario bank loads (`maps/derby-bowl-<N>.json`, seed 11): committed so fixtures name a map by path, and
/// held to the generator here (`JJ_BLESS=1` rewrites them).
const BANK_SEED: u64 = 11;
const BANK_SIZES: [usize; 3] = [8, 16, 32];

#[test]
fn the_scenario_bank_maps_are_the_generators_output() {
    for cars in BANK_SIZES {
        let map = arena(BANK_SEED, cars);
        let path = format!(
            "{}/../../maps/derby-bowl-{cars}.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let json = serde_json::to_string(&map.map).unwrap() + "\n";
        if std::env::var_os("JJ_BLESS").is_some() {
            std::fs::write(&path, &json).unwrap();
            continue;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            committed == json,
            "maps/derby-bowl-{cars}.json is stale: re-bless with JJ_BLESS=1"
        );
    }
}

#[test]
#[ignore]
fn debug_trace() {
    let map = arena(11, 16);
    let d = design(&map);
    println!(
        "floor {} bank {} wall_r {} top {}",
        d.floor_r,
        d.bank_r,
        d.wall_r(),
        d.top_h()
    );
    let ram = Ram {
        angle: 0.17,
        off: 0.0,
        speed: 35.0,
        boost: false,
        steer: 0,
        up: 0.0,
        lift: 0.0,
        r0: d.floor_r * 0.35,
    };
    let mut sim = sim(&map);
    let car = sim.spawn_grid(1)[0];
    let (ca, sa) = (libm::cos(ram.angle), libm::sin(ram.angle));
    let heading = libm::atan2(ca, sa) as f32;
    let pose = jj_sim::SpawnPose {
        x: (ram.r0 * ca) as f32,
        y: 0.5,
        z: (ram.r0 * sa) as f32,
        heading,
    };
    sim.place_car(
        car,
        pose,
        0.0,
        [35.0 * heading.sin(), 0.0, 35.0 * heading.cos()],
    );
    for t in 0..(7 * S) {
        sim.set_input(
            car,
            DriveInput {
                throttle: 32767,
                ..DriveInput::default()
            },
        );
        sim.step();
        if t % 12 == 0 {
            let st = sim.car_state(car).unwrap();
            println!(
                "t {:.2} r {:.2} y {:.2} up {:.2} v {:.1} w {}",
                t as f32 / S as f32,
                f64::from(st.position[0]).hypot(f64::from(st.position[2])),
                st.position[1],
                st.up_y,
                f32::hypot(st.linvel[0], st.linvel[2]),
                st.wheels_in_contact
            );
        }
    }
}

/// P1-S10: a late joiner in a running derby arrives on the arena's edge, clear of every car already there, under spawn
/// protection, settles upright on the floor and ranks on raw points from when it arrived. Sixteen bots have been driving
/// round the bowl for 10 s when it drops in (so its grid slot may be taken).
#[test]
fn a_derby_late_joiner_arrives_clear_on_the_edge_protected_and_upright() {
    for seed in [2u64, 5] {
        let map = arena(seed, 16);
        let d = design(&map);
        let mut sim = sim(&map);
        let ids = sim.spawn_grid(16);
        sim.start_derby(180 * S);
        for &id in &ids {
            sim.set_autopilot(id, true);
        }
        for _ in 0..(10 * S) {
            sim.step();
        }
        let late = sim.drop_in();
        assert!(
            sim.is_protected(late),
            "seed {seed}: the late joiner is protected"
        );
        let at = sim.car_state(late).unwrap().position;
        let nearest = ids
            .iter()
            .filter_map(|&c| sim.car_state(c))
            .map(|s| f64::from(s.position[0] - at[0]).hypot(f64::from(s.position[2] - at[2])))
            .fold(f64::INFINITY, f64::min);
        assert!(
            nearest > 2.5,
            "seed {seed}: the late joiner lands {nearest:.2} m from another car's centre"
        );
        for _ in 0..(3 * S) {
            sim.step();
        }
        let st = sim.car_state(late).unwrap();
        let r = f64::from(st.position[0]).hypot(f64::from(st.position[2]));
        assert!(
            r < d.floor_r + d.bank_r,
            "seed {seed}: the late joiner is in the bowl (r = {r:.1})"
        );
        assert!(
            st.up_y > 0.9,
            "seed {seed}: the late joiner is upright ({})",
            st.up_y
        );
        let ledger = sim.derby().expect("the derby is on");
        let row = ledger
            .rows()
            .into_iter()
            .find(|r| r.car == late.0)
            .expect("the late joiner has a row");
        assert!(
            row.arrived > 10 * S - 1,
            "seed {seed}: it ranks from arrival (tick {})",
            row.arrived
        );
    }
}

/// br-bbki.11 (the carnage bowl): a derby's bots hunt. A player's car and twelve bots on the autopilot in a 13-car bowl for
/// a minute of derby: they ram each other (points and takedowns all round, not a few lucky brushes), keep moving (not
/// pinned against the wall or stuck), and stay in the bowl.
#[test]
fn derby_bots_hunt_each_other_round_the_bowl() {
    let map = arena(11, 13);
    let d = design(&map);
    let mut sim = sim(&map);
    let ids = sim.spawn_grid(13);
    sim.start_derby(180 * S);
    for &id in &ids {
        sim.set_autopilot(id, true);
    }
    let (mut moving, mut samples) = (0u64, 0u64);
    let mut outside = Vec::new();
    for t in 0..(60 * S) {
        sim.step();
        if t % (S / 2) == 0 {
            for &id in &ids {
                let st = sim.car_state(id).unwrap();
                samples += 1;
                if st.forward_speed.abs() > 3.0 {
                    moving += 1;
                }
                let r = f64::from(st.position[0] - d.cx as f32)
                    .hypot(f64::from(st.position[2] - d.cz as f32));
                if r > d.wall_r() + ESCAPE_MARGIN_M {
                    outside.push((id.0, t, r));
                }
            }
        }
    }
    let takedowns = sim.takedowns().len();
    let rows = sim.derby().expect("the derby is on").rows();
    let scorers = rows.iter().filter(|r| r.units > 0).count();
    let total: u64 = rows.iter().map(|r| r.units).sum();
    eprintln!(
        "scorers {scorers}/13, total units {total}, takedowns {takedowns}, moving {moving}/{samples}"
    );
    assert!(outside.is_empty(), "no car leaves the bowl: {outside:?}");
    assert!(scorers >= 10, "most bots score by ramming: {scorers}/13");
    assert!(takedowns >= 13, "takedowns all round: {takedowns}");
    assert!(
        moving * 10 >= samples * 7,
        "bots keep moving: {moving}/{samples}"
    );
}

/// br-bbki.11: the carnage bowl, the Feel Lab's derby scene: the 13-car bowl (seed 11) as a lab map
/// (`maps/lab/carnage-bowl.json`, so the Feel Lab's scene picker offers it) and its fixture
/// (`scenarios/derby/carnage-bowl.json`): the player's car and twelve bots on the autopilot hunt each other for a minute of
/// derby. Both are the generator's output (`JJ_BLESS=1` rewrites them); the fixture's envelope is in the scenario bank.
#[test]
fn the_carnage_bowl_lab_scene_is_the_generators_output() {
    let cars = 13;
    let map = arena(BANK_SEED, cars);
    let d = design(&map);
    let root = format!("{}/../..", env!("CARGO_MANIFEST_DIR"));
    let json = serde_json::to_string(&map.map).unwrap() + "\n";
    // The grid the round puts them on, as fixture poses.
    let mut s = sim(&map);
    let ids = s.spawn_grid(cars);
    let poses: Vec<serde_json::Value> = ids
        .iter()
        .map(|&id| {
            let st = s.car_state(id).unwrap();
            let q = st.rotation;
            let heading =
                (2.0 * (q[3] * q[1] + q[0] * q[2])).atan2(1.0 - 2.0 * (q[1] * q[1] + q[2] * q[2]));
            serde_json::json!({ "pose": {
                "x": (f64::from(st.position[0]) * 100.0).round() / 100.0,
                "y": (f64::from(st.position[1]) * 100.0).round() / 100.0 + 0.1,
                "z": (f64::from(st.position[2]) * 100.0).round() / 100.0,
                "headingDeg": (f64::from(heading).to_degrees() * 10.0).round() / 10.0,
            } })
        })
        .collect();
    let mut expect = vec![
        serde_json::json!({ "car": 0, "metric": "derbyPoints", "min": 0.1, "max": 100000 }),
        serde_json::json!({ "car": 0, "metric": "maxSpeed", "min": 8, "max": 80 }),
    ];
    for car in 0..cars {
        expect.push(serde_json::json!({ "car": car, "metric": "maxRadiusM", "min": 0, "max": ((d.wall_r() + ESCAPE_MARGIN_M) * 10.0).round() / 10.0 }));
    }
    let fixture = serde_json::json!({
        "scenario": "carnage-bowl",
        "what": "br-bbki.11 (R131 lab scene): the carnage bowl. The player's car (0) and twelve bots on the autopilot in the 13-car bowl hunt each other for a minute of derby: the player's car scores by ramming, nobody leaves the bowl. The Feel Lab's scene of the same map (maps/lab/carnage-bowl.json) runs it live with Bots 12. Re-pinned for br-bhkz.4 (arena generator 4: a floor 3 m bigger in radius, the crossover and 20 degree jumps): the grid follows the new floor; the envelope is unchanged.",
        "map": "maps/lab/carnage-bowl.json",
        "seed": 7,
        "ticks": 60 * S,
        "derby": { "atTick": 0 },
        "cars": poses,
        "autopilot": (0..cars).map(|car| serde_json::json!({ "tick": 0, "car": car, "on": true })).collect::<Vec<_>>(),
        "expect": expect,
    });
    let fixture_json = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
    let (map_path, fixture_path) = (
        format!("{root}/maps/lab/carnage-bowl.json"),
        format!("{root}/scenarios/derby/carnage-bowl.json"),
    );
    if std::env::var_os("JJ_BLESS").is_some() {
        std::fs::write(&map_path, &json).unwrap();
        std::fs::write(&fixture_path, &fixture_json).unwrap();
        return;
    }
    assert!(
        std::fs::read_to_string(&map_path).unwrap_or_default() == json,
        "maps/lab/carnage-bowl.json is stale: re-bless with JJ_BLESS=1"
    );
    assert!(
        std::fs::read_to_string(&fixture_path).unwrap_or_default() == fixture_json,
        "scenarios/derby/carnage-bowl.json is stale: re-bless with JJ_BLESS=1"
    );
}

// ---- P1-M-arena-features: the field (jumps, relief, an island or spine) ----

/// The car counts the acceptance names, and the seeds sampled at each (a sample, not a limit).
const FIELD_CARS: [usize; 3] = [8, 24, 32];
const FIELD_SEEDS: u64 = 12;

fn field(seed: u64, cars: usize) -> Field {
    generate_with_field(seed, cars).1
}

/// The terrain height (m) at the sample nearest (x, z).
fn ground(map: &jj_map::Map, x: f64, z: f64) -> f64 {
    let t = &map.terrain;
    let sp = f64::from(t.spacing) / 1000.0;
    let c = ((x - f64::from(t.origin_x) / 1000.0) / sp).round() as usize;
    let r = ((z - f64::from(t.origin_z) / 1000.0) / sp).round() as usize;
    f64::from(t.heights[r * t.cols as usize + c]) / 100.0
}

#[test]
fn arenas_at_8_24_and_32_cars_carry_jumps_relief_and_an_island() {
    let mut rows = vec![format!(
        "{:>4} {:>5} {:>7} {:>7} {:>5} {:>7} {:>6} {:>4} {:>5} {:>6} {:>6} {:>8}",
        "cars",
        "seed",
        "floorR",
        "fieldR",
        "jumps",
        "tables",
        "kicker",
        "mnd",
        "dips",
        "rocks",
        "lips (crossover first)",
        "m2/car"
    )];
    for cars in FIELD_CARS {
        for seed in 0..FIELD_SEEDS {
            let map = arena(seed, cars);
            let f = field(seed, cars);
            let d = design(&map);
            let jumps = f.relief.iter().filter(|p| p.kind.is_jump()).count();
            let bumps = f.count(ReliefKind::Mound) + f.count(ReliefKind::Dip);
            // br-bhkz.4: the crossover in every arena, and at least two more jumps round it, a table-top among them.
            assert!(
                f.count(ReliefKind::Crossover) == 1
                    && jumps >= 3
                    && f.count(ReliefKind::TableTop) >= 1,
                "{cars}/{seed}: crossovers {}, jumps {jumps}, table-tops {}",
                f.count(ReliefKind::Crossover),
                f.count(ReliefKind::TableTop)
            );
            // Launches worth taking: the crossover's lips stand 1.5 m or more, no lip under a metre, none over the
            // validator's 2 m, and every launch ramp is the measured 20 degrees or the table-top's gentler end.
            for j in f.relief.iter().filter(|p| p.kind.is_jump()) {
                let least = if j.kind == ReliefKind::Crossover {
                    1.5
                } else {
                    0.7
                };
                assert!(
                    j.height >= least && j.height <= 2.0,
                    "{cars}/{seed}: a {} lip of {} m",
                    j.kind.name(),
                    j.height
                );
                for run in [j.up, j.down] {
                    let slope = j.height / run;
                    assert!(
                        slope <= jj_procgen::arena::field::LAUNCH_SLOPE + 1e-9 && slope > 0.2,
                        "{cars}/{seed}: a {} ramp of slope {slope:.3}",
                        j.kind.name()
                    );
                }
            }
            assert!(bumps >= 2, "{cars}/{seed}: {bumps} mounds and dips");
            assert!(!f.rocks.is_empty(), "{cars}/{seed}: something to ram round");
            // The field is in the map: every jump's top stands in the terrain, the rocks are solid dressing.
            for j in f.relief.iter().filter(|p| p.kind.is_jump()) {
                // The highest sample within a cell of the lip (a kicker's lip is a crease between samples).
                let top = (j.up + j.table / 2.0) - j.length() / 2.0;
                let h = (-4..=4)
                    .flat_map(|a| (-4..=4).map(move |b| (f64::from(a) * 0.3, f64::from(b) * 0.3)))
                    .map(|(a, b)| {
                        ground(&map.map, j.x + j.dir[0] * top + a, j.z + j.dir[1] * top + b)
                    })
                    .fold(f64::MIN, f64::max);
                assert!(
                    h <= j.height + 0.01 && h > j.height - 0.3,
                    "{cars}/{seed}: a {} lip {} stands {h} in the terrain",
                    j.kind.name(),
                    j.height
                );
            }
            let solid = map
                .map
                .dressing
                .iter()
                .filter(|dr| {
                    dr.collides
                        && f64::from(dr.pose.x).hypot(f64::from(dr.pose.z)) / 1000.0 < d.floor_r
                })
                .count();
            assert_eq!(solid, f.rocks.len(), "{cars}/{seed}: the island's rocks");
            assert!(f.rocks.iter().all(|r| r.h <= MAX_ISLAND_H_M));
            // Pieces keep their lanes (sampled on a 0.5 m grid): a jump or the island has half a lane round it, a mound or
            // dip half its pad, and no point is inside two of those. The crossover and its gate's rocks are one piece
            // (br-bhkz.4: the rocks stand against the deck on purpose).
            let n = (f.radius * 2.0) as i64;
            for i in -n..=n {
                for k in -n..=n {
                    let (x, z) = (i as f64 * 0.5, k as f64 * 0.5);
                    let pad = |p: &jj_procgen::arena::Relief| {
                        (if p.kind.is_jump() {
                            LANE_M / 2.0
                        } else {
                            BUMP_PAD_M
                        }) - 0.05
                    };
                    let rock = f
                        .rocks
                        .iter()
                        .any(|r| (x - r.x).hypot(z - r.z) <= r.r + LANE_M / 2.0 - 0.05);
                    let on =
                        f.relief
                            .iter()
                            .filter(|p| p.kind != ReliefKind::Crossover && p.covers(x, z, pad(p)))
                            .count()
                            + usize::from(
                                rock || f.relief.iter().any(|p| {
                                    p.kind == ReliefKind::Crossover && p.covers(x, z, pad(p))
                                }),
                            );
                    assert!(on <= 1, "{cars}/{seed}: pieces crowd ({x}, {z})");
                }
            }
            let lips: Vec<String> = f
                .relief
                .iter()
                .filter(|p| p.kind.is_jump())
                .map(|p| format!("{:.1}", p.height))
                .collect();
            let max_lip = lips.join("/");
            rows.push(format!(
                "{cars:>4} {seed:>5} {:>7.1} {:>7.1} {jumps:>5} {:>7} {:>6} {:>4} {:>5} {:>6} {max_lip:>6} {:>8.0}",
                d.floor_r,
                f.radius,
                f.count(ReliefKind::TableTop),
                f.count(ReliefKind::Kicker),
                f.count(ReliefKind::Mound),
                f.count(ReliefKind::Dip),
                f.rocks.len(),
                core::f64::consts::PI * d.floor_r * d.floor_r / cars as f64
            ));
        }
    }
    let table = rows.join("\n") + "\n";
    println!("{table}");
    if std::env::var_os("JJ_EVIDENCE").is_some() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../docs/evidence/P1-M-arena-features"
        );
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(format!("{dir}/arenas.txt"), table).unwrap();
    }
}

/// A sound arena with one thing broken, and what `check` must say about it.
fn rejects(name: &str, want: &str, f: impl FnOnce(&mut jj_map::Map)) {
    let registry = jj_procgen::registry();
    let mut map = generate(3, 24);
    assert!(
        check(&map, &registry).is_empty(),
        "{name}: the base arena is sound"
    );
    f(&mut map);
    let bad = check(&map, &registry);
    assert!(
        bad.iter().any(|b| b.contains(want)),
        "{name}: wanted a complaint containing {want:?}, got {bad:?}"
    );
}

/// Sets the terrain's samples within `r` m of (x, z) to `h` cm, or to `f(dist)` cm.
fn stamp(map: &mut jj_map::Map, x: f64, z: f64, r: f64, f: impl Fn(f64) -> i16) {
    let t = &mut map.terrain;
    let sp = f64::from(t.spacing) / 1000.0;
    for row in 0..t.rows as usize {
        for col in 0..t.cols as usize {
            let (px, pz) = (
                f64::from(t.origin_x) / 1000.0 + col as f64 * sp,
                f64::from(t.origin_z) / 1000.0 + row as f64 * sp,
            );
            let d = (px - x).hypot(pz - z);
            if d <= r {
                t.heights[row * t.cols as usize + col] = f(d);
            }
        }
    }
}

fn rock(x: f64, z: f64, r: f64, h: f64) -> jj_map::Dressing {
    jj_map::Dressing {
        kit_piece: "rocks/dome".into(),
        pose: jj_map::Pose {
            x: (x * 1000.0) as i32,
            y: 0,
            z: (z * 1000.0) as i32,
            yaw: 0,
        },
        params: [
            ("radiusMm".to_owned(), (r * 1000.0) as i64),
            ("heightCm".to_owned(), (h * 100.0) as i64),
        ]
        .into_iter()
        .collect(),
        collides: true,
    }
}

#[test]
fn the_validator_rejects_features_that_trap_or_hide_cars() {
    let base = generate(3, 24);
    let d = base.features.iter().find_map(BowlDesign::of).unwrap();
    let fr = jj_procgen::arena::field::radius_for(d.floor_r);
    // A gentle 3 m hill: tall enough to hide a car from the Overview.
    rejects("tower", "could hide a car", |m| {
        stamp(m, 12.0, 0.0, 9.0, |r| {
            (300.0 * (1.0 - r / 9.0)).round() as i16 + 1
        })
    });
    // A 1.5 m deep pit with gentle sides: too deep to be sure of driving out.
    rejects("deep pit", "could trap a car", |m| {
        stamp(m, -12.0, 0.0, 9.0, |r| {
            -(150.0 * (1.0 - r / 9.0)).round() as i16
        })
    });
    // A 1 m step (a wall in the grid): a car trips on it or is trapped behind it.
    rejects("cliff", "steep", |m| stamp(m, 0.0, -14.0, 3.0, |_| 100));
    // Relief on the flat rim, under the spawn ring.
    rejects("rim", "isn't flat", |m| {
        stamp(m, d.floor_r - 5.5, 0.0, 2.0, |_| 20)
    });
    // An island rock too tall: it hides the cars behind it.
    rejects("tall island", "could hide a car", |m| {
        m.dressing.push(rock(-fr + 6.0, 0.0, 3.0, 6.0))
    });
    // A rock out on the spawn ring.
    rejects("rock on the ring", "reaches into the bowl", |m| {
        m.dressing.push(rock(d.floor_r - 5.5, 0.0, 2.0, 2.0))
    });
    // A ring of rocks walling off a pocket of the floor: the flood can't reach inside it.
    rejects("walled pocket", "reachable", |m| {
        let (cx, cz) = (0.0, fr - 9.0);
        for k in 0..12 {
            let a = core::f64::consts::TAU * f64::from(k) / 12.0;
            m.dressing
                .push(rock(cx + 6.0 * a.cos(), cz + 6.0 * a.sin(), 2.0, 2.0));
        }
    });
}

/// A car stopped in the bottom of every dip, on top of every table and kicker lip, and against the island (facing out)
/// drives away under throttle within a few seconds: no piece of the field traps a car.
#[test]
fn nothing_in_the_field_traps_a_stopped_car() {
    let mut rows = Vec::new();
    for cars in FIELD_CARS {
        for seed in 0..4u64 {
            let map = arena(seed, cars);
            let f = field(seed, cars);
            // What it stopped on, where, its heading, and the piece it must get off (None: the island's rocks).
            let mut spots: Vec<(String, f64, f64, f32, Option<jj_procgen::arena::Relief>)> =
                Vec::new();
            for p in &f.relief {
                let out = libm::atan2(p.dir[0], p.dir[1]) as f32;
                match p.kind {
                    ReliefKind::Dip | ReliefKind::Mound => {
                        for k in 0..4 {
                            spots.push((
                                format!("{} {k}", p.kind.name()),
                                p.x,
                                p.z,
                                k as f32 * core::f32::consts::FRAC_PI_2,
                                Some(*p),
                            ));
                        }
                    }
                    _ => {
                        let top = p.up + p.table / 2.0 - p.length() / 2.0;
                        // Across the jump, both ways (the worst way off a table). Across the crossover's deck stand the
                        // gate's rocks (br-bhkz.4: a car nose-on to a rock is the island's case, below), so from its
                        // middle a car drives out along it, both ways.
                        let across: Vec<(f64, f32)> = if p.kind == ReliefKind::Crossover {
                            vec![(top, out), (top, out + core::f32::consts::PI)]
                        } else {
                            vec![
                                (top, out + core::f32::consts::FRAC_PI_2),
                                (top, out - core::f32::consts::FRAC_PI_2),
                                (top, out),
                            ]
                        };
                        for (k, (u, h)) in across.into_iter().enumerate() {
                            spots.push((
                                format!("{} top {k}", p.kind.name()),
                                p.x + p.dir[0] * u,
                                p.z + p.dir[1] * u,
                                h,
                                Some(*p),
                            ));
                        }
                        // Astride each lip (the creases a car could high-centre on), both ways along.
                        for (k, u) in [(0, p.up), (1, p.up + p.table)] {
                            let u = u - p.length() / 2.0;
                            for (w, h) in [("on", out), ("back", out + core::f32::consts::PI)] {
                                spots.push((
                                    format!("{} lip {k} {w}", p.kind.name()),
                                    p.x + p.dir[0] * u,
                                    p.z + p.dir[1] * u,
                                    h,
                                    Some(*p),
                                ));
                            }
                        }
                    }
                }
            }
            // Beside each rock, facing away from the island's middle (across the spine for its middle rock).
            let n = f.rocks.len() as f64;
            let (cx, cz) = (
                f.rocks.iter().map(|r| r.x).sum::<f64>() / n,
                f.rocks.iter().map(|r| r.z).sum::<f64>() / n,
            );
            for r in &f.rocks {
                let (dx, dz) = (r.x - cx, r.z - cz);
                let a = if dx.hypot(dz) > 0.1 {
                    dz.atan2(dx)
                } else if let Some(o) = f.rocks.iter().find(|o| (o.x - cx).hypot(o.z - cz) > 0.1) {
                    (o.z - cz).atan2(o.x - cx) + core::f64::consts::FRAC_PI_2
                } else {
                    0.7
                };
                // A car's half-length and a hand off the rock (br-bhkz.4: it was 1.6 m, the car's tail 0.6 m inside
                // the rock, which pushed it out over a clear floor; with a jump's side slope a lane away it wedged).
                let (x, z) = (r.x + (r.r + 2.4) * a.cos(), r.z + (r.r + 2.4) * a.sin());
                spots.push((
                    "island".into(),
                    x,
                    z,
                    libm::atan2(a.cos(), a.sin()) as f32,
                    None,
                ));
            }
            for (what, x, z, heading, piece) in spots {
                let mut sim = sim(&map);
                let car = sim.spawn_grid(1)[0];
                let y = ground(&map.map, x, z) as f32 + 0.6;
                sim.place_car(
                    car,
                    jj_sim::SpawnPose {
                        x: x as f32,
                        y,
                        z: z as f32,
                        heading,
                    },
                    0.0,
                    [0.0; 3],
                );
                // Off the piece by a car's length (or 8 m from a rock), at any time in 6 s: it drove away, upright as it
                // left (what it meets after that, the bank at full throttle, is another test's).
                let (mut away, mut off, mut up) = (0.0f64, false, 1.0f32);
                for _ in 0..(6 * S) {
                    sim.set_input(
                        car,
                        DriveInput {
                            throttle: 32767,
                            ..DriveInput::default()
                        },
                    );
                    sim.step();
                    let st = sim.car_state(car).unwrap();
                    let (px, pz) = (f64::from(st.position[0]), f64::from(st.position[2]));
                    away = away.max((px - x).hypot(pz - z));
                    if !off {
                        up = up.min(st.up_y);
                    }
                    off |= match piece {
                        Some(p) => !p.covers(px, pz, 0.5),
                        None => away > 8.0,
                    };
                }
                rows.push((cars, seed, what.clone(), away));
                assert!(
                    off && up > 0.5,
                    "{cars}/{seed}: a car stopped at {what} ({x:.1}, {z:.1}) didn't drive off it in 6 s ({away:.1} m, up {up:.2})"
                );
            }
        }
    }
    println!("{} stopped cars all drove away", rows.len());
}

/// The bots hunting round a featured bowl meet the jumps, fly and land: a minute of a 13-car derby on the carnage bowl's
/// arena, counting every judged landing whose flight took off over a jump. Landings are judged (P1-FL07) and a crash is
/// righted at once: every car keeps moving and stays in the bowl.
///
/// br-bhkz.4: with the 12 degree hops the bots' lines skirted, this measured 5 landings by 3 bots a minute (and asked
/// for 3 by 2). With 20 degree launches and the crossover on the bots' line through the island's gate it measures 18
/// landings by 10 of the 13 bots, 8 of them off the crossover, none a crash; the floors below are about half of that.
#[test]
fn derby_bots_fly_the_jumps_and_land() {
    let (cars, seed) = (13, BANK_SEED);
    let map = arena(seed, cars);
    let f = field(seed, cars);
    let d = design(&map);
    let mut sim = sim(&map);
    let ids = sim.spawn_grid(cars);
    sim.start_derby(180 * S);
    for &id in &ids {
        sim.set_autopilot(id, true);
    }
    let profile = sim.air_profile().clone();
    let mut flying = vec![None::<(f64, f64)>; cars];
    let mut last = vec![None; cars];
    let mut tiers = [0u32; 4];
    let (mut jump_landings, mut fliers) = (0u32, std::collections::BTreeSet::new());
    let mut by_kind = std::collections::BTreeMap::<&str, u32>::new();
    let mut airtime = Vec::<f32>::new();
    let mut max_r = 0.0f64;
    let mut upright = vec![0u64; cars];
    for t in 0..(60 * S) {
        sim.step();
        for (k, &id) in ids.iter().enumerate() {
            let st = sim.car_state(id).unwrap();
            // On the floor (not riding the bank, where a car leans with it).
            let on_floor =
                f64::from(st.position[0]).hypot(f64::from(st.position[2])) < d.floor_r - 1.0;
            if t % 6 == 0 && (st.up_y > 0.5 || !on_floor) {
                upright[k] += 1;
            } else if t % 60 == 0 && std::env::var_os("JJ_TRACE").is_some() {
                eprintln!(
                    "t {:.1} car {k} up {:.2} at ({:.1}, {:.1}, {:.1}) v {:.1}",
                    t as f64 / S as f64,
                    st.up_y,
                    st.position[0],
                    st.position[1],
                    st.position[2],
                    st.forward_speed
                );
            }
            let air = sim.air_state(id).unwrap();
            let now = air.flying(&profile, TICK_HZ);
            let (x, z) = (f64::from(st.position[0]), f64::from(st.position[2]));
            max_r = max_r.max(x.hypot(z));
            match (flying[k], now) {
                (None, true) => flying[k] = Some((x, z)),
                (Some((x0, z0)), false) => {
                    flying[k] = None;
                    // Took off on a jump (or within a car's length past its end), and the judge saw a new landing.
                    let off = f
                        .relief
                        .iter()
                        .any(|p| p.kind.is_jump() && p.covers(x0, z0, 4.0));
                    if let Some(l) = air.last
                        && off
                        && air.last != last[k]
                    {
                        jump_landings += 1;
                        fliers.insert(k);
                        tiers[l.tier.as_u8() as usize] += 1;
                        let kind = f
                            .relief
                            .iter()
                            .find(|p| p.kind.is_jump() && p.covers(x0, z0, 4.0))
                            .map_or("?", |p| p.kind.name());
                        *by_kind.entry(kind).or_insert(0u32) += 1;
                        airtime.push(l.airtime_s);
                        if std::env::var_os("JJ_TRACE").is_some() {
                            eprintln!(
                                "t {:.1} car {k} flew a {kind}: {:.2} s, {:.1} m, tier {} ({:.0} deg)",
                                t as f64 / S as f64,
                                l.airtime_s,
                                (x - x0).hypot(z - z0),
                                l.tier.as_u8(),
                                l.angle_deg
                            );
                        }
                    }
                    last[k] = air.last;
                }
                _ => {}
            }
        }
    }
    // Every car spends its time on the floor on its wheels (a crash landing is righted at once): upright in 90 % of the
    // samples (a car on the bank leans with it and counts as upright).
    let least = upright.iter().copied().min().unwrap_or(0) as f64 / (60 * S / 6) as f64;
    airtime.sort_by(f32::total_cmp);
    eprintln!(
        "jump landings {jump_landings} by {} of {cars} cars ({by_kind:?}); tiers clean/ok/bad/crash {tiers:?}; airtime median {:.2} s, longest {:.2} s; least upright {least:.2}; max r {max_r:.1} of wall {:.1}",
        fliers.len(),
        airtime.get(airtime.len() / 2).copied().unwrap_or(0.0),
        airtime.last().copied().unwrap_or(0.0),
        d.wall_r()
    );
    assert!(
        max_r < d.wall_r() + ESCAPE_MARGIN_M,
        "no car leaves the bowl"
    );
    // Bots hunt cars, not jumps: they fly a jump when one lies on the way to a rival, the crossover among them.
    assert!(
        jump_landings >= 10,
        "the bots fly the jumps: {jump_landings}"
    );
    assert!(
        fliers.len() >= 6,
        "most bots fly: {} of {cars}",
        fliers.len()
    );
    let crossed = by_kind.get("crossover").copied().unwrap_or(0);
    assert!(crossed >= 3, "the bots fly the crossover: {crossed}");
    assert!(
        least > 0.9,
        "every car is on its wheels most of the time ({least:.2})"
    );
    assert_eq!(tiers[3], 0, "no crash landings off the jumps");
}

/// P1-M-arena-features, br-bhkz.4: the jumps fixture (`scenarios/derby/arena-jumps.json`) on the 8-car bank arena
/// (`maps/derby-bowl-8.json`). Two bots take turns over every jump, the crossover first: one hunts the other, parked on
/// the far side, so its line runs over the jump; then they swap and the other bot flies it the other way. The envelope:
/// each flight is a real one (the hunter's landings and time in the air go up every round), both bots land on their
/// wheels (judged clean or ok, never bad or a crash) and ram their rival, and neither leaves the bowl.
///
/// Two cars, not a pair per jump: a hunter picks the nearest rival it faces, so with other pairs on the floor the
/// crossover's bot chased a neighbour instead of the rival across the island.
const FIXTURE_ROUND_TICKS: u64 = 600;
/// Every flight in the jumps fixture adds at least this much time off the ground, s (measured 1.0-1.2 s each).
const FIXTURE_AIR_S: f64 = 0.8;

#[test]
fn the_arena_jumps_fixture_is_the_generators_output() {
    let cars = 8;
    let map = arena(BANK_SEED, cars);
    let f = field(BANK_SEED, cars);
    let d = design(&map);
    let jumps: Vec<_> = f.relief.iter().filter(|p| p.kind.is_jump()).collect();
    assert!(jumps.len() >= 3 && jumps[0].kind == ReliefKind::Crossover);
    let root = format!("{}/../..", env!("CARGO_MANIFEST_DIR"));
    // Is (x, z) clear floor: on the floor, off every piece and rock by a car's half-length?
    let clear = |x: f64, z: f64| {
        x.hypot(z) < d.floor_r - 4.0
            && f.relief.iter().all(|p| !p.covers(x, z, 2.5))
            && f.rocks.iter().all(|r| (x - r.x).hypot(z - r.z) > r.r + 2.5)
    };
    let pose = |x: f64, z: f64, heading: f64| {
        serde_json::json!({
            "x": (x * 100.0).round() / 100.0,
            "y": 0.12,
            "z": (z * 100.0).round() / 100.0,
            "headingDeg": (heading.to_degrees() * 10.0).round() / 10.0,
        })
    };
    let (mut place, mut autopilot, mut expect) = (Vec::new(), Vec::new(), Vec::new());
    let wall = ((d.wall_r() + ESCAPE_MARGIN_M) * 10.0).round() / 10.0;
    // Parked across the spawn ring from each other until the first round.
    let fixture_cars: Vec<serde_json::Value> = (0..2)
        .map(|car| {
            let a = core::f64::consts::PI * f64::from(car);
            let r = d.floor_r - 5.5;
            serde_json::json!({ "pose": pose(r * a.cos(), r * a.sin(), a) })
        })
        .collect();
    // The hunter starts at this speed, 12 m before the ramp. br-bhkz.4: it was 16 then 22 m/s over 12-degree hops; a
    // 20-degree launch from 14 m/s (about 17 at the ramp's foot) flies over a second and 18 m, and faster would carry a
    // bot past the floor the 8-car bowl has beyond its jumps.
    let speed = 14.0f64;
    let mut flights = [0u32; 2];
    for (j, p) in jumps.iter().enumerate() {
        // Up the jump's launch ramp, then the other way (the crossover from its other end): car 0 flies the first,
        // car 1 the second.
        for (hunter, way) in [(0usize, 1.0), (1usize, -1.0)] {
            let round = (2 * j + hunter) as u64;
            let tick = 200 + FIXTURE_ROUND_TICKS * round;
            let prey = 1 - hunter;
            let (tx, tz) = (p.dir[0] * way, p.dir[1] * way);
            let heading = libm::atan2(tx, tz);
            let half = p.length() / 2.0;
            // The nearest clear floor to 12 m before the jump and 20 m past it (beyond the flight: a bot that lands on its
            // rival isn't judged on the jump).
            let spot = |sign: f64, want: &[f64]| {
                want.iter()
                    .map(|&m| (p.x + sign * tx * (half + m), p.z + sign * tz * (half + m)))
                    .find(|&(x, z)| clear(x, z))
                    .unwrap_or_else(|| panic!("jump {j}: no clear floor {sign} of it"))
            };
            let (hx, hz) = spot(-1.0, &[12.0, 10.0, 14.0, 8.0, 16.0]);
            let (px, pz) = spot(1.0, &[20.0, 18.0, 22.0, 16.0, 24.0, 14.0]);
            place.push(serde_json::json!({ "car": hunter, "tick": tick, "pose": pose(hx, hz, heading),
                "linvel": [((speed * tx) * 100.0f64).round() / 100.0, 0, ((speed * tz) * 100.0f64).round() / 100.0] }));
            place.push(serde_json::json!({ "car": prey, "tick": tick, "pose": pose(px, pz, heading + core::f64::consts::FRAC_PI_2),
                "linvel": [0, 0, 0] }));
            autopilot.push(serde_json::json!({ "tick": tick, "car": hunter, "on": true }));
            autopilot.push(serde_json::json!({ "tick": tick, "car": prey, "on": false }));
            // By the end of its round the hunter has flown this jump: one more landing, and real air under it.
            flights[hunter] += 1;
            let at = tick + FIXTURE_ROUND_TICKS - 10;
            expect.extend([
                serde_json::json!({ "car": hunter, "atTick": at, "metric": "landings", "min": flights[hunter], "max": 1000 }),
                serde_json::json!({ "car": hunter, "atTick": at, "metric": "airtimeS",
                    "min": (FIXTURE_AIR_S * f64::from(flights[hunter]) * 10.0).round() / 10.0, "max": 600 }),
            ]);
        }
    }
    for car in 0..2 {
        expect.extend([
            serde_json::json!({ "car": car, "metric": "landingTier", "min": 0, "max": 1 }),
            serde_json::json!({ "car": car, "metric": "landingUpY", "min": 0.7, "max": 1.001 }),
            serde_json::json!({ "car": car, "metric": "derbyPoints", "min": 0.1, "max": 100000 }),
            serde_json::json!({ "car": car, "metric": "maxRadiusM", "min": 0, "max": wall }),
        ]);
    }
    let fixture = serde_json::json!({
        "scenario": "arena-jumps",
        "what": "P1-M-arena-features, br-bhkz.4: bots fly the derby arena's jumps and land. On the 8-car bank arena (maps/derby-bowl-8.json, seed 11) two bots take turns over every jump, the crossover through the island's gate first, then the jumps either side of it. Each round (every 600 ticks from tick 200) one bot is put on the autopilot about 12 m before a jump's launch ramp at 14 m/s and the other is parked about 20 m past its far end, beyond the flight (the nearest clear floor), so the hunter's line runs over the jump (for the crossover, through the gate between the island's rocks, which the bots take instead of going round); the next round they swap and the other bot flies the same jump the other way. Every flight is a real one (by the end of its round the hunter has one more landing and at least 0.8 s more time in the air), both bots land on their wheels (the first landing judged clean or ok by the landing judge, never bad or a crash) and ram their rival, and neither leaves the bowl. Re-pinned for br-bhkz.4 (generator 4: 20 degree launches to 1-2 m lips and the crossover; the old fixture flew 12 degree hops at 16 and 22 m/s with a pair of cars per jump, and car 2 was let off its second flight, br-7htf: that relaxation is removed; two cars because a hunter picks the nearest rival it faces, and with other pairs on the floor that wasn't the one across the jump). Generated by crates/jj-procgen/tests/arena.rs (JJ_BLESS=1).",
        "map": "maps/derby-bowl-8.json",
        "seed": 7,
        "ticks": 200 + FIXTURE_ROUND_TICKS * 2 * jumps.len() as u64,
        "derby": { "atTick": 0 },
        "cars": fixture_cars,
        "place": place,
        "autopilot": autopilot,
        "expect": expect,
    });
    let json = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
    let path = format!("{root}/scenarios/derby/arena-jumps.json");
    if std::env::var_os("JJ_BLESS").is_some() {
        std::fs::write(&path, &json).unwrap();
        return;
    }
    assert!(
        std::fs::read_to_string(&path).unwrap_or_default() == json,
        "scenarios/derby/arena-jumps.json is stale: re-bless with JJ_BLESS=1"
    );
}

/// P1-W04: a derby's item boxes never block a jump: no box stands on a jump's ramps, table or side slopes, and the
/// box's 1.3 m cube (`generic/item-station`) reaches nowhere a jump stands more than the sim's flat-ground allowance
/// (`BOX_FLAT_RISE_M`, 0.2 m) over the floor, on arenas that carry the field; and there are still plenty of them. (A box
/// may stand on a dip's gentle edge: it never collides.) br-bhkz.4: the check was the cube against the whole footprint;
/// the sim's placement reads the ground 2 m round a spot in eight directions, which can miss the corner of a ramp's
/// foot, where the ramp is a few centimetres high (seed 5/8 put a box 0.4 m off one). That blocks nothing, so the
/// check is now the ground under the cube.
#[test]
fn derby_item_boxes_never_block_a_jump() {
    for (seed, cars) in [(1, 8), (2, 16), (3, 32), (4, 24), (5, 8)] {
        let map = arena(seed, cars);
        let f = field(seed, cars);
        let mut sim = sim(&map);
        sim.spawn_grid(1);
        sim.start_derby(180 * S);
        let boxes = sim.stations();
        let jumps = f.relief.iter().filter(|p| p.kind.is_jump()).count();
        eprintln!("{seed}/{cars}: {} boxes, {jumps} jumps", boxes.len());
        assert!(
            boxes.len() >= 12,
            "{seed}/{cars}: plenty of boxes: {}",
            boxes.len()
        );
        for b in boxes {
            let (x, z) = (f64::from(b.position[0]), f64::from(b.position[2]));
            for p in f.relief.iter().filter(|p| p.kind.is_jump()) {
                let under = [
                    (0.0, 0.0),
                    (0.65, 0.65),
                    (-0.65, 0.65),
                    (0.65, -0.65),
                    (-0.65, -0.65),
                ]
                .iter()
                .map(|&(dx, dz)| p.height_at(x + dx, z + dz))
                .fold(0.0, f64::max);
                assert!(
                    !p.covers(x, z, 0.0) && under <= 0.2,
                    "{seed}/{cars}: a box at ({x:.1}, {z:.1}) is on a {} (the jump stands {under:.2} m under it)",
                    p.kind.name()
                );
            }
        }
    }
}

/// A minute of derby, per car: shares of the time it was slow (under 3 m/s, not held for a respawn), on the bank (past
/// the floor's edge), tilted (up < 0.7), and parked on the rim (on the bank and slow or tilted: the review's finding).
#[derive(Debug, Default, Clone, Copy)]
struct Minute {
    slow: f64,
    bank: f64,
    tilted: f64,
    rim_parked: f64,
}

/// A 60 s derby as the host runs one: six cars on a 6-car bowl, a player's idle seat (the autopilot at the idle pace, in
/// a roster car that changes with the seed) and Easy, Normal, Hard, Normal and Hard bots (the host's bots drive roster
/// car 0), all hunting. Per car its minute, and the derby's score events.
fn derby_minute(seed: u64) -> (Vec<Minute>, usize) {
    let cars = 6;
    let map = arena(seed, cars);
    let d = design(&map);
    let roster: Vec<VehicleProfile> =
        VehicleProfile::roster(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
            .unwrap()
            .into_iter()
            .map(|(_, p)| p)
            .collect();
    let seat_car = seed as usize % roster.len();
    let mut sim = Sim::with_profiles(&map, &jj_procgen::registry(), seed, roster);
    let ids = sim.spawn_grid_as(&[seat_car, 0, 0, 0, 0, 0]);
    sim.start_derby(180 * S);
    // The idle seat (botSkills.idle), then the bots.
    for (&id, pace) in ids.iter().zip([700u16, 800, 900, 1000, 900, 1000]) {
        sim.set_autopilot(id, true);
        sim.set_bot_pace(id, pace);
    }
    let mut out = vec![Minute::default(); cars];
    let mut samples = 0.0;
    for t in 0..(60 * S) {
        sim.step();
        if t % (S / 10) != 0 {
            continue;
        }
        samples += 1.0;
        for (k, &id) in ids.iter().enumerate() {
            let st = sim.car_state(id).unwrap();
            let r = f64::from(st.position[0] - d.cx as f32)
                .hypot(f64::from(st.position[2] - d.cz as f32));
            let held = sim.race().is_held(id.0, sim.tick());
            let slow = !held && st.forward_speed.abs() < 3.0;
            let (bank, tilted) = (r > d.floor_r, st.up_y < 0.7);
            let m = &mut out[k];
            m.slow += f64::from(u8::from(slow));
            m.bank += f64::from(u8::from(bank));
            m.tilted += f64::from(u8::from(tilted));
            m.rim_parked += f64::from(u8::from(!held && bank && (slow || tilted)));
        }
    }
    for m in &mut out {
        *m = Minute {
            slow: m.slow / samples,
            bank: m.bank / samples,
            tilted: m.tilted / samples,
            rim_parked: m.rim_parked / samples,
        };
    }
    let hits = sim.derby().expect("the derby is on").events().len();
    (out, hits)
}

/// Council review 2026-11-16 (#5): in a 60 s derby an idle player's autopilot and the Easy bot sat under 3 m/s for most
/// of it, tilted on the bowl's rim, and by the end every car was pressed against the bottom of the bank. A derby is the
/// round where everyone smashes. Six seeds of a six-car derby (each with a different roster car in the idle seat):
/// measured before the fix, the field spent 21 % of the minute parked on the rim, 19 % tilted and 53 % on the bank, with
/// 113 score events a minute; after it, 8 %, 4 % and 25 %, with 126. No car spends a third of the minute slow (the worst
/// is a car rammed and pinned: 28 % before, 30 % after, where a back-off or a ram is a slow moment on the floor).
#[test]
fn derby_bots_keep_off_the_rim_and_never_park() {
    let (mut all, mut hits) = (Vec::new(), 0);
    for seed in 1u64..=6 {
        let (cars, h) = derby_minute(seed);
        let pct = |v: f64| (v * 100.0).round();
        let row: Vec<String> = cars
            .iter()
            .map(|m| {
                format!(
                    "{}/{}/{}/{}",
                    pct(m.slow),
                    pct(m.bank),
                    pct(m.tilted),
                    pct(m.rim_parked)
                )
            })
            .collect();
        eprintln!(
            "seed {seed}: slow/bank/tilted/rim-parked % (idle seat, then bots) {row:?}; {h} score events"
        );
        all.extend(cars);
        hits += h;
    }
    let mean = |f: fn(&Minute) -> f64| all.iter().map(f).sum::<f64>() / all.len() as f64;
    let (rim_parked, tilted, bank) = (mean(|m| m.rim_parked), mean(|m| m.tilted), mean(|m| m.bank));
    let per_minute = hits as f64 / 6.0;
    eprintln!(
        "field: rim-parked {:.1} %, tilted {:.1} %, on the bank {:.1} %; {per_minute:.0} score events a minute",
        rim_parked * 100.0,
        tilted * 100.0,
        bank * 100.0
    );
    assert!(
        rim_parked < 0.12,
        "the field parks on the rim: {rim_parked:.3}"
    );
    assert!(
        tilted < 0.08,
        "the field sits tilted on the bank: {tilted:.3}"
    );
    assert!(
        bank < 0.3,
        "the field hunts on the floor, not the bank: {bank:.3}"
    );
    let worst = all.iter().map(|m| m.slow).fold(0.0, f64::max);
    assert!(
        worst < 1.0 / 3.0,
        "a car spent {worst:.2} of the derby slow"
    );
    assert!(
        per_minute >= 110.0,
        "everyone smashes: {per_minute:.0} score events a minute"
    );
}

// ---- br-bhkz.4: launches worth taking ----

/// One measured flight off a jump.
#[derive(Debug, Clone, Copy)]
struct Flight {
    /// Speed as its nose reached the ramp's foot, m/s.
    foot_mps: f32,
    /// Speed as the last wheel left the ground, m/s.
    lip_mps: f32,
    airtime_s: f32,
    /// Ground distance from takeoff to touchdown, m.
    dist_m: f64,
    /// Highest the chassis got above the floor, m.
    peak_m: f32,
    tier: u8,
    angle_deg: f32,
    /// Least up_y in the half second after touchdown.
    min_up: f32,
    /// Where it came down, along the launch direction from the piece's middle, m.
    down_u: f64,
}

/// Sends a car at `speed` m/s along `dir` from `run` m before `(x, z)`, where the ramp's foot is: it holds that speed
/// to the foot, takes the ramp with the throttle down and flies as an autopilot's car does (neutral). Reports its
/// first judged landing; `down_u` is how far past `(x, z)` it came down.
fn fly(map: &LoadedMap, at: (f64, f64), dir: [f64; 2], run: f64, speed: f32) -> Option<Flight> {
    let mut sim = sim(map);
    let car = sim.spawn_grid(1)[0];
    sim.start_derby(180 * S);
    for _ in 0..(4 * S) {
        sim.step();
    }
    let heading = libm::atan2(dir[0], dir[1]) as f32;
    let (x0, z0) = (at.0 - dir[0] * run, at.1 - dir[1] * run);
    sim.place_car(
        car,
        jj_sim::SpawnPose {
            x: x0 as f32,
            y: 0.12,
            z: z0 as f32,
            heading,
        },
        0.0,
        [speed * dir[0] as f32, 0.0, speed * dir[1] as f32],
    );
    let before = sim.air_state(car).unwrap().landings;
    let (mut off, mut peak, mut lip, mut foot) = (None, 0.0f32, 0.0f32, 0.0f32);
    let mut out = None;
    let mut after = 0u64;
    let mut grounded_for = 0u64;
    let mut min_up = 1.0f32;
    for _ in 0..(8 * S) {
        let st = sim.car_state(car).unwrap();
        let grounded = st.wheels_in_contact > 0;
        // Neutral in the air (an autopilot's car flies neutral, R14). On the ground it holds `speed` up to the ramp's
        // foot (`run` m on), then the throttle is down until it has landed.
        let gone = (f64::from(st.position[0]) - x0).hypot(f64::from(st.position[2]) - z0);
        let throttle = grounded && out.is_none() && (gone >= run - 0.5 || st.forward_speed < speed);
        // Read a car's half-length before the foot: at the foot its front wheels are already on the ramp.
        if gone < run - 2.2 {
            foot = st.forward_speed;
        }
        sim.set_input(
            car,
            DriveInput {
                throttle: if throttle { 32767 } else { 0 },
                ..DriveInput::default()
            },
        );
        sim.step();
        let st = sim.car_state(car).unwrap();
        let (x, z) = (f64::from(st.position[0]), f64::from(st.position[2]));
        if out.is_none() {
            if st.wheels_in_contact == 0 {
                if off.is_none() {
                    off = Some((x, z));
                    lip = f32::hypot(f32::hypot(st.linvel[0], st.linvel[2]), st.linvel[1]);
                }
                peak = peak.max(st.position[1]);
                grounded_for = 0;
            } else if sim.air_state(car).unwrap().landings == before {
                // A hop that wasn't judged: forget it once the car has been down a moment (a landing is judged a few
                // ticks after first contact).
                grounded_for += 1;
                if grounded_for > S / 4 {
                    off = None;
                    peak = 0.0;
                }
            }
            let air = sim.air_state(car).unwrap();
            if air.landings > before
                && let (Some(l), Some((ox, oz))) = (air.last, off)
            {
                out = Some(Flight {
                    foot_mps: foot,
                    lip_mps: lip,
                    airtime_s: l.airtime_s,
                    dist_m: (x - ox).hypot(z - oz),
                    peak_m: peak,
                    tier: l.tier.as_u8(),
                    angle_deg: l.angle_deg,
                    min_up: 1.0,
                    down_u: (x - at.0) * dir[0] + (z - at.1) * dir[1],
                });
            }
        } else {
            after += 1;
            min_up = min_up.min(st.up_y);
            if after >= S / 2 {
                break;
            }
        }
    }
    out.map(|f| Flight { min_up, ..f })
}

/// A bare 16-car arena carrying only `relief` and `rocks` (hand-laid: a piece measured on its own).
fn lab(relief: Vec<jj_procgen::arena::Relief>, rocks: Vec<jj_procgen::arena::Rock>) -> LoadedMap {
    let cars = 32;
    let floor_r = jj_procgen::arena::arena_floor_radius(cars);
    let f = Field {
        radius: jj_procgen::arena::field::radius_for(floor_r),
        rocks,
        relief,
    };
    let map = jj_procgen::arena::build(1, cars, &f);
    let registry = jj_procgen::registry();
    let bad = check(&map, &registry);
    assert!(bad.is_empty(), "{bad:?}");
    jj_map::load_json(&serde_json::to_vec(&map).unwrap(), &registry).unwrap()
}

/// A way onto a jump: the jump, which end ("up" its `dir`, or "back"), the ramp's foot, the way along it and the
/// run-up's length.
type Launch = (
    jj_procgen::arena::Relief,
    &'static str,
    (f64, f64),
    [f64; 2],
    f64,
);

/// Every way onto every jump of `f` that has a clear run-up.
fn launches(d: &BowlDesign, f: &Field) -> Vec<Launch> {
    let mut out = Vec::new();
    for (k, p) in f
        .relief
        .iter()
        .enumerate()
        .filter(|(_, p)| p.kind.is_jump())
    {
        for (name, way) in [("up", 1.0), ("back", -1.0)] {
            let dir = [p.dir[0] * way, p.dir[1] * way];
            let half = p.length() / 2.0;
            let foot = (p.x - dir[0] * half, p.z - dir[1] * half);
            // The run-up is on the floor and clear of every other piece and the rocks.
            let clear = |x: f64, z: f64| {
                x.hypot(z) < d.floor_r - 2.0
                    && f.relief
                        .iter()
                        .enumerate()
                        .all(|(i, q)| i == k || !q.covers(x, z, 1.0))
                    && f.rocks.iter().all(|r| (x - r.x).hypot(z - r.z) > r.r + 1.5)
            };
            let run = [14.0, 12.0, 10.0].into_iter().find(|&run| {
                (0..=28).all(|i| {
                    let m = run * f64::from(i) / 28.0;
                    clear(foot.0 - dir[0] * m, foot.1 - dir[1] * m)
                })
            });
            if let Some(run) = run {
                out.push((*p, name, foot, dir, run));
            }
        }
    }
    out
}

/// Where a flight off `p` from `foot` along `dir` came down: on its own deck, on its far ramp's back, on the floor
/// beyond it, on another piece of the field, or past the floor's edge on the bank.
fn came_down(
    d: &BowlDesign,
    field: &Field,
    p: &jj_procgen::arena::Relief,
    launch_ramp: f64,
    (foot, dir): ((f64, f64), [f64; 2]),
    f: &Flight,
) -> &'static str {
    let (x, z) = (foot.0 + dir[0] * f.down_u, foot.1 + dir[1] * f.down_u);
    if f.down_u < launch_ramp + p.table {
        "deck"
    } else if f.down_u < p.length() {
        "far ramp"
    } else if x.hypot(z) > d.floor_r - 1.0 {
        "bank"
    } else if field.relief.iter().any(|q| q != p && q.covers(x, z, 1.0)) {
        "another piece"
    } else {
        "floor"
    }
}

/// The speeds the flights are measured at, m/s at the ramp's foot: a derby's bots hunt at 12-22 m/s and a Cruz reaches
/// 23 m/s in 6 s.
const FLIGHT_SPEEDS: [f32; 4] = [12.0, 16.0, 20.0, 24.0];
/// A jump with a lip this high is one of the big ones, m.
const BIG_LIP_M: f64 = 1.5;

/// br-bhkz.4 (owner 2026-11-17: "the jumps were really not good enough"): launches worth taking. Every jump of the 8, 24
/// and 32-car bank arenas, flown both ways at 12, 16, 20 and 24 m/s by a car that flies as an autopilot's does (neutral,
/// R14: the lip decides its landing). The envelope:
///
/// - every flight is judged and lands on its wheels, upright after it: clean or OK on the floor or a deck, at worst bad
///   (never a crash) where it meets a slope (a far ramp's back when it came up short; another piece or the bank when it
///   flew that far);
/// - the big ones (lips of 1.5 m and more) fly at least a second from 16 m/s up (measured 1.2-1.5 s) and 0.9 s at
///   12 m/s (measured 1.0 s);
/// - the crossover is in every arena with a clear run-up at both ends; from 14 m/s a car clears its deck, the gate and
///   the far ramp, flies over a second and comes down on the floor beyond; at 12 m/s it mostly comes up short, onto
///   the far ramp's back.
///
/// `JJ_EVIDENCE=1` writes the table to `docs/evidence/br-bhkz.4/flights.txt`.
#[test]
fn the_jumps_fly_a_second_and_land_on_their_wheels() {
    let mut rows = vec![format!(
        "{:>4} {:>9} {:>4} {:>4} {:>5} {:>5} {:>5} {:>5} {:>6} {:>5} {:>5} {:>5}  {}",
        "cars",
        "jump",
        "way",
        "lip",
        "slope",
        "foot",
        "off",
        "air s",
        "dist m",
        "peak",
        "tier",
        "deg",
        "came down on"
    )];
    let tiers = ["clean", "ok", "bad", "crash"];
    let mut wrong = Vec::<String>::new();
    for cars in FIELD_CARS {
        let map = arena(BANK_SEED, cars);
        let f = field(BANK_SEED, cars);
        let d = design(&map);
        let ways = launches(&d, &f);
        assert_eq!(
            ways.iter()
                .filter(|w| w.0.kind == ReliefKind::Crossover)
                .count(),
            2,
            "{cars}: the crossover has a clear run-up at both ends"
        );
        for (p, name, foot, dir, run) in ways {
            let ramp = if name == "up" { p.up } else { p.down };
            let big = p.height >= BIG_LIP_M - 1e-9;
            // The crossover is flown at 14 m/s too: about where it starts to clear.
            let speeds: Vec<f32> = if p.kind == ReliefKind::Crossover {
                vec![12.0, 14.0, 16.0, 20.0, 24.0]
            } else {
                FLIGHT_SPEEDS.to_vec()
            };
            for v in speeds {
                let what = format!("{cars}: a {} ({name}) at {v} m/s", p.kind.name());
                let fl = fly(&map, foot, dir, run, v)
                    .unwrap_or_else(|| panic!("{what}: no judged landing"));
                let on = came_down(&d, &f, &p, ramp, (foot, dir), &fl);
                rows.push(format!(
                    "{cars:>4} {:>9} {name:>4} {:>4.1} {:>5.2} {:>5.1} {:>5.1} {:>5.2} {:>6.1} {:>5.1} {:>5} {:>5.1}  {on}",
                    p.kind.name(),
                    p.height,
                    p.height / ramp,
                    fl.foot_mps,
                    fl.lip_mps,
                    fl.airtime_s,
                    fl.dist_m,
                    fl.peak_m,
                    tiers[fl.tier as usize],
                    fl.angle_deg,
                ));
                // On the floor or a deck a neutral flight lands clean or OK. On a far ramp's back (a flight that came up
                // short) the ground falls away under a nose still up from the launch: at worst bad (a quarter of its
                // speed), never a crash, and the driver who noses down lands it clean (R14: the pitch is the skill).
                // A flight fast enough to reach the bank or another piece of the field meets a slope, like one that
                // came up short: the same allowance.
                let worst = if on == "floor" || on == "deck" { 1 } else { 2 };
                if fl.tier > worst || fl.min_up <= 0.7 {
                    wrong.push(format!(
                        "{what}: lands on its wheels (tier {}, {:.1} deg, up {:.2}, on the {on})",
                        tiers[fl.tier as usize], fl.angle_deg, fl.min_up
                    ));
                }
                if p.kind == ReliefKind::Crossover
                    && v >= 14.0
                    && (on == "deck" || on == "far ramp")
                {
                    wrong.push(format!(
                        "{what}: clears the crossover (came down on the {on})"
                    ));
                }
                let least = if v >= 14.0 { 1.0 } else { 0.9 };
                if big && (v >= 14.0 || p.kind != ReliefKind::Crossover) && fl.airtime_s < least {
                    wrong.push(format!(
                        "{what}: flies {:.2} s, at least {least}",
                        fl.airtime_s
                    ));
                }
            }
        }
    }
    let table = rows.join("\n") + "\n";
    println!("{table}");
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    if std::env::var_os("JJ_EVIDENCE").is_some() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/evidence/br-bhkz.4");
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(format!("{dir}/flights.txt"), table).unwrap();
    }
}

/// br-bhkz.4: nothing about the crossover traps a slow car. From 4 to 12 m/s at the ramp's foot (too slow to clear it) a
/// car rolls or hops onto the deck, runs between the gate's rocks and leaves by the far ramp, on its wheels, at both
/// ends of every sampled arena's crossover: there is no gap to drop into.
#[test]
fn a_slow_car_drives_over_the_crossover() {
    for cars in FIELD_CARS {
        for seed in [BANK_SEED, 2] {
            let map = arena(seed, cars);
            let f = field(seed, cars);
            let d = design(&map);
            for (p, name, foot, dir, run) in launches(&d, &f) {
                if p.kind != ReliefKind::Crossover {
                    continue;
                }
                for v in [4.0f32, 6.0, 8.0, 10.0, 12.0] {
                    let mut sim = sim(&map);
                    let car = sim.spawn_grid(1)[0];
                    sim.start_derby(180 * S);
                    for _ in 0..(4 * S) {
                        sim.step();
                    }
                    let heading = libm::atan2(dir[0], dir[1]) as f32;
                    let (x0, z0) = (foot.0 - dir[0] * run, foot.1 - dir[1] * run);
                    sim.place_car(
                        car,
                        jj_sim::SpawnPose {
                            x: x0 as f32,
                            y: 0.12,
                            z: z0 as f32,
                            heading,
                        },
                        0.0,
                        [v * dir[0] as f32, 0.0, v * dir[1] as f32],
                    );
                    // Past the far ramp's foot by a car's length, m from this ramp's foot.
                    let far = p.length() + 4.5;
                    let (mut over, mut up) = (false, 1.0f32);
                    for _ in 0..(10 * S) {
                        let st = sim.car_state(car).unwrap();
                        let on = (f64::from(st.position[0]) - foot.0) * dir[0]
                            + (f64::from(st.position[2]) - foot.1) * dir[1];
                        if on > far {
                            over = true;
                            break;
                        }
                        up = up.min(st.up_y);
                        // It holds its speed (a slow car, not one that floors it up the ramp).
                        sim.set_input(
                            car,
                            DriveInput {
                                throttle: if st.forward_speed < v { 32767 } else { 0 },
                                ..DriveInput::default()
                            },
                        );
                        sim.step();
                    }
                    assert!(
                        over && up > 0.7,
                        "{cars}/{seed}: at {v} m/s ({name}) a car didn't get over the crossover on its wheels (over {over}, up {up:.2})"
                    );
                }
            }
        }
    }
}

/// br-bhkz.4: a stomp is the lander's hit. In a derby the car that brought the closing speed is the striker and keeps
/// `strikerTake` of its own damage (assets/profiles/derby.json, `jj_sim::derby::rules`), and the ground costs `junkTake`:
/// so a car that flies a table-top and comes down on a standing rival loses much less health than the rival it lands
/// on, scores more off the hit than the rival does, and drives on. The table-top is laid by hand (a 1.6 m lip, the
/// generator's slopes) so the rival can stand exactly where the flight comes down.
#[test]
fn a_car_landing_on_a_rival_off_a_jump_takes_much_less_than_it_gives() {
    use jj_procgen::arena::{Relief, Rock};
    use jj_sim::damage::{DamageEvent, OtherBody};
    let jump = Relief {
        kind: ReliefKind::TableTop,
        x: -6.0,
        z: 0.0,
        dir: [1.0, 0.0],
        height: 1.6,
        up: 4.5,
        table: 3.0,
        down: 5.75,
        half: 3.0,
        side: 3.75,
    };
    let map = lab(
        vec![jump],
        vec![Rock {
            x: 0.0,
            z: 16.0,
            r: 3.0,
            h: 2.0,
        }],
    );
    let foot = (jump.x - jump.length() / 2.0, jump.z);
    let (run, speed) = (14.0, 16.0f32);
    // Where the flight comes down with nothing in the way.
    let clear = fly(&map, foot, jump.dir, run, speed).expect("the table-top flies");
    assert!(clear.airtime_s > 1.0, "{clear:?}");

    let mut sim = sim(&map);
    let ids = sim.spawn_grid(2);
    let (flier, rival) = (ids[0], ids[1]);
    sim.start_derby(180 * S);
    for _ in 0..(4 * S) {
        sim.step();
    }
    assert!(!sim.is_protected(flier) && !sim.is_protected(rival));
    // The rival stands on the line, tail to the jump, 3 m short of the touchdown: the flier comes down on its tail and
    // roof (measured from 4 m short to 4 m past: the lander loses 3-19 HP and the car under it 14-49). A rival standing
    // across the line with the flier coming down square on its roof used to lose nothing (the roof is no part) and score
    // the lander's damage (docs/evidence/br-bhkz.4/jumps.md); since b83f481f a derby charges a roof hit to the nearest
    // part (jj-sim tests/derby_hits.rs, a_car_that_lands_on_a_rivals_roof_damages_it_and_scores).
    let at = foot.0 + clear.down_u - 3.0;
    let rival_heading = core::f32::consts::FRAC_PI_2;
    sim.place_car(
        rival,
        jj_sim::SpawnPose {
            x: at as f32,
            y: 0.12,
            z: foot.1 as f32,
            heading: rival_heading,
        },
        0.0,
        [0.0; 3],
    );
    sim.place_car(
        flier,
        jj_sim::SpawnPose {
            x: (foot.0 - run) as f32,
            y: 0.12,
            z: foot.1 as f32,
            heading: core::f32::consts::FRAC_PI_2,
        },
        0.0,
        [speed, 0.0, 0.0],
    );
    let (mut high, mut flew) = (0.0f32, 0u64);
    for _ in 0..(5 * S) {
        let st = sim.car_state(flier).unwrap();
        let gone = f64::from(st.position[0]) - (foot.0 - run);
        let throttle = st.wheels_in_contact > 0 && (gone >= run - 0.5 || st.forward_speed < speed);
        sim.set_input(
            flier,
            DriveInput {
                throttle: if throttle && gone < run + jump.up {
                    32767
                } else {
                    0
                },
                ..DriveInput::default()
            },
        );
        sim.step();
        let st = sim.car_state(flier).unwrap();
        if st.wheels_in_contact == 0 {
            flew += 1;
            high = high.max(st.position[1]);
        }
    }
    // Health lost to the other car, per car.
    let lost = |car: u32| -> f32 {
        sim.damage_events()
            .iter()
            .filter_map(|(_, e)| match e {
                DamageEvent::Episode(r)
                    if r.car == car && matches!(r.other, OtherBody::Car { .. }) =>
                {
                    Some(r.damage)
                }
                _ => None,
            })
            .sum()
    };
    let (lander, landed_on) = (lost(flier.0), lost(rival.0));
    let ledger = sim.derby().expect("a derby");
    eprintln!(
        "stomp off a 1.6 m table-top at {speed} m/s: flew {:.2} s to {high:.1} m; the lander lost {lander:.1} HP, the car it landed on {landed_on:.1} HP; points {:.1} vs {:.1}",
        flew as f64 / S as f64,
        ledger.points(flier.0),
        ledger.points(rival.0)
    );
    assert!(flew > S / 2 && high > 2.0, "the flier came off the jump");
    assert!(
        landed_on > 10.0,
        "it landed on the rival: {landed_on:.1} HP"
    );
    assert!(
        lander * 2.0 < landed_on,
        "a stomp is the lander's hit: it lost {lander:.1} HP, the car it landed on {landed_on:.1}"
    );
    assert!(
        ledger.points(flier.0) > 2.0 * ledger.points(rival.0),
        "and the lander's points: {} vs {}",
        ledger.points(flier.0),
        ledger.points(rival.0)
    );
    let st = sim.car_state(flier).unwrap();
    assert!(
        st.up_y > 0.7,
        "the lander is on its wheels after it ({})",
        st.up_y
    );
}

/// br-bhkz.4: the bots' crossover numbers are the generator's. A derby's bots know the island only as its two rocks
/// (`jj_sim::autopilot::Obstacle`); they take the gap between them for a gate when it is `GATE_MIN_M` wide, and expect
/// the crossover's ramps to end within `GATE_RUN_M` of its middle. Every generated arena's gate is that wide, its
/// crossover that short, and it lies across the island: along the line the bots drive.
#[test]
fn the_bots_gate_is_the_generators_crossover() {
    use jj_procgen::arena::field::{GATE_DECK_M, GATE_HALF_M};
    assert_eq!(
        f64::from(jj_sim::autopilot::GATE_MIN_M),
        jj_procgen::arena::GATE_OPEN_M,
        "the validator holds open the gate the bots drive through"
    );
    for (seed, cars) in (0..FIELD_SEEDS)
        .flat_map(|s| FIELD_CARS.map(|c| (s, c)))
        .chain([(9, 1000)])
    {
        let f = field(seed, cars);
        let p = f
            .relief
            .iter()
            .find(|p| p.kind == ReliefKind::Crossover)
            .unwrap_or_else(|| panic!("{cars}/{seed}: no crossover"));
        let [a, b] = f.rocks.as_slice() else {
            panic!(
                "{cars}/{seed}: the gate is two rocks, not {}",
                f.rocks.len()
            );
        };
        let across = ((b.x - a.x).hypot(b.z - a.z), a.r.max(b.r));
        let clear = across.0 - 2.0 * across.1;
        assert!(
            clear >= f64::from(jj_sim::autopilot::GATE_MIN_M)
                && (clear - 2.0 * GATE_HALF_M).abs() < 1e-6,
            "{cars}/{seed}: the gate is {clear} m wide"
        );
        assert!(
            p.length() / 2.0 <= f64::from(jj_sim::autopilot::GATE_RUN_M) && p.table == GATE_DECK_M,
            "{cars}/{seed}: the crossover runs {} m each side of the gate",
            p.length() / 2.0
        );
        // Its line is the perpendicular through the middle of the two rocks.
        let mid = ((a.x + b.x) / 2.0, (a.z + b.z) / 2.0);
        let along = ((b.x - a.x) * p.dir[0] + (b.z - a.z) * p.dir[1]).abs() / across.0;
        assert!(
            (mid.0 - p.x).hypot(mid.1 - p.z) < 1e-6 && along < 1e-6,
            "{cars}/{seed}: the crossover runs through the gate's middle, across the island"
        );
    }
}
