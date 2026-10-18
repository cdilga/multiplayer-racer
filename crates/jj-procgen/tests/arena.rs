//! P1-M10: the derby bowl. Arenas for 8, 16 and 32 cars (and far beyond: there is no cap) validate and place every car;
//! the canonical bytes are the evidence (`goldens/arena.txt`, checked in WASM by `wasm_parity.rs` too); and the shape alone
//! keeps cars in: rams at the rim from many angles and speeds, boosted and airborne, never put a car outside
//! (`bowl-containment`), and driving from the floor up the bank never catches or launches a car (`bowl-transition`).
//! The same two as scenario-bank fixtures live in `scenarios/derby/`. Re-bless with `JJ_BLESS=1` after an intended change.
#![cfg(not(target_arch = "wasm32"))]

use jj_map::arena::{BowlDesign, bowl_mesh};
use jj_map::{LoadedMap, gameplay_hash, hex};
use jj_procgen::arena::{GENERATOR_VERSION, check, generate, prepare};
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
        floors.windows(2).all(|w| w[0] < w[1]),
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
    // foot, never thrown off the transition).
    for &speed in &[6.0f32, 10.0, 15.0] {
        let ram = Ram {
            angle: 0.4,
            off: 0.0,
            speed,
            boost: false,
            steer: 0,
            up: 0.0,
            lift: 0.0,
            r0: d.floor_r * 0.5,
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
