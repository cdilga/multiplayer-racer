//! The derby's weapons (br-bhkz.3; owner 2026-11-17: "we didn't have anywhere near enough weapons for the derby"): the roo
//! bar, the bunger and the magpie, and that every weapon's hit (the boomerang's too) is a hit the derby scores.
//!
//! - **Roo bar**: a ram its car drives costs that car nothing and the car it hits double; rammed itself, it does nothing.
//! - **Bunger**: lobbed at a car ahead, it lands by it and goes off when the fuse runs out: the car is thrown and
//!   damaged, the thrower untouched, a sanga'd car takes a fifth, junk in the ring becomes the thrower's.
//! - **Magpie**: it finds whoever is winning (never the thrower) and pecks them: damage, a shove and a spin.
//! - **Scores**: a boomerang, a bunger or a magpie hit is the thrower's points; a dropped esky is its dropper's hit on
//!   the first car to meet it, however long it has sat there.
//!
//! The yard (`scenarios/damage/yard.json`) is the damage bank's flat pad.

use std::path::Path;

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::{DamageEvent, EpisodeRecord, OtherBody};
use jj_sim::items::{bunger, magpie};
use jj_sim::utility::UtilityKind;
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const S: u64 = TICK_HZ as u64;
const EAST: f32 = core::f32::consts::FRAC_PI_2;

fn yard() -> LoadedMap {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scenarios/damage/yard.json");
    load_json(&std::fs::read(path).expect("yard"), &Registry::generic()).expect("yard validates")
}

/// `n` cars in the yard, settled and out of spawn protection, in a derby or not.
fn cars(map: &LoadedMap, n: usize, derby: bool) -> Sim {
    let mut sim = Sim::new(map, &Registry::generic(), 1, VehicleProfile::cruz());
    for i in 0..n {
        sim.spawn_car(SpawnPose {
            x: -60.0 + 12.0 * i as f32,
            y: 0.1,
            z: -20.0,
            heading: 0.0,
        });
    }
    if derby {
        sim.start_derby(120 * S);
    } else {
        sim.start_race(9);
    }
    for _ in 0..(4 * S) {
        sim.step();
    }
    assert!((0..n).all(|i| !sim.is_protected(CarId(i as u32))));
    sim
}

fn pose(x: f32, z: f32, heading: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.05,
        z,
        heading,
    }
}

fn run(sim: &mut Sim, seconds: f32) {
    for _ in 0..(seconds * TICK_HZ as f32) as u64 {
        sim.step();
    }
}

fn give(sim: &mut Sim, car: u32, item: ItemId) {
    sim.pickup_item(CarId(car), SeatId(car + 1), item)
        .expect("the car takes the item");
}

fn episodes(sim: &Sim) -> Vec<EpisodeRecord> {
    sim.damage_events()
        .iter()
        .filter_map(|(_, e)| match e {
            DamageEvent::Episode(r) => Some(*r),
            _ => None,
        })
        .collect()
}

fn lost(sim: &Sim, car: u32) -> f32 {
    episodes(sim)
        .iter()
        .filter(|r| r.car == car)
        .map(|r| r.damage)
        .sum()
}

fn replays(map: &LoadedMap, sim: &Sim) {
    let replay = Sim::replay(
        map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash(), "it replays exactly");
}

/// Car 1 drives east at `speed` into the right-hand side of car 0, parked facing north (the damage bank's T-bone).
fn t_bone(sim: &mut Sim, speed: f32) {
    sim.place_car(CarId(0), pose(60.0, -30.0, 0.0), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(56.25, -29.66, EAST), 0.0, [speed, 0.0, 0.0]);
    run(sim, 1.0);
}

#[test]
fn a_roo_bar_makes_the_ram_free_and_the_hit_double() {
    let map = yard();
    // 4.6 m/s: soft enough that a doubled hit doesn't run a door's health out and hide the doubling.
    for derby in [false, true] {
        let mut plain = cars(&map, 2, derby);
        t_bone(&mut plain, 4.6);
        let mut barred = cars(&map, 2, derby);
        give(&mut barred, 1, ItemId::RooBar);
        assert!(barred.utility(CarId(1), UtilityKind::Forward));
        assert!(barred.roo_bar_active(CarId(1)));
        t_bone(&mut barred, 4.6);
        let (rammed, rammer) = (lost(&plain, 0), lost(&plain, 1));
        let (rammed_bar, rammer_bar) = (lost(&barred, 0), lost(&barred, 1));
        eprintln!(
            "derby {derby}: plain rammed {rammed:.1} / rammer {rammer:.1}; roo bar rammed {rammed_bar:.1} / rammer {rammer_bar:.1}"
        );
        assert!(rammed > 5.0 && rammer > 1.0, "the plain ram is a real hit");
        assert_eq!(rammer_bar, 0.0, "the bar takes the ram");
        assert!(
            (rammed_bar / rammed - 2.0).abs() < 0.25,
            "the car it rams takes double: {rammed_bar:.1} vs {rammed:.1}"
        );
        // Rammed itself, the bar does nothing: car 0 wears it and stands still.
        let mut worn = cars(&map, 2, derby);
        give(&mut worn, 0, ItemId::RooBar);
        assert!(worn.utility(CarId(0), UtilityKind::Forward));
        t_bone(&mut worn, 4.6);
        assert!(
            (lost(&worn, 0) / rammed - 1.0).abs() < 0.1
                && (lost(&worn, 1) / rammer - 1.0).abs() < 0.1,
            "a bar on the car that is hit changes nothing: {:.1} / {:.1}",
            lost(&worn, 0),
            lost(&worn, 1)
        );
        replays(&map, &barred);
    }
    // Ten seconds on, the bar is gone.
    let mut sim = cars(&map, 2, true);
    give(&mut sim, 1, ItemId::RooBar);
    assert!(sim.utility(CarId(1), UtilityKind::Forward));
    run(&mut sim, 10.1);
    assert!(!sim.roo_bar_active(CarId(1)));
}

#[test]
fn a_bunger_lands_by_the_car_ahead_and_blasts_it() {
    let map = yard();
    let mut sim = cars(&map, 3, true);
    // Car 0 throws from x = 0 facing east; car 1 stands 16 m ahead, a little off its line; car 2 is far away.
    sim.place_car(CarId(0), pose(0.0, -30.0, EAST), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(16.0, -27.0, 0.0), 0.0, [0.0; 3]);
    sim.place_car(CarId(2), pose(-40.0, -60.0, 0.0), 0.0, [0.0; 3]);
    run(&mut sim, 0.5);
    // A block of junk beside car 1, inside the ring.
    let junk = sim.prop_kinds().len() as u32;
    sim.spawn_debris(pose(16.0, -33.0, 0.0), [0.4, 0.4, 0.4]);
    run(&mut sim, 0.5);
    give(&mut sim, 0, ItemId::Bunger);
    assert!(sim.utility(CarId(0), UtilityKind::Forward));
    assert_eq!(sim.bungers().len(), 1);
    assert!(sim.bungers()[0].lit());
    let before = sim.car_state(CarId(1)).unwrap().position;
    run(&mut sim, 1.0);
    let b = &sim.bungers()[0];
    assert!(b.blast.is_some(), "the fuse ran out");
    let off = libm::hypotf(b.position[0] - before[0], b.position[2] - before[2]);
    assert!(
        off < 2.5,
        "the lob landed by the car it was thrown at: {off:.1} m off"
    );
    assert_eq!(
        b.hits.iter().map(|h| h.car).collect::<Vec<_>>(),
        vec![1],
        "only the rival in the ring is hit: never the thrower, never a car outside it"
    );
    let hit = b.hits[0];
    assert!(
        hit.damage > bunger::BLAST_DAMAGE * bunger::EDGE_SHARE && hit.dv_mps > 3.0,
        "a real blast: {hit:?}"
    );
    assert_eq!(lost(&sim, 0), 0.0, "the thrower is untouched");
    // The derby scores it, and the junk it threw is the thrower's.
    assert!(
        sim.derby().unwrap().points(0) >= f64::from(hit.damage) - 0.01,
        "the blast is the thrower's points: {} for {} HP",
        sim.derby().unwrap().points(0),
        hit.damage
    );
    assert_eq!(sim.prop_owner(junk).map(|o| o.car), Some(0));
    run(&mut sim, 1.0);
    let after = sim.car_state(CarId(1)).unwrap().position;
    assert!(
        libm::hypotf(after[0] - before[0], after[2] - before[2]) > 1.0,
        "the car was thrown"
    );
    replays(&map, &sim);
}

#[test]
fn a_sanga_shrugs_most_of_a_bunger_off_and_a_drop_catches_the_car_behind() {
    let map = yard();
    let mut sim = cars(&map, 2, true);
    // Car 0 drops one behind it; car 1 sits 4 m behind, tanked up.
    sim.place_car(CarId(0), pose(0.0, -30.0, EAST), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(-9.0, -30.0, EAST), 0.0, [0.0; 3]);
    run(&mut sim, 0.5);
    give(&mut sim, 1, ItemId::Sanga);
    assert!(sim.utility(CarId(1), UtilityKind::Forward));
    give(&mut sim, 0, ItemId::Bunger);
    assert!(sim.utility(CarId(0), UtilityKind::Rear));
    run(&mut sim, 1.0);
    let b = &sim.bungers()[0];
    assert!(b.landed && b.blast.is_some());
    assert!(
        b.position[0] < -2.0,
        "it was dropped behind the car: x {:.1}",
        b.position[0]
    );
    let hit = b
        .hits
        .iter()
        .find(|h| h.car == 1)
        .expect("the car behind is in the ring");
    assert!(
        hit.damage <= bunger::BLAST_DAMAGE * bunger::SANGA_SCALE + 0.01,
        "a tanked-up car takes a fifth: {hit:?}"
    );
}

#[test]
fn a_magpie_swoops_whoever_is_winning_and_spins_them() {
    let map = yard();
    let mut sim = cars(&map, 3, true);
    // Car 2 takes the lead: it T-bones car 1.
    sim.place_car(CarId(1), pose(60.0, -30.0, 0.0), 0.0, [0.0; 3]);
    sim.place_car(CarId(2), pose(56.25, -29.66, EAST), 0.0, [9.0, 0.0, 0.0]);
    sim.place_car(CarId(0), pose(0.0, -30.0, EAST), 0.0, [0.0; 3]);
    run(&mut sim, 2.0);
    assert!(!sim.is_protected(CarId(0)));
    let ledger = sim.derby().unwrap();
    assert!(ledger.points(2) > ledger.points(1) && ledger.points(1) > ledger.points(0));
    let lead_before = lost(&sim, 2);
    give(&mut sim, 0, ItemId::Magpie);
    assert!(sim.utility(CarId(0), UtilityKind::Forward));
    assert_eq!(sim.magpies()[0].target, Some(2), "it goes for the leader");
    let mut peak_height = 0.0f32;
    let mut spin = 0.0f32;
    for _ in 0..(7 * S) {
        sim.step();
        if let Some(m) = sim.magpies().first().filter(|m| m.active()) {
            peak_height = peak_height.max(m.position[1]);
        }
        if sim.magpies()[0].hit.is_some() {
            spin = spin.max(sim.car_state(CarId(2)).unwrap().angvel[1].abs());
        }
    }
    let m = &sim.magpies()[0];
    let hit = m.hit.expect("it reached the leader");
    assert_eq!(m.ended.map(|(_, e)| e), Some(magpie::End::Pecked));
    assert_eq!(hit.car, 2);
    assert!(
        peak_height > 3.0,
        "it climbed before it dived: {peak_height:.1} m"
    );
    assert!(
        hit.damage > 0.0 && lost(&sim, 2) > lead_before,
        "the peck damages: {hit:?}"
    );
    assert!(spin > 0.5, "and spins the car: {spin:.2} rad/s");
    assert_eq!(lost(&sim, 0), 0.0, "the thrower is untouched");
    assert!(
        sim.derby().unwrap().points(0) >= f64::from(hit.damage) - 0.01,
        "the peck is the thrower's points"
    );
    replays(&map, &sim);
    // The leader's own magpie goes for the next best, never for itself.
    let mut sim2 = cars(&map, 2, true);
    give(&mut sim2, 0, ItemId::Magpie);
    assert!(sim2.utility(CarId(0), UtilityKind::Forward));
    assert_eq!(sim2.magpies()[0].target, Some(1));
}

#[test]
fn a_boomerang_hit_is_the_throwers_points() {
    let map = yard();
    let mut sim = cars(&map, 2, true);
    sim.place_car(CarId(0), pose(0.0, -30.0, EAST), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(14.0, -30.0, 0.0), 0.0, [0.0; 3]);
    run(&mut sim, 0.5);
    give(&mut sim, 0, ItemId::Boomerang);
    assert!(sim.utility(CarId(0), UtilityKind::Forward));
    run(&mut sim, 3.0);
    let hits = &sim.boomerangs()[0].hits;
    assert!(!hits.is_empty(), "the boomerang reached the car ahead");
    let dealt: f32 = hits.iter().map(|h| h.damage).sum();
    assert!(dealt > 0.0);
    // Before br-bhkz.3 a weapon's damage never reached the ledger: the only weapon that hurt scored nothing.
    assert!(
        sim.derby().unwrap().points(0) >= f64::from(dealt) - 0.01,
        "the throw scores its damage: {} points for {dealt} HP",
        sim.derby().unwrap().points(0)
    );
    let named = episodes(&sim)
        .iter()
        .any(|r| r.car == 1 && r.other == OtherBody::Car { car: 0 });
    assert!(named, "the damage log names the thrower");
}

#[test]
fn a_dropped_esky_is_its_droppers_hit_however_long_it_sat() {
    let map = yard();
    let mut sim = cars(&map, 2, true);
    sim.place_car(CarId(0), pose(0.0, -30.0, EAST), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(-70.0, -30.0, EAST), 0.0, [0.0; 3]);
    run(&mut sim, 0.5);
    give(&mut sim, 0, ItemId::Esky);
    assert!(sim.utility(CarId(0), UtilityKind::Forward));
    // The dropper leaves; the esky sits for ten seconds (the ledger's attribution is three).
    sim.place_car(CarId(0), pose(0.0, -70.0, EAST), 0.0, [0.0; 3]);
    run(&mut sim, 10.0);
    sim.place_car(CarId(1), pose(-30.0, -30.0, EAST), 0.0, [16.0, 0.0, 0.0]);
    for _ in 0..(3 * S) {
        sim.set_input(
            CarId(1),
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        );
        sim.step();
    }
    let hit = episodes(&sim)
        .into_iter()
        .find(|r| r.car == 1 && matches!(r.other, OtherBody::Prop { .. }))
        .expect("the follower met the esky");
    assert_eq!(
        hit.other_owner.map(|o| o.car),
        Some(0),
        "the trap is its dropper's"
    );
    assert!(
        sim.derby().unwrap().points(0) > 0.0,
        "and its damage is the dropper's points"
    );
}
