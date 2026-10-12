//! The Playtest-1 track mix (P1-M08b, R83; R125 withdrew the all-four rule): each seed draws one to four biomes from
//! the pool, uniformly and in any order, by the data's mix weights ([`GeneratorData::draw_mix`]); the lap ends back in
//! the first biome (the lap's seam stays inside one biome, see [`crate::biome::select`]), with validated transitions
//! between them.
//!
//! Each track is given [`PLAYTEST_DRAWS`] fresh course draws before the ladder starts dropping biomes (which the seed
//! bank reports).

use jj_map::Biome;

use crate::tuning::GeneratorData;
use crate::validate::{Prepared, prepare_tuned};

/// The biomes a track may draw from, any of them alone.
pub const POOL: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];

/// Course draws tried with the seed's biomes before the ladder falls back (each is tens of milliseconds).
pub const PLAYTEST_DRAWS: u32 = 8;

/// The seed's Playtest-1 track from the shipped generator data.
pub fn prepare(seed: u64) -> Prepared {
    prepare_data(seed, GeneratorData::shipped())
}

/// The seed's track from explicit generator data: its biome mix is drawn per seed.
pub fn prepare_data(seed: u64, data: &GeneratorData) -> Prepared {
    prepare_tuned(seed, &data.draw_mix(seed), PLAYTEST_DRAWS, data)
}
