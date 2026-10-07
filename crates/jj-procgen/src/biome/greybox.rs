//! The placeholder biome (P1-M03f): a tarmac road over gentle ground with the generic kit, so the procgen core is
//! testable alone. Pure data, like every biome.

use jj_map::{Biome, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::scatter::{Algorithm, BITUMEN_RADIUS_M, Spec, piece};
use crate::terrain::TerrainParams;

pub struct Greybox;

const PIECES: &[crate::scatter::PieceSpec] = &[
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

impl BiomeDef for Greybox {
    fn data(&self) -> BiomeData {
        BiomeData {
            id: Biome::Greybox,
            road: Surface::Tarmac,
            ground: Surface::OffTrack,
            terrain: TerrainParams {
                relief_m: 2.0,
                ground_relief_m: 2.0,
                wavelength_m: 100.0,
                max_grade: 0.03,
                max_curvature: 0.0020,
                max_bank_cdeg: 200,
                blend_m: 20.0,
            },
            features: Density {
                jump: 2.0,
                crest: 1.5,
                whoops: 1.5,
                creek: 1.0,
            },
            scatter: Spec {
                algorithm: Algorithm::Poisson {
                    radius_m: BITUMEN_RADIUS_M,
                },
                pieces: PIECES,
            },
            lineside: &[],
            signs: &[],
            segment_types: &[],
        }
    }
}
