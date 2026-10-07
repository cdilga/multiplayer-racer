//! Biomes (P1-M03f): the interface the four biome tasks implement, the selector that assigns route segments to biomes
//! ([`select`]), and the transition rules ([`check_transitions`]).
//!
//! **A biome is pure data** ([`BiomeData`]): its road and ground surfaces, terrain (relief, wavelength, max grade,
//! curvature, bank, blend), feature mix, scatter (Poisson or cluster, spacing, weighted pieces with parameter ranges,
//! setback and `collides`), and the segment names it adds. A biome task adds one file here (`biome/<name>.rs`, a unit
//! struct implementing [`BiomeDef`]) and changes its line in [`def`]; it touches no other procgen file. Today's five
//! files are placeholders over the generic kit (`greybox` is the one the core runs alone).
//!
//! The shared wayfinding family ([`wayfinding`]) is the core's, not a biome's: a row of single-chevron posts and a W-beam
//! guard rail on every corner (R104, R105) and a race-banner gantry at the finish (R106), whatever the biome.

use jj_map::{Biome, GENERIC_PIECES, Registry, Surface};

use crate::features::Density;
use crate::scatter::Spec;
use crate::terrain::TerrainParams;

pub mod bitumen;
pub mod dirt;
pub mod greybox;
pub mod rocks;
mod select;
pub mod town;
pub mod wayfinding;

pub use select::{
    MAX_TURN, MIN_BOUNDARY_GAP_M, SelectError, Selection, TRANSITION_M, check_transitions,
    segment_name, select,
};

/// Everything a biome is.
#[derive(Clone, Copy, Debug)]
pub struct BiomeData {
    pub id: Biome,
    /// The route's surface class (and the painted road cells').
    pub road: Surface,
    /// The class off the road. Placeholder biomes use `OffTrack`; a biome may name its own ground.
    pub ground: Surface,
    pub terrain: TerrainParams,
    pub features: Density,
    pub scatter: Spec,
    /// Extra segment names this biome may label stretches of its road with (beyond its own name).
    pub segment_types: &'static [&'static str],
}

/// What a biome implements. Only [`BiomeDef::data`] is required.
pub trait BiomeDef: Sync {
    fn data(&self) -> BiomeData;

    fn id(&self) -> Biome {
        self.data().id
    }

    /// The kit pieces the biome scatters, by registry id.
    fn kit_pieces(&self) -> Vec<&'static str> {
        let mut ids: Vec<&'static str> = self
            .data()
            .scatter
            .pieces
            .iter()
            .map(|p| p.kit_piece)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }
}

/// The definition for a biome id.
pub fn def(biome: Biome) -> &'static dyn BiomeDef {
    match biome {
        Biome::Greybox => &greybox::Greybox,
        Biome::Town => &town::Town,
        Biome::Rocks => &rocks::Rocks,
        Biome::OutbackDirt => &dirt::OutbackDirt,
        Biome::OutbackBitumen => &bitumen::OutbackBitumen,
    }
}

/// Every biome id with a definition.
pub const ALL: [Biome; 5] = [
    Biome::Greybox,
    Biome::Town,
    Biome::OutbackBitumen,
    Biome::OutbackDirt,
    Biome::Rocks,
];

/// Stand-ins for P1-R10's `assets/kit/wayfinding/` entries (same ids; R10's files replace these). Compiled in so the
/// core and its tests validate generated maps without waiting for the render track.
pub const WAYFINDING_PIECES: [(&str, &str); 3] = [
    (
        "wayfinding/chevron-post",
        include_str!("../../kit/wayfinding/chevron-post.json"),
    ),
    (
        "wayfinding/finish-gantry",
        include_str!("../../kit/wayfinding/finish-gantry.json"),
    ),
    (
        "wayfinding/guard-rail",
        include_str!("../../kit/wayfinding/guard-rail.json"),
    ),
];

/// The registry generated maps validate against: the generic kit plus the wayfinding family.
pub fn registry() -> Registry {
    Registry::from_json(
        GENERIC_PIECES
            .iter()
            .chain(WAYFINDING_PIECES.iter())
            .map(|(id, json)| (*id, json.as_bytes())),
    )
}

/// The data checks any biome must pass (a biome task runs this on its own [`BiomeData`]): a real road surface, positive
/// terrain limits, a feature mix, and a weighted piece list whose every piece is in `registry` with parameters inside the
/// kit's ranges, setbacks that start at or beyond the scatter's clearance and a footprint the registry can resolve.
pub fn check_data(data: &BiomeData, registry: &Registry) -> Vec<String> {
    let mut bad = Vec::new();
    let name = format!("{:?}", data.id);
    if data.road == Surface::OffTrack {
        bad.push(format!("{name}: the road can't be off-track"));
    }
    let t = &data.terrain;
    if t.relief_m <= 0.0
        || t.wavelength_m <= 0.0
        || t.max_grade <= 0.0
        || t.max_curvature <= 0.0
        || t.blend_m <= 0.0
    {
        bad.push(format!("{name}: terrain limits must be positive"));
    }
    let f = &data.features;
    if [f.jump, f.crest, f.whoops, f.creek]
        .iter()
        .any(|d| *d < 0.0)
    {
        bad.push(format!("{name}: a negative feature density"));
    }
    if data.scatter.pieces.is_empty()
        || data.scatter.pieces.iter().map(|p| p.weight).sum::<f64>() <= 0.0
    {
        bad.push(format!("{name}: the scatter needs weighted pieces"));
    }
    for p in data.scatter.pieces {
        let Some(kit) = registry.get(p.kit_piece) else {
            bad.push(format!("{name}: {} isn't in the registry", p.kit_piece));
            continue;
        };
        if p.weight <= 0.0 || p.setback_m.0 < 0.0 || p.setback_m.1 < p.setback_m.0 {
            bad.push(format!(
                "{name}: {} has weight {} and setback {:?}",
                p.kit_piece, p.weight, p.setback_m
            ));
        }
        for &(key, lo, hi) in p.params {
            match kit.params.get(key) {
                Some(spec) if spec.min <= lo && lo <= hi && hi <= spec.max => {}
                other => bad.push(format!(
                    "{name}: {} {key} {lo}..={hi} outside the kit's {other:?}",
                    p.kit_piece
                )),
            }
        }
    }
    bad
}
