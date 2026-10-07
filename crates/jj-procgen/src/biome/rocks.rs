//! Rocks, the Olgas (placeholder data until P1-M06): big domes in clumps beside a packed-dirt road.

use jj_map::{Biome, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::scatter::{Algorithm, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct Rocks;

const PIECES: &[PieceSpec] = &[
    piece(
        "generic/box-building",
        3.0,
        &[
            ("widthMm", 18_000, 42_000),
            ("depthMm", 16_000, 36_000),
            ("heightCm", 900, 2_400),
        ],
        (18.0, 90.0),
        true,
    ),
    piece(
        "generic/post",
        2.0,
        &[("heightCm", 80, 200), ("radiusMm", 300, 600)],
        (4.0, 40.0),
        true,
    ),
];

impl BiomeDef for Rocks {
    fn data(&self) -> BiomeData {
        BiomeData {
            id: Biome::Rocks,
            road: Surface::PackedDirt,
            ground: Surface::OffTrack,
            terrain: TerrainParams {
                relief_m: 10.0,
                ground_relief_m: 10.0,
                wavelength_m: 80.0,
                max_grade: 0.06,
                max_curvature: 0.0040,
                max_bank_cdeg: 600,
                blend_m: 20.0,
            },
            features: Density {
                jump: 2.5,
                crest: 2.0,
                whoops: 1.0,
                creek: 0.0,
            },
            scatter: Spec {
                algorithm: Algorithm::Cluster {
                    parent_radius_m: 150.0,
                    children: (10, 30),
                    sigma_m: 22.0,
                },
                pieces: PIECES,
            },
            segment_types: &[],
        }
    }
}
