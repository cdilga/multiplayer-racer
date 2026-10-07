//! Outback bitumen (placeholder data until P1-M07): a sealed road through flat country, fence posts and the odd shed.

use jj_map::{Biome, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::scatter::{Algorithm, BITUMEN_RADIUS_M, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct OutbackBitumen;

const PIECES: &[PieceSpec] = &[
    piece(
        "generic/post",
        4.0,
        &[("heightCm", 100, 140), ("radiusMm", 60, 90)],
        (4.0, 8.0),
        false,
    ),
    piece(
        "generic/box-building",
        0.6,
        &[
            ("widthMm", 6_000, 12_000),
            ("depthMm", 5_000, 9_000),
            ("heightCm", 300, 500),
        ],
        (25.0, 70.0),
        true,
    ),
    piece(
        "generic/post",
        3.0,
        &[("heightCm", 50, 120), ("radiusMm", 250, 500)],
        (8.0, 80.0),
        false,
    ),
];

impl BiomeDef for OutbackBitumen {
    fn data(&self) -> BiomeData {
        BiomeData {
            id: Biome::OutbackBitumen,
            road: Surface::Tarmac,
            ground: Surface::OffTrack,
            terrain: TerrainParams {
                relief_m: 4.0,
                ground_relief_m: 4.0,
                wavelength_m: 220.0,
                max_grade: 0.035,
                max_curvature: 0.0015,
                max_bank_cdeg: 400,
                blend_m: 24.0,
            },
            features: Density {
                jump: 0.5,
                crest: 2.0,
                whoops: 0.0,
                creek: 1.0,
            },
            scatter: Spec {
                algorithm: Algorithm::Poisson {
                    radius_m: BITUMEN_RADIUS_M,
                },
                pieces: PIECES,
            },
            segment_types: &[],
        }
    }
}
