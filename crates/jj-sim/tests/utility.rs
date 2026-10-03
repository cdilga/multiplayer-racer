//! P1-S08: the ACTION stick's utilities in the sim. The scenario bank (`scenarios/affordances/utility-intent.json`,
//! `utility-cooldown.json`, `scenarios/duels/cone-defence.json`) drives them through jj-input; these check the sim's
//! own rules directly:
//! - each accepted command fires once; cooldowns refuse in game time (0.5 s OI!, 2.5 s cone);
//! - a cone lands behind the rear bumper, on the ground, as a `Cone` prop, and stays for the round;
//! - a car driving into a cone pushes it, and isn't wrecked;
//! - utilities replay from the journal.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::utility::rules;
use jj_sim::{
    CarId, DriveInput, Journal, PropKind, Sim, SpawnPose, TICK_HZ, UtilityEvent, UtilityKind,
    VehicleProfile,
};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates")
}

fn sim(map: &LoadedMap, seed: u64) -> Sim {
    Sim::new(map, &Registry::generic(), seed, VehicleProfile::cruz())
}

fn steps(sim: &mut Sim, n: u64) {
    for _ in 0..n {
        sim.step();
    }
}

/// A car on the greybox's back straight (heading −x), past its spawn protection and settled.
fn settled_car(sim: &mut Sim, x: f32) -> CarId {
    let car = sim.spawn_car(SpawnPose {
        x,
        y: 0.1,
        z: 30.0,
        heading: -core::f32::consts::FRAC_PI_2,
    });
    steps(sim, 2 * S);
    assert!(!sim.is_protected(car), "protection is over");
    car
}

fn cones(sim: &Sim) -> Vec<([f32; 3], [f32; 4])> {
    sim.debris_poses()
        .into_iter()
        .zip(sim.prop_kinds())
        .filter(|(_, k)| **k == PropKind::Cone)
        .map(|(p, _)| p)
        .collect()
}

#[test]
fn each_utility_fires_once_and_its_cooldown_refuses_in_game_time() {
    let map = greybox();
    let mut s = sim(&map, 5);
    let car = settled_car(&mut s, 140.0);
    assert!(s.utility(car, UtilityKind::Forward));
    steps(&mut s, S / 4);
    assert!(
        !s.utility(car, UtilityKind::Forward),
        "inside the 0.5 s cooldown"
    );
    steps(&mut s, S / 4);
    assert!(s.utility(car, UtilityKind::Forward), "0.5 s on: ready");
    assert!(s.utility(car, UtilityKind::Rear));
    steps(&mut s, 2 * S);
    assert!(
        !s.utility(car, UtilityKind::Rear),
        "inside the 2.5 s cooldown"
    );
    steps(&mut s, S / 2);
    assert!(s.utility(car, UtilityKind::Rear), "2.5 s on: ready");
    let a = s.action_state(car).unwrap();
    assert_eq!(a.utility_fired, [2, 2]);
    let fired: Vec<_> = s.utility_events().iter().map(|(_, e)| *e).collect();
    assert_eq!(fired.len(), 4);
    assert!(matches!(fired[0], UtilityEvent::Oi { car: 0 }));
    assert!(matches!(fired[2], UtilityEvent::Cone { car: 0, .. }));
    // A car that doesn't exist does nothing.
    assert!(!s.utility(CarId(9), UtilityKind::Rear));
}

#[test]
fn a_cone_lands_behind_the_bumper_on_the_ground_and_stays_for_the_round() {
    let map = greybox();
    let mut s = sim(&map, 7);
    let car = settled_car(&mut s, 140.0);
    let before = s.car_state(car).unwrap().position;
    assert!(s.utility(car, UtilityKind::Rear));
    // The car faces −x, so "behind" is +x; the hull's rear is about 2 m behind the axles' midpoint.
    steps(&mut s, S);
    let c = cones(&s);
    assert_eq!(c.len(), 1);
    let [x, y, z] = c[0].0;
    let behind = x - before[0];
    assert!(
        (rules::CONE_BEHIND_M + 1.0..rules::CONE_BEHIND_M + 3.5).contains(&behind),
        "behind the bumper: {behind:.2} m behind the car's origin"
    );
    assert!((z - 30.0).abs() < 0.3, "in line with the car: z {z:.2}");
    assert!(
        y > 0.0 && y < rules::CONE_HALF_HEIGHT_M + 0.3,
        "standing on the road: y {y:.2}"
    );
    // A round later it's still there, where it fell (props persist, R58).
    steps(&mut s, 60 * S);
    let later = cones(&s);
    assert_eq!(later.len(), 1, "never removed");
    let d = ((later[0].0[0] - x).powi(2) + (later[0].0[2] - z).powi(2)).sqrt();
    assert!(d < 0.05, "at rest where it landed: moved {d:.3} m");
}

#[test]
fn a_car_driving_into_a_cone_pushes_it_and_is_not_wrecked() {
    let map = greybox();
    let mut s = sim(&map, 11);
    let leader = settled_car(&mut s, 120.0);
    assert!(s.utility(leader, UtilityKind::Rear));
    let cone0 = cones(&s)[0].0;
    // A second car 15 m back drives through the cone's spot at full throttle.
    let follower = s.spawn_car(SpawnPose {
        x: cone0[0] + 15.0,
        y: 0.1,
        z: 30.0,
        heading: -core::f32::consts::FRAC_PI_2,
    });
    steps(&mut s, 2 * S);
    assert!(!s.is_protected(follower));
    s.set_input(
        follower,
        DriveInput {
            throttle: i16::MAX,
            ..DriveInput::default()
        },
    );
    // The leader moves off out of the way.
    s.set_input(
        leader,
        DriveInput {
            throttle: i16::MAX,
            ..DriveInput::default()
        },
    );
    steps(&mut s, 5 * S);
    let cone1 = cones(&s)[0].0;
    let pushed = ((cone1[0] - cone0[0]).powi(2) + (cone1[2] - cone0[2]).powi(2)).sqrt();
    assert!(pushed > 1.0, "the cone was knocked {pushed:.2} m");
    let f = s.car_state(follower).unwrap();
    assert!(
        f.up_y > 0.8,
        "the follower stays on its wheels: up {:.2}",
        f.up_y
    );
    assert_eq!(s.race().car(follower.0).unwrap().wrecks, 0);
}

#[test]
fn utilities_replay_from_the_journal() {
    let map = greybox();
    let mut s = sim(&map, 13);
    let car = settled_car(&mut s, 140.0);
    s.utility(car, UtilityKind::Rear);
    s.utility(car, UtilityKind::Forward);
    steps(&mut s, S);
    s.utility(car, UtilityKind::Rear); // refused: cooldown
    steps(&mut s, 2 * S);
    let journal = Journal::from_bytes(&s.journal().to_bytes()).unwrap();
    let replayed = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        &journal,
        s.tick(),
    );
    assert_eq!(replayed.state_hash(), s.state_hash());
    assert_eq!(replayed.utility_events(), s.utility_events());
}
