//! br-4tbo (P1-S-botpace): bots and the autopilot keep up with the arcade cars. The autopilot planned to a fixed 26 m/s
//! (tuned for the old 7 kN car) while players reach ~50 m/s, so filler bots and a locked phone's car fell far behind. Its
//! plan is data now (`assets/profiles/assist.json` `autopilot`), up to a share of each car's own top speed, holding to a
//! jump's take-off speed on its ramp. On standard generated tracks, each arcade roster car laps on the autopilot within
//! `PACE` of the scripted good driver (`common::good_driver`, assists Off) in the same car, with no wreck and no
//! recovery. Prints the table (`--nocapture`); `JJ_EVIDENCE_DIR` writes it as `bot-pace.txt`.
#![cfg(not(target_arch = "wasm32"))]

mod common;

use jj_map::{LoadedMap, canonical_bytes, load_canonical};
use jj_sim::assist::AssistLevel;
use jj_sim::{Sim, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;
/// The bot's lap may take at most this much longer than the good driver's (the bead's "within ~15 %").
const PACE: f32 = 1.15;
/// Standard-class tracks sampled (a sample, not a limit).
const TRACKS: usize = 3;

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// One lap on the autopilot from the grid: seconds, wrecks, recoveries.
fn bot_lap(map: &LoadedMap, profile: &VehicleProfile) -> (f32, u32, u32) {
    let mut sim = Sim::new(map, &jj_procgen::registry(), 5, profile.clone());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    sim.set_autopilot(car, true);
    while !sim.race().is_finished(car.0) {
        assert!(sim.tick() < 400 * S, "the autopilot laps the track");
        sim.step();
    }
    let rc = sim.race().car(car.0).unwrap();
    (sim.tick() as f32 / TICK_HZ as f32, rc.wrecks, rc.recoveries)
}

#[test]
fn the_autopilot_laps_standard_tracks_within_15_percent_of_a_good_driver_in_every_arcade_car() {
    let tracks: Vec<(u64, LoadedMap, f32)> = (0..200u64)
        .map(|seed| (seed, jj_procgen::playtest::prepare(seed)))
        .filter(|(_, p)| p.valid && p.course.class.name() == "standard")
        .take(TRACKS)
        .map(|(seed, p)| {
            let map = load_canonical(&canonical_bytes(&p.map), &jj_procgen::registry())
                .expect("a valid map loads");
            (seed, map, p.course.length_m as f32)
        })
        .collect();
    assert_eq!(
        tracks.len(),
        TRACKS,
        "standard tracks in the first 200 seeds"
    );
    let mut table = String::from(
        "vehicle          seed  lapM   top(m/s)  plan(m/s)  good(s)  bot(s)  bot/good  wrecks  recov\n",
    );
    let mut misses = Vec::new();
    let assist = jj_sim::assist::AssistProfile::standard();
    for (id, profile) in VehicleProfile::roster(&root()).unwrap() {
        if profile.tuning.arcade.is_none() {
            continue; // the bikes keep Rapier's tyres: the good driver corners on the arcade turn
        }
        let top = profile.top_speed_mps();
        let plan = assist.speed_plan(&profile).max_speed;
        for (seed, map, len) in &tracks {
            let good = common::good_driver::lap_time(map, &profile, AssistLevel::Off, 1);
            let (bot, wrecks, recov) = bot_lap(map, &profile);
            let ratio = bot / good;
            table += &format!(
                "{id:<16} {seed:>4} {len:>5.0} {top:>9.1} {plan:>10.1} {good:>8.1} {bot:>7.1} {ratio:>9.2} {wrecks:>7} {recov:>6}\n"
            );
            if ratio > PACE || wrecks > 0 || recov > 0 {
                misses.push(format!(
                    "{id} seed {seed}: bot {bot:.1} s vs good {good:.1} s ({ratio:.2}), wrecks {wrecks}, recoveries {recov}"
                ));
            }
        }
    }
    println!("{table}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("bot-pace.txt"), &table).unwrap();
    }
    assert!(misses.is_empty(), "{misses:#?}\n{table}");
}
