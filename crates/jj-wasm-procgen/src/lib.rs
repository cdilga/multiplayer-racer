//! wasm-bindgen facade for the procgen worker (P1-M08a): the browser's procgen Web Worker prepares each round's map
//! here. Pure data in and out: a seed and a recipe in; the canonical bytes (what the sim validates and races), the
//! `jj.map.v1` JSON (what the renderer builds from) and the attempt log (the R90 readout) out. The sim owns colliders
//! and main owns the GPU upload; this crate never touches either.

use jj_map::{Biome, load_json};
use jj_procgen::validate::Plan;
use wasm_bindgen::prelude::*;

/// The crate name and version this module was built from, for the build line in the UI.
#[wasm_bindgen(js_name = buildInfo)]
pub fn build_info() -> String {
    concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION")).to_owned()
}

/// Playtest 1's lap: four biomes in order, ending back in the first (the M03g ladder handles the seeds that can't fit it).
pub const PLAYTEST1_RECIPE: &str = "town,rocks,outback-dirt,outback-bitumen";

/// The Playtest-1 recipe, as a comma-separated list of biome names.
#[wasm_bindgen(js_name = defaultRecipe)]
pub fn default_recipe() -> String {
    PLAYTEST1_RECIPE.to_owned()
}

/// Biome names (`greybox`, `town`, `rocks`, `outback-dirt`, `outback-bitumen`), comma-separated.
pub fn parse_recipe(list: &str) -> Result<Vec<Biome>, String> {
    list.split(',')
        .map(|n| {
            serde_json::from_value(serde_json::Value::String(n.trim().into()))
                .map_err(|_| format!("unknown biome {:?}", n.trim()))
        })
        .collect()
}

fn plan_name(p: &Plan) -> String {
    match p {
        Plan::Requested => "requested".into(),
        Plan::Redrawn(d) => format!("redrawn-{d}"),
        Plan::Shorter(k) => format!("shorter-{k}"),
        Plan::Conservative => "conservative".into(),
    }
}

/// One prepared round map.
#[wasm_bindgen]
pub struct Prepared {
    canonical: Vec<u8>,
    map_json: String,
    log: String,
    plan: String,
    valid: bool,
}

#[wasm_bindgen]
impl Prepared {
    /// `jj.map.v1` canonical bytes: what `MapReady` carries.
    #[wasm_bindgen(getter)]
    pub fn canonical(&self) -> Vec<u8> {
        self.canonical.clone()
    }

    /// The map as JSON, for the renderer.
    #[wasm_bindgen(getter, js_name = mapJson)]
    pub fn map_json(&self) -> String {
        self.map_json.clone()
    }

    /// The fallback ladder's attempts as JSON: `[{"biomes":4,"draw":0,"rejected":[...]}, ...]`.
    #[wasm_bindgen(getter)]
    pub fn log(&self) -> String {
        self.log.clone()
    }

    /// `requested`, `redrawn-N`, `shorter-N` or `conservative`.
    #[wasm_bindgen(getter)]
    pub fn plan(&self) -> String {
        self.plan.clone()
    }

    /// False only if even the conservative recipe failed: the caller must not send the map.
    #[wasm_bindgen(getter)]
    pub fn valid(&self) -> bool {
        self.valid
    }
}

/// The seed's validated map for `recipe` (comma-separated biome names), through the whole fallback ladder.
/// `seed` is an integer below 2^53 (it crosses from JS as a number).
#[wasm_bindgen]
pub fn prepare(seed: f64, recipe: &str) -> Result<Prepared, JsError> {
    let recipe = parse_recipe(recipe).map_err(|e| JsError::new(&e))?;
    let p = jj_procgen::prepare(seed as u64, &recipe);
    let log = serde_json::json!(
        p.attempts
            .iter()
            .map(|a| serde_json::json!({
                "biomes": a.recipe.len(), "draw": a.draw, "rejected": a.rejected,
            }))
            .collect::<Vec<_>>()
    );
    Ok(Prepared {
        canonical: jj_map::canonical_bytes(&p.map),
        map_json: serde_json::to_string(&p.map).map_err(|e| JsError::new(&e.to_string()))?,
        log: log.to_string(),
        plan: plan_name(&p.plan),
        valid: p.valid,
    })
}

/// Validates an authored `jj.map.v1` JSON document against the same registry the sim uses and returns its canonical
/// bytes (the dev map import). The error is the validator's: one `rule at: detail` line per violation.
#[wasm_bindgen(js_name = validateMap)]
pub fn validate_map(json: &str) -> Result<Vec<u8>, JsError> {
    load_json(json.as_bytes(), &jj_procgen::registry())
        .map(|m| m.canonical)
        .map_err(|r| {
            JsError::new(
                &r.violations
                    .iter()
                    .map(|v| format!("{} {}: {}", v.rule.name(), v.at, v.detail))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_recipe_parses_and_prepares_a_valid_map() {
        let recipe = parse_recipe(PLAYTEST1_RECIPE).unwrap();
        assert_eq!(recipe.len(), 4);
        assert!(parse_recipe("town,nowhere").is_err());
        let p = jj_procgen::prepare(7, &recipe);
        assert!(p.valid);
    }
}
