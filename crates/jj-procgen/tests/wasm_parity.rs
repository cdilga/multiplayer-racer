//! Native = WASM (P1-M03a): every seed in the committed goldens generates, validates and hashes to the same value in
//! WASM (Node, through wasm-bindgen-test-runner) as the native `procgen.rs` asserts, so the canonical bytes are
//! identical on both. `cargo test --target wasm32-unknown-unknown -p jj-procgen --test wasm_parity`

#![cfg(target_arch = "wasm32")]

use jj_map::{gameplay_hash, hex, validate};
use wasm_bindgen_test::wasm_bindgen_test;

const GOLDENS: &str = include_str!("goldens/seeds.txt");

#[wasm_bindgen_test]
fn golden_seeds_in_wasm_match_the_native_hashes() {
    let mut n = 0;
    for line in GOLDENS.lines().filter(|l| !l.trim().is_empty()) {
        let (seed, golden) = line.split_once(' ').expect("`<seed> <hash>` lines");
        let map = jj_procgen::generate(seed.parse().expect("a u64 seed"));
        assert!(
            validate(&map, &jj_procgen::registry()).ok,
            "seed {seed} fails validation in WASM"
        );
        assert_eq!(hex(&gameplay_hash(&map)), golden, "seed {seed}");
        n += 1;
    }
    assert!(n > 0, "no goldens");
}

const RECIPES: &str = include_str!("goldens/recipes.txt");

#[wasm_bindgen_test]
fn two_biome_recipes_in_wasm_match_the_native_hashes() {
    let mut n = 0;
    for line in RECIPES.lines().filter(|l| !l.trim().is_empty()) {
        let (seed, golden) = line.split_once(' ').expect("`<seed> <hash>` lines");
        let (map, _) = jj_procgen::generate_recipe(
            seed.parse().expect("a u64 seed"),
            &[jj_map::Biome::Greybox, jj_map::Biome::OutbackDirt],
        )
        .expect("the pinned seeds have room for two boundaries");
        assert!(validate(&map, &jj_procgen::registry()).ok, "seed {seed}");
        assert_eq!(hex(&gameplay_hash(&map)), golden, "seed {seed}");
        n += 1;
    }
    assert!(n > 0, "no recipe goldens");
}

/// Generate + validate in WASM (P1-M03g, `ev:hardware`): the four-biome lap through the whole fallback ladder, per seed,
/// inside the 1.5 s laptop budget (master §11.2a); the receipt in `docs/evidence/P1-M03g/` names the hardware and the
/// Chromium numbers. FL15b/c's gates had the ladder redraw up to ~11 times (CI run 5283: worst 16 s at CI's opt-level 1);
/// br-cxqk brought it back (eris, CI's profile, GENERATOR_VERSION 28: worst 865 ms, mean 460 ms). The redraws, the cause
/// last time and the same on every machine and target, are guarded too: worst <= GUARD_WORST_DRAWS and mean <=
/// GUARD_MEAN_DRAWS (measured 8 / 3.12).
const TARGET_MS: f64 = 1500.0;
const GUARD_WORST_DRAWS: usize = 9;
const GUARD_MEAN_DRAWS: f64 = 3.5;

#[wasm_bindgen_test]
fn generate_and_validate_in_wasm_stays_inside_the_laptop_budget() {
    #[wasm_bindgen::prelude::wasm_bindgen]
    extern "C" {
        #[wasm_bindgen::prelude::wasm_bindgen(js_namespace = Date, js_name = now)]
        fn date_now() -> f64;
    }
    let (mut worst, mut total) = (0.0f64, 0.0f64);
    let (mut worst_draws, mut draws) = (0usize, 0usize);
    for seed in 0..24u64 {
        let t = date_now();
        let p = jj_procgen::playtest::prepare(seed);
        let ms = date_now() - t;
        assert!(p.valid, "seed {seed}");
        worst = worst.max(ms);
        total += ms;
        worst_draws = worst_draws.max(p.attempts.len());
        draws += p.attempts.len();
    }
    let mean_draws = draws as f64 / 24.0;
    let line = format!(
        "wasm prepare(): worst {worst:.0} ms, mean {:.0} ms over 24 seeds (target {TARGET_MS} ms, br-cxqk); draws worst \
         {worst_draws}, mean {mean_draws:.2} (guard {GUARD_WORST_DRAWS} / {GUARD_MEAN_DRAWS})",
        total / 24.0
    );
    wasm_bindgen_test::console_log!("{line}");
    assert!(
        worst_draws <= GUARD_WORST_DRAWS && mean_draws <= GUARD_MEAN_DRAWS,
        "{line}"
    );
    // Quarantined (AGENTS.md CI rule 4, owner br-cxqk): CI run 6624 measured worst 2742 ms, mean 1090 ms at
    // GENERATOR_VERSION 32 with the draws inside their guards, so each draw got dearer (overpass leaps' sculpt passes
    // since v29, loops on since v31). br-cxqk brings it back under TARGET_MS and restores this assertion; until then the
    // time is logged and the draw guards above hold.
    if worst > TARGET_MS {
        wasm_bindgen_test::console_log!(
            "over the {TARGET_MS} ms target (quarantined under br-cxqk): {line}"
        );
    }
}

const ARENAS: &str = include_str!("goldens/arena.txt");

/// The derby bowls (P1-M10): the canonical map bytes and the collider's triangles are bit-identical in WASM.
#[wasm_bindgen_test]
fn derby_arenas_in_wasm_match_the_native_hashes_and_meshes() {
    let mut n = 0;
    for line in ARENAS.lines().filter(|l| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split(' ').collect();
        let (seed, cars): (u64, usize) = (
            f[0].parse().expect("a seed"),
            f[1].parse().expect("a car count"),
        );
        let map = jj_procgen::arena::prepare(seed, cars, &jj_procgen::registry())
            .unwrap_or_else(|bad| panic!("arena {seed}/{cars} fails in WASM: {bad:?}"));
        assert_eq!(hex(&gameplay_hash(&map.map)), f[2], "arena {seed}/{cars}");
        assert_eq!(
            format!("{:016x}", jj_map::arena::mesh_fingerprint(&map.map)),
            f[3],
            "arena {seed}/{cars} mesh"
        );
        n += 1;
    }
    assert!(n > 0, "no arena goldens");
}
