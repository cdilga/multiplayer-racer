//! Owner trailer capture exposed a real derby-only failure: every throw returned NotRacing.
use jj_map::{Registry, load_json};
use jj_sim::{Sim, SpawnPose, UtilityKind, VehicleProfile};
use jj_types::{
    SeatId,
    items::{ItemId, ItemUseRefusal},
};

#[test]
fn derby_can_throw_while_running_but_not_after_its_clock_expires() {
    let map = load_json(
        include_bytes!("../../../maps/greybox-loop.json"),
        &Registry::generic(),
    )
    .unwrap();
    let mut sim = Sim::new(&map, &Registry::generic(), 5, VehicleProfile::cruz());
    let car = sim.spawn_car(SpawnPose {
        x: 40.0,
        y: 0.3,
        z: 0.0,
        heading: core::f32::consts::FRAC_PI_2,
    });
    sim.start_derby(720);
    // Spawn protection still applies to a derby's offensive pickups.
    assert!(sim.pickup_item(car, SeatId(1), ItemId::Boomerang).is_err());
    for _ in 0..360 {
        sim.step();
    }
    assert!(!sim.is_protected(car));
    sim.pickup_item(car, SeatId(1), ItemId::Boomerang).unwrap();
    assert!(
        sim.utility(car, UtilityKind::Forward),
        "an active derby accepts the throw"
    );
    assert_eq!(sim.boomerangs().len(), 1);
    for _ in 0..360 {
        sim.step();
    }
    assert!(sim.derby().unwrap().over(sim.tick()));
    sim.pickup_item(car, SeatId(1), ItemId::Boomerang).unwrap();
    assert!(!sim.utility(car, UtilityKind::Forward));
    assert_eq!(
        sim.item_refusals().last().unwrap().2,
        ItemUseRefusal::NotRacing
    );
    sim.step(); // Include the final tick's journalled pickup/refusal in the replay.
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(
        replay.state_hash(),
        sim.state_hash(),
        "derby throws replay exactly"
    );
}
