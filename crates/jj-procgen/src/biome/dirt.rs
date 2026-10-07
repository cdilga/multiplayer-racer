//! Outback dirt (P1-M06, playtest scope): a winding graded red-dirt track through spinifex and desert oak; two vegetation
//! species scattered clear of the route; straight and curve segments only (the core's course); a driveable normal line.
//! An unsealed-road warning where it begins and a warning before each crest.

use jj_map::{Biome, FeatureKind, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::lineside::{SignRule, Trigger};
use crate::scatter::{Algorithm, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct OutbackDirt;

/// The two species: a spinifex tussock (even cover) and one tree.
const SCATTER: &[PieceSpec] = &[
    piece(
        "outback_dirt/spinifex",
        9.0,
        &[("radiusMm", 300, 900), ("heightCm", 30, 100)],
        (3.0, 140.0),
        false,
    ),
    piece(
        "outback_dirt/desert-oak",
        1.0,
        &[("radiusMm", 1_200, 2_600), ("heightCm", 350, 800)],
        (4.0, 140.0),
        false,
    ),
];

const SIGNS: &[SignRule] = &[
    SignRule {
        kit_piece: "signs/unsealed-road",
        trigger: Trigger::BiomeEntry,
        before_m: 0.0,
        offset_m: 3.0,
    },
    SignRule {
        kit_piece: "signs/crest",
        trigger: Trigger::Feature(FeatureKind::Crest),
        before_m: 70.0,
        offset_m: 3.0,
    },
];

impl BiomeDef for OutbackDirt {
    fn data(&self) -> BiomeData {
        BiomeData {
            id: Biome::OutbackDirt,
            road: Surface::PackedDirt,
            ground: Surface::OffTrack,
            terrain: TerrainParams {
                relief_m: 5.0,
                ground_relief_m: 5.0,
                wavelength_m: 120.0,
                max_grade: 0.05,
                max_curvature: 0.0030,
                max_bank_cdeg: 500,
                blend_m: 20.0,
            },
            features: Density {
                jump: 2.0,
                crest: 1.0,
                whoops: 2.0,
                creek: 1.5,
            },
            scatter: Spec {
                algorithm: Algorithm::Poisson { radius_m: 6.5 },
                pieces: SCATTER,
            },
            lineside: &[],
            signs: SIGNS,
            segment_types: &[],
        }
    }
}
