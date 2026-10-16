//! Set pieces (R132, P1-FL15b): big parametric landforms that own the terrain in their footprint. The first family is
//! the **gap leap** (canyon leap, mesa drop, creek washout): the road runs up a channel to a full-road-width kicker, a
//! gap opens in front of it (a pit a car that commits too slowly falls into, and respawns from), and the far rim is the
//! landing, running down a slope. A safe detour leaves the road before the channel and rejoins after the landing.
//!
//! The map carries what the game needs to play it: the kicker (exact geometry, [`crate::jump::JumpDesign`] with no
//! table or landing ramp, so the sim collides with and the renderer draws the same triangles), the pit (a respawn
//! volume), the landable speed band and the route span it owns. The terrain itself (channel walls, pit, rim, landing,
//! detour) is ordinary heightfield, sculpted by the generator; the validator checks the ballistic flight against that
//! heightfield, so a piece is landable by construction or it doesn't load.
//!
//! Params (integers): `piece` (1 canyon leap, 2 mesa drop, 3 creek washout), `fromAt`/`toAt` (the route points where
//! the piece starts, i.e. where the detour splits and the player commits, and where it ends), the kicker
//! (`rampLengthMm`, `rampWidthMm`, `lipHeightCm`, `blendMm`; the pose is its base on the centerline), `gapLengthMm`
//! (lip to far rim), `pitDepthCm` (pit floor below the take-off ground), `pitLeftMm`/`pitRightMm` (the pit's extent
//! either side of the centerline), `landingLengthMm` (rim to the end of the landing), `minSpeedCmps`/`maxSpeedCmps`
//! (the band a car leaving the lip lands in), `detourSide` (+1 left, -1 right), `detourOffsetMm` and `detourWidthMm`.
//!
//! The **overpass leap** (`piece` 4, R124 br-xlvx.5) is a gap leap over another part of the track: at a figure-eight's
//! crossing the upper road leaves a kicker, flies over the lower road (which runs through the gap, in its cutting) and
//! lands past it. It carries `lowerFrom`/`lowerTo` (the lower road's route span under it) and no detour
//! (`detourWidthMm` 0). Its contract adds: the lower road passes through the gap, never under the kicker or the
//! landing; the slowest car's flight keeps [`limits::OVERPASS_CLEARANCE_M`] over it; and its pit belongs to the upper
//! road only ([`Pit::span`]), so a car that misses falls and respawns, while cars driving the lower road under it never
//! count as fallen in.
//! `f64` and `libm` only, so native and WASM agree to the bit.

use crate::jump::{JumpDesign, ground_height_m};
use crate::model::{Feature, FeatureKind, Map};

/// Safety envelopes for every gap leap (not counts: any number of pieces may be placed).
pub mod limits {
    /// A car leaving the lip at the band's slowest speed comes down at least this far past the far rim.
    pub const RIM_MARGIN_M: f64 = 3.0;
    /// ... and at the fastest, at least this far before the landing's end.
    pub const END_MARGIN_M: f64 = 4.0;
    /// The pit must be at least this deep below the take-off ground, so a miss reads as a fall, not a dip.
    pub const MIN_PIT_DEPTH_CM: i64 = 400;
    pub const MIN_GAP_MM: i64 = 6_000;
    /// Turning allowed between the kicker's base and the end of the landing (the flight is straight), radians.
    pub const MAX_CORE_TURN: f64 = 0.10;
    /// A car's centre this far below the take-off ground inside the gap is in the pit.
    pub const PIT_TRIGGER_M: f64 = 2.0;
    /// Slowest speed band floor a piece may declare, m/s (below it a car can barely climb out of the approach).
    pub const MIN_BAND_SPEED_CMPS: i64 = 1_200;
    /// Height of a car's centre above the ground on its wheels, m: the flight is the centre's.
    pub const RIDE_HEIGHT_M: f64 = 0.5;
    /// An overpass leap's slowest flight keeps the underside of a car (its centre less the ride height) this far above
    /// the lower road, m: a car on it (about 1.6 m tall) and room to spare.
    pub const OVERPASS_CLEARANCE_M: f64 = 4.0;
    /// The cars' body damping in the air, per second (the roster's largest `linear_damping`: Rapier slows a flying
    /// body by it each step). An overpass leap's flight (2 s and more) is flown with it; over that long it costs a
    /// quarter of the distance.
    pub const FLIGHT_DAMPING_PER_S: f64 = 0.19;
}

/// The piece families, as stored in `piece`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PieceKind {
    CanyonLeap,
    MesaDrop,
    CreekWashout,
    OverpassLeap,
}

impl PieceKind {
    pub fn code(self) -> i64 {
        match self {
            Self::CanyonLeap => 1,
            Self::MesaDrop => 2,
            Self::CreekWashout => 3,
            Self::OverpassLeap => 4,
        }
    }

    pub fn from_code(c: i64) -> Option<Self> {
        match c {
            1 => Some(Self::CanyonLeap),
            2 => Some(Self::MesaDrop),
            3 => Some(Self::CreekWashout),
            4 => Some(Self::OverpassLeap),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::CanyonLeap => "canyon-leap",
            Self::MesaDrop => "mesa-drop",
            Self::CreekWashout => "creek-washout",
            Self::OverpassLeap => "overpass-leap",
        }
    }
}

/// A gap leap's design, read from a `set-piece` feature's params.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GapLeap {
    pub kind: PieceKind,
    pub kicker: JumpDesign,
    pub from: u32,
    pub to: u32,
    pub gap_m: f64,
    pub pit_depth_m: f64,
    pub pit_left_m: f64,
    pub pit_right_m: f64,
    pub landing_m: f64,
    pub min_speed: f64,
    pub max_speed: f64,
    pub detour_side: i64,
    pub detour_offset_m: f64,
    pub detour_width_m: f64,
    /// An overpass leap's lower road: its route span under the gap (`lowerFrom`, `lowerTo`).
    pub lower: Option<(u32, u32)>,
}

/// The params a gap leap must carry.
pub const PARAMS: [&str; 18] = [
    "piece",
    "fromAt",
    "toAt",
    "rampLengthMm",
    "rampWidthMm",
    "lipHeightCm",
    "blendMm",
    "gapLengthMm",
    "pitDepthCm",
    "pitLeftMm",
    "pitRightMm",
    "landingLengthMm",
    "minSpeedCmps",
    "maxSpeedCmps",
    "detourSide",
    "detourOffsetMm",
    "detourWidthMm",
    "sharp",
];

impl GapLeap {
    pub fn of(f: &Feature) -> Option<Self> {
        if f.kind != FeatureKind::SetPiece {
            return None;
        }
        let get = |k: &str| f.params.get(k).copied();
        let m = |k: &str| get(k).map(|v| v as f64 / 1000.0);
        Some(Self {
            kind: PieceKind::from_code(get("piece")?)?,
            kicker: JumpDesign {
                ramp_m: m("rampLengthMm")?,
                ramp_w: m("rampWidthMm")?,
                lip: get("lipHeightCm")? as f64 / 100.0,
                table_m: 0.0,
                land_w: m("rampWidthMm")?,
                down_m: 0.0,
                blend_m: m("blendMm")?,
                down_blend_m: 0.0,
            },
            from: u32::try_from(get("fromAt")?).ok()?,
            to: u32::try_from(get("toAt")?).ok()?,
            gap_m: m("gapLengthMm")?,
            pit_depth_m: get("pitDepthCm")? as f64 / 100.0,
            pit_left_m: m("pitLeftMm")?,
            pit_right_m: m("pitRightMm")?,
            landing_m: m("landingLengthMm")?,
            min_speed: get("minSpeedCmps")? as f64 / 100.0,
            max_speed: get("maxSpeedCmps")? as f64 / 100.0,
            detour_side: get("detourSide")?,
            detour_offset_m: m("detourOffsetMm")?,
            detour_width_m: m("detourWidthMm")?,
            lower: match (get("lowerFrom"), get("lowerTo")) {
                (Some(a), Some(b)) => Some((u32::try_from(a).ok()?, u32::try_from(b).ok()?)),
                _ => None,
            },
        })
    }

    /// `u` (m along the route from the kicker's base) of the lip, the far rim and the end of the landing.
    pub fn lip_u(&self) -> f64 {
        self.kicker.ramp_m
    }
    pub fn rim_u(&self) -> f64 {
        self.lip_u() + self.gap_m
    }
    pub fn end_u(&self) -> f64 {
        self.rim_u() + self.landing_m
    }

    /// Launch angle at the lip (radians): the kicker's slope there, steepened by its concave foot.
    pub fn launch_angle(&self) -> f64 {
        let k = &self.kicker;
        libm::atan(k.lip / (k.ramp_m - k.blend_m / 2.0))
    }
}

/// The landing is an exact triangle surface (like a tabletop's down-ramp), standing this far above the heightfield
/// under the road, which the generator lowers by the same amount: a car that bottoms out on landing slides on smooth
/// triangles (`FIX_INTERNAL_EDGES`), never on the grid's internal edges.
pub const LANDING_LIFT_M: f64 = 0.6;
/// The lift tapers to nothing over the landing's last metres, so the road leaves it flush.
pub const LANDING_TAPER_M: f64 = 6.0;
/// ... and rises from nothing over its first metres, so a car coming down at the rim meets no step.
pub const LANDING_RISE_M: f64 = 3.0;
/// Section spacing of the landing surface, m.
pub const LANDING_STEP_M: f64 = 0.5;

/// How far the landing surface stands above the (lowered) ground at `u` from the kicker's base and `lat` left of the
/// centerline: [`LANDING_LIFT_M`] across the flat width, falling to 0 over the side slopes and the taper.
pub fn landing_lift(d: &GapLeap, u: f64, lat: f64) -> f64 {
    if u < d.rim_u() || u > d.end_u() {
        return 0.0;
    }
    LANDING_LIFT_M * JumpDesign::side(d.kicker.land_w, lat) * landing_taper(d.rim_u(), d.end_u(), u)
}

/// The landing lift's taper along `u` (0..1): rising from the far rim (no step at its edge) and falling to the end.
pub fn landing_taper(rim_u: f64, end_u: f64, u: f64) -> f64 {
    let s = |t: f64| {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    };
    s((u - rim_u) / LANDING_RISE_M) * s((end_u - u) / LANDING_TAPER_M)
}

/// The take-off: the lip's surface point (m), the horizontal unit direction of flight, and the ground height under the
/// lip (the kicker stands on it).
pub fn take_off(map: &Map, f: &Feature, d: &GapLeap) -> ([f64; 3], [f64; 2], f64) {
    let lip = crate::jump::surface_point(map, f, &d.kicker, d.lip_u(), 0.0);
    let (_, t) = crate::jump::route_along(map, f, d.lip_u());
    (lip, t, lip[1] - d.kicker.lip)
}

/// Where a car's centre leaving the lip at `speed` m/s comes back down to the ground: the horizontal distance past the
/// lip (m) and the ground's height there, by marching the ballistic flight (no drag, g = 9.81) over the heightfield
/// along the lip's heading. `None` if it never comes down within 8 s.
pub fn touchdown(map: &Map, f: &Feature, d: &GapLeap, speed: f64) -> Option<(f64, f64)> {
    let (lip, t, _) = take_off(map, f, d);
    let a = d.launch_angle();
    let (mut vh, mut vy) = (speed * libm::cos(a), speed * libm::sin(a));
    let (mut x, mut y) = (0.0, lip[1] + limits::RIDE_HEIGHT_M);
    let dt = 1.0 / 240.0;
    let damp = 1.0 / (1.0 + dt * flight_damping(d));
    for _ in 0..(8 * 240) {
        vy -= 9.81 * dt;
        vh *= damp;
        vy *= damp;
        x += vh * dt;
        y += vy * dt;
        let g = ground_height_m(&map.terrain, lip[0] + t[0] * x, lip[2] + t[1] * x)
            + landing_lift(d, d.lip_u() + x, 0.0);
        if vy < 0.0 && y <= g + limits::RIDE_HEIGHT_M {
            return Some((x, g));
        }
    }
    None
}

/// What breaks the gap-leap contract: params, the pit, a straight core and the ballistic landing band.
pub fn problems(map: &Map, f: &Feature) -> Vec<String> {
    let mut out = Vec::new();
    let missing: Vec<&str> = PARAMS
        .iter()
        .copied()
        .filter(|k| !f.params.contains_key(*k))
        .collect();
    if !missing.is_empty() {
        out.push(format!("set-piece needs {}", missing.join(", ")));
        return out;
    }
    let Some(d) = GapLeap::of(f) else {
        out.push("set-piece: unknown `piece` or a negative route index".into());
        return out;
    };
    let n = map.route.points.len() as u32;
    if d.from >= n || d.to >= n {
        out.push(format!(
            "fromAt {} / toAt {} outside the route",
            d.from, d.to
        ));
        return out;
    }
    let p = &f.params;
    if p["gapLengthMm"] < limits::MIN_GAP_MM
        || p["pitDepthCm"] < limits::MIN_PIT_DEPTH_CM
        || p["minSpeedCmps"] < limits::MIN_BAND_SPEED_CMPS
        || p["maxSpeedCmps"] <= p["minSpeedCmps"]
        || p["lipHeightCm"] <= 0
        || p["lipHeightCm"] > crate::limits::MAX_LIP_HEIGHT_CM
        || p["rampLengthMm"] < crate::limits::MIN_RAMP_LENGTH_MM
        || p["blendMm"] < 0
        || p["blendMm"] >= p["rampLengthMm"]
        || p["pitLeftMm"] <= 0
        || p["pitRightMm"] <= 0
        || d.detour_side.abs() != 1
        || p["landingLengthMm"] < crate::limits::MIN_LANDING_LENGTH_MM
        || p["sharp"] != 1
    {
        out.push(format!(
            "gap {} mm (min {}), pit {} cm (min {}), band {}..{} cm/s, lip {} cm, ramp {} mm: out of range",
            p["gapLengthMm"],
            limits::MIN_GAP_MM,
            p["pitDepthCm"],
            limits::MIN_PIT_DEPTH_CM,
            p["minSpeedCmps"],
            p["maxSpeedCmps"],
            p["lipHeightCm"],
            p["rampLengthMm"]
        ));
        return out;
    }
    // The flight is straight: the route may barely bend between the kicker's base and the end of the landing.
    let (_, t0) = crate::jump::route_along(map, f, 0.0);
    let mut worst: f64 = 0.0;
    let mut u = 0.0;
    while u <= d.end_u() {
        let (_, t) = crate::jump::route_along(map, f, u);
        worst = worst.max(libm::fabs(libm::atan2(
            t0[0] * t[1] - t0[1] * t[0],
            t0[0] * t[0] + t0[1] * t[1],
        )));
        u += 2.5;
    }
    if worst > limits::MAX_CORE_TURN {
        out.push(format!(
            "the route turns {:.3} rad between the kicker and the landing's end (max {})",
            worst,
            limits::MAX_CORE_TURN
        ));
    }
    // The pit is a pit: the ground in the middle of the gap is at least the declared depth below the take-off ground.
    let (lip, t, take_off_ground) = take_off(map, f, &d);
    let mid = d.gap_m / 2.0;
    let floor = ground_height_m(&map.terrain, lip[0] + t[0] * mid, lip[2] + t[1] * mid);
    if take_off_ground - floor < d.pit_depth_m * 0.9 {
        out.push(format!(
            "the pit floor is {:.1} m below the take-off ground, declared {:.1} m",
            take_off_ground - floor,
            d.pit_depth_m
        ));
    }
    // Landable by construction: the slowest committed car clears the rim, the fastest lands before the landing ends.
    match touchdown(map, f, &d, d.min_speed) {
        Some((x, _)) if x >= d.gap_m + limits::RIM_MARGIN_M => {}
        other => out.push(format!(
            "at {:.1} m/s a car comes down {} past the lip: needs {:.1} m (gap + rim margin)",
            d.min_speed,
            other.map_or("never".into(), |(x, _)| format!("{x:.1} m")),
            d.gap_m + limits::RIM_MARGIN_M
        )),
    }
    match touchdown(map, f, &d, d.max_speed) {
        Some((x, _)) if x <= d.gap_m + d.landing_m - limits::END_MARGIN_M => {}
        other => out.push(format!(
            "at {:.1} m/s a car comes down {} past the lip: the landing ends at {:.1} m",
            d.max_speed,
            other.map_or("never".into(), |(x, _)| format!("{x:.1} m")),
            d.gap_m + d.landing_m - limits::END_MARGIN_M
        )),
    }
    if d.kind == PieceKind::OverpassLeap {
        out.extend(overpass_problems(map, f, &d));
    } else if d.lower.is_some() {
        out.push("only an overpass leap (piece 4) has a lower road".into());
    }
    out
}

/// The damping a piece's flight is flown with, per second: an overpass leap's long flight with the cars' own
/// ([`limits::FLIGHT_DAMPING_PER_S`]); the shorter gap leaps without (their contract as it stands).
pub fn flight_damping(d: &GapLeap) -> f64 {
    if d.kind == PieceKind::OverpassLeap {
        limits::FLIGHT_DAMPING_PER_S
    } else {
        0.0
    }
}

/// The height (m) of a car's centre `x` m past the lip, leaving it at `speed` m/s (the flight [`touchdown`] marches;
/// `None` once it has come down to the take-off's height without reaching `x`).
pub fn flight_y(map: &Map, f: &Feature, d: &GapLeap, speed: f64, x: f64) -> Option<f64> {
    let (lip, _, _) = take_off(map, f, d);
    let a = d.launch_angle();
    let (mut vh, mut vy) = (speed * libm::cos(a), speed * libm::sin(a));
    let (mut u, mut y) = (0.0, lip[1] + limits::RIDE_HEIGHT_M);
    let dt = 1.0 / 240.0;
    let damp = 1.0 / (1.0 + dt * flight_damping(d));
    for _ in 0..(8 * 240) {
        if u >= x {
            return Some(y);
        }
        vy -= 9.81 * dt;
        vh *= damp;
        vy *= damp;
        u += vh * dt;
        y += vy * dt;
    }
    None
}

/// An overpass leap's own contract: a lower road that runs through the gap (never under the kicker or the landing) with
/// the slowest flight [`limits::OVERPASS_CLEARANCE_M`] clear above it, and no detour.
fn overpass_problems(map: &Map, f: &Feature, d: &GapLeap) -> Vec<String> {
    let mut out = Vec::new();
    let pts = &map.route.points;
    let n = pts.len();
    let Some((a, b)) = d.lower else {
        return vec!["an overpass leap needs lowerFrom and lowerTo".into()];
    };
    if a as usize >= n || b as usize >= n {
        return vec![format!("lowerFrom {a} / lowerTo {b} outside the route")];
    }
    let upper = |i: usize| {
        let (from, to) = (d.from as usize, d.to as usize);
        if from <= to {
            from <= i && i <= to
        } else {
            i >= from || i <= to
        }
    };
    if d.detour_width_m != 0.0 {
        out.push("an overpass leap has no detour (detourWidthMm 0)".into());
    }
    let (lip, t, _) = take_off(map, f, d);
    let half = d.kicker.ramp_w / 2.0;
    let count = (b as usize + n - a as usize) % n + 1;
    let mut through = 0;
    for k in 0..count {
        let i = (a as usize + k) % n;
        if upper(i) {
            out.push(format!(
                "the lower road (point {i}) is part of the leap's own span"
            ));
            break;
        }
        let q = &pts[i];
        let (x, y, z) = (
            f64::from(q.x) / 1000.0,
            f64::from(q.y) / 1000.0,
            f64::from(q.z) / 1000.0,
        );
        let lower_half = f64::from(q.width) / 2000.0;
        let (u, lat) = (
            (x - lip[0]) * t[0] + (z - lip[2]) * t[1],
            -(x - lip[0]) * t[1] + (z - lip[2]) * t[0],
        );
        // Points of the lower road whose roadway reaches into the flight's lane (the kicker's width).
        if lat.abs() > half + lower_half {
            continue;
        }
        if u < -d.kicker.ramp_m - lower_half || u > d.gap_m + d.landing_m + lower_half {
            continue;
        }
        if u < lower_half || u > d.gap_m - lower_half {
            out.push(format!(
                "the lower road (point {i}) runs under the kicker or the landing ({u:.1} m from the lip; the gap is {:.1} m)",
                d.gap_m
            ));
            continue;
        }
        through += 1;
        let clear = flight_y(map, f, d, d.min_speed, u)
            .map_or(f64::NEG_INFINITY, |fy| fy - limits::RIDE_HEIGHT_M - y);
        if clear < limits::OVERPASS_CLEARANCE_M {
            out.push(format!(
                "at {:.1} m/s the flight clears the lower road (point {i}) by {clear:.1} m (min {})",
                d.min_speed,
                limits::OVERPASS_CLEARANCE_M
            ));
        }
    }
    if through == 0 {
        out.push("the lower road never passes through the gap: not an overpass".into());
    }
    out
}

/// A pit as a respawn volume, in the lip's straight frame: a car whose centre is inside the gap's plan rectangle and
/// more than [`limits::PIT_TRIGGER_M`] below the take-off ground has missed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pit {
    pub origin: [f64; 3],
    pub dir: [f64; 2],
    pub length_m: f64,
    pub left_m: f64,
    pub right_m: f64,
    /// Height below which a car inside the rectangle is in the pit, m.
    pub trigger_y: f64,
    /// The route span the pit belongs to (an overpass leap's upper road): only a car racing that stretch has missed;
    /// cars on the lower road under it pass through. `None`: every car inside it has fallen in.
    pub span: Option<(u32, u32)>,
}

impl Pit {
    pub fn contains(&self, x: f64, y: f64, z: f64) -> bool {
        if y >= self.trigger_y {
            return false;
        }
        let (dx, dz) = (x - self.origin[0], z - self.origin[2]);
        let u = dx * self.dir[0] + dz * self.dir[1];
        let lat = -dx * self.dir[1] + dz * self.dir[0];
        u >= 0.0 && u <= self.length_m && lat <= self.left_m && lat >= -self.right_m
    }
}

/// Every set piece's pit on `map`.
pub fn pits(map: &Map) -> Vec<Pit> {
    map.features
        .iter()
        .filter_map(|f| {
            let d = GapLeap::of(f)?;
            let (lip, t, ground) = take_off(map, f, &d);
            // An overpass leap lands lower than it takes off: a car coming down onto its rim isn't in the pit.
            let floor = if d.kind == PieceKind::OverpassLeap {
                ground.min(ground_height_m(
                    &map.terrain,
                    lip[0] + t[0] * d.gap_m,
                    lip[2] + t[1] * d.gap_m,
                ))
            } else {
                ground
            };
            Some(Pit {
                origin: [lip[0], ground, lip[2]],
                dir: t,
                length_m: d.gap_m,
                left_m: d.pit_left_m,
                right_m: d.pit_right_m,
                trigger_y: floor - limits::PIT_TRIGGER_M,
                span: (d.kind == PieceKind::OverpassLeap).then_some((d.from, d.to)),
            })
        })
        .collect()
}

/// Route points strictly inside a piece's gap (the road ribbon isn't drawn there; nothing is placed there).
pub fn gap_points(map: &Map, f: &Feature) -> Vec<usize> {
    let Some(d) = GapLeap::of(f) else {
        return Vec::new();
    };
    let (lip, t, _) = take_off(map, f, &d);
    let n = map.route.points.len();
    let base = crate::jump::feature_base(map, f);
    let mut out = Vec::new();
    for k in 0..n {
        let i = (base + k) % n;
        let q = &map.route.points[i];
        let u =
            (f64::from(q.x) / 1000.0 - lip[0]) * t[0] + (f64::from(q.z) / 1000.0 - lip[2]) * t[1];
        if u > d.gap_m {
            break;
        }
        if u > 0.0 {
            out.push(i);
        }
    }
    out
}

/// The detour's lateral offset ramps in and out over this distance at each end, m.
pub const DETOUR_TURN_M: f64 = 40.0;

/// Smoothstep on 0..=1.
pub fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The detour's lateral offset (m, left positive) `u0` metres after the piece's start on a piece `len` metres long.
pub fn detour_lateral(d: &GapLeap, u0: f64, len: f64) -> f64 {
    let ramp = smoothstep(u0 / DETOUR_TURN_M) * smoothstep((len - u0) / DETOUR_TURN_M);
    d.detour_side as f64 * d.detour_offset_m * ramp
}

/// The safe detour's centerline (m, x and z): one point per route point from `fromAt` to `toAt`, offset sideways. The
/// generator grades and paints the ground along it; the renderer draws its track from the same points.
pub fn detour_path(map: &Map, f: &Feature) -> Vec<[f64; 2]> {
    let Some(d) = GapLeap::of(f) else {
        return Vec::new();
    };
    let pts = &map.route.points;
    let n = pts.len();
    if n < 2 || d.from as usize >= n || d.to as usize >= n {
        return Vec::new();
    }
    let p = |i: usize| {
        [
            f64::from(pts[i % n].x) / 1000.0,
            f64::from(pts[i % n].z) / 1000.0,
        ]
    };
    let count = (d.to as usize + n - d.from as usize) % n + 1;
    let ix: Vec<usize> = (0..count).map(|k| (d.from as usize + k) % n).collect();
    let mut u = vec![0.0; count];
    for k in 1..count {
        let (a, b) = (p(ix[k - 1]), p(ix[k]));
        u[k] = u[k - 1] + libm::hypot(b[0] - a[0], b[1] - a[1]);
    }
    let len = u[count - 1];
    (0..count)
        .map(|k| {
            let (a, b) = (p(ix[k] + n - 1), p(ix[k] + 1));
            let l = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
            let t = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
            let lat = detour_lateral(&d, u[k], len);
            let c = p(ix[k]);
            [c[0] - t[1] * lat, c[1] + t[0] * lat]
        })
        .collect()
}
