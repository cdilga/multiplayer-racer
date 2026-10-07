//! Town (placeholder data until P1-M04): buildings in clumps along a tarmac road.

use jj_map::{Biome, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::scatter::{Algorithm, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct Town;

const PIECES: &[PieceSpec] = &[
    piece(
        "generic/box-building",
        5.0,
        &[
            ("widthMm", 8_000, 18_000),
            ("depthMm", 6_000, 12_000),
            ("heightCm", 350, 900),
        ],
        (3.0, 150.0),
        true,
    ),
    piece(
        "generic/post",
        2.0,
        &[("heightCm", 400, 700), ("radiusMm", 130, 200)],
        (3.0, 6.0),
        true,
    ),
];

impl BiomeDef for Town {
    fn data(&self) -> BiomeData {
        BiomeData {
            id: Biome::Town,
            road: Surface::Tarmac,
            ground: Surface::OffTrack,
            terrain: TerrainParams {
                relief_m: 3.0,
                ground_relief_m: 3.0,
                wavelength_m: 60.0,
                max_grade: 0.03,
                max_curvature: 0.0020,
                max_bank_cdeg: 200,
                blend_m: 20.0,
            },
            features: Density {
                jump: 0.0,
                crest: 1.0,
                whoops: 0.0,
                creek: 0.0,
            },
            scatter: Spec {
                algorithm: Algorithm::Cluster {
                    parent_radius_m: 120.0,
                    children: (10, 30),
                    sigma_m: 14.0,
                },
                pieces: PIECES,
            },
            segment_types: &[],
        }
    }
}
