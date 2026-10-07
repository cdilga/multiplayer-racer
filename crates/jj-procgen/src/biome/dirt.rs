//! Outback dirt (placeholder data until P1-M07): open plain, even scrub, a packed-dirt road.

use jj_map::{Biome, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::scatter::{Algorithm, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct OutbackDirt;

const PIECES: &[PieceSpec] = &[
    piece(
        "generic/post",
        6.0,
        &[("heightCm", 60, 160), ("radiusMm", 250, 550)],
        (3.0, 70.0),
        false,
    ),
    piece(
        "generic/box-building",
        0.3,
        &[
            ("widthMm", 6_000, 10_000),
            ("depthMm", 5_000, 8_000),
            ("heightCm", 300, 450),
        ],
        (20.0, 60.0),
        true,
    ),
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
                algorithm: Algorithm::Poisson { radius_m: 9.0 },
                pieces: PIECES,
            },
            segment_types: &[],
        }
    }
}
