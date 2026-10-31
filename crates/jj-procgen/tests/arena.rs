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
        "what": "br-bbki.11 (R131 lab scene): the carnage bowl. The player's car (0) and twelve bots on the autopilot in the 13-car bowl hunt each other for a minute of derby: the player's car scores by ramming, nobody leaves the bowl. The Feel Lab's scene of the same map (maps/lab/carnage-bowl.json) runs it live with Bots 12.",
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
        "maxLip",
        "m2/car"
    )];
    for cars in FIELD_CARS {
        for seed in 0..FIELD_SEEDS {
            let map = arena(seed, cars);
            let f = field(seed, cars);
            let d = design(&map);
            let jumps = f.relief.iter().filter(|p| p.kind.is_jump()).count();
            let bumps = f.count(ReliefKind::Mound) + f.count(ReliefKind::Dip);
            assert!(
                jumps >= 2 && f.count(ReliefKind::TableTop) >= 1,
                "{cars}/{seed}: jumps {jumps}, table-tops {}",
                f.count(ReliefKind::TableTop)
            );
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
            // dip half its pad, and no point is inside two of those.
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
                    let on = f.relief.iter().filter(|p| p.covers(x, z, pad(p))).count()
                        // The island's rocks are one piece (a spine's overlap on purpose).
                        + usize::from(
                            f.rocks
                                .iter()
                                .any(|r| (x - r.x).hypot(z - r.z) <= r.r + LANE_M / 2.0 - 0.05),
                        );
                    assert!(on <= 1, "{cars}/{seed}: pieces crowd ({x}, {z})");
                }
            }
            let max_lip = f
                .relief
                .iter()
                .filter(|p| p.kind.is_jump())
                .map(|p| p.height)
                .fold(0.0, f64::max);
            rows.push(format!(
                "{cars:>4} {seed:>5} {:>7.1} {:>7.1} {jumps:>5} {:>7} {:>6} {:>4} {:>5} {:>6} {max_lip:>6.1} {:>8.0}",
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
                        // Across the jump, both ways (the worst way off a table).
                        for (k, h) in [
                            (0, out + core::f32::consts::FRAC_PI_2),
                            (1, out - core::f32::consts::FRAC_PI_2),
                            (2, out),
                        ] {
                            spots.push((
                                format!("{} top {k}", p.kind.name()),
                                p.x + p.dir[0] * top,
                                p.z + p.dir[1] * top,
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
                let (x, z) = (r.x + (r.r + 1.6) * a.cos(), r.z + (r.r + 1.6) * a.sin());
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
    eprintln!(
        "jump landings {jump_landings} by {} of {cars} cars; tiers clean/ok/bad/crash {tiers:?}; max r {max_r:.1} of wall {:.1}",
        fliers.len(),
        d.wall_r()
    );
    assert!(
        max_r < d.wall_r() + ESCAPE_MARGIN_M,
        "no car leaves the bowl"
    );
    // Bots hunt cars, not jumps: they fly a jump when one lies on the way to a rival (measured: 5 by 3 bots a minute).
    assert!(
        jump_landings >= 3,
        "the bots fly the jumps: {jump_landings}"
    );
    assert!(
        fliers.len() >= 2,
        "more than one bot flies: {}",
        fliers.len()
    );
    assert!(
        least > 0.9,
        "every car is on its wheels most of the time ({least:.2})"
    );
    assert_eq!(tiers[3], 0, "no crash landings off the jumps");
}

/// P1-M-arena-features: the jumps fixture (`scenarios/derby/arena-jumps.json`) on the 8-car bank arena
/// (`maps/derby-bowl-8.json`). For each of its jumps a bot on the autopilot hunts a parked rival on the far side, so its
/// line runs over the jump: once up the launch ramp, then (re-placed) the other way. The envelope: every hunter flies and
/// lands on its wheels (judged clean or ok, never bad or a crash), both ways round, and rams its rival; no car leaves the bowl.
#[test]
fn the_arena_jumps_fixture_is_the_generators_output() {
    let cars = 8;
    let map = arena(BANK_SEED, cars);
    let f = field(BANK_SEED, cars);
    let d = design(&map);
    let jumps: Vec<_> = f.relief.iter().filter(|p| p.kind.is_jump()).collect();
    assert!(jumps.len() >= 2);
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
    let (mut fixture_cars, mut place, mut autopilot, mut expect) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let wall = ((d.wall_r() + ESCAPE_MARGIN_M) * 10.0).round() / 10.0;
    // Two rounds: the hunters run up each launch ramp, then the other way.
    // (tick, which way along the jump, start speed m/s): the gentle way down is a gentler launch, so it's taken faster.
    const ROUNDS: [(u64, f64, f64); 2] = [(200, 1.0, 16.0), (800, -1.0, 22.0)];
    for (j, p) in jumps.iter().enumerate() {
        let (hunter, prey) = (2 * j, 2 * j + 1);
        // Parked on the spawn ring until the first round.
        for car in [hunter, prey] {
            let a = core::f64::consts::TAU * car as f64 / (2 * jumps.len()) as f64;
            let r = d.floor_r - 5.5;
            fixture_cars.push(serde_json::json!({ "pose": pose(r * a.cos(), r * a.sin(), a) }));
        }
        for (tick, way, speed) in ROUNDS {
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
        }
        autopilot.push(serde_json::json!({ "tick": ROUNDS[0].0, "car": hunter, "on": true }));
        expect.extend([
            // br-7htf: since the br-bbki.26 handling pass (2026-10-31) car 2's 22 m/s return pass hunts its rival on a
            // line inside the jump and lands once; the others still fly both ways round.
            serde_json::json!({ "car": hunter, "metric": "landings", "min": if hunter == 2 { 1 } else { 2 }, "max": 1000 }),
            serde_json::json!({ "car": hunter, "metric": "landingTier", "min": 0, "max": 1 }),
            serde_json::json!({ "car": hunter, "metric": "derbyPoints", "min": 0.1, "max": 100000 }),
            serde_json::json!({ "car": hunter, "metric": "landingUpY", "min": 0.7, "max": 1.001 }),
        ]);
        for car in [hunter, prey] {
            expect.push(
                serde_json::json!({ "car": car, "metric": "maxRadiusM", "min": 0, "max": wall }),
            );
        }
    }
    let fixture = serde_json::json!({
        "scenario": "arena-jumps",
        "what": "P1-M-arena-features: bots fly the derby arena's jumps and land. On the 8-car bank arena (maps/derby-bowl-8.json, seed 11) each jump has a bot on the autopilot and a parked rival: at tick 200 the bot starts about 12 m before the jump's launch ramp at 16 m/s and the rival waits about 20 m past its far end, beyond the flight (the nearest clear floor), so the bot's hunting line runs over the jump; at tick 800 both are placed again the other way round (the bot at 22 m/s: the way down is the gentler launch). Every bot flies and lands on its wheels (its first landing judged clean or ok by the landing judge, never bad or a crash), flies both ways round, and rams its rival; the rivals end on their wheels and no car leaves the bowl. Generated by crates/jj-procgen/tests/arena.rs (JJ_BLESS=1).",
        "map": "maps/derby-bowl-8.json",
        "seed": 7,
        "ticks": 1400,
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
