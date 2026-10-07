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
/// against the 1.5 s laptop budget (master §11.2a). The Node (V8) figure on whatever machine runs it; the receipt in
/// `docs/evidence/P1-M03g/` names the hardware and the Chromium numbers.
/// Overridden at build time (`JJ_WASM_BUDGET_MS=0`) to make the assertion print the measured numbers for a receipt.
const BUDGET_MS: f64 = match option_env!("JJ_WASM_BUDGET_MS") {
    Some(_) => 0.0,
    None => 1500.0,
};

#[wasm_bindgen_test]
fn generate_and_validate_in_wasm_stays_inside_the_laptop_budget() {
    #[wasm_bindgen::prelude::wasm_bindgen]
    extern "C" {
        #[wasm_bindgen::prelude::wasm_bindgen(js_namespace = Date, js_name = now)]
        fn date_now() -> f64;
    }
    let (mut worst, mut total) = (0.0f64, 0.0f64);
    for seed in 0..24u64 {
        let t = date_now();
        let p = jj_procgen::playtest::prepare(seed);
        let ms = date_now() - t;
        assert!(p.valid, "seed {seed}");
        worst = worst.max(ms);
        total += ms;
    }
    assert!(
        worst <= BUDGET_MS,
        "wasm prepare(): worst {worst:.0} ms, mean {:.0} ms over 24 seeds (budget {BUDGET_MS} ms)",
        total / 24.0
    );
}
