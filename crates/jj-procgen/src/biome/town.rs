//! Town (P1-M04, playtest scope): flat wide streets, one parametric weatherboard house and one parametric shopfront
//! facing the street, power poles, mailboxes, wheelie bins (out or not), side streets (simple junctions), gum trees and
//! the water tower; tarmac road. A direction sign at each junction, a warning before each crest and one where the town
//! begins. Pure data: the lineside engine places the street, scatter fills the gum trees.

use jj_map::{Biome, FeatureKind, Surface};

use super::{BiomeData, BiomeDef};
use crate::features::Density;
use crate::lineside::{Anchor, Lineside, Side, SignRule, Trigger, Yaw};
use crate::scatter::{Algorithm, PieceSpec, Spec, piece};
use crate::terrain::TerrainParams;

pub struct Town;

/// Gum trees everywhere (never colliding: the collider is the canopy) and, rarely, the water tower.
const SCATTER: &[PieceSpec] = &[
    piece(
        "town/gum-tree",
        12.0,
        &[("heightCm", 500, 1100), ("radiusMm", 1800, 3400)],
        (3.0, 150.0),
        false,
    ),
    piece(
        "town/water-tower",
        0.12,
        &[("heightCm", 700, 1100), ("radiusMm", 1600, 2800)],
        (14.0, 120.0),
        true,
    ),
];

const fn rule(
    kit_piece: &'static str,
    spacing_m: (f64, f64),
    side: Side,
    offset_m: (f64, f64),
) -> Lineside {
    Lineside {
        kit_piece,
        spacing_m,
        side,
        anchor: Anchor::Edge,
        offset_m,
        params: &[],
        collides: false,
        yaw: Yaw::FaceRoad,
        skip: 0.0,
        avoid_corners: true,
        stretch: None,
        prop: false,
        link: None,
    }
}

const STREET: &[Lineside] = &[
    // Side streets first, so the houses leave them their room.
    Lineside {
        yaw: Yaw::Across,
        params: &[("lengthMm", 24_000, 40_000), ("widthMm", 7_000, 9_000)],
        ..rule("town/side-street", (110.0, 190.0), Side::Either, (0.0, 0.0))
    },
    Lineside {
        collides: true,
        skip: 0.35,
        params: &[
            ("widthMm", 9_000, 13_000),
            ("depthMm", 7_000, 9_000),
            ("heightCm", 420, 520),
        ],
        ..rule("town/shopfront", (40.0, 70.0), Side::Both, (5.0, 7.0))
    },
    Lineside {
        collides: true,
        skip: 0.2,
        params: &[
            ("widthMm", 6_000, 11_000),
            ("depthMm", 5_000, 8_000),
            ("heightCm", 300, 420),
            ("roofPitchDeg", 18, 32),
        ],
        ..rule("town/house", (13.0, 21.0), Side::Both, (6.0, 9.0))
    },
    Lineside {
        collides: true,
        yaw: Yaw::Random,
        params: &[("heightCm", 750, 850), ("radiusMm", 140, 170)],
        // Poles in a line with a power line strung between each pair (a crossarm and three sagging wires).
        link: Some("town/power-line"),
        ..rule("town/power-pole", (38.0, 46.0), Side::Right, (3.8, 4.4))
    },
    Lineside {
        skip: 0.4,
        ..rule("town/mailbox", (30.0, 60.0), Side::Both, (2.6, 3.2))
    },
    // A wheelie bin out for collection or not: the town's only per-instance variation (a dynamic prop).
    Lineside {
        skip: 0.45,
        prop: true,
        link: None,
        yaw: Yaw::Random,
        ..rule("generic/bin", (22.0, 40.0), Side::Both, (3.2, 5.0))
    },
];

const SIGNS: &[SignRule] = &[
    SignRule {
        kit_piece: "signs/junction",
        trigger: Trigger::Junction,
        before_m: 14.0,
        offset_m: 3.0,
    },
    SignRule {
        kit_piece: "signs/crest",
        trigger: Trigger::Feature(FeatureKind::Crest),
        before_m: 70.0,
        offset_m: 3.0,
    },
    SignRule {
        kit_piece: "signs/kangaroo",
        trigger: Trigger::BiomeEntry,
        before_m: 0.0,
        offset_m: 3.0,
    },
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
                algorithm: Algorithm::Poisson { radius_m: 24.0 },
                pieces: SCATTER,
            },
            lineside: STREET,
            signs: SIGNS,
            segment_types: &[],
        }
    }
}
