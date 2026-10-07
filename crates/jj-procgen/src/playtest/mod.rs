//! The Playtest-1 recipe (P1-M08b, R83): every generated race track runs through town, rocks, outback dirt and outback
//! bitumen, in that order, with validated transitions between them, including the dirt to bitumen junction, and the lap
//! ends back in town (the lap's seam stays inside one biome, see [`crate::biome::select`]).
//!
//! The recipe is the fallback ladder's first choice and it gets more course draws than the default so that a track keeps
//! all four biomes: [`PLAYTEST_DRAWS`] fresh courses before the ladder starts dropping biomes (which the seed bank
//! reports and the tests forbid for the pinned seeds).

use jj_map::{Biome, Map};

use crate::validate::{Prepared, prepare_with};

/// The four biomes, in lap order.
pub const RECIPE: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];

/// The same recipe as `jj-wasm-procgen` takes it.
pub const RECIPE_NAMES: &str = "town,rocks,outback-dirt,outback-bitumen";

/// Course draws tried with all four biomes before the ladder falls back (each is tens of milliseconds).
pub const PLAYTEST_DRAWS: u32 = 8;

/// The seed's Playtest-1 track.
pub fn prepare(seed: u64) -> Prepared {
    prepare_with(seed, &RECIPE, PLAYTEST_DRAWS)
}

/// Whether the map's route runs through all four biomes, with the dirt to bitumen junction in lap order.
pub fn has_all_four(map: &Map) -> bool {
    let names: Vec<&str> = map.route.segments.iter().map(|s| s.name.as_str()).collect();
    let lap: Vec<String> = RECIPE
        .iter()
        .map(|b| crate::biome::segment_name(*b))
        .collect();
    // Town, rocks, dirt, bitumen, then back to town: the dirt segment is followed directly by the bitumen one.
    names.len() == 5 && names[..4].iter().zip(&lap).all(|(a, b)| *a == b) && names[4] == lap[0]
}
