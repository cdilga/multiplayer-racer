//! Set pieces stamped into the landscape (R132, P1-FL15b): big parametric landforms that own the terrain in their
//! footprint, placed as beats along the course after the terrain is generated and before the small features.
//!
//! The family is the **gap leap** ([`jj_map::setpiece`] is the map contract): the road climbs a channel to a
//! full-road-width kicker, a pit opens in front of it, the far rim is the landing, and a safe dirt detour leaves the
//! road before the channel (the commitment point) and rejoins after the landing, so the jump is a choice (R129).
//!
//! - **Canyon leap** (the Olgas reference, `art/references/australia/generated/biome-rocks-olgas.png`): rock walls both
//!   sides of the channel, a crack through the rock, an Olgas dome beside it seen from afar.
//! - **Mesa drop**: the road climbs onto a mesa and leaps off its breakaway edge to the plain below; a butte marks it.
//! - **Creek washout**: a washed-out creek crossing; the leap clears the gully, the detour fords it.
//!
//! Everything a piece is comes from `assets/profiles/set-pieces.json` ([`validate_data`] checks it). A site is a route
//! point with a straight enough core (kicker to the end of the landing) and room for the approach and run-out inside
//! one biome's range; the piece's road profile replaces the terrain's along its span, and the ground in its footprint is
//! sculpted from (u, lat) in the route's frame. Every placed piece is then checked by [`jj_map::setpiece::problems`]
//! against the stamped heightfield (the ballistic landing band, the pit, the straight core): a piece that fails is
//! undone and another site is tried, so a placed piece is landable by construction. Placement draws from its own
//! stream (`set-pieces`), so it moves nothing else. No count caps: the count is the data's density per km, with a
//! minimum per lap.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use jj_map::setpiece::{self, GapLeap, PieceKind, smoothstep};
use jj_map::{Biome, Feature, FeatureKind, Gate, Map, Pose, Surface};
use serde::Deserialize;

use crate::assemble::{FINISH_AT_M, arc_lengths};
use crate::seed::Rng;

const SHIPPED: &str = include_str!("../../../../assets/profiles/set-pieces.json");

/// The set-piece data file.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Data {
    pub schema: String,
    pub note: String,
    /// Fewest pieces on a lap (a minimum, never a maximum).
    pub min_per_lap: u32,
    /// Expected pieces per km beyond the minimum.
    pub per_km: f64,
    /// Clear road between two pieces, m.
    pub spacing_m: f64,
    /// Speed the sight check assumes on the road before the commitment point, m/s.
    pub sight_speed_mps: f64,
    /// A piece's landmark is in the chase camera's view for at least this long in the last `sightWindowS` before the
    /// commitment point, s (corners swing it out of frame for a moment; it's seen, not stared at).
    pub min_sight_s: f64,
    pub sight_window_s: f64,
    /// The sight check's eye: the mid chase camera's place behind and above the car (assets/profiles/camera.json), and
    /// half its horizontal view on a 16:9 screen, degrees.
    pub sight_eye_back_m: f64,
    pub sight_eye_up_m: f64,
    pub sight_half_angle_deg: f64,
    /// The pieces each biome draws from (repeats weight a kind).
    pub biomes: BTreeMap<String, Vec<String>>,
    pub pieces: BTreeMap<String, PieceData>,
}

/// One kind's parameters. `[a, b]` pairs are draw ranges; lengths and heights m; speeds m/s.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PieceData {
    /// Commitment point (detour split) to the kicker's base.
    pub approach_m: [f64; 2],
    /// Rise of the take-off ground above the road at the commitment point (negative: the approach descends).
    pub climb_m: [f64; 2],
    pub ramp_m: [f64; 2],
    pub lip_m: [f64; 2],
    pub blend_m: f64,
    pub gap_m: [f64; 2],
    pub pit_depth_m: [f64; 2],
    /// The far rim below the take-off ground (negative: above it, at most level with the lip).
    pub rim_drop_m: [f64; 2],
    /// The landing's downhill slope from the rim.
    pub landing_slope: f64,
    /// Landing end back to the terrain's own profile.
    pub runout_m: f64,
    /// Channel walls above the road (0: a plateau, the mesa).
    pub wall_height_m: [f64; 2],
    /// Width of the walls (or the plateau's shoulder) beside the road.
    pub wall_width_m: f64,
    /// How far before the kicker's base the walls (or the plateau) begin.
    pub wall_from_m: f64,
    /// The landmark (dome, butte, tor) seen from afar beside the lip, on the side away from the detour.
    pub landmark_height_m: [f64; 2],
    pub landmark_radius_m: f64,
    /// How far the pit reaches past the walls on the side away from the detour.
    pub pit_far_m: f64,
    pub detour_offset_m: f64,
    pub detour_width_m: f64,
    /// The detour dips this deep through the gap (a ford), 0 for none.
    pub ford_depth_m: f64,
    /// A car leaving the lip anywhere in this band lands on the far side.
    pub speed_band: [f64; 2],
    pub pit_surface: Surface,
    pub wall_surface: Surface,
}

/// The shipped data, parsed once.
pub fn shipped() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(SHIPPED).expect("assets/profiles/set-pieces.json parses")
    })
}

/// Problems with the data: unknown kinds or biomes, inverted ranges, impossible numbers. Empty when it's sound.
pub fn validate_data(d: &Data) -> Vec<String> {
    let mut out = Vec::new();
    if d.schema != "jj.setpieces.v1" {
        out.push(format!("schema {:?}", d.schema));
    }
    if d.per_km < 0.0 || d.spacing_m < 0.0 || d.sight_speed_mps <= 0.0 || d.min_sight_s < 0.0 {
        out.push(
            "perKm, spacingM, sightSpeedMps and minSightS must be non-negative (speed positive)"
                .into(),
        );
    }
    for (b, kinds) in &d.biomes {
        if biome_of(b).is_none() {
            out.push(format!("biomes: unknown biome {b:?}"));
        }
        for k in kinds {
            if kind_of(k).is_none() || !d.pieces.contains_key(k) {
                out.push(format!("biomes.{b}: unknown piece {k:?}"));
            }
        }
    }
    for (name, p) in &d.pieces {
        if kind_of(name).is_none() {
            out.push(format!("pieces: unknown kind {name:?}"));
        }
        let ranges = [
            ("approachM", p.approach_m),
            ("rampM", p.ramp_m),
            ("lipM", p.lip_m),
            ("gapM", p.gap_m),
            ("pitDepthM", p.pit_depth_m),
            ("wallHeightM", p.wall_height_m),
            ("landmarkHeightM", p.landmark_height_m),
            ("speedBand", p.speed_band),
        ];
        for (k, [a, b]) in ranges {
            if !(a.is_finite() && b.is_finite() && a <= b && a >= 0.0) {
                out.push(format!("{name}.{k}: [{a}, {b}] is not a range"));
            }
        }
        // The approach may climb or descend (a canyon cut into a hill); the far rim may stand above the take-off ground
        // (level with the lip: a short fall, a landing aligned with the car) or below it (the mesa's drop).
        for (k, [a, b]) in [("climbM", p.climb_m), ("rimDropM", p.rim_drop_m)] {
            if !(a.is_finite() && b.is_finite() && a <= b) {
                out.push(format!("{name}.{k}: [{a}, {b}] is not a range"));
            }
        }
        if -p.rim_drop_m[0] > p.lip_m[0] {
            out.push(format!(
                "{name}.rimDropM: the far rim would stand above the lip"
            ));
        }
        if p.lip_m[1] * 100.0 > jj_map::limits::MAX_LIP_HEIGHT_CM as f64 {
            out.push(format!("{name}.lipM above the map's highest lip"));
        }
        if p.pit_depth_m[0] * 100.0 < setpiece::limits::MIN_PIT_DEPTH_CM as f64 {
            out.push(format!("{name}.pitDepthM shallower than a pit"));
        }
        if p.blend_m <= 0.0 || p.blend_m >= p.ramp_m[0] {
            out.push(format!("{name}.blendM must be inside the ramp"));
        }
        if p.approach_m[0] < p.wall_from_m + 10.0 || p.approach_m[0] < setpiece::DETOUR_TURN_M {
            out.push(format!(
                "{name}.approachM too short for its walls and the detour's turn"
            ));
        }
        if p.detour_offset_m < 6.0 + p.wall_width_m + p.detour_width_m / 2.0 + 8.0 {
            out.push(format!(
                "{name}.detourOffsetM: the detour would run into the walls"
            ));
        }
        if !(0.0..=0.3).contains(&p.landing_slope) {
            out.push(format!("{name}.landingSlope outside 0..0.3"));
        }
    }
    out
}

/// The kind a data name (`canyon-leap`, `mesa-drop`, `creek-washout`) names.
pub fn kind_of(name: &str) -> Option<PieceKind> {
    [
        PieceKind::CanyonLeap,
        PieceKind::MesaDrop,
        PieceKind::CreekWashout,
    ]
    .into_iter()
    .find(|k| k.name() == name)
}

fn biome_of(name: &str) -> Option<Biome> {
    Some(match name {
        "greybox" => Biome::Greybox,
        "town" => Biome::Town,
        "rocks" => Biome::Rocks,
        "outback-dirt" => Biome::OutbackDirt,
        "outback-bitumen" => Biome::OutbackBitumen,
        _ => return None,
    })
}

fn biome_name(b: Biome) -> &'static str {
    match b {
        Biome::Greybox => "greybox",
        Biome::Town => "town",
        Biome::Rocks => "rocks",
        Biome::OutbackDirt => "outback-dirt",
        Biome::OutbackBitumen => "outback-bitumen",
    }
}

/// One drawn piece, in metres, relative to its kicker's base (u = 0).
#[derive(Clone, Debug)]
struct Draw {
    kind: PieceKind,
    approach: f64,
    climb: f64,
    ramp: f64,
    lip: f64,
    blend: f64,
    gap: f64,
    pit_depth: f64,
    rim_drop: f64,
    landing: f64,
    /// The landing's downhill slope (the data's, or steeper where the terrain falls away).
    slope: f64,
    runout: f64,
    wall_h: f64,
    landmark_h: f64,
    side: f64,
    p: PieceData,
}

impl Draw {
    fn new(kind: PieceKind, p: &PieceData, rng: &mut Rng) -> Self {
        let r = |rng: &mut Rng, [a, b]: [f64; 2]| if b > a { rng.range(a, b) } else { a };
        let (approach, climb, ramp, lip) = (
            r(rng, p.approach_m),
            r(rng, p.climb_m),
            r(rng, p.ramp_m),
            r(rng, p.lip_m),
        );
        let gap = r(rng, p.gap_m);
        let pit_depth = r(rng, p.pit_depth_m);
        let rim_drop = r(rng, p.rim_drop_m);
        let wall_h = r(rng, p.wall_height_m);
        let landmark_h = r(rng, p.landmark_height_m);
        let side = if rng.unit() < 0.5 { 1.0 } else { -1.0 };
        let mut d = Self {
            kind,
            approach,
            climb,
            ramp,
            lip,
            blend: p.blend_m,
            gap,
            pit_depth,
            rim_drop,
            landing: 0.0,
            slope: p.landing_slope,
            runout: p.runout_m,
            wall_h,
            landmark_h,
            side,
            p: p.clone(),
        };
        // By construction: the slowest car in the band clears the rim with margin (the gap shrinks to fit), and the
        // landing runs past where the fastest car comes down (flat-ground ballistics; the validator then checks the
        // stamped ground).
        d.size();
        d
    }

    /// Fits the gap and the landing to the speed band at the current landing slope.
    fn size(&mut self) {
        self.size_with(self.p.landing_slope);
    }

    /// Fits the gap to the band's slowest speed and the landing (at `slope`) past where the band's fastest car comes
    /// down. The far rim stands about level with the lip, so the fall onto the landing is short and the car comes down
    /// close to parallel with it.
    fn size_with(&mut self, slope: f64) {
        let reach_min = self.flight(self.p.speed_band[0]).0;
        self.gap = self
            .gap
            .min(reach_min - setpiece::limits::RIM_MARGIN_M - 1.0);
        self.slope = slope;
        self.landing =
            (self.flight(self.p.speed_band[1]).0 - self.gap + setpiece::limits::END_MARGIN_M + 6.0)
                .max(jj_map::limits::MIN_LANDING_LENGTH_MM as f64 / 1000.0);
    }

    /// Where a car leaving the lip at `v` comes down over this piece's pit, rim and landing slope: metres past the lip,
    /// and how steeply it is falling then (fall over run).
    fn flight(&self, v: f64) -> (f64, f64) {
        let a = libm::atan(self.lip / (self.ramp - self.blend / 2.0));
        let (vh, mut vy) = (v * libm::cos(a), v * libm::sin(a));
        let (mut x, mut y) = (0.0, self.lip);
        let dt = 1.0 / 240.0;
        for _ in 0..(8 * 240) {
            x += vh * dt;
            vy -= 9.81 * dt;
            y += vy * dt;
            let g = if x < self.gap {
                -self.pit_depth
            } else {
                -self.rim_drop - self.slope * (x - self.gap)
            };
            if vy < 0.0 && y <= g {
                return (x, -vy / vh);
            }
        }
        (x, -vy / vh)
    }

    fn lip_u(&self) -> f64 {
        self.ramp
    }
    fn rim_u(&self) -> f64 {
        self.ramp + self.gap
    }
    fn land_end_u(&self) -> f64 {
        self.rim_u() + self.landing
    }
    fn end_u(&self) -> f64 {
        self.land_end_u() + self.runout
    }
    fn hw_wall(&self) -> f64 {
        self.p.wall_width_m
    }
}

/// The road's height along the piece (m), `u` from the kicker's base, given the terrain's road height at the start
/// (`h0`) and the end (`h1`). `None` when the run-out back to the terrain would be too steep.
#[derive(Clone, Copy, Debug)]
struct Profile {
    h0: f64,
    /// The terrain's road grade arriving at the commitment point, and leaving the run-out's end (the profile joins it
    /// with matching slope, so the road never kinks into a crest at a piece's ends).
    g0: f64,
    h1: f64,
    g1: f64,
    take_off: f64,
    land_end: f64,
}

/// The pit starts this many grid spacings past the lip (the bilinear ground under the kicker stays level).
const PIT_EDGE_CELLS: f64 = 1.5;
/// Longest run-out back to the terrain, m.
const MAX_RUNOUT_M: f64 = 200.0;
/// Steepest grade the approach and the run-out may have anywhere.
const MAX_GRADE: f64 = 0.15;
/// Sharpest crest (1/m) on the approach and the run-out: a car at 25 m/s stays on its wheels over it (v²κ < g).
const MAX_CREST: f64 = 0.0125;
/// Sharpest dip (1/m): the suspension takes it at speed.
const MAX_SAG: f64 = 0.03;
/// Steeper landing slopes a piece may take where the terrain falls away.
const LANDING_SLOPES: [f64; 2] = [0.20, 0.25];
/// The climb to the take-off ends this far before the kicker's base, so the car meets the ramp on the level, m.
const LEVEL_M: f64 = 20.0;

/// The cubic Hermite from (`p0`, slope `m0`) to (`p1`, slope `m1`) over `len` m, at `x` m.
fn hermite(p0: f64, m0: f64, p1: f64, m1: f64, len: f64, x: f64) -> f64 {
    let t = (x / len).clamp(0.0, 1.0);
    let (t2, t3) = (t * t, t * t * t);
    (2.0 * t3 - 3.0 * t2 + 1.0) * p0
        + (t3 - 2.0 * t2 + t) * len * m0
        + (-2.0 * t3 + 3.0 * t2) * p1
        + (t3 - t2) * len * m1
}

impl Profile {
    /// The piece's road profile between the terrain's road at the commitment point (`h0`, grade `g0`) and at the
    /// span's end (`h1`, grade `g1`); `None` when its approach or run-out would be too steep or kink too sharply.
    fn new(d: &Draw, h0: f64, g0: f64, h1: f64, g1: f64) -> Option<Self> {
        let take_off = h0 + d.climb;
        let land_end = take_off - d.rim_drop - d.slope * d.landing;
        let p = Self {
            h0,
            g0,
            h1,
            g1,
            take_off,
            land_end,
        };
        // Both blends, sampled: grade and vertical curvature inside the limits.
        // Each blend may start as steep as what it joins (the terrain's grade, the landing's slope), no steeper.
        let spans = [
            (-d.approach, -LEVEL_M, MAX_GRADE.max(libm::fabs(g0))),
            (
                d.land_end_u(),
                d.end_u(),
                MAX_GRADE.max(d.slope).max(libm::fabs(g1)),
            ),
        ];
        for (a, b, max_grade) in spans {
            let step = 1.0;
            let mut u = a;
            while u + 2.0 * step <= b {
                let (y0, y1, y2) = (p.road(d, u), p.road(d, u + step), p.road(d, u + 2.0 * step));
                let grade = (y2 - y0) / (2.0 * step);
                let curve = (y2 - 2.0 * y1 + y0) / (step * step);
                if libm::fabs(grade) > max_grade + 1e-9 || curve < -MAX_CREST || curve > MAX_SAG {
                    return None;
                }
                u += step;
            }
        }
        Some(p)
    }

    fn road(&self, d: &Draw, u: f64) -> f64 {
        let (c0, c1) = (-d.approach, -LEVEL_M);
        if u <= c1 {
            hermite(self.h0, self.g0, self.take_off, 0.0, c1 - c0, u - c0)
        } else if u <= d.lip_u() {
            self.take_off
        } else if u <= d.rim_u() {
            // Over the gap: the line the road would take (route `y` there; nothing stands on it).
            self.take_off - d.rim_drop * (u - d.lip_u()) / d.gap
        } else if u <= d.land_end_u() {
            self.take_off - d.rim_drop - d.slope * (u - d.rim_u())
        } else {
            hermite(
                self.land_end,
                -d.slope,
                self.h1,
                self.g1,
                d.runout,
                u - d.land_end_u(),
            )
        }
    }
}

/// A route polyline with arc lengths (closed).
struct Line {
    pts: Vec<(f64, f64)>,
    s: Vec<f64>,
    total: f64,
}

impl Line {
    fn new(map: &Map) -> Self {
        let pts: Vec<(f64, f64)> = map
            .route
            .points
            .iter()
            .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
            .collect();
        let (s, total) = arc_lengths(&pts);
        Self { pts, s, total }
    }
    fn n(&self) -> usize {
        self.pts.len()
    }
    fn tangent(&self, i: usize) -> (f64, f64) {
        let n = self.n();
        let (a, b) = (self.pts[(i + n - 1) % n], self.pts[(i + 1) % n]);
        let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    }
    /// Route index `du` metres after (or before, negative) point `i`, wrapping.
    fn offset(&self, i: usize, du: f64) -> usize {
        let n = self.n();
        let target = (self.s[i] + du).rem_euclid(self.total);
        let k = self.s.partition_point(|&v| v < target);
        k.min(n - 1)
    }
    /// Signed arc distance from `a` forward to `b`, in (-total/2, total/2].
    fn du(&self, a: usize, b: usize) -> f64 {
        let d = (self.s[b] - self.s[a]).rem_euclid(self.total);
        if d > self.total / 2.0 {
            d - self.total
        } else {
            d
        }
    }
    fn turn(&self, a: usize, b: usize) -> f64 {
        let (t0, t1) = (self.tangent(a), self.tangent(b));
        libm::fabs(libm::atan2(
            t0.0 * t1.1 - t0.1 * t1.0,
            t0.0 * t1.0 + t0.1 * t1.1,
        ))
    }
}

/// What [`place`] did: each piece's kind and its route span `[from, to]` as arc lengths (m), for the small features to
/// keep clear of.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub kind: PieceKind,
    pub from_s: f64,
    pub to_s: f64,
}

/// Places set pieces along `ranges` (arc-length ranges and the biome each belongs to): at least the data's minimum per
/// lap, plus its density per km. Stamps the terrain, the route's heights and surfaces, moves the gates out of each
/// piece's span and returns the spans. Run after the terrain (and crossings) and before the small features.
pub fn place(
    map: &mut Map,
    rng: &mut Rng,
    ranges: &[(f64, f64, Biome)],
    data: &Data,
) -> Vec<Placed> {
    place_counted(map, rng, ranges, data).0
}

/// [`place`] with a count of why candidate sites were turned down (R90: placement is introspectable).
pub fn place_counted(
    map: &mut Map,
    rng: &mut Rng,
    ranges: &[(f64, f64, Biome)],
    data: &Data,
) -> (Vec<Placed>, BTreeMap<String, u32>) {
    let mut rejects: BTreeMap<String, u32> = BTreeMap::new();
    let line = Line::new(map);
    let n = line.n();
    let km = line.total / 1000.0;
    let extra = data.per_km * km;
    let want = (data.min_per_lap as usize)
        .max(libm::floor(extra) as usize + usize::from(rng.unit() < extra - libm::floor(extra)));
    let mut placed: Vec<Placed> = Vec::new();
    // Candidate kicker bases: every 4th route point in a range whose biome has pieces, in a seeded order.
    let mut candidates: Vec<(usize, Biome)> = Vec::new();
    for &(lo, hi, b) in ranges {
        if data.biomes.get(biome_name(b)).is_none_or(|k| k.is_empty()) {
            continue;
        }
        for i in (0..n).step_by(2) {
            if line.s[i] >= lo && line.s[i] <= hi {
                candidates.push((i, b));
            }
        }
    }
    for k in (1..candidates.len()).rev() {
        let j = (rng.next_u64() % (k as u64 + 1)) as usize;
        candidates.swap(k, j);
    }
    // The terrain's level flow beats first (P1-FL15a: straight ~200 m windows held to a few percent on the land's
    // high and low ground): a piece there costs the landscape no relief and fits without a long run-out. Then the
    // gentlest ground, in the seeded order within each band.
    let steep = |base: usize| {
        let n = line.n();
        let y = |i: usize| f64::from(map.route.points[i % n].y) / 1000.0;
        let (a, b) = (line.offset(base, -60.0), line.offset(base, 120.0));
        let mut worst: f64 = 0.0;
        let mut i = a;
        while i != b {
            let j = (i + 4) % n;
            let run = (line.s[j] - line.s[i]).rem_euclid(line.total).max(1e-6);
            worst = worst.max(libm::fabs(y(j) - y(i)) / run);
            if span_contains(&line, i, j, b) {
                break;
            }
            i = j;
        }
        worst
    };
    let mut keyed: Vec<(u8, (usize, Biome))> = candidates
        .iter()
        .map(|&c| {
            let g = steep(c.0);
            (
                if g <= 0.035 {
                    0
                } else if g <= 0.08 {
                    1
                } else {
                    2
                },
                c,
            )
        })
        .collect();
    keyed.sort_by_key(|(band, _)| *band);
    let candidates: Vec<(usize, Biome)> = keyed.into_iter().map(|(_, c)| c).collect();
    // Sight is preferred, not required by placement: a first pass takes only sites whose landmark is in view long
    // enough before the commitment point, a second pass fills any minimum the first couldn't.
    for round in 0..2 {
        for &(base, biome) in &candidates {
            if placed.len() >= want {
                break;
            }
            // Every kind the biome offers, starting from a seeded one: a site the drawn kind can't use may suit another.
            let kinds = &data.biomes[biome_name(biome)];
            let first = (rng.next_u64() % kinds.len() as u64) as usize;
            let mut found = None;
            for kk in 0..kinds.len() {
                let name = &kinds[(first + kk) % kinds.len()];
                let kind = kind_of(name).expect("validated");
                let d = Draw::new(kind, &data.pieces[name.as_str()], rng);
                let mut d = d;
                let mut site = site_ok(map, &line, base, &d, ranges, biome, &placed, data);
                if site.is_err() {
                    // The detour may fit on the other side.
                    d.side = -d.side;
                    site = site_ok(map, &line, base, &d, ranges, biome, &placed, data);
                }
                let (from, to) = match site {
                    Ok(span) => span,
                    Err(why) => {
                        *rejects.entry(why.into()).or_default() += 1;
                        continue;
                    }
                };
                // Fit the piece to the terrain: the climb (inside its range) and then the run-out bring the landing's end
                // back to the terrain's own height at the end of the span.
                let (from, to) = match fit(map, &line, base, &mut d, from, to) {
                    Some(span) => match site_ok(map, &line, base, &d, ranges, biome, &placed, data)
                    {
                        Ok(s2) if s2.0 == span.0 => s2,
                        _ => {
                            *rejects.entry("no room for the run-out".into()).or_default() += 1;
                            continue;
                        }
                    },
                    None => {
                        *rejects.entry("run-out too steep".into()).or_default() += 1;
                        continue;
                    }
                };
                let mut trial = map.clone();
                let Some(f) = stamp(&mut trial, &line, base, from, to, &d, data) else {
                    *rejects.entry("run-out too steep".into()).or_default() += 1;
                    continue;
                };
                if let Some(p) = setpiece::problems(&trial, &f).first() {
                    let key: String = p.chars().take_while(|c| !c.is_ascii_digit()).collect();
                    *rejects.entry(format!("contract: {key}")).or_default() += 1;
                    continue;
                }
                let seen = sight_seconds(&trial, &f, data) >= data.min_sight_s;
                if round == 0 && !seen {
                    *rejects.entry("not seen from afar".into()).or_default() += 1;
                    continue;
                }
                found = Some((trial, f, kind, from, to));
                break;
            }
            let Some((mut trial, f, kind, from, to)) = found else {
                continue;
            };
            trial.features.push(f);
            *map = trial;
            placed.push(Placed {
                kind,
                from_s: line.s[from],
                to_s: line.s[from] + line.du(from, to),
            });
        }
    }
    if !placed.is_empty() {
        move_gates(map, &line);
        // The kill plane stays below every pit.
        let lowest = map.terrain.heights.iter().copied().min().unwrap_or(0);
        map.header.bounds.kill_y = map
            .header
            .bounds
            .kill_y
            .min(i32::from(lowest) * 10 - 10_000);
    }
    (placed, rejects)
}

/// Chooses the climb (inside the data's range) and the run-out length so the landing's end meets the terrain at the
/// span's end; `None` when even the longest run-out would be too steep.
fn fit(
    map: &Map,
    line: &Line,
    base: usize,
    d: &mut Draw,
    _from: usize,
    _to: usize,
) -> Option<(usize, usize)> {
    let runout = d.runout;
    // The shortest approach that fits: the commitment point sits as late as it can, with the most road before it
    // from which the piece is seen.
    let [a0, a1] = d.p.approach_m;
    for approach in [a0, (a0 + a1) / 2.0, a1] {
        d.approach = approach;
        let from = line.offset(base, -d.approach);
        let (h0, g0) = terrain_road(map, line, from);
        // Where the terrain falls away, a steeper landing takes some of the drop (a downhill landing, R129).
        for slope in [d.p.landing_slope, LANDING_SLOPES[0], LANDING_SLOPES[1]] {
            if slope < d.p.landing_slope {
                continue;
            }
            d.size_with(slope);
            d.runout = runout;
            while d.runout <= MAX_RUNOUT_M {
                let to = line.offset(base, d.end_u());
                let (h1, g1) = terrain_road(map, line, to);
                // The climb that best meets the terrain at the end, inside the data's range.
                let want = h1 - h0 + d.rim_drop + d.slope * d.landing;
                d.climb = want.clamp(d.p.climb_m[0], d.p.climb_m[1]);
                if Profile::new(d, h0, g0, h1, g1).is_some() {
                    return Some((from, to));
                }
                d.runout += 15.0;
            }
        }
    }
    None
}

/// The terrain's road at route point `i`: its height and its grade along the route (m, rise over run).
fn terrain_road(map: &Map, line: &Line, i: usize) -> (f64, f64) {
    let n = line.n();
    let y = |k: usize| f64::from(map.route.points[k % n].y) / 1000.0;
    let (a, b) = ((i + n - 1) % n, (i + 1) % n);
    let run = (line.s[b] - line.s[a]).rem_euclid(line.total).max(1e-6);
    (y(i), (y(b) - y(a)) / run)
}

/// The piece's span `[from, to]` (route indices) when its kicker can sit at `base`: a straight core, the whole span in
/// one biome range, clear of the start and of other pieces.
#[allow(clippy::too_many_arguments)]
fn site_ok(
    map: &Map,
    line: &Line,
    base: usize,
    d: &Draw,
    ranges: &[(f64, f64, Biome)],
    biome: Biome,
    placed: &[Placed],
    data: &Data,
) -> Result<(usize, usize), &'static str> {
    let from = line.offset(base, -d.approach);
    let to = line.offset(base, d.end_u());
    let core_end = line.offset(base, d.land_end_u());
    // Arc positions without wrap: the start/finish corridor stays clear.
    let (s0, s1) = (line.s[base] - d.approach, line.s[base] + d.end_u());
    let finish = map.route.start.at as usize;
    let fs = line.s[finish];
    let clear_of_start = |s: f64| {
        let d = (s - fs).rem_euclid(line.total);
        d > FINISH_AT_M && d < line.total - FINISH_AT_M - 60.0
    };
    if !clear_of_start(s0) || !clear_of_start(s1) || s0 < 0.0 || s1 > line.total {
        return Err("near the start");
    }
    if !ranges
        .iter()
        .any(|&(lo, hi, b)| b == biome && s0 >= lo && s1 <= hi)
    {
        return Err("outside one biome");
    }
    if placed
        .iter()
        .any(|p| s0 < p.to_s + data.spacing_m && s1 > p.from_s - data.spacing_m)
    {
        return Err("too close to another piece");
    }
    // Straight core: kicker base to landing end, and the approach's last 20 m.
    // 40 m of straight before the kicker: a car (or the autopilot) settles onto the line before the ramp.
    let pre = line.offset(base, -40.0);
    let mut i = pre;
    while i != core_end {
        if line.turn(pre, i) > setpiece::limits::MAX_CORE_TURN * 0.9 {
            return Err("core not straight");
        }
        i = (i + 1) % line.n();
    }
    // The detour and the pit need the ground beside the span to themselves: no other part of the road comes within
    // reach of them (walls and the landmark are clipped where another road passes; the stamp leaves that ground alone).
    let span: Vec<usize> = span_indices(line, from, to);
    let len = line.du(from, to);
    let hw = f64::from(map.route.points[base].width) / 2000.0;
    let others: Vec<(f64, f64)> = (0..line.n())
        .step_by(2)
        .filter(|&j| {
            !span_contains(line, from, to, j)
                && libm::fabs(line.du(from, j)) > 40.0
                && libm::fabs(line.du(to, j)) > 40.0
        })
        .map(|j| line.pts[j])
        .collect();
    let clear = |p: (f64, f64), r: f64| {
        others
            .iter()
            .all(|q| libm::hypot(p.0 - q.0, p.1 - q.1) >= r)
    };
    let side = d.side;
    for &k in span.iter().step_by(2) {
        let u0 = line.du(from, k);
        let ramp = smoothstep(u0 / setpiece::DETOUR_TURN_M)
            * smoothstep((len - u0) / setpiece::DETOUR_TURN_M);
        let lat = side * d.p.detour_offset_m * ramp;
        let (c, t) = (line.pts[k], line.tangent(k));
        let p = (c.0 - t.1 * lat, c.1 + t.0 * lat);
        if !clear(p, d.p.detour_width_m / 2.0 + hw + 10.0) {
            return Err("road too close to the detour");
        }
        let u = line.du(base, k);
        if u > d.lip_u() - 2.0 && u < d.rim_u() + 2.0 {
            // Across the whole carved width: past the walls on the far side, and on the detour's side to just short
            // of the track (a creek runs on past its ford).
            let far = hw + d.p.wall_width_m + d.p.pit_far_m;
            let near = if d.kind == PieceKind::CreekWashout {
                d.p.detour_offset_m + 40.0
            } else {
                d.p.detour_offset_m - 10.0
            };
            let steps = libm::ceil((far + near) / 5.0) as usize;
            for k in 0..=steps {
                let lat = side * (-far + (far + near) * k as f64 / steps as f64);
                if !clear((c.0 - t.1 * lat, c.1 + t.0 * lat), hw + 8.0) {
                    return Err("road too close to the pit");
                }
            }
        }
    }
    // Corners in the span keep their guard rails and chevrons on the outside: the detour runs on their inside.
    for c in crate::biome::wayfinding::corners(&line.pts) {
        let mid = (c.from + c.to) / 2;
        if !(span_contains(line, from, to, c.from) || span_contains(line, from, to, c.to)) {
            continue;
        }
        let (t0, t1) = (line.tangent(c.from), line.tangent(c.to.max(mid)));
        let toward_left = t0.0 * t1.1 - t0.1 * t1.0 > 0.0;
        // Turning toward the left (lat > 0) puts the outside on the right.
        let outside = if toward_left { -1.0 } else { 1.0 };
        if side == outside {
            return Err("detour on a corner's outside");
        }
    }
    // No bridge in the span.
    if map.features.iter().any(|f| f.kind == FeatureKind::Bridge) {
        let ix = map
            .features
            .iter()
            .filter_map(jj_map::bridge::BridgeDesign::of)
            .flat_map(|b| {
                [b.upper, b.lower]
                    .into_iter()
                    .filter_map(|sp| jj_map::bridge::indices(map, sp))
                    .flatten()
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        if ix.iter().any(|&i| span_contains(line, from, to, i)) {
            return Err("bridge in the span");
        }
    }
    Ok((from, to))
}

fn span_indices(line: &Line, from: usize, to: usize) -> Vec<usize> {
    let n = line.n();
    let count = (to + n - from) % n + 1;
    (0..count).map(|k| (from + k) % n).collect()
}

fn span_contains(line: &Line, from: usize, to: usize, i: usize) -> bool {
    let n = line.n();
    (i + n - from) % n <= (to + n - from) % n
}

/// Sculpts the piece into `map` and returns its feature, or `None` when the terrain can't take it (the run-out back to
/// the terrain would be too steep).
fn stamp(
    map: &mut Map,
    line: &Line,
    base: usize,
    from: usize,
    to: usize,
    d: &Draw,
    data: &Data,
) -> Option<Feature> {
    let n = line.n();
    let (h0, g0) = terrain_road(map, line, from);
    let (h1, g1) = terrain_road(map, line, to);
    let prof = Profile::new(d, h0, g0, h1, g1)?;
    let span = span_indices(line, from, to);
    let hw = f64::from(map.route.points[base].width) / 2000.0;
    let t = &map.terrain;
    let (sp, ox, oz) = (
        f64::from(t.spacing) / 1000.0,
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let old = t.heights.clone();
    // u of each span point relative to the kicker's base.
    let us: Vec<f64> = span.iter().map(|&i| line.du(base, i)).collect();
    let len = us[us.len() - 1] - us[0];
    let side = d.side;
    let det_half = d.p.detour_width_m / 2.0;
    let detour_lat = |u: f64| {
        let u0 = u - us[0];
        let ramp = smoothstep(u0 / setpiece::DETOUR_TURN_M)
            * smoothstep((len - u0) / setpiece::DETOUR_TURN_M);
        side * d.p.detour_offset_m * ramp
    };
    let detour_y = |u: f64| {
        let u0 = (u - us[0]) / len;
        let lin = prof.h0 + (prof.h1 - prof.h0) * smoothstep(u0);
        let ford = if d.p.ford_depth_m > 0.0 {
            let c = (d.lip_u() + d.rim_u()) / 2.0;
            let w = d.gap / 2.0 + 18.0;
            let x = (libm::fabs(u - c) / w).min(1.0);
            d.p.ford_depth_m * (1.0 + libm::cos(core::f64::consts::PI * x)) / 2.0
        } else {
            0.0
        };
        let ramp = libm::fabs(detour_lat(u)) / d.p.detour_offset_m;
        let road = prof.road(d, u);
        road + (lin - ford - road) * ramp
    };
    // Pit extents (left positive): to just short of the detour on its side, past the walls on the other.
    let pit_near = d.p.detour_offset_m - det_half - 6.0;
    let pit_far = hw + d.hw_wall() + d.p.pit_far_m;
    let (pit_left, pit_right) = if side > 0.0 {
        (pit_near, pit_far)
    } else {
        (pit_far, pit_near)
    };
    // The creek runs on past the ford; the canyon's crack and the mesa's ditch end short of the detour.
    let carve_left = if d.kind == PieceKind::CreekWashout && side > 0.0 {
        d.p.detour_offset_m + 40.0
    } else {
        pit_left
    };
    let carve_right = if d.kind == PieceKind::CreekWashout && side < 0.0 {
        d.p.detour_offset_m + 40.0
    } else {
        pit_right
    };
    let landmarks = choose_landmark(map, line, base, from, to, d, &prof, hw, data);
    // The canyon's flank dome: the Olgas rock the channel cuts past, beside the kicker (the reference's left dome).
    let flank = (d.kind == PieceKind::CanyonLeap).then(|| {
        let (c, r) = flank_at(hw, &d.p, d.lip_u(), side);
        (c, r, d.landmark_h * 0.75)
    });
    let reach = d.p.detour_offset_m + det_half + 14.0;
    let reach = reach
        .max(landmarks.iter().map(|l| l.1.abs()).fold(0.0, f64::max) + d.p.landmark_radius_m)
        .max(carve_left.max(carve_right) + 4.0);
    // Bounding box of the footprint.
    let (mut x0, mut x1, mut z0, mut z1) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for &i in &span {
        let p = line.pts[i];
        x0 = x0.min(p.0 - reach);
        x1 = x1.max(p.0 + reach);
        z0 = z0.min(p.1 - reach);
        z1 = z1.max(p.1 + reach);
    }
    // Other parts of the road near the footprint (the cells nearer them keep their ground).
    let others: Vec<(f64, f64)> = (0..n)
        .step_by(2)
        .filter(|&j| !span_contains(line, from, to, j))
        .map(|j| line.pts[j])
        .filter(|q| q.0 > x0 - reach && q.0 < x1 + reach && q.1 > z0 - reach && q.1 < z1 + reach)
        .collect();
    let c0 = libm::floor((x0 - ox) / sp).max(0.0) as usize;
    let c1 = (libm::ceil((x1 - ox) / sp).max(0.0) as usize).min(cols - 1);
    let r0 = libm::floor((z0 - oz) / sp).max(0.0) as usize;
    let r1 = (libm::ceil((z1 - oz) / sp).max(0.0) as usize).min(rows - 1);
    let mut heights = map.terrain.heights.clone();
    let mut surfaces = map.terrain.surfaces.clone();
    let wall_from = -d.p.wall_from_m;
    // The kicker's and the landing's flat width (the road less its side slopes).
    let land_w = 2.0 * (hw - jj_map::jump::EDGE_SLOPE_M);
    let bed = hw + 1.5 * sp;
    for r in r0..=r1 {
        for c in c0..=c1 {
            let p = (ox + c as f64 * sp, oz + r as f64 * sp);
            // Nearest point on the span's polyline: u and lat (left positive).
            let (mut best, mut u, mut lat) = (f64::INFINITY, 0.0, 0.0);
            for k in 0..span.len() - 1 {
                let (a, b) = (line.pts[span[k]], line.pts[span[k + 1]]);
                let (dx, dz) = (b.0 - a.0, b.1 - a.1);
                let l2 = (dx * dx + dz * dz).max(1e-12);
                let tt = (((p.0 - a.0) * dx + (p.1 - a.1) * dz) / l2).clamp(0.0, 1.0);
                let (qx, qz) = (a.0 + tt * dx, a.1 + tt * dz);
                let dd = libm::hypot(p.0 - qx, p.1 - qz);
                if dd < best {
                    best = dd;
                    let l = libm::sqrt(l2);
                    u = us[k] + tt * (us[k + 1] - us[k]);
                    lat = (-(p.0 - a.0) * dz + (p.1 - a.1) * dx) / l;
                }
            }
            if best > reach {
                continue;
            }
            // Leave the ground of any other part of the road alone.
            let other = others
                .iter()
                .map(|q| libm::hypot(p.0 - q.0, p.1 - q.1))
                .fold(f64::INFINITY, f64::min);
            if other < best + 4.0 {
                continue;
            }
            let at = r * cols + c;
            let h_old = f64::from(old[at]) / 100.0;
            let road = prof.road(d, u);
            let a = libm::fabs(lat);
            let mut h;
            let mut surf = None;
            // 1. The road's own structure: the bed, then walls (or the mesa's plateau) and an embankment or cutting.
            let in_walls = u >= wall_from && u <= d.lip_u();
            let wall_env = smoothstep((u - wall_from) / 12.0);
            let shoulder = if in_walls { hw + d.hw_wall() } else { bed };
            if a <= bed {
                h = road;
            } else if in_walls && a <= shoulder {
                let top = road + d.wall_h * wall_env;
                // Walls rise steeply from the bed's edge: two cells to full height.
                let rise = smoothstep((a - bed) / (2.0 * sp));
                h = road + (top - road) * rise;
                if d.wall_h > 0.0 && wall_env > 0.3 {
                    surf = Some(d.p.wall_surface);
                }
            } else {
                let edge_top = if in_walls {
                    road + d.wall_h * wall_env
                } else {
                    road
                };
                let edge = if in_walls { shoulder } else { bed };
                // Side slopes: steep (a wall reads as a wall) where they are tall, gentle where they are low.
                let drop = libm::fabs(edge_top - h_old);
                // Past the rim the verges are gentle and drivable (R133): a car that comes down off line or slides
                // wide after a rough landing drives back up instead of meeting a wall.
                let run = if u > d.rim_u() {
                    (drop * 2.5).max(10.0)
                } else {
                    (drop * 0.6).max(6.0)
                };
                let w = 1.0 - smoothstep((a - edge) / run);
                h = h_old + (edge_top - h_old) * w;
                if in_walls && drop > 3.0 && w > 0.5 {
                    surf = Some(d.p.wall_surface);
                }
            }
            // 2. The landmark (a dome, butte or tor seen from afar) beyond the landing, and the canyon's flank dome.
            let domes = landmarks
                .iter()
                .map(|&c| (c, d.p.landmark_radius_m, d.landmark_h))
                .chain(flank);
            for (c, r, height) in domes {
                let dl = libm::hypot(u - c.0, lat - c.1);
                // Never on the road bed.
                if dl < r && a > bed + sp {
                    let q = dl / r;
                    let dome = prof.road(d, c.0) + height * libm::sqrt(1.0 - q * q).powf(0.8);
                    if dome > h {
                        h = dome;
                        surf = Some(Surface::Rock);
                    }
                }
            }
            // 3. The pit: the gap through the whole carved width, cliffs at its ends.
            let lat_left = lat;
            // Cells within one cell's diagonal of the lip keep the take-off ground, so the kicker stands on level
            // ground to its lip.
            let edge = PIT_EDGE_CELLS * sp;
            // The far rim may round over: every landing in the band comes down past the rim's margin.
            if u > d.lip_u() + edge
                && u < d.rim_u()
                && lat_left <= carve_left
                && lat_left >= -carve_right
            {
                h = prof.take_off - d.pit_depth;
                surf = Some(d.p.pit_surface);
            }
            // 4. The detour wins its corridor (it fords the creek, skirts the crack's end).
            if u >= us[0] && u <= us[us.len() - 1] {
                let dlat = libm::fabs(lat - detour_lat(u));
                let off = libm::fabs(detour_lat(u));
                if off > bed + det_half && dlat < det_half + 8.0 {
                    let w = 1.0 - smoothstep((dlat - det_half) / 8.0);
                    h = h + (detour_y(u) - h) * w;
                    if dlat <= det_half {
                        surf = Some(Surface::PackedDirt);
                    }
                }
            }
            // Under the landing's exact surface (jj_map::setpiece::landing_lift) the ground sits that much lower.
            if u > d.rim_u() && u < d.land_end_u() {
                h -= setpiece::LANDING_LIFT_M
                    * jj_map::jump::JumpDesign::side(land_w, lat)
                    * setpiece::landing_taper(d.rim_u(), d.land_end_u(), u);
            }
            heights[at] =
                libm::round(h * 100.0).clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16;
            if let Some(s) = surf
                && (a > hw || (u > d.lip_u() && u < d.rim_u()))
            {
                surfaces[at] = s;
            }
        }
    }
    map.terrain.heights = heights;
    map.terrain.surfaces = surfaces;
    for (k, &i) in span.iter().enumerate() {
        let q = &mut map.route.points[i];
        q.y = libm::round(prof.road(d, us[k]) * 1000.0) as i32;
        q.bank = 0;
    }
    let (x, z) = line.pts[base];
    let tg = line.tangent(base);
    let mm = |v: f64| libm::round(v * 1000.0) as i64;
    let params: BTreeMap<String, i64> = [
        ("piece", d.kind.code()),
        ("fromAt", from as i64),
        ("toAt", to as i64),
        ("rampLengthMm", mm(d.ramp)),
        // The flat top spans the road less its side slopes, so the whole kicker stands on the road bed (side
        // slopes climbing a wall beside the road made the kicker's front edge collide like a wall).
        ("rampWidthMm", mm(2.0 * (hw - jj_map::jump::EDGE_SLOPE_M))),
        ("lipHeightCm", libm::round(d.lip * 100.0) as i64),
        ("blendMm", mm(d.blend)),
        ("gapLengthMm", mm(d.gap)),
        ("pitDepthCm", libm::round(d.pit_depth * 100.0) as i64),
        ("pitLeftMm", mm(pit_left)),
        ("pitRightMm", mm(pit_right)),
        ("landingLengthMm", mm(d.landing)),
        (
            "minSpeedCmps",
            libm::round(d.p.speed_band[0] * 100.0) as i64,
        ),
        (
            "maxSpeedCmps",
            libm::round(d.p.speed_band[1] * 100.0) as i64,
        ),
        ("detourSide", side as i64),
        ("detourOffsetMm", mm(d.p.detour_offset_m)),
        ("detourWidthMm", mm(d.p.detour_width_m)),
        ("sharp", 1),
        ("landmarkUMm", mm(landmarks[0].0)),
        ("landmarkLatMm", mm(landmarks[0].1)),
        (
            "landmark2UMm",
            mm(landmarks.get(1).unwrap_or(&landmarks[0]).0),
        ),
        (
            "landmark2LatMm",
            mm(landmarks.get(1).unwrap_or(&landmarks[0]).1),
        ),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    Some(Feature {
        kind: FeatureKind::SetPiece,
        pose: Pose {
            x: mm(x) as i32,
            y: libm::round(prof.take_off * 1000.0) as i32,
            z: mm(z) as i32,
            yaw: libm::round(libm::atan2(tg.1, tg.0).to_degrees() * 100.0) as i32,
        },
        params,
    })
}

/// How long (s, at the data's sight speed) one of a placed piece's landmarks is in view during the `sightWindowS` before
/// its commitment point (`fromAt`): from the mid chase camera's eye, the landmark's top inside its horizontal view and
/// no ground above the line of sight until it reaches the landmark.
pub fn sight_seconds(map: &Map, f: &Feature, data: &Data) -> f64 {
    let (Some(d), targets) = (GapLeap::of(f), landmark_tops(map, f, data)) else {
        return 0.0;
    };
    sight_of(map, &Line::new(map), d.from as usize, &targets, data)
}

/// [`sight_seconds`] for landmarks with these tops and radii, seen from the road before route point `from`.
fn sight_of(map: &Map, line: &Line, from: usize, targets: &[([f64; 3], f64)], data: &Data) -> f64 {
    let n = line.n();
    // Every route point in the window before the commitment point, back to `sightWindowS` at the sight speed: the
    // road it covers while a landmark is in the chase camera's view.
    let window = data.sight_window_s * data.sight_speed_mps;
    let (mut i, mut back, mut seen) = (from, 0.0, 0.0);
    while back < window {
        let j = (i + n - 1) % n;
        let step = libm::hypot(line.pts[i].0 - line.pts[j].0, line.pts[i].1 - line.pts[j].1);
        let (eye, heading) = chase_eye(map, line, i, data);
        if targets
            .iter()
            .any(|&(target, radius)| in_view(map, eye, heading, target, radius, data))
        {
            seen += step;
        }
        back += step;
        i = j;
        if i == from {
            break;
        }
    }
    seen / data.sight_speed_mps
}

/// Where the landmark goes (u, lat from the kicker's base): of the spots beside and beyond the landing, on either side
/// clear of the detour and of any other road, the one seen longest before the commitment point (ties keep the default
/// spot), judged against the terrain before the stamp, with the dome's top where the stamp will raise it.
#[allow(clippy::too_many_arguments)]
fn choose_landmark(
    map: &Map,
    line: &Line,
    base: usize,
    from: usize,
    to: usize,
    d: &Draw,
    prof: &Profile,
    hw: f64,
    data: &Data,
) -> Vec<(f64, f64)> {
    let r = d.p.landmark_radius_m;
    let default = landmark_at(hw, r, d.rim_u(), d.landing, d.side);
    let near = -d.side * (hw + 6.0 + r);
    let detour_side = d.side * (d.p.detour_offset_m + d.p.detour_width_m / 2.0 + 10.0 + r);
    let mut spots = vec![default];
    for u in [
        d.rim_u() + 0.3 * d.landing,
        d.rim_u() + 0.9 * d.landing,
        d.end_u(),
    ] {
        for lat in [near, near - d.side * 30.0, detour_side] {
            spots.push((u, lat));
        }
    }
    // Beside the approach, outside its walls: in view through the corner before the commitment point.
    let beside = -d.side * (hw + d.p.wall_width_m + r + 4.0);
    for u in [-0.5 * d.approach, -10.0] {
        for lat in [beside, beside - d.side * 30.0] {
            spots.push((u, lat));
        }
    }
    let others: Vec<(f64, f64)> = (0..line.n())
        .step_by(2)
        .filter(|&j| !span_contains(line, from, to, j))
        .map(|j| line.pts[j])
        .collect();
    // Two domes, like the Olgas' group: the spot seen longest, then the one that adds most to it.
    let tops: Vec<((f64, f64), [f64; 3])> = spots
        .into_iter()
        .filter_map(|(u, lat)| {
            let k = line.offset(base, u);
            let (c, t) = (line.pts[k], line.tangent(k));
            let (x, z) = (c.0 - t.1 * lat, c.1 + t.0 * lat);
            if others
                .iter()
                .any(|q| libm::hypot(q.0 - x, q.1 - z) < r + hw + 10.0)
            {
                return None;
            }
            Some(((u, lat), [x, prof.road(d, u) + d.landmark_h, z]))
        })
        .collect();
    // A candidate landmark: its (along, lateral) spot and its top in the world.
    type Spot = ((f64, f64), [f64; 3]);
    let mut chosen: Vec<Spot> = Vec::new();
    for _ in 0..2 {
        let mut best: Option<(Spot, f64)> = None;
        for &(spot, top) in &tops {
            if chosen
                .iter()
                .any(|(c, _)| libm::hypot(c.0 - spot.0, c.1 - spot.1) < 1.5 * r)
            {
                continue;
            }
            let mut set: Vec<([f64; 3], f64)> = chosen.iter().map(|&(_, t)| (t, r)).collect();
            set.push((top, r));
            let seen = sight_of(map, line, from, &set, data);
            if best.is_none_or(|(_, b)| seen > b + 0.25) {
                best = Some(((spot, top), seen));
            }
        }
        if let Some((pick, _)) = best {
            chosen.push(pick);
        }
    }
    if chosen.is_empty() {
        vec![default]
    } else {
        chosen.into_iter().map(|(spot, _)| spot).collect()
    }
}

/// Where a piece's landmark stands by default (u, lat in the route frame from the kicker's base).
fn landmark_at(hw: f64, radius: f64, rim_u: f64, landing: f64, side: f64) -> (f64, f64) {
    // Beyond the far rim, beside the landing, away from the detour: down the line of travel, so the approach sees it.
    (rim_u + 0.6 * landing, -side * (hw + 6.0 + radius))
}

/// The tops (world m) and footprint radii of a placed piece's landmarks: the far one beyond the landing and, for a
/// canyon leap, its flank dome.
fn landmark_tops(map: &Map, f: &Feature, data: &Data) -> Vec<([f64; 3], f64)> {
    let Some(d) = GapLeap::of(f) else {
        return Vec::new();
    };
    let Some(p) = data.pieces.get(d.kind.name()) else {
        return Vec::new();
    };
    let hw = d.kicker.ramp_w / 2.0 + jj_map::jump::EDGE_SLOPE_M;
    let side = d.detour_side as f64;
    // Where the generator stood it (chosen for the view), else the default spot.
    let placed = match (f.params.get("landmarkUMm"), f.params.get("landmarkLatMm")) {
        (Some(&u), Some(&lat)) => (u as f64 / 1000.0, lat as f64 / 1000.0),
        _ => landmark_at(hw, p.landmark_radius_m, d.rim_u(), d.landing_m, side),
    };
    let mut out = vec![(placed, p.landmark_radius_m)];
    if let (Some(&u), Some(&lat)) = (f.params.get("landmark2UMm"), f.params.get("landmark2LatMm")) {
        out.push((
            (u as f64 / 1000.0, lat as f64 / 1000.0),
            p.landmark_radius_m,
        ));
    }
    if d.kind == PieceKind::CanyonLeap {
        out.push(flank_at(hw, p, d.lip_u(), side));
    }
    let line = Line::new(map);
    let base = jj_map::jump::feature_base(map, f);
    out.into_iter()
        .map(|((u, lat), r)| {
            let k = line.offset(base, u);
            let (c, t) = (line.pts[k], line.tangent(k));
            let (x, z) = (c.0 - t.1 * lat, c.1 + t.0 * lat);
            (
                [x, crate::terrain::ground_height_m(&map.terrain, x, z), z],
                r,
            )
        })
        .collect()
}

/// The chase camera's eye for a car at route point `i` (behind and above it, the ground under the eye no higher) and
/// the heading it looks along.
fn chase_eye(map: &Map, line: &Line, i: usize, data: &Data) -> ([f64; 3], (f64, f64)) {
    let (p, t) = (line.pts[i], line.tangent(i));
    let (x, z) = (
        p.0 - t.0 * data.sight_eye_back_m,
        p.1 - t.1 * data.sight_eye_back_m,
    );
    let road = f64::from(map.route.points[i].y) / 1000.0;
    let y =
        (road + data.sight_eye_up_m).max(crate::terrain::ground_height_m(&map.terrain, x, z) + 1.0);
    ([x, y, z], t)
}

/// Where a canyon's flank dome stands (u, lat from the kicker's base) and its radius.
fn flank_at(hw: f64, p: &PieceData, lip_u: f64, side: f64) -> ((f64, f64), f64) {
    let r = p.landmark_radius_m * 0.8;
    ((lip_u - 10.0, -side * (hw + p.wall_width_m + r + 2.0)), r)
}

/// The data's minimum of set pieces per lap, each seen from afar before its commitment point, where the map's biomes
/// place them; empty when it holds. Prepare asks it of every course draw but the last.
pub fn check_minimum(map: &Map) -> Vec<String> {
    let data = shipped();
    if !map
        .header
        .biomes
        .iter()
        .any(|b| data.biomes.contains_key(biome_name(*b)))
    {
        return Vec::new();
    }
    let seen = map
        .features
        .iter()
        .filter(|f| GapLeap::of(f).is_some() && sight_seconds(map, f, data) >= data.min_sight_s)
        .count();
    if (seen as u32) < data.min_per_lap {
        vec![format!(
            "set pieces: {seen} on the lap seen {} s before their commitment point, at least {}",
            data.min_sight_s, data.min_per_lap
        )]
    } else {
        Vec::new()
    }
}

/// Every set piece on `map` against its contract; empty when they all hold.
pub fn check(map: &Map) -> Vec<String> {
    let mut bad = Vec::new();
    for f in map
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::SetPiece)
    {
        bad.extend(
            setpiece::problems(map, f)
                .into_iter()
                .map(|p| format!("set piece: {p}")),
        );
    }
    bad
}

/// The landmark whose top is `target` (footprint `radius` m) is seen from `eye` looking along `heading`: within 40° of
/// it and the line of sight above the ground until it reaches the landmark.
pub fn in_view(
    map: &Map,
    eye: [f64; 3],
    heading: (f64, f64),
    target: [f64; 3],
    radius: f64,
    data: &Data,
) -> bool {
    let (dx, dy, dz) = (target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
    let dist = libm::hypot(dx, dz);
    if dist < 1.0 {
        return true;
    }
    let cos = (dx * heading.0 + dz * heading.1) / dist;
    if cos < libm::cos(data.sight_half_angle_deg.to_radians()) {
        return false;
    }
    let steps = libm::ceil(dist / 2.5) as usize;
    // The line of sight reaching the landmark's own footprint is seeing the landmark.
    for k in 1..steps {
        let f = k as f64 / steps as f64;
        if dist * (1.0 - f) < radius {
            break;
        }
        let (x, y, z) = (eye[0] + dx * f, eye[1] + dy * f, eye[2] + dz * f);
        if crate::terrain::ground_height_m(&map.terrain, x, z) > y {
            return false;
        }
    }
    true
}

/// Removes every gate strictly inside a piece's span and puts one at each end of it, so a car taking the detour never
/// misses a gate, and the spacing either side stays the usual (the finish gate is never inside: pieces keep clear of
/// the start).
fn move_gates(map: &mut Map, line: &Line) {
    let spans: Vec<(usize, usize)> = map
        .features
        .iter()
        .filter_map(GapLeap::of)
        .map(|d| (d.from as usize, d.to as usize))
        .collect();
    let mut gates: Vec<Gate> = map
        .route
        .gates
        .iter()
        .copied()
        .filter(|g| {
            g.finish
                || !spans.iter().any(|&(a, b)| {
                    g.at as usize != a
                        && g.at as usize != b
                        && span_contains(line, a, b, g.at as usize)
                })
        })
        .collect();
    for &(a, b) in &spans {
        for at in [a, b] {
            if gates.iter().all(|g| g.at as usize != at) {
                gates.push(Gate {
                    at: at as u32,
                    finish: false,
                });
            }
        }
    }
    gates.sort();
    map.route.gates = gates;
}

/// Room the small features keep from a piece's span, m.
pub const CLEAR_M: f64 = 60.0;

/// `ranges` with every placed piece's span (and [`CLEAR_M`] either side) cut out.
pub fn clear_of<T: Copy>(ranges: &[(f64, f64, T)], placed: &[Placed]) -> Vec<(f64, f64, T)> {
    let mut out = ranges.to_vec();
    for p in placed {
        let (lo, hi) = (p.from_s - CLEAR_M, p.to_s + CLEAR_M);
        out = out
            .into_iter()
            .flat_map(|(a, b, t)| {
                let mut v = Vec::new();
                if b <= lo || a >= hi {
                    v.push((a, b, t));
                } else {
                    if a < lo {
                        v.push((a, lo, t));
                    }
                    if b > hi {
                        v.push((hi, b, t));
                    }
                }
                v
            })
            .collect();
    }
    out
}

/// `(u, lat, distance)` of `(x, z)` in a placed piece's route frame (u from the kicker's base, lat left positive), from
/// the nearest point of the piece's span; `None` for a point nearer another part of the road.
fn local(map: &Map, line: &Line, f: &Feature, x: f64, z: f64) -> Option<(f64, f64, f64)> {
    let d = GapLeap::of(f)?;
    let base = jj_map::jump::feature_base(map, f);
    let span = span_indices(line, d.from as usize, d.to as usize);
    let (mut best, mut out) = (f64::INFINITY, (0.0, 0.0));
    for k in 0..span.len() - 1 {
        let (a, b) = (line.pts[span[k]], line.pts[span[k + 1]]);
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let l2 = (dx * dx + dz * dz).max(1e-12);
        let t = (((x - a.0) * dx + (z - a.1) * dz) / l2).clamp(0.0, 1.0);
        let dd = libm::hypot(x - a.0 - t * dx, z - a.1 - t * dz);
        if dd < best {
            best = dd;
            let u = line.du(base, span[k]) + t * libm::sqrt(l2);
            out = (u, (-(x - a.0) * dz + (z - a.1) * dx) / libm::sqrt(l2));
        }
    }
    Some((out.0, out.1, best))
}

/// Takes every dressing piece and prop off a placed piece's play space: the road from the kicker to the landing's end,
/// the pit, and the detour's corridor (lineside and scatter run after placement; nothing may sit on a landing).
pub fn clear_footprints(map: &mut Map, registry: &jj_map::Registry) {
    let line = Line::new(map);
    let pieces: Vec<Feature> = map
        .features
        .iter()
        .filter(|f| GapLeap::of(f).is_some())
        .cloned()
        .collect();
    if pieces.is_empty() {
        return;
    }
    // An item's reach from its pose, m (half its footprint's diagonal; mm in the registry).
    let reach_of = |id: &str, params: &jj_map::Params| {
        registry
            .get(id)
            .and_then(|k| k.footprint(params))
            .map_or(1.0, |fp| match fp {
                jj_map::Footprint::Rect { x, z, .. } => libm::hypot(x, z) / 2000.0,
                jj_map::Footprint::Circle { radius, .. } => radius / 1000.0,
            })
    };
    // `solid`: a collider or a prop. Flat markings on the road (lane dashes, reflector posts' bases, junction pads)
    // stay on the kicker's run and the landing; only the pit takes them.
    let blocked = |map: &Map, x: f64, z: f64, r: f64, solid: bool| {
        pieces.iter().any(|f| {
            let d = GapLeap::of(f).expect("filtered");
            let Some((u, lat, _)) = local(map, &line, f, x, z) else {
                return false;
            };
            let hw = d.kicker.ramp_w / 2.0 + jj_map::jump::EDGE_SLOPE_M;
            let base = jj_map::jump::feature_base(map, f);
            let (u0, u1) = (line.du(base, d.from as usize), line.du(base, d.to as usize));
            // Off the road band everything goes (a power line goes with its pole); on it only solids do.
            let core = u > -5.0 - r
                && u < d.end_u() + 5.0 + r
                && libm::fabs(lat) < hw + 2.0 + r
                && (solid || libm::fabs(lat) > hw + 1.0);
            let pit = u > d.lip_u() - 2.0 - r
                && u < d.rim_u() + 2.0 + r
                && lat < d.pit_left_m + 2.0 + r
                && lat > -d.pit_right_m - 2.0 - r;
            let det = jj_map::setpiece::detour_lateral(&d, u - u0, u1 - u0);
            // The track and its graded shoulders where it has left the road (a big footprint centred outside could
            // still reach onto it); where it still runs along the road it's the road's own verge.
            let half = d.detour_width_m / 2.0;
            let detour = libm::fabs(det) > hw + half
                && u >= u0 - r
                && u <= u1 + r
                && libm::fabs(lat - det) < half + 3.0 + r;
            core || pit || detour
        })
    };
    // The landing's verges: guard rails there come off (the landing is straight, so no corner loses its rail).
    // (Unless the wayfinding sees a corner along the landing: its rail stays.)
    let corners = crate::biome::wayfinding::corners(&line.pts);
    let bends: Vec<bool> = pieces
        .iter()
        .map(|f| {
            let d = GapLeap::of(f).expect("filtered");
            let base = jj_map::jump::feature_base(map, f);
            let (a, b) = (
                line.offset(base, d.rim_u()),
                line.offset(base, d.end_u() + 5.0),
            );
            corners.iter().any(|c| {
                span_contains(&line, a, b, c.from)
                    || span_contains(&line, a, b, c.to)
                    || span_contains(&line, c.from, c.to, a)
            })
        })
        .collect();
    let landing_verge = |map: &Map, x: f64, z: f64| {
        pieces
            .iter()
            .zip(&bends)
            .filter(|(_, bend)| !**bend)
            .any(|(f, _)| {
                let d = GapLeap::of(f).expect("filtered");
                let road_half = d.kicker.ramp_w / 2.0 + jj_map::jump::EDGE_SLOPE_M;
                local(map, &line, f, x, z).is_some_and(|(u, lat, _)| {
                    u > d.rim_u() - 2.0 && u < d.end_u() + 5.0 && libm::fabs(lat) < road_half + 8.0
                })
            })
    };
    // Wayfinding stays (chevrons, the gantry, corner rails: the detour runs inside corners), except guard rails along
    // the landing: a car that slides wide after a rough landing drives back off the gentle verge instead.
    let keep: Vec<bool> = map
        .dressing
        .iter()
        .map(|p| {
            let (x, z) = (f64::from(p.pose.x) / 1000.0, f64::from(p.pose.z) / 1000.0);
            if p.kit_piece == crate::biome::wayfinding::GUARD_RAIL {
                // Off the landing's verges and out of the detour's way (corner rails stand on corners' outsides; the
                // detour runs inside them).
                let near = (0..line.n())
                    .min_by(|&a, &b| {
                        let d = |i: usize| libm::hypot(line.pts[i].0 - x, line.pts[i].1 - z);
                        d(a).total_cmp(&d(b))
                    })
                    .unwrap_or(0);
                let on_corner = corners.iter().any(|c| {
                    span_contains(
                        &line,
                        (c.from + line.n() - 4) % line.n(),
                        (c.to + 4) % line.n(),
                        near,
                    )
                });
                return !landing_verge(map, x, z)
                    && (on_corner
                        || !blocked(map, x, z, reach_of(&p.kit_piece, &p.params), false));
            }
            // Overhead power lines go only with their poles (below).
            p.kit_piece.starts_with("wayfinding/")
                || p.kit_piece == "town/power-line"
                || !blocked(map, x, z, reach_of(&p.kit_piece, &p.params), p.collides)
        })
        .collect();
    let mut it = keep.iter();
    map.dressing.retain(|_| *it.next().expect("same length"));
    // Nothing stands on the detour's painted track (a footprint reaching onto it from outside the corridor test): a
    // track cell is packed dirt off the route's own band.
    let t = &map.terrain;
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz, cols, rows) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
        t.cols as i64,
        t.rows as i64,
    );
    let road_half = f64::from(map.route.points[0].width) / 2000.0;
    let on_track = |x: f64, z: f64| {
        let (c, r) = (
            libm::round((x - ox) / sp) as i64,
            libm::round((z - oz) / sp) as i64,
        );
        if c < 0 || r < 0 || c >= cols || r >= rows {
            return false;
        }
        t.surfaces[(r * cols + c) as usize] == Surface::PackedDirt
            && crate::assemble::distance_to_loop(&line.pts, (x, z)) > road_half + sp
    };
    let touches_track = |d: &jj_map::Dressing| {
        let Some(fp) = registry
            .get(&d.kit_piece)
            .and_then(|k| k.footprint(&d.params))
        else {
            return false;
        };
        let (x, z) = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
        let a = f64::from(d.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
        let (ca, sa) = (libm::cos(a), libm::sin(a));
        let local: Vec<(f64, f64)> = match fp {
            jj_map::Footprint::Rect { x: w, z: dz, .. } => {
                let (hx, hz) = (w / 2000.0, dz / 2000.0);
                [
                    (-1.0, -1.0),
                    (1.0, -1.0),
                    (1.0, 1.0),
                    (-1.0, 1.0),
                    (0.0, -1.0),
                    (1.0, 0.0),
                    (0.0, 1.0),
                    (-1.0, 0.0),
                    (0.0, 0.0),
                ]
                .iter()
                .map(|(i, j)| (i * hx, j * hz))
                .collect()
            }
            jj_map::Footprint::Circle { radius, .. } => (0..8)
                .map(|k| {
                    let th = f64::from(k) * core::f64::consts::TAU / 8.0;
                    (
                        radius / 1000.0 * libm::cos(th),
                        radius / 1000.0 * libm::sin(th),
                    )
                })
                .chain([(0.0, 0.0)])
                .collect(),
        };
        local
            .iter()
            .any(|(lx, lz)| on_track(x + lx * ca - lz * sa, z + lx * sa + lz * ca))
    };
    let keep: Vec<bool> = map
        .dressing
        .iter()
        .map(|d| {
            d.kit_piece.starts_with("wayfinding/")
                || d.kit_piece == jj_map::kit::ITEM_STATION
                || d.kit_piece == "town/power-line"
                || !touches_track(d)
        })
        .collect();
    let mut it = keep.iter();
    map.dressing.retain(|_| *it.next().expect("same length"));
    // A power line whose pole went goes too (it spans pole to pole).
    let poles: Vec<(f64, f64)> = map
        .dressing
        .iter()
        .filter(|d| d.kit_piece == "town/power-pole")
        .map(|d| (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0))
        .collect();
    map.dressing.retain(|l| {
        if l.kit_piece != "town/power-line" {
            return true;
        }
        let (x, z) = (f64::from(l.pose.x) / 1000.0, f64::from(l.pose.z) / 1000.0);
        let half = l.params.get("lengthMm").copied().unwrap_or(0) as f64 / 2000.0;
        let a = f64::from(l.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
        [-1.0, 1.0].iter().all(|k| {
            let e = (x + k * libm::cos(a) * half, z + k * libm::sin(a) * half);
            poles
                .iter()
                .any(|p| libm::hypot(p.0 - e.0, p.1 - e.1) < 0.05)
        })
    });
    let keep: Vec<bool> = map
        .props
        .iter()
        .map(|p| {
            !blocked(
                map,
                f64::from(p.pose.x) / 1000.0,
                f64::from(p.pose.z) / 1000.0,
                reach_of(&p.kit_piece, &p.params),
                true,
            )
        })
        .collect();
    let mut it = keep.iter();
    map.props.retain(|_| *it.next().expect("same length"));
}

/// Why each of a piece's landmarks is or isn't seen from route point `i` (diagnostics): `("seen", distance m, rise
/// m)`, `("fov", angle off the heading °, 0)` or `("ground", metres along the ray, ground over the ray m)`.
pub fn why_unseen(map: &Map, f: &Feature, data: &Data, i: usize) -> Vec<(&'static str, f64, f64)> {
    let line = Line::new(map);
    let (eye, heading) = chase_eye(map, &line, i, data);
    landmark_tops(map, f, data)
        .into_iter()
        .map(|(target, radius)| {
            let (dx, dy, dz) = (target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
            let dist = libm::hypot(dx, dz);
            let cos = (dx * heading.0 + dz * heading.1) / dist.max(1e-9);
            if cos < libm::cos(data.sight_half_angle_deg.to_radians()) {
                return ("fov", libm::acos(cos.clamp(-1.0, 1.0)).to_degrees(), 0.0);
            }
            let steps = libm::ceil(dist / 2.5) as usize;
            for k in 1..steps {
                let fr = k as f64 / steps as f64;
                if dist * (1.0 - fr) < radius {
                    break;
                }
                let (x, y, z) = (eye[0] + dx * fr, eye[1] + dy * fr, eye[2] + dz * fr);
                let g = crate::terrain::ground_height_m(&map.terrain, x, z);
                if g > y {
                    return ("ground", dist * fr, g - y);
                }
            }
            ("seen", dist, dy)
        })
        .collect()
}
