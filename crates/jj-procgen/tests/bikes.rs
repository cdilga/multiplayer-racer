//! br-bwju.4: the two-wheel simulation fixture is independent of the eventual bike models.
use jj_map::{Biome, canonical_bytes, load_canonical};
use jj_sim::{Sim, TICK_HZ, VehicleProfile};

#[test]
fn bike_laps_every_generated_biome_upright_and_replays() {
    let profile =
        VehicleProfile::from_json(include_str!("../../../scenarios/bikes/profile.json")).unwrap();
    for biome in [
        Biome::Town,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ] {
        for seed in 0..3 {
            let p = jj_procgen::prepare(seed, &[biome]);
            assert!(p.valid);
            let registry = jj_procgen::registry();
            let map = load_canonical(&canonical_bytes(&p.map), &registry).unwrap();
            let mut sim = Sim::new(&map, &registry, seed, profile.clone());
            let car = sim.spawn_grid(1)[0];
            sim.start_race(1);
            sim.set_autopilot(car, true);
            let mut min_up = 1.0f32;
            while !sim.race().is_finished(car.0) && sim.tick() < 400 * u64::from(TICK_HZ) {
                sim.step();
                // Upside down on a loop's deck is the ride, not a roll (br-xlvx.6.5).
                if !sim.riding_loop(car) {
                    min_up = min_up.min(sim.car_state(car).unwrap().up_y);
                }
            }
            let rc = sim.race().car(car.0).unwrap();
            eprintln!(
                "{biome:?} seed {seed}: tick {}, minUp {min_up}, recoveries {}, wrecks {}",
                sim.tick(),
                rc.recoveries,
                rc.wrecks
            );
            assert!(
                rc.finished_at.is_some(),
                "{biome:?} seed {seed} never finished"
            );
            assert_eq!((rc.recoveries, rc.wrecks), (0, 0), "{biome:?} seed {seed}");
            assert!(min_up > 0.5, "{biome:?} seed {seed} fell: {min_up}");
            let replay = Sim::replay(&map, &registry, profile.clone(), sim.journal(), sim.tick());
            assert_eq!(sim.state_hash(), replay.state_hash());
        }
    }
}
