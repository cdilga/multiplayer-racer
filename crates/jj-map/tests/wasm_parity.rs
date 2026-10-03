//! Native = WASM: the greybox validates and loads in WASM (Node, through wasm-bindgen-test-runner) and hashes to the
//! same committed golden the native test asserts, so the canonical bytes are identical on both.
//! `cargo test --target wasm32-unknown-unknown -p jj-map --test wasm_parity`

#![cfg(target_arch = "wasm32")]

use jj_map::*;
use wasm_bindgen_test::wasm_bindgen_test;

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const GOLDEN: &str = include_str!("../../../maps/greybox-loop.hash");

#[wasm_bindgen_test]
fn greybox_hash_in_wasm_matches_the_native_golden() {
    let loaded =
        load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap_or_else(|r| panic!("{r:?}"));
    assert_eq!(hex(&loaded.hash), GOLDEN.trim());
    let again =
        load_canonical(&loaded.canonical, &Registry::generic()).unwrap_or_else(|r| panic!("{r:?}"));
    assert_eq!(again.hash, loaded.hash);
}
