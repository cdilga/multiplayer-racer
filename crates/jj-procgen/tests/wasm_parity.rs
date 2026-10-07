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
