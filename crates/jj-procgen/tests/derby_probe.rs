//! A measurement, not a gate (br-bhkz.1): what a bot derby does to its cars. Six bots, three minutes, three seeds: the
//! wrecks, who caused them, and where the damage came from (rivals, junk, scenery). The before and after of the derby's
//! hit rules are in docs/evidence/br-bhkz.1/measurements.md. Run with `-- --ignored --nocapture`.
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;

use jj_procgen::arena::prepare;
use jj_sim::damage::{DamageEvent, OtherBody};
use jj_sim::{Sim, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;

fn group(part: u8) -> &'static str {
    match part {
        0 => "core",
        1 => "front",
        2 => "back",
        3..=6 => "door",
        _ => "wheel",
    }
}

#[test]
#[ignore = "a measurement: prints what a bot derby does"]
fn what_a_bot_derby_does() {
    let cars = 6;
    for seed in 1u64..=3 {
        let map = prepare(seed, cars, &jj_procgen::registry()).expect("arena");
        let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        let ids = sim.spawn_grid_as(&[0; 6]);
        sim.start_derby(180 * S);
        for (&id, pace) in ids.iter().zip([800u16, 800, 900, 1000, 900, 1000]) {
            sim.set_autopilot(id, true);
            sim.set_bot_pace(id, pace);
        }
        for _ in 0..(180 * S) {
            sim.step();
        }
        // Damage taken, by what hit and which part; the wrecks, by why and whether a car caused them.
        let mut by: BTreeMap<(&str, &str), (f32, u32)> = BTreeMap::new();
        let mut wrecks: BTreeMap<String, u32> = BTreeMap::new();
        let mut detached = 0;
        for (_, e) in sim.damage_events() {
            match e {
                DamageEvent::Episode(r) => {
                    let cause = match r.other {
                        OtherBody::Car { .. } => "car",
                        OtherBody::Prop { .. } => "prop",
                        OtherBody::Scenery => "scenery",
                    };
                    let slot = by.entry((cause, group(r.part))).or_default();
                    slot.0 += r.damage;
                    slot.1 += 1;
                }
                DamageEvent::PartDetached { .. } => detached += 1,
                DamageEvent::Wrecked {
                    why, instigator, ..
                } => {
                    let who = if instigator.is_some() {
                        "by-car"
                    } else {
                        "alone"
                    };
                    *wrecks.entry(format!("{why:?}/{who}")).or_default() += 1;
                }
                DamageEvent::PartLoose { .. } => {}
            }
        }
        let ledger = sim.derby().expect("derby");
        let points: Vec<String> = ids
            .iter()
            .map(|id| format!("{:.0}", ledger.points(id.0)))
            .collect();
        eprintln!(
            "== seed {seed}: floor r {:.0} m, {} boxes",
            jj_procgen::arena::arena_floor_radius(cars),
            sim.stations().len()
        );
        eprintln!(
            "points {points:?}; {} score events; {detached} detaches; wrecks {wrecks:?}",
            ledger.events().len()
        );
        for ((cause, part), (hp, n)) in &by {
            eprintln!("  taken from {cause:8} on {part:6}: {hp:7.1} HP in {n} hits");
        }
    }
}
