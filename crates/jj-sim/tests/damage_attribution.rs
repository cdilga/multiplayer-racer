//! P1-S04a, beside the damage bank (`tests/damage.rs`): what the episodes carry and where they show.
//!
//! - `jj sim` output (R90 "see"): every part's health and state in each car's observation, and the trace's episodes and
//!   loose and detached transitions, at their ticks, with cause and instigator;
//! - a hit by debris names the car that last put an impulse into the debris (the causal owner, for S10/W02);
//! - the profile carries every part's proxy in the contract's order, so a contact's collider names its part.

use std::path::{Path, PathBuf};

use jj_map::{Registry, load_json};
use jj_sim::damage::{DamageEvent, EpisodeRecord, OtherBody, PART_NAMES, PARTS};
use jj_sim::{CarId, Sim, SpawnPose, VehicleProfile};
use serde_json::json;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
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

#[test]
fn episodes_and_part_states_show_in_the_jj_sim_output() {
    let file = repo().join("scenarios/damage/fixtures/t-bone-12.json");
    let fx: jj_fixture::Fixture =
        serde_json::from_slice(&std::fs::read(&file).expect("fixture")).expect("fixture parses");
    let registry = Registry::generic();
    let map = load_json(
        &std::fs::read(repo().join(&fx.map)).expect("map"),
        &registry,
    )
    .expect("map validates");
    let out = jj_fixture::run(&fx, &map, &registry, &VehicleProfile::cruz(), true).expect("runs");
    assert!(out.replay_matches(), "the traced run replays");
    let trace = serde_json::to_string(&out.recorded.trace).expect("trace json");
    for needle in [
        "\"event\":\"episode\"",
        "\"event\":\"partDetached\"",
        "\"event\":\"partLoose\"",
        "\"otherOwner\"",
        "\"instigator\":1",
        "\"closingMps\"",
        "\"impulse\"",
    ] {
        assert!(trace.contains(needle), "the trace has {needle}");
    }
    let last = out.recorded.observations.last().expect("an observation");
    let parts = &last["cars"][0]["parts"];
    assert_eq!(parts.as_array().map(Vec::len), Some(PARTS), "every part");
    let state = |car: usize, part: &str| {
        last["cars"][car]["parts"]
            .as_array()
            .and_then(|p| p.iter().find(|p| p["part"] == part))
            .map(|p| p["state"].clone())
    };
    assert_eq!(state(0, "door_RR"), Some(json!("detached")));
    assert_eq!(state(0, "door_FL"), Some(json!("intact")));
    assert_eq!(state(1, "front"), Some(json!("loose")));
}

/// Plan §6.3: "per (car, part, other body)": debris carries its causal owner. A car hits a debris block at speed, which
/// flies on into a parked car: that episode names the first car as the debris' owner, and when it last hit it.
#[test]
fn a_hit_by_debris_names_the_car_that_hit_the_debris() {
    let map = load_json(
        &std::fs::read(repo().join("scenarios/damage/yard.json")).expect("map"),
        &Registry::generic(),
    )
    .expect("map validates");
    let mut sim = Sim::new(&map, &Registry::generic(), 3, VehicleProfile::cruz());
    for i in 0..2 {
        sim.spawn_car(SpawnPose {
            x: -60.0 + 12.0 * i as f32,
            y: 0.1,
            z: -20.0,
            heading: 0.0,
        });
    }
    for _ in 0..240 {
        sim.step();
    }
    let h = 90f32.to_radians();
    // Car 0 runs +x at 12 m/s into a 0.8 m block 3 m ahead of it; car 1 is parked in line, its tail 2.7 m past the block.
    sim.spawn_debris(
        SpawnPose {
            x: 63.0,
            y: 0.4,
            z: -30.0,
            heading: 0.0,
        },
        [0.4, 0.4, 0.4],
    );
    let pose = |x: f32| SpawnPose {
        x,
        y: 0.05,
        z: -30.0,
        heading: h,
    };
    // 12.8 m/s: the yard is off-track (R124 rolling drag), so this arrives at the 12 m/s it used to.
    sim.place_car(CarId(0), pose(56.0), 0.0, [12.8, 0.0, 0.0]);
    sim.place_car(CarId(1), pose(68.0), 0.0, [0.0, 0.0, 0.0]);
    for _ in 0..120 {
        sim.step();
    }
    let eps = episodes(&sim);
    let on_debris = eps
        .iter()
        .find(|r| r.car == 0 && matches!(r.other, OtherBody::Prop { .. }))
        .expect("car 0's front hit the debris");
    assert_eq!(on_debris.other_owner, None, "nobody had touched it before");
    let hit_by_debris = eps
        .iter()
        .find(|r| r.car == 1 && matches!(r.other, OtherBody::Prop { .. }))
        .expect("the debris flew into car 1 at over 4 m/s");
    let owner = hit_by_debris.other_owner.expect("a causal owner");
    assert_eq!(owner.car, 0, "car 0 knocked it");
    assert!(
        owner.tick <= on_debris.last_tick,
        "its time is when car 0 last put an impulse into it"
    );
    assert_eq!(sim.prop_owner(0).map(|o| o.car), Some(0));
    assert!(hit_by_debris.impulse > 0.0 && hit_by_debris.closing_mps >= 4.0);
}

#[test]
fn the_profile_carries_every_part_proxy_in_contract_order() {
    let p = VehicleProfile::cruz();
    let names: Vec<&str> = p.geometry.parts.iter().map(|g| g.name.as_str()).collect();
    assert_eq!(names, PART_NAMES);
    for g in &p.geometry.parts {
        assert!(g.points.len() >= 4, "{} has a proxy", g.name);
    }
    let mass: f32 = p.geometry.parts.iter().map(|g| g.mass_fraction).sum();
    assert!((mass - 1.0).abs() < 0.01, "mass fractions sum to {mass}");
}
