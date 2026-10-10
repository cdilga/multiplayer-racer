//! Feature pieces (P1-M03d): jumps with entry and landing envelopes, crests, whoops and creek dips, composed into the
//! route as `jj.map.v1` features and baked into the heightfield, so a car drives them through the same collider the road
//! uses. Run after [`crate::terrain::undulate`] (which writes the heights this adds to).
//!
//! - **Sites** are drawn from the `features` stream along straight stretches (a turn budget over the whole envelope),
//!   clear of the start corridor, of each other, and of the lap seam. Counts come from a per-biome density per km of
//!   route (data, not a cap); a site that can't be found in 64 draws is skipped.
//! - **Jump** (standard, a tabletop since owner playtest 1 found the old 8 % wedge flat): a 4 m wide ramp centred on
//!   the route (the standard line goes over it) up to a 1.1-2.1 m lip (slope 0.16-0.21, ramp 7-10 m), a table at lip height, then a landing ramp back
//!   down to the road, 6 m wide with sloped sides; 4 m of bypass either side (the validator's rule) and a 12 m entry
//!   straight. Too slow and the car lands on the table; at speed it lands on the down-slope; the landing length covers
//!   the flight at the validator's design speed (jj-map's landability rule). Huge jumps are R124's later opt-in.
//! - **Crest / creek dip**: a raised-cosine hump or hollow across the whole road; **whoops**: a run of sine bumps under a
//!   raised-sine envelope. Limits are in [`LIMITS`]: grade and vertical curvature a car at 25 m/s stays grounded over.
//! - **Heights** are written to the grid, and route `y` follows the new ground. The recovery spans leave out each jump's
//!   ramp and landing (a respawn never goes where a car is meant to fly).
//!
//! `pose` is the piece's base on the centerline; `yaw` is the route's heading in centidegrees (0 = +x toward +z, i.e.
//! `atan2(tz, tx)`). Integers in, integers out; `libm` maths only: bytes are identical natively and in WASM.

use std::collections::BTreeMap;

use jj_map::{Biome, Feature, FeatureKind, Map, Pose, Span};

use crate::assemble::{FINISH_AT_M, arc_lengths};
use crate::seed::Rng;
use crate::terrain::ground_height_m;

/// Design limits every placed feature is checked against ([`check_envelope`]).
pub struct Limits {
    pub jump_ramp_m: (f64, f64),
    pub jump_lip_cm: (i64, i64),
    pub jump_ramp_width_mm: i64,
    pub jump_landing_m: (f64, f64),
    /// The tabletop's flat top after the lip, m.
    pub jump_table_m: (f64, f64),
    /// The landing ramp's slope back down to the road (fall over run).
    pub jump_down_slope: f64,
    /// Steepest ramp (rise over run).
    pub jump_ramp_slope: f64,
    /// Gentlest ramp: below it a tabletop barely launches a car.
    pub jump_min_ramp_slope: f64,
    /// Steepest natural road grade across a jump's whole envelope.
    pub jump_road_grade: f64,
    /// Straight run before the ramp's base, m.
    pub entry_m: f64,
    /// Grade and vertical curvature (1/m) any non-jump piece may add; a car at 25 m/s stays grounded at 0.0157.
    pub max_grade: f64,
    pub max_curvature: f64,
    /// Total plan turning allowed over a piece's whole envelope, radians.
    pub max_turn: f64,
    /// Clear distance between two pieces' envelopes, m.
    pub gap_m: f64,
    /// No piece starts before this arc length (the start corridor and a run-up) or ends within `seam_m` of the lap seam.
    pub earliest_m: f64,
    pub seam_m: f64,
}

pub const LIMITS: Limits = Limits {
    jump_ramp_m: (7.0, 10.0),
    jump_lip_cm: (110, 210),
    jump_ramp_width_mm: 4_000,
    jump_landing_m: (34.0, 46.0),
    jump_table_m: (4.0, 8.0),
    jump_down_slope: 0.16,
    jump_ramp_slope: 0.21,
    jump_min_ramp_slope: 0.16,
    jump_road_grade: 0.045,
    entry_m: 12.0,
    max_grade: 0.16,
    max_curvature: 0.012,
    max_turn: 0.12,
    gap_m: 10.0,
    earliest_m: FINISH_AT_M + 20.0,
    seam_m: 10.0,
};
/// Extra straight after a jump's landing before the next turn.
const EXIT_M: f64 = 6.0;
/// Plain margin before and after a crest, whoops run or dip.
const MARGIN_M: f64 = 10.0;
const ATTEMPTS: u32 = 64;
/// Lateral reach of a road-wide piece past the road edge at full strength, and the fade beyond it, m.
const SHOULDER_M: f64 = 2.5;
const FADE_M: f64 = 4.0;

/// How often each piece occurs per km of route, per biome (data; the biome beads own their final mixes).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Density {
    pub jump: f64,
    pub crest: f64,
    pub whoops: f64,
    pub creek: f64,
}

/// The biome's feature mix (each biome's numbers live in its own `biome/<name>.rs`).
pub fn density(biome: Biome) -> Density {
    crate::biome::def(biome).data().features
}

/// The route in metres, with arc lengths and headings.
struct Line {
    pts: Vec<(f64, f64)>,
    s: Vec<f64>,
    total: f64,
    half: f64,
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
        let half = f64::from(map.route.points[0].width) / 2000.0;
        Self {
            pts,
            s,
            total,
            half,
        }
    }

    fn n(&self) -> usize {
        self.pts.len()
    }

    fn tangent(&self, i: usize) -> (f64, f64) {
        let n = self.n();
        let (a, b) = (self.pts[i % n], self.pts[(i + 1) % n]);
        let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    }

    /// Absolute plan turning over points `i0..=i1`, radians.
    fn turn(&self, i0: usize, i1: usize) -> f64 {
        (i0 + 1..=i1)
            .map(|i| {
                let (a, b) = (self.tangent(i - 1), self.tangent(i));
                libm::fabs(libm::atan2(b.0 * a.1 - b.1 * a.0, a.0 * b.0 + a.1 * b.1))
            })
            .sum()
    }

    /// First point index at or beyond arc length `s`.
    fn index_at(&self, s: f64) -> usize {
        self.s.iter().position(|&v| v >= s).unwrap_or(self.n() - 1)
    }

    fn y(&self, map: &Map, i: usize) -> f64 {
        f64::from(map.route.points[i].y) / 1000.0
    }
}

/// A piece's envelope along the route (arc length, m): `from..to` is everything it needs clear and straight, `base` is
/// where its own geometry starts, `len` how long that geometry is.
#[derive(Clone, Copy, Debug)]
struct Zone {
    from: f64,
    base: f64,
    len: f64,
    to: f64,
}

fn zone_of(kind: FeatureKind, base: f64, p: &BTreeMap<String, i64>) -> Zone {
    let get = |k: &str| p.get(k).copied().unwrap_or(0) as f64 / 1000.0;
    let (pre, len, post) = match kind {
        FeatureKind::Jump => (
            LIMITS.entry_m,
            get("rampLengthMm") + get("landingLengthMm"),
            EXIT_M,
        ),
        _ => (MARGIN_M, get("lengthMm"), MARGIN_M),
    };
    Zone {
        from: base - pre,
        base,
        len,
        to: base + len + post,
    }
}

/// How far a feature's envelope reaches before and after its base along the route (m): offsets `(from, to)`.
pub fn extent_m(f: &Feature) -> (f64, f64) {
    let z = zone_of(f.kind, 0.0, &f.params);
    (z.from, z.to)
}

/// Adds the biome's features to `map` (replacing any it has): heights, route `y`, recovery spans, dressing and props
/// regrounded. Call once, right after [`crate::terrain::undulate`].
pub fn place(map: &mut Map, rng: &mut Rng, biome: Biome) {
    let total = Line::new(map).total;
    place_in(map, rng, &[(0.0, total, density(biome))]);
}

/// [`place`] for a route that crosses biomes: `ranges` are `(from, to)` arc lengths (m) with the density that applies
/// there. A piece's whole envelope stays inside one range, so no piece straddles a biome boundary.
pub fn place_in(map: &mut Map, rng: &mut Rng, ranges: &[(f64, f64, Density)]) {
    map.features.clear();
    let line = Line::new(map);
    // Counts per range: whole expected number plus one more with the fractional probability.
    let mut kinds: Vec<(FeatureKind, f64, f64)> = Vec::new();
    for &(from, to, dens) in ranges {
        let km = (to - from) / 1000.0;
        for (kind, per_km) in [
            (FeatureKind::Jump, dens.jump),
            (FeatureKind::Crest, dens.crest),
            (FeatureKind::Whoops, dens.whoops),
            (FeatureKind::CreekDip, dens.creek),
        ] {
            let want = per_km * km;
            let n = libm::floor(want) as usize + usize::from(rng.unit() < want - libm::floor(want));
            kinds.extend(std::iter::repeat_n((kind, from, to), n));
        }
    }
    let mut zones: Vec<Zone> = Vec::new();
    for (kind, from, to) in kinds {
        for _ in 0..ATTEMPTS {
            let params = draw_params(kind, rng);
            let span = zone_of(kind, 0.0, &params);
            let lo = from.max(LIMITS.earliest_m) + (span.base - span.from);
            let hi = to.min(line.total - LIMITS.seam_m) - (span.to - span.base);
            if hi <= lo {
                continue;
            }
            // Snap to a route point so the pose sits exactly on the centerline.
            let i0 = line.index_at(rng.range(lo, hi));
            let zone = zone_of(kind, line.s[i0], &params);
            if zone.from >= from && zone.to <= to && zone_ok(map, &line, kind, &zone, &zones) {
                let (x, z) = line.pts[i0];
                let t = line.tangent(i0);
                map.features.push(Feature {
                    kind,
                    pose: Pose {
                        x: mm(x),
                        y: map.route.points[i0].y,
                        z: mm(z),
                        yaw: libm::round(libm::atan2(t.1, t.0).to_degrees() * 100.0) as i32,
                    },
                    params,
                });
                zones.push(zone);
                break;
            }
        }
    }
    // Stable order: by position along the route, so the bytes don't depend on draw order.
    let order = |f: &Feature| {
        let i = line.index_at(zone_base(&line, f));
        (i, f.kind)
    };
    map.features.sort_by_key(order);
    bake(map, &line);
    carve_recovery(map, &line);
}

fn mm(v: f64) -> i32 {
    libm::round(v * 1000.0) as i32
}

fn draw_params(kind: FeatureKind, rng: &mut Rng) -> BTreeMap<String, i64> {
    let mut p = BTreeMap::new();
    let whole =
        |rng: &mut Rng, lo: f64, hi: f64, step: f64| libm::round(rng.range(lo, hi) / step) as i64;
    match kind {
        FeatureKind::Jump => {
            // The ramp's length and slope are drawn and the lip follows: no shallow ramp (on a tabletop the air time is
            // 2·v·sin(angle)/g, so a gentle ramp is a flat jump, owner playtest 1), and the ramp spans at least three
            // cells of the 2.5 m height grid (a shorter one bakes lumpy and barely launches).
            let ramp_mm = whole(rng, LIMITS.jump_ramp_m.0, LIMITS.jump_ramp_m.1, 0.5) * 500;
            let slope = rng.range(LIMITS.jump_min_ramp_slope, LIMITS.jump_ramp_slope);
            let lip = (libm::floor(ramp_mm as f64 / 1000.0 * slope * 20.0) as i64 * 5)
                .clamp(LIMITS.jump_lip_cm.0, LIMITS.jump_lip_cm.1);
            p.insert("rampLengthMm".into(), ramp_mm);
            p.insert("rampWidthMm".into(), LIMITS.jump_ramp_width_mm);
            p.insert("lipHeightCm".into(), lip);
            p.insert(
                "tableLengthMm".into(),
                whole(rng, LIMITS.jump_table_m.0, LIMITS.jump_table_m.1, 1.0) * 1000,
            );
            // The landing reaches past the flight at the validator's design speed, with 4 m to spare.
            let flight = jj_map::limits::jump_flight_m(
                lip,
                p["rampLengthMm"],
                jj_map::limits::JUMP_DESIGN_SPEED_MPS,
            );
            let land = whole(rng, LIMITS.jump_landing_m.0, LIMITS.jump_landing_m.1, 1.0) * 1000;
            p.insert(
                "landingLengthMm".into(),
                land.max(((flight + 4.0) as i64 + 1) * 1000),
            );
            p.insert("landingWidthMm".into(), 6_000);
        }
        FeatureKind::Crest => {
            let len = whole(rng, 30.0, 60.0, 5.0) * 5;
            // Gentle enough that a car at 25 m/s stays grounded: vertical curvature 2π²·H/L² <= LIMITS.max_curvature.
            let top = libm::floor(0.0004 * (len * len) as f64 * 10.0) as i64 * 10;
            let height = (whole(rng, 30.0, 100.0, 10.0) * 10).min(top.max(30));
            p.insert("lengthMm".into(), len * 1000);
            p.insert("heightCm".into(), height);
        }
        FeatureKind::Whoops => {
            p.insert("pitchMm".into(), whole(rng, 10.0, 13.0, 1.0) * 1_000);
            let bumps = 4 + (rng.next_u64() % 5) as i64;
            p.insert("lengthMm".into(), bumps * p["pitchMm"]);
            p.insert("heightCm".into(), whole(rng, 12.0, 20.0, 2.0) * 2);
        }
        FeatureKind::CreekDip => {
            p.insert("lengthMm".into(), whole(rng, 16.0, 24.0, 2.0) * 2_000);
            p.insert("depthCm".into(), whole(rng, 30.0, 50.0, 10.0) * 10);
        }
        FeatureKind::Kerb => {}
    }
    p
}

/// Where a feature's own geometry starts along the route: its pose's nearest point.
fn zone_base(line: &Line, f: &Feature) -> f64 {
    let p = (f64::from(f.pose.x) / 1000.0, f64::from(f.pose.z) / 1000.0);
    let i = (0..line.n())
        .min_by(|&a, &b| {
            let d = |i: usize| (line.pts[i].0 - p.0).powi(2) + (line.pts[i].1 - p.1).powi(2);
            d(a).total_cmp(&d(b))
        })
        .unwrap_or(0);
    line.s[i]
}

/// Whether a site satisfies the placement rules (straight, in range, clear of earlier pieces, gentle road for a jump).
fn zone_ok(map: &Map, line: &Line, kind: FeatureKind, z: &Zone, taken: &[Zone]) -> bool {
    if z.from < LIMITS.earliest_m || z.to > line.total - LIMITS.seam_m {
        return false;
    }
    if taken
        .iter()
        .any(|o| z.from < o.to + LIMITS.gap_m && o.from < z.to + LIMITS.gap_m)
    {
        return false;
    }
    let (i0, i1) = (line.index_at(z.from), line.index_at(z.to));
    if line.turn(i0, i1) > LIMITS.max_turn {
        return false;
    }
    if kind == FeatureKind::Jump {
        let worst = (i0..i1)
            .map(|i| {
                libm::fabs(line.y(map, i + 1) - line.y(map, i))
                    / (line.s[i + 1] - line.s[i]).max(1e-9)
            })
            .fold(0.0, f64::max);
        if worst > LIMITS.jump_road_grade {
            return false;
        }
    }
    true
}

/// A piece's height change (m) at distance `u` along its geometry and lateral offset `lat` from the centerline.
fn delta(
    kind: FeatureKind,
    p: &BTreeMap<String, i64>,
    u: f64,
    lat: f64,
    half: f64,
    spacing: f64,
) -> f64 {
    let get = |k: &str| p.get(k).copied().unwrap_or(0) as f64;
    let road_wide = || {
        let k = ((half + SHOULDER_M + FADE_M - libm::fabs(lat)) / FADE_M).clamp(0.0, 1.0);
        k * k * (3.0 - 2.0 * k)
    };
    match kind {
        FeatureKind::Jump => {
            let (l, lip) = (get("rampLengthMm") / 1000.0, get("lipHeightCm") / 100.0);
            let (table, down) = (get("tableLengthMm") / 1000.0, lip / LIMITS.jump_down_slope);
            let (w, lw) = (get("rampWidthMm") / 1000.0, get("landingWidthMm") / 1000.0);
            if u < 0.0 || u > l + table + down {
                return 0.0;
            }
            if u <= l {
                // The ramp, one cell wide at the edges: the window tapers over a grid spacing.
                let side = ((w / 2.0 - libm::fabs(lat)) / spacing + 0.5).clamp(0.0, 1.0);
                // A kicker: steeper toward the lip (height ∝ (u/l)^1.6), so the take-off survives the 2.5 m grid.
                return lip * libm::pow(u / l, 1.6) * side;
            }
            // The table and the landing ramp: wider than the ramp, their sides sloping down over 1.5 m so a car that
            // lands off the line drives off them instead of dropping off a wall.
            let side = ((lw / 2.0 + 1.5 - libm::fabs(lat)) / 1.5).clamp(0.0, 1.0);
            let h = if u <= l + table {
                lip
            } else {
                lip * (1.0 - (u - l - table) / down)
            };
            h * side
        }
        FeatureKind::Crest | FeatureKind::CreekDip => {
            let len = get("lengthMm") / 1000.0;
            if !(0.0..=len).contains(&u) {
                return 0.0;
            }
            let h = if kind == FeatureKind::Crest {
                get("heightCm") / 100.0
            } else {
                -get("depthCm") / 100.0
            };
            let t = u / len;
            h / 2.0 * (1.0 - libm::cos(core::f64::consts::TAU * t)) * road_wide()
        }
        FeatureKind::Whoops => {
            let (len, pitch) = (get("lengthMm") / 1000.0, get("pitchMm") / 1000.0);
            if !(0.0..=len).contains(&u) {
                return 0.0;
            }
            let env = libm::sin(core::f64::consts::PI * u / len);
            get("heightCm") / 100.0
                * env
                * env
                * libm::sin(core::f64::consts::TAU * u / pitch)
                * road_wide()
        }
        FeatureKind::Kerb => 0.0,
    }
}

/// Adds every feature's heights to the grid and lets the route's `y` and the placed pieces follow the new ground.
fn bake(map: &mut Map, line: &Line) {
    let before = map.terrain.clone();
    let (cols, rows) = (before.cols as usize, before.rows as usize);
    let sp = f64::from(before.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(before.origin_x) / 1000.0,
        f64::from(before.origin_z) / 1000.0,
    );
    let reach = line.half + SHOULDER_M + FADE_M;
    let mut add = vec![0.0f64; cols * rows];
    for f in &map.features {
        let base = zone_base(line, f);
        let zone = zone_of(f.kind, base, &f.params);
        // Each cell takes the nearest route point's frame: u along the route, lat to its right.
        let mut best: BTreeMap<usize, (f64, f64, f64)> = BTreeMap::new();
        for i in line.index_at(zone.from - reach)..=line.index_at(zone.to + reach) {
            let (px, pz) = line.pts[i];
            let (tx, tz) = line.tangent(i);
            let c0 = libm::floor(((px - reach - ox) / sp).max(0.0)) as usize;
            let c1 = (libm::ceil(((px + reach - ox) / sp).max(0.0)) as usize).min(cols - 1);
            let r0 = libm::floor(((pz - reach - oz) / sp).max(0.0)) as usize;
            let r1 = (libm::ceil(((pz + reach - oz) / sp).max(0.0)) as usize).min(rows - 1);
            for r in r0..=r1 {
                for c in c0..=c1 {
                    let (dx, dz) = (ox + c as f64 * sp - px, oz + r as f64 * sp - pz);
                    let d2 = dx * dx + dz * dz;
                    let e = best
                        .entry(r * cols + c)
                        .or_insert((f64::INFINITY, 0.0, 0.0));
                    if d2 < e.0 {
                        *e = (d2, line.s[i] + dx * tx + dz * tz, dx * -tz + dz * tx);
                    }
                }
            }
        }
        for (at, (_, u, lat)) in best {
            add[at] += delta(f.kind, &f.params, u - base, lat, line.half, sp);
        }
    }
    for (h, d) in map.terrain.heights.iter_mut().zip(&add) {
        *h = (i32::from(*h) + libm::round(d * 100.0) as i32) as i16;
    }
    for (i, q) in map.route.points.iter_mut().enumerate() {
        let (x, z) = line.pts[i];
        let was = ground_height_m(&before, x, z);
        let now = ground_height_m(&map.terrain, x, z);
        q.y += libm::round((now - was) * 1000.0) as i32;
    }
    let terrain = map.terrain.clone();
    for pose in map
        .dressing
        .iter_mut()
        .map(|d| &mut d.pose)
        .chain(map.props.iter_mut().map(|q| &mut q.pose))
    {
        let y = ground_height_m(
            &terrain,
            f64::from(pose.x) / 1000.0,
            f64::from(pose.z) / 1000.0,
        );
        pose.y = mm(y);
    }
    for f in &mut map.features {
        let i = line.index_at(zone_base(line, f));
        f.pose.y = map.route.points[i].y;
    }
}

/// Recovery everywhere except each jump's ramp and landing.
fn carve_recovery(map: &mut Map, line: &Line) {
    let n = line.n();
    let mut open = vec![true; n];
    for f in map.features.iter().filter(|f| f.kind == FeatureKind::Jump) {
        let z = zone_of(f.kind, zone_base(line, f), &f.params);
        for flag in &mut open[line.index_at(z.base)..=line.index_at(z.base + z.len).min(n - 1)] {
            *flag = false;
        }
    }
    let mut spans = Vec::new();
    let mut from = None;
    for (i, &o) in open.iter().enumerate() {
        match (o, from) {
            (true, None) => from = Some(i),
            (false, Some(a)) => {
                spans.push(Span {
                    from: a as u32,
                    to: (i - 1) as u32,
                });
                from = None;
            }
            _ => {}
        }
    }
    if let Some(a) = from {
        spans.push(Span {
            from: a as u32,
            to: (n - 1) as u32,
        });
    }
    map.route.recovery = spans;
}

/// Every placed feature against its envelope; the reasons it fails, empty when all pass. Reads only the map, so it
/// checks a loaded map as well as a generated one.
pub fn check_envelope(map: &Map) -> Vec<String> {
    let mut bad = Vec::new();
    let line = Line::new(map);
    let n = line.n();
    let mut zones: Vec<(usize, Zone)> = Vec::new();
    for (k, f) in map.features.iter().enumerate() {
        let name = format!("features[{k}] {:?}", f.kind);
        let get = |key: &str| f.params.get(key).copied();
        let base = zone_base(&line, f);
        let z = zone_of(f.kind, base, &f.params);
        let (i0, i1) = (line.index_at(z.from), line.index_at(z.to).min(n - 1));
        if z.from < LIMITS.earliest_m || z.to > line.total - LIMITS.seam_m {
            bad.push(format!(
                "{name}: envelope {:.0}..{:.0} m is outside the track's usable run",
                z.from, z.to
            ));
        }
        if line.turn(i0, i1) > LIMITS.max_turn + 1e-9 {
            bad.push(format!(
                "{name}: bends {:.2} rad inside its envelope",
                line.turn(i0, i1)
            ));
        }
        let (px, pz) = line.pts[line.index_at(base)];
        if (f64::from(f.pose.x) / 1000.0 - px).abs() > 0.01
            || (f64::from(f.pose.z) / 1000.0 - pz).abs() > 0.01
        {
            bad.push(format!("{name}: pose is off the centerline"));
        }
        let in_range =
            |key: &str, lo: f64, hi: f64, scale: f64, bad: &mut Vec<String>| match get(key) {
                Some(v) if (lo..=hi).contains(&(v as f64 / scale)) => {}
                other => bad.push(format!("{name}: {key} {other:?} outside {lo}..={hi}")),
            };
        // Centerline heights across the envelope, at the points.
        let h = |i: usize| ground_height_m(&map.terrain, line.pts[i % n].0, line.pts[i % n].1);
        match f.kind {
            FeatureKind::Jump => {
                in_range(
                    "rampLengthMm",
                    LIMITS.jump_ramp_m.0,
                    LIMITS.jump_ramp_m.1,
                    1000.0,
                    &mut bad,
                );
                in_range(
                    "lipHeightCm",
                    LIMITS.jump_lip_cm.0 as f64,
                    LIMITS.jump_lip_cm.1 as f64,
                    1.0,
                    &mut bad,
                );
                in_range(
                    "landingLengthMm",
                    LIMITS.jump_landing_m.0,
                    LIMITS.jump_landing_m.1 + 100.0,
                    1000.0,
                    &mut bad,
                );
                if get("rampWidthMm") != Some(LIMITS.jump_ramp_width_mm) {
                    bad.push(format!("{name}: ramp width {:?}", get("rampWidthMm")));
                }
                if let (Some(l), Some(lip)) = (get("rampLengthMm"), get("lipHeightCm")) {
                    let slope = lip as f64 / 100.0 / (l as f64 / 1000.0);
                    if slope > LIMITS.jump_ramp_slope + 1e-9 {
                        bad.push(format!("{name}: ramp slope {slope:.3}"));
                    }
                }
                // Entry and landing: the road itself stays gentle across the whole envelope (the ramp, table and
                // landing ramp are the feature; the entry and the run-out after the landing ramp are plain road).
                let lip_m = get("lipHeightCm").unwrap_or(0) as f64 / 100.0;
                let ramp_end = z.base
                    + get("rampLengthMm").unwrap_or(0) as f64 / 1000.0
                    + get("tableLengthMm").unwrap_or(0) as f64 / 1000.0
                    + lip_m / LIMITS.jump_down_slope;
                let (e0, r0) = (line.index_at(z.from), line.index_at(z.base));
                // The drop beyond the lip (a grid cell or two) is the jump itself; the landing proper starts 6 m on.
                let (l0, l1) = (line.index_at(ramp_end + 6.0), line.index_at(z.base + z.len));
                for (a, b, what) in [(e0, r0, "entry"), (l0, l1, "landing")] {
                    for i in a..b.min(n - 1) {
                        let g = libm::fabs(h(i + 1) - h(i)) / (line.s[i + 1] - line.s[i]).max(1e-9);
                        // The cm grid and a 1.5-cell cliff beside the ramp's end show up as a few extra percent.
                        if g > LIMITS.jump_road_grade + 0.03 {
                            bad.push(format!("{name}: {what} grade {g:.3}"));
                        }
                    }
                }
            }
            FeatureKind::Crest | FeatureKind::CreekDip => {
                in_range("lengthMm", 16.0, 60.0, 1000.0, &mut bad);
                let key = if f.kind == FeatureKind::Crest {
                    "heightCm"
                } else {
                    "depthCm"
                };
                in_range(key, 30.0, 100.0, 1.0, &mut bad);
                // A crest must keep a car grounded; a dip only compresses it, so it may be sharper.
                let curv = if f.kind == FeatureKind::Crest {
                    LIMITS.max_curvature
                } else {
                    0.045
                };
                shape_ok(&name, &line, &h, i0, i1, Some(curv), &mut bad);
            }
            FeatureKind::Whoops => {
                in_range("pitchMm", 10.0, 13.0, 1000.0, &mut bad);
                in_range("heightCm", 12.0, 20.0, 1.0, &mut bad);
                // Whoops are rough by design: grade only.
                shape_ok(&name, &line, &h, i0, i1, None, &mut bad);
            }
            FeatureKind::Kerb => {}
        }
        for (j, o) in &zones {
            if z.from < o.to + LIMITS.gap_m - 1e-9 && o.from < z.to + LIMITS.gap_m - 1e-9 {
                bad.push(format!("{name}: envelope overlaps features[{j}]"));
            }
        }
        zones.push((k, z));
    }
    bad
}

/// Grade and vertical curvature along the centerline inside an envelope, on the grid the car drives.
fn shape_ok(
    name: &str,
    line: &Line,
    h: &dyn Fn(usize) -> f64,
    i0: usize,
    i1: usize,
    curv: Option<f64>,
    bad: &mut Vec<String>,
) {
    let step = 2usize; // 5 m
    for i in i0..i1.saturating_sub(step) {
        let run = line.s[i + step] - line.s[i];
        let g = libm::fabs(h(i + step) - h(i)) / run.max(1e-9);
        // Natural road grade rides underneath: allow the biome's largest on top of the piece's own.
        if g > LIMITS.max_grade + 0.06 {
            bad.push(format!("{name}: grade {g:.3} at point {i}"));
        }
        if let (Some(max), true) = (curv, i >= i0 + step) {
            let k = libm::fabs(h(i + step) - 2.0 * h(i) + h(i - step)) / (run * run);
            if k > max + 0.004 {
                bad.push(format!("{name}: vertical curvature {k:.4} at point {i}"));
            }
        }
    }
}
