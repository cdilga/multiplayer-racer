//! Outback bitumen (P1-M07, playtest scope): a sealed highway across flat red country: yellow centre dashes as placed pieces
//! (the white edge line is the road ribbon's own), guide posts every 50 m, the shared W-beam guard rail in short runs (culvert ends), spinifex
//! beyond the verge. A direction sign where it begins and a warning before each crest or jump.

use jj_map::{Biome, FeatureKind, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::lineside::{Anchor, Lineside, Side, SignRule, Trigger, Yaw};
use crate::scatter::{Algorithm, BITUMEN_RADIUS_M, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct OutbackBitumen;

const SCATTER: &[PieceSpec] = &[
    piece(
        "outback_dirt/spinifex",
        8.0,
        &[("radiusMm", 300, 900), ("heightCm", 30, 100)],
        (4.0, 100.0),
        false,
    ),
    piece(
        "generic/box-building",
        0.25,
        &[
            ("widthMm", 6_000, 12_000),
            ("depthMm", 5_000, 9_000),
            ("heightCm", 300, 500),
        ],
        (25.0, 70.0),
        true,
    ),
];

const fn line(kit_piece: &'static str, side: Side, offset: f64) -> Lineside {
    Lineside {
        kit_piece,
        spacing_m: (3.0, 3.0),
        side,
        anchor: Anchor::Centre,
        offset_m: (offset, offset),
        params: &[("lengthMm", 3_000, 3_000)],
        collides: false,
        yaw: Yaw::Along,
        skip: 0.0,
        avoid_corners: false,
        stretch: None,
        prop: false,
        link: None,
    }
}

const ROAD: &[Lineside] = &[
    // Yellow centre dashes: 3 m on, 6 m off (a 3 m piece every 9 m).
    Lineside {
        spacing_m: (9.0, 9.0),
        ..line("outback_bitumen/centre-line", Side::Right, 0.0)
    },
    // Guide posts every 50 m, both sides.
    Lineside {
        spacing_m: (50.0, 50.0),
        anchor: Anchor::Edge,
        offset_m: (2.6, 2.6),
        params: &[],
        yaw: Yaw::Random,
        avoid_corners: true,
        ..line("outback_bitumen/reflector-post", Side::Both, 0.0)
    },
    // Short runs of the shared W-beam rail at culvert ends: 24 m of rail every 160 m, both sides.
    Lineside {
        kit_piece: "wayfinding/guard-rail",
        spacing_m: (4.0, 4.0),
        side: Side::Both,
        anchor: Anchor::Edge,
        offset_m: (3.6, 3.6),
        params: &[
            ("lengthMm", 4_000, 4_000),
            ("heightCm", 80, 80),
            ("thicknessMm", 300, 300),
        ],
        collides: true,
        yaw: Yaw::Along,
        skip: 0.0,
        avoid_corners: true,
        stretch: Some((24.0, 136.0)),
        prop: false,
        link: None,
    },
];

const SIGNS: &[SignRule] = &[
    SignRule {
        kit_piece: "signs/stuart-hwy",
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
    SignRule {
        kit_piece: "signs/jumps-crest",
        trigger: Trigger::Feature(FeatureKind::Jump),
        before_m: 60.0,
        offset_m: 3.0,
    },
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
                pieces: SCATTER,
            },
            lineside: ROAD,
            signs: SIGNS,
            segment_types: &[],
        }
    }
}
