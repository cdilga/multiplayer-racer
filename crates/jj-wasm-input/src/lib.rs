//! wasm-bindgen facade for controllers (input + protocol only; no sim, no renderer).

use wasm_bindgen::prelude::wasm_bindgen;

/// The crate name and version this module was built from, for the build line in the UI.
#[wasm_bindgen(js_name = buildInfo)]
pub fn build_info() -> String {
    concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION")).to_owned()
}
