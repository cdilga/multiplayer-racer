//! A late joiner into a crowded race drives away (P1-G02's JN5 follow-up, plan §7.5): 11 cars on the greybox, a wreck's
//! husk and loose debris where the newcomer will be placed, then a drop-in whose controller holds DRIVE straight forward.
//! The new car must clear everything at its spawn and be driving within seconds (no wedging on a husk, a car or debris).
//!
//! Finding (the JN5 report): placement is clear of cars, husks and debris, and the newcomer is driving in under a second. A
//! controller that holds DRIVE straight forward still ends up stopped against the barrier at the end of the straight, about
//! the road's half width (7 m) off the line, and stays there at 0 m/s under throttle: the same picture as the report. The 8 s
//! runs below end there (x 186 on the greybox); the assertions judge the first 4 s.
//! `JJ_LATE_PRINT=1` prints where it landed and how it went.

use jj_map::{Registry, load_json};
use jj_sim::placement::overlaps;
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn throttle(v: f32) -> DriveInput {
    DriveInput {
        throttle: (v * 32767.0) as i16,
        ..Default::default()
    }
}

fn pos(sim: &Sim, car: u32) -> [f32; 3] {
    sim.car_state(CarId(car)).expect("car").position
}

/// One scenario: `husk` leaves a wreck's husk at the target, `debris` scatters cuboids round it, `parked` leaves cars
/// standing beside it. Returns how far (m) the newcomer drove along +x in 4 s, and where it was placed.
fn run(husk: bool, debris: bool, parked: usize) -> (f32, [f32; 3], bool) {
    let map = load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap();
    let mut sim = Sim::new(&map, &Registry::generic(), 7, VehicleProfile::cruz());
    let ids = sim.spawn_grid(11);
    sim.start_race(3);
    for &c in &ids {
        sim.set_autopilot(c, true);
    }
    // Run until the newcomer's target lies on the main straight (x 20..140, heading +x), then build the scene there.
    let mut target = None;
    for _ in 0..90 {
        for _ in 0..S {
            sim.step();
        }
        if let Some(p) = sim.race().drop_in_progress(sim.tick()) {
            let x = sim.race().finish_s() + p;
            if (20.0..140.0).contains(&x) {
                target = Some(x);
                break;
            }
        }
    }
    let tx = target.expect("a moment when the drop-in lands on the straight");
    if husk {
        // A wreck exactly where the newcomer would be placed: its husk stays as a dynamic body.
        sim.set_autopilot(ids[5], false);
        sim.place_car(
            ids[5],
            SpawnPose {
                x: tx,
                y: 0.3,
                z: 0.0,
                heading: 90f32.to_radians(),
            },
            0.0,
            [0.0; 3],
        );
        sim.wreck(ids[5]);
        assert!(sim.husk_count() >= 1, "a husk lies on the road");
    }
    if debris {
        for (dx, dz) in [
            (-2.5, 0.0),
            (0.5, 2.5),
            (3.0, -2.0),
            (-6.0, 1.5),
            (-9.0, -1.5),
        ] {
            sim.spawn_debris(
                SpawnPose {
                    x: tx + dx,
                    y: 0.4,
                    z: dz,
                    heading: 0.3,
                },
                [0.6, 0.3, 1.0],
            );
        }
    }
    for k in 0..parked {
        // Cars standing on the road to either side of the target and behind it (idle controllers, no autopilot), none in the
        // lane ahead: a car parked in the way is a different test.
        let c = ids[6 + k];
        sim.set_autopilot(c, false);
        sim.place_car(
            c,
            SpawnPose {
                x: tx - 6.0 * (k / 2) as f32,
                y: 0.3,
                z: if k % 2 == 0 { -4.5 } else { 4.5 },
                heading: 90f32.to_radians(),
            },
            0.0,
            [0.0; 3],
        );
    }
    // (No stepping since the target was read: the scene stands exactly where the placement will look.)
    let me = sim.drop_in();
    let start = pos(&sim, me.0);
    // Placed clear: the newcomer's footprint touches no other car and no debris or husk (a clear pose exists within the search).
    let mine = sim.footprint(me).unwrap();
    for c in sim.cars().filter(|&c| c != me) {
        assert!(
            !overlaps(&mine, &sim.footprint(c).unwrap()),
            "husk {husk} debris {debris} parked {parked}: placed on car {}",
            c.0
        );
    }
    assert!(
        !sim.debris_footprints().iter().any(|d| overlaps(&mine, d)),
        "husk {husk} debris {debris} parked {parked}: placed on debris or a husk"
    );
    if std::env::var("JJ_LATE_PRINT").is_ok() {
        println!(
            "target x {tx:.1}; placed at {start:?} protected {}",
            sim.is_protected(me)
        );
    }
    let mut at_4s = start;
    for t in 0..8 * S {
        sim.set_input(me, throttle(1.0));
        sim.step();
        if t == 4 * S {
            at_4s = pos(&sim, me.0);
        }
    }
    let end = pos(&sim, me.0);
    let v = sim.car_state(me).unwrap().forward_speed;
    if std::env::var("JJ_LATE_PRINT").is_ok() {
        println!(
            "husk {husk} debris {debris} parked {parked}: drove {:.1} m, ends at {end:?}, speed {v:.1}, protected {}",
            end[0] - start[0],
            sim.is_protected(me)
        );
    }
    (at_4s[0] - start[0], end, sim.is_protected(me))
}

#[test]
fn a_late_joiner_into_a_crowd_with_a_husk_and_debris_drives_away() {
    for (husk, debris, parked) in [
        (false, false, 0),
        (true, false, 0),
        (false, true, 0),
        (true, true, 0),
        (true, true, 2),
        (true, true, 4),
    ] {
        let (driven, end, protected) = run(husk, debris, parked);
        assert!(
            driven > 20.0,
            "husk {husk} debris {debris} parked {parked}: the newcomer drove only {driven:.1} m in 4 s (ends at {end:?}, protected {protected})"
        );
        assert!(!protected, "protection ended once clear");
    }
}
