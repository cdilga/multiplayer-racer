//! wasm-bindgen facade for the procgen worker (P1-M08a): the browser's procgen Web Worker prepares each round's map
//! here. Pure data in and out: a seed and a recipe in; the canonical bytes (what the sim validates and races), the
//! `jj.map.v1` JSON (what the renderer builds from) and the attempt log (the R90 readout) out. The sim owns colliders
//! and main owns the GPU upload; this crate never touches either.

use jj_map::{Biome, load_json};
use jj_procgen::validate::Plan;
use wasm_bindgen::prelude::*;

pub mod share;

/// br-m1xe: the share code for a track this build generates (`recipe` as for [`prepare_tuned`]; empty is the seed's mix).
#[wasm_bindgen(js_name = trackCode)]
pub fn track_code(seed: f64, recipe: &str) -> Result<String, JsError> {
    let recipe = parse_recipe(recipe).map_err(|e| JsError::new(&e))?;
    Ok(share::encode(seed as u64, &recipe))
}

/// br-m1xe: reads a share code: `{"seed": n, "recipe": "rocks,town"}`, or the reason it can't be rebuilt here (a typo,
/// or another generator version, named).
#[wasm_bindgen(js_name = readTrackCode)]
pub fn read_track_code(code: &str) -> Result<String, JsError> {
    let t = share::decode(code).map_err(|e| JsError::new(&e.to_string()))?;
    let recipe: Vec<String> = t
        .recipe
        .iter()
        .map(|b| {
            serde_json::to_value(b)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default()
        })
        .collect();
    Ok(serde_json::json!({ "seed": t.seed as f64, "recipe": recipe.join(","), "version": t.version }).to_string())
}

/// The crate name and version this module was built from, for the build line in the UI.
#[wasm_bindgen(js_name = buildInfo)]
pub fn build_info() -> String {
    concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION")).to_owned()
}

/// The default recipe is empty: the seed draws its own one to four biomes in any order (R125, `GeneratorData::draw_mix`;
/// the M03g ladder handles the seeds that can't fit them). A non-empty list is an explicit lap, for dev tools.
pub const DEFAULT_RECIPE: &str = "";

/// The default recipe: empty, meaning the seed's own biome mix.
#[wasm_bindgen(js_name = defaultRecipe)]
pub fn default_recipe() -> String {
    DEFAULT_RECIPE.to_owned()
}

/// Biome names (`greybox`, `town`, `rocks`, `outback-dirt`, `outback-bitumen`), comma-separated; empty is the seed's mix.
pub fn parse_recipe(list: &str) -> Result<Vec<Biome>, String> {
    if list.trim().is_empty() {
        return Ok(Vec::new());
    }
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
    prepare_tuned(seed, recipe, "")
}

/// The shipped generator data (`assets/profiles/generator.json`) as JSON: the owner tuning menu's rows and defaults.
#[wasm_bindgen(js_name = generatorDefaults)]
pub fn generator_defaults() -> String {
    serde_json::to_string(jj_procgen::tuning::GeneratorData::shipped()).unwrap_or_default()
}

/// The shipped generator data with `set` applied: `[["course.lengthMinM","800"],…]` (dotted paths as in the file, JSON
/// values as text). Returns the whole document, or the validator's lines as the error; nothing is partly applied.
#[wasm_bindgen(js_name = generatorWith)]
pub fn generator_with(set: &str) -> Result<String, JsError> {
    let set: Vec<(String, String)> =
        serde_json::from_str(set).map_err(|e| JsError::new(&format!("not a change list: {e}")))?;
    let doc = jj_procgen::tuning::GeneratorData::shipped()
        .with_fields(&set)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&doc).map_err(|e| JsError::new(&e.to_string()))
}

/// [`prepare`] with tuned generator data (br-2sdu.3): a full `jj.generator` document, or empty for the shipped one.
/// An invalid document is refused with the validator's lines.
#[wasm_bindgen(js_name = prepareTuned)]
pub fn prepare_tuned(seed: f64, recipe: &str, generator: &str) -> Result<Prepared, JsError> {
    let recipe = parse_recipe(recipe).map_err(|e| JsError::new(&e))?;
    let data = if generator.is_empty() {
        jj_procgen::tuning::GeneratorData::shipped().clone()
    } else {
        jj_procgen::tuning::GeneratorData::from_json(generator)
            .map_err(|e| JsError::new(&e.to_string()))?
    };
    // The Playtest-1 course-draw budget (a few tens of milliseconds a draw); an empty recipe is the seed's own mix.
    let seed = seed as u64;
    let p = if recipe.is_empty() {
        jj_procgen::playtest::prepare_data(seed, &data)
    } else {
        jj_procgen::prepare_tuned(seed, &recipe, jj_procgen::playtest::PLAYTEST_DRAWS, &data)
    };
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

/// A derby round's arena (P1-G06, P1-M10): the generated bowl for `cars` cars (no cap), validated like every map.
#[wasm_bindgen(js_name = prepareArena)]
pub fn prepare_arena(seed: f64, cars: u32) -> Result<Prepared, JsError> {
    let map =
        jj_procgen::arena::prepare(seed as u64, (cars as usize).max(2), &jj_procgen::registry())
            .map_err(|bad| JsError::new(&bad.join("; ")))?;
    Ok(Prepared {
        canonical: map.canonical.clone(),
        map_json: serde_json::to_string(&map.map).map_err(|e| JsError::new(&e.to_string()))?,
        log: "[]".into(),
        plan: "arena".into(),
        valid: true,
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
    fn the_default_recipe_is_the_seeds_own_mix_and_prepares_a_valid_map() {
        assert_eq!(parse_recipe(DEFAULT_RECIPE).unwrap(), Vec::new());
        assert_eq!(parse_recipe("town,rocks").unwrap().len(), 2);
        assert!(parse_recipe("town,nowhere").is_err());
        let data = jj_procgen::tuning::GeneratorData::shipped();
        for seed in [7, 8, 9] {
            let p = jj_procgen::playtest::prepare_data(seed, data);
            assert!(p.valid, "seed {seed}");
        }
    }
}
