//! P1-W01's transaction kernel. Live sim/host integration and physical item effects are separate
//! checks; these tests do not claim a delivered weapon, pickup station or HUD.
use jj_contracts::item::Mode;
use jj_sim::{
    UtilityKind,
    items::{Cards, Context, Items, Owner, PickupRefusal, Queue},
};
use jj_types::{
    LifeId, SeatId,
    items::{ItemId, ItemUseRefusal},
};

fn context() -> Context {
    Context {
        owner: Owner {
            seat: SeatId(17),
            life: LifeId(3),
        },
        mode: Mode::Race,
        racing: true,
        protected: false,
    }
}

#[test]
fn full_pickup_is_not_consumed_and_use_shifts_the_fifo() {
    let cards = Cards::shipped().unwrap();
    let mut items = Items::default();
    let ctx = context();
    items.pickup(&cards, 0, ItemId::Sanga, ctx, 1).unwrap();
    items.pickup(&cards, 0, ItemId::Boomerang, ctx, 2).unwrap();
    let before = items.queue(0);
    assert_eq!(
        items.pickup(&cards, 0, ItemId::Sanga, ctx, 3),
        Err(PickupRefusal::Full)
    );
    assert_eq!(items.queue(0), before);
    assert_eq!(items.events().len(), 2, "the third box is not picked");
    let first = items
        .use_front(&cards, 0, ctx, UtilityKind::Rear, 4, |_| Ok(()))
        .unwrap();
    assert_eq!(first.item, ItemId::Sanga, "self use works rearward too");
    assert_eq!(items.queue(0).front.unwrap().item, ItemId::Boomerang);
    assert!(items.queue(0).back.is_none());
    let second = items
        .use_front(&cards, 0, ctx, UtilityKind::Forward, 5, |_| Ok(()))
        .unwrap();
    assert_eq!(second.item, ItemId::Boomerang);
    assert_eq!(second.direction, UtilityKind::Forward);
    assert_eq!(second.armed_at, 5 + 18);
    assert_eq!(second.expires_at, 5 + 288);
    assert_eq!(items.queue(0), Queue::default());
}

#[test]
fn protection_and_failed_activation_keep_the_item_and_do_not_allocate_an_effect() {
    let cards = Cards::shipped().unwrap();
    let mut items = Items::default();
    let ctx = context();
    let protected = Context {
        protected: true,
        ..ctx
    };
    assert_eq!(
        items.pickup(&cards, 0, ItemId::Boomerang, protected, 0),
        Err(PickupRefusal::Protected)
    );
    items.pickup(&cards, 0, ItemId::Boomerang, ctx, 0).unwrap();
    let before = items.queue(0);
    for (c, reason) in [
        (protected, ItemUseRefusal::Protected),
        (
            Context {
                racing: false,
                ..ctx
            },
            ItemUseRefusal::NotRacing,
        ),
    ] {
        assert_eq!(
            items.use_front(&cards, 0, c, UtilityKind::Forward, 1, |_| panic!(
                "refused before physical activation"
            )),
            Err(reason)
        );
    }
    assert_eq!(
        items.use_front(&cards, 0, ctx, UtilityKind::Rear, 2, |_| Err(
            ItemUseRefusal::Blocked
        )),
        Err(ItemUseRefusal::Blocked)
    );
    assert_eq!(items.queue(0), before);
    assert_eq!(items.effects().count(), 0);
    assert_eq!(items.events().len(), 1);
    assert_eq!(
        items
            .use_front(&cards, 0, ctx, UtilityKind::Rear, 3, |_| Ok(()))
            .unwrap()
            .id,
        1
    );
}

#[test]
fn respawn_clears_held_items_but_keeps_the_fired_effect_owner_until_exact_expiry() {
    let cards = Cards::shipped().unwrap();
    let mut items = Items::default();
    let ctx = context();
    items.pickup(&cards, 0, ItemId::Boomerang, ctx, 0).unwrap();
    items.pickup(&cards, 0, ItemId::Sanga, ctx, 0).unwrap();
    let fired = items
        .use_front(&cards, 0, ctx, UtilityKind::Rear, 1, |_| Ok(()))
        .unwrap();
    items.respawn(0);
    assert_eq!(items.queue(0), Queue::default());
    assert_eq!(items.effects().copied().collect::<Vec<_>>(), [fired]);
    assert!(items.expire(fired.expires_at - 1).is_empty());
    assert_eq!(items.expire(fired.expires_at), [fired]);
    assert_eq!(items.events().last().unwrap().owner, ctx.owner);
}

#[test]
fn card_uses_and_cooldown_are_game_time_and_a_protected_car_can_use_a_buff() {
    let shipped = Cards::shipped().unwrap();
    let mut sanga = shipped.get(ItemId::Sanga).clone();
    sanga.uses = 2;
    sanga.timing.cooldown_ms = 1000;
    let cards = Cards::parse(
        &serde_json::to_vec(shipped.get(ItemId::Boomerang)).unwrap(),
        &serde_json::to_vec(&sanga).unwrap(),
    )
    .unwrap();
    let mut items = Items::default();
    let ctx = Context {
        protected: true,
        ..context()
    };
    items.pickup(&cards, 0, ItemId::Sanga, ctx, 0).unwrap();
    items
        .use_front(&cards, 0, ctx, UtilityKind::Rear, 1, |_| Ok(()))
        .unwrap();
    assert_eq!(items.queue(0).front.unwrap().uses_left, 1);
    assert_eq!(
        items.use_front(&cards, 0, ctx, UtilityKind::Forward, 120, |_| panic!(
            "cooldown blocks activation"
        )),
        Err(ItemUseRefusal::Cooldown)
    );
    items
        .use_front(&cards, 0, ctx, UtilityKind::Forward, 121, |_| Ok(()))
        .unwrap();
    assert_eq!(items.queue(0), Queue::default());
}

#[test]
fn round_retirement_returns_every_effect_and_replayed_transactions_hash_identically() {
    let cards = Cards::shipped().unwrap();
    let run = || {
        let mut items = Items::default();
        let ctx = context();
        // A sample, not an effect/car budget. Every accepted use keeps a distinct causal record.
        for car in 0..1024 {
            items.pickup(&cards, car, ItemId::Sanga, ctx, 0).unwrap();
            items
                .use_front(&cards, car, ctx, UtilityKind::Forward, 1, |_| Ok(()))
                .unwrap();
        }
        items
    };
    let mut a = run();
    let b = run();
    let mut ha = vec![];
    let mut hb = vec![];
    a.hash_into(&mut ha);
    b.hash_into(&mut hb);
    assert_eq!(ha, hb);
    assert_eq!(a.effects().count(), 1024);
    let restored: Items = postcard::from_bytes(&postcard::to_allocvec(&a).unwrap()).unwrap();
    let mut restored_hash = vec![];
    restored.hash_into(&mut restored_hash);
    assert_eq!(restored_hash, ha);
    assert_eq!(a.round_end(2).len(), 1024);
    assert_eq!(a.effects().count(), 0);
    assert_eq!(a.queue(1023), Queue::default());
}

fn world() -> (jj_map::LoadedMap, jj_sim::Sim, jj_sim::CarId) {
    let map = jj_map::load_json(
        include_bytes!("../../../maps/greybox-loop.json"),
        &jj_map::Registry::generic(),
    )
    .unwrap();
    let mut sim = jj_sim::Sim::new(
        &map,
        &jj_map::Registry::generic(),
        17,
        jj_sim::VehicleProfile::cruz(),
    );
    let car = sim.spawn_car(jj_sim::route_spawn(&map, 16, 0.0, 0.6));
    sim.start_race(99);
    for _ in 0..240 {
        sim.step();
    }
    assert!(!sim.is_protected(car));
    (map, sim, car)
}

fn assert_sim_replay(map: &jj_map::LoadedMap, sim: &jj_sim::Sim) {
    let journal = jj_sim::Journal::from_bytes(&sim.journal().to_bytes()).unwrap();
    let replay = jj_sim::Sim::replay(
        map,
        &jj_map::Registry::generic(),
        jj_sim::VehicleProfile::cruz(),
        &journal,
        sim.tick(),
    );
    assert_eq!(sim.state_hash(), replay.state_hash());
    assert_eq!(sim.items().events(), replay.items().events());
    assert_eq!(sim.item_refusals(), replay.item_refusals());
}

#[test]
fn sim_pickups_are_journalled_and_an_unavailable_handler_never_fires_the_fallback() {
    let (map, mut sim, car) = world();
    let before = sim.state_hash();
    sim.pickup_item(car, SeatId(17), ItemId::Boomerang).unwrap();
    sim.pickup_item(car, SeatId(17), ItemId::Sanga).unwrap();
    assert_ne!(
        sim.state_hash(),
        before,
        "inventory affects the future state hash"
    );
    assert_eq!(
        sim.pickup_item(car, SeatId(17), ItemId::Boomerang),
        Err(PickupRefusal::Full)
    );
    let held = sim.items().queue(car.0);
    assert!(!sim.utility(car, UtilityKind::Rear));
    assert_eq!(sim.items().queue(car.0), held);
    assert_eq!(
        sim.item_refusals().last().unwrap().2,
        ItemUseRefusal::Unavailable
    );
    assert!(
        sim.utility_events().is_empty(),
        "holding an item must not drop a cone instead"
    );
    sim.step();
    assert_sim_replay(&map, &sim);
}

#[test]
fn sim_recovery_clears_queues_and_protection_refuses_an_offensive_pickup() {
    let (map, mut sim, car) = world();
    sim.pickup_item(car, SeatId(17), ItemId::Boomerang).unwrap();
    assert!(sim.recover(car));
    assert_eq!(sim.items().queue(car.0), Queue::default());
    assert!(sim.is_protected(car));
    assert_eq!(
        sim.pickup_item(car, SeatId(17), ItemId::Boomerang),
        Err(PickupRefusal::Protected)
    );
    sim.pickup_item(car, SeatId(17), ItemId::Sanga).unwrap();
    sim.step();
    assert_sim_replay(&map, &sim);
}

#[test]
fn sim_round_end_clears_inventory_but_dynamic_debris_keeps_moving_and_replays() {
    let (map, mut sim, car) = world();
    sim.pickup_item(car, SeatId(17), ItemId::Sanga).unwrap();
    assert!(sim.utility(car, UtilityKind::Rear));
    assert!(sim.sanga_state(car).is_some());
    assert_eq!(sim.items().effects().count(), 1);
    sim.spawn_debris(
        jj_sim::SpawnPose {
            x: 140.0,
            y: 3.0,
            z: 25.0,
            heading: 0.0,
        },
        [0.2; 3],
    );
    let before = sim.debris_poses();
    assert!(sim.end_race_now());
    assert_eq!(sim.items().queue(car.0), Queue::default());
    assert!(sim.sanga_state(car).is_none());
    assert_eq!(sim.items().effects().count(), 0);
    for _ in 0..30 {
        sim.step();
    }
    let after = sim.debris_poses();
    assert_eq!(
        after.len(),
        before.len(),
        "live debris is never retired with items"
    );
    assert!(
        after.last().unwrap().0[1] < before.last().unwrap().0[1],
        "the debris still falls dynamically"
    );
    assert_sim_replay(&map, &sim);
}

#[test]
fn a_fired_buff_keeps_its_original_owner_and_timer_through_recovery() {
    let (map, mut sim, car) = world();
    sim.pickup_item(car, SeatId(17), ItemId::Sanga).unwrap();
    sim.pickup_item(car, SeatId(17), ItemId::Boomerang).unwrap();
    assert!(sim.utility(car, UtilityKind::Forward));
    let fired = *sim.items().effects().next().unwrap();
    assert!(sim.recover(car));
    assert_eq!(sim.items().queue(car.0), Queue::default());
    assert_eq!(sim.sanga_state(car).unwrap().expires_at, fired.expires_at);
    for _ in 0..240 {
        sim.step();
    }
    assert_eq!(sim.items().effects().next().unwrap().owner, fired.owner);
    assert_eq!(sim.sanga_state(car).unwrap().expires_at, fired.expires_at);
    assert_sim_replay(&map, &sim);
}
