//! `jj.map.v1`: the one map format the game loads, authored and generated (plan §8.1), with the kit-piece registry,
//! the structural validator and the loader. Native and WASM produce identical canonical bytes (integers only, postcard),
//! and the gameplay hash is SHA-256 of those bytes.
//!
//! ```text
//! JSON (authoring) ──parse──► Map ──validate(registry)──► canonicalise ──► postcard bytes ──► SHA-256
//! canonical bytes (worker Init) ──decode──► Map ──validate + must re-encode to the same bytes
//! ```

#![forbid(unsafe_code)]

pub mod canon;
mod geom;
pub mod jump;
pub mod kit;
pub mod model;
pub mod validate;

pub use canon::{canonical_bytes, canonicalise, gameplay_hash, hex};
pub use kit::{Footprint, GENERIC_PIECES, KitPiece, Registry};
pub use model::*;
pub use validate::{Report, Rule, Violation, limits, validate};

/// A validated map with its canonical bytes and their hash.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoadedMap {
    pub map: Map,
    pub canonical: Vec<u8>,
    pub hash: [u8; 32],
}

impl LoadedMap {
    fn from_valid(map: Map) -> Self {
        let map = canonicalise(&map);
        let canonical = canonical_bytes(&map);
        let hash = gameplay_hash(&map);
        Self {
            map,
            canonical,
            hash,
        }
    }
}

/// Parses the JSON form; unknown or missing gameplay fields fail the `schema` rule.
pub fn parse_json(json: &[u8]) -> Result<Map, Report> {
    serde_json::from_slice(json)
        .map_err(|e| Report::of(vec![Violation::new(Rule::Schema, "map", e.to_string())]))
}

/// Parses, validates and canonicalises a JSON map.
pub fn load_json(json: &[u8], registry: &Registry) -> Result<LoadedMap, Report> {
    let map = parse_json(json)?;
    let report = validate(&map, registry);
    if report.ok {
        Ok(LoadedMap::from_valid(map))
    } else {
        Err(report)
    }
}

/// Decodes canonical bytes (the worker's `Init.map_bytes`), validates, and checks they really are canonical.
pub fn load_canonical(bytes: &[u8], registry: &Registry) -> Result<LoadedMap, Report> {
    let schema = |detail: String| Report::of(vec![Violation::new(Rule::Schema, "map", detail)]);
    let (map, rest): (Map, &[u8]) =
        postcard::take_from_bytes(bytes).map_err(|e| schema(e.to_string()))?;
    if !rest.is_empty() {
        return Err(schema(format!("{} trailing bytes", rest.len())));
    }
    let report = validate(&map, registry);
    if !report.ok {
        return Err(report);
    }
    let loaded = LoadedMap::from_valid(map);
    if loaded.canonical != bytes {
        return Err(schema(
            "the bytes decode but aren't in canonical form (unsorted collections or a stored hash)"
                .into(),
        ));
    }
    Ok(loaded)
}
