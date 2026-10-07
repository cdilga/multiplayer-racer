//! Rocks, the Olgas (P1-M05, playtest scope): one parametric dome family, towering, with a seeded height and footprint
//! scale; ledges and stacks are the same rule at a smaller scale; a packed-dirt road with climbs and jumps from the core's
//! features; sparse spinifex and flowering shrubs. A steep-descent warning before each jump and a landmark sign at the entry.

use jj_map::{Biome, FeatureKind, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::lineside::{Anchor, Lineside, Side, SignRule, Trigger, Yaw};
use crate::scatter::{Algorithm, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct Rocks;

const SCATTER: &[PieceSpec] = &[
    piece(
        "rocks/spinifex",
        6.0,
        &[("radiusMm", 300, 900), ("heightCm", 30, 100)],
        (3.0, 120.0),
        false,
    ),
    piece(
        "rocks/shrub",
        1.5,
        &[("radiusMm", 400, 1200), ("heightCm", 50, 160)],
        (3.0, 120.0),
        false,
    ),
];

const DOMES: &[Lineside] = &[
    // The towers: tall and towering is the point. Radius and height are seeded draws from the dressing stream.
    Lineside {
        kit_piece: "rocks/dome",
        spacing_m: (26.0, 60.0),
        side: Side::Both,
        anchor: Anchor::Edge,
        offset_m: (6.0, 38.0),
        params: &[("radiusMm", 9_000, 36_000), ("heightCm", 3_000, 9_000)],
        collides: true,
        yaw: Yaw::Random,
        skip: 0.1,
        avoid_corners: false,
        stretch: None,
        prop: false,
    },
    // Ledges and stacks: the same rule at a smaller scale, close to the track.
    Lineside {
        kit_piece: "rocks/dome",
        spacing_m: (10.0, 26.0),
        side: Side::Both,
        anchor: Anchor::Edge,
        offset_m: (3.0, 14.0),
        params: &[("radiusMm", 3_000, 7_000), ("heightCm", 1_200, 2_800)],
        collides: true,
        yaw: Yaw::Random,
        skip: 0.25,
        avoid_corners: true,
        stretch: None,
        prop: false,
    },
];

const SIGNS: &[SignRule] = &[
    SignRule {
        kit_piece: "signs/steep-descent",
        trigger: Trigger::Feature(FeatureKind::Jump),
        before_m: 60.0,
        offset_m: 3.0,
    },
    SignRule {
        kit_piece: "signs/big-red-rock",
        trigger: Trigger::BiomeEntry,
        before_m: 0.0,
        offset_m: 3.0,
    },
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
                algorithm: Algorithm::Poisson { radius_m: 11.0 },
                pieces: SCATTER,
            },
            lineside: DOMES,
            signs: SIGNS,
            segment_types: &[],
        }
    }
}
