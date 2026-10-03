//! The `jj.map.v1` document (plan §8.1): one format for authored and generated maps.
//!
//! Integers only, so canonical bytes are the same on every target: positions in millimetres (`i32`), terrain heights in
//! centimetres (`i16`), angles in centidegrees. The JSON form (camelCase, unknown fields rejected) is for authoring; the
//! canonical form is the postcard encoding of the validated, sorted struct (`crate::canon`).
//!
//! Every field is always encoded (no skipped options): postcard isn't self-describing, so a skipped field would break
//! decoding of the canonical bytes the sim worker receives (`MainToSim::Init.map_bytes`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The version string every `jj.map.v1` document carries.
pub const MAP_VERSION: &str = "jj.map.v1";

/// Integer parameters for a feature, dressing piece or prop (sorted by name, so canonical).
pub type Params = BTreeMap<String, i64>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Map {
    pub header: Header,
    pub terrain: Terrain,
    pub route: Route,
    #[serde(default)]
    pub features: Vec<Feature>,
    #[serde(default)]
    pub dressing: Vec<Dressing>,
    #[serde(default)]
    pub props: Vec<Prop>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Header {
    /// Always [`MAP_VERSION`].
    pub version: String,
    pub generator: Generator,
    pub seed: u64,
    pub biomes: Vec<Biome>,
    pub bounds: Bounds,
    /// The reference lap: authored for the greybox; route length ÷ 15 m/s for a generated track (DEFAULT, TUNE).
    pub ref_lap_ms: u32,
    /// Hex SHA-256 of the canonical bytes (which carry this field as `None`); checked when present.
    #[serde(default)]
    pub gameplay_hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Generator {
    pub id: String,
    pub version: String,
}

/// The four Playtest-1 biomes (R83) and the placeholder the greybox and procgen core use.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Biome {
    Greybox,
    Town,
    Rocks,
    OutbackDirt,
    OutbackBitumen,
}

/// The playable area in plan view, and the kill height below which a car is out of bounds (§7.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    pub min_x: i32,
    pub min_z: i32,
    pub max_x: i32,
    pub max_z: i32,
    pub kill_y: i32,
}

/// Ground surface classes (`u8` on the terrain grid).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Surface {
    Tarmac,
    PackedDirt,
    Gravel,
    Rock,
    OffTrack,
}

/// A regular heightfield plus a surface grid, row-major from `origin` (x along columns, z along rows).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Terrain {
    pub origin_x: i32,
    pub origin_z: i32,
    pub spacing: u32,
    pub cols: u32,
    pub rows: u32,
    /// `rows × cols` heights, centimetres.
    pub heights: Vec<i16>,
    /// `rows × cols` surface classes.
    pub surfaces: Vec<Surface>,
}

/// A point on the route's centerline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutePoint {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    /// Full drivable width, mm.
    pub width: u32,
    /// Bank, centidegrees (positive leans the road toward its left).
    pub bank: i16,
    pub surface: Surface,
}

/// A checkpoint gate across the route at a centerline point. Exactly one is the finish line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Gate {
    pub at: u32,
    pub finish: bool,
}

/// The start-grid rule (§7.5): a corridor of `length` back along the route from point `at`, `width` wide, with rows
/// every `row_spacing` and columns every `column_spacing`. Placement fills it for any N (no cap): once it's full,
/// further cars go in it anyway under spawn protection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartCorridor {
    pub at: u32,
    pub length: u32,
    pub width: u32,
    pub row_spacing: u32,
    pub column_spacing: u32,
}

/// A run of centerline points `from..=to` (wrapping past the end on a closed route when `from > to`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Span {
    pub from: u32,
    pub to: u32,
}

/// A named run of the route (duel segments: `hairpin`, `s-bend`, `straight`…), so fixtures find them by name.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Segment {
    pub name: String,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Route {
    /// A loop (the last point joins the first) or a point-to-point route.
    pub closed: bool,
    pub points: Vec<RoutePoint>,
    pub gates: Vec<Gate>,
    pub start: StartCorridor,
    /// Where respawn anchors may go (§7.5); a jump's flight and landing are left out.
    pub recovery: Vec<Span>,
    #[serde(default)]
    pub segments: Vec<Segment>,
}

/// A world pose: position (mm) and heading about +y (centidegrees, 0 = +x, counter-clockwise seen from above).
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pose {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub yaw: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FeatureKind {
    /// A ramp (pose = the ramp's base, facing along the route) and its landing envelope. Params: `rampLengthMm`,
    /// `rampWidthMm`, `lipHeightCm`, `landingLengthMm`, `landingWidthMm`.
    Jump,
    Crest,
    Whoops,
    CreekDip,
    /// A low strip across the road (the wheelie-hop duel). Params: `heightCm`, `depthMm`.
    Kerb,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Feature {
    pub kind: FeatureKind,
    pub pose: Pose,
    #[serde(default)]
    pub params: Params,
}

/// A static piece from the kit-piece registry. `collides` pieces get the registry's collider proxy in the sim.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dressing {
    pub kit_piece: String,
    pub pose: Pose,
    #[serde(default)]
    pub params: Params,
    pub collides: bool,
}

/// An initial dynamic prop (cones, bins): knocked about in the round, never removed (debris rule).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prop {
    pub kit_piece: String,
    pub pose: Pose,
    #[serde(default)]
    pub params: Params,
}
