//! The structural validator (plan §8.1). It runs on every map, in the browser too, and names the rule each problem
//! breaks. It never caps anything: the start corridor is checked as a rule (rows clear at the declared spacing), not
//! for any particular N (§7.5).

use serde::Serialize;

use crate::canon::{gameplay_hash, hex};
use crate::geom::{RouteGeom, footprint_points};
use crate::kit::{Footprint, Registry};
use crate::model::{FeatureKind, MAP_VERSION, Map, Pose, Surface};

/// Thresholds. DEFAULT values, TUNE at the feel playtests; changing one is a data change with a fixture.
pub mod limits {
    /// Narrowest drivable width anywhere on the route (two cars abreast with room).
    pub const MIN_DRIVABLE_WIDTH_MM: u32 = 8_000;
    /// Thinnest collider a static piece may have (a thinner wall lets fast cars tunnel through).
    pub const MIN_WALL_THICKNESS_MM: f64 = 250.0;
    /// Gates every ~40 m (§7.5); never more than this apart along the route.
    pub const MAX_GATE_SPACING_MM: f64 = 80_000.0;
    pub const MIN_GATES: usize = 3;
    /// A gate loop must enclose at least this much area (else lap detection is ambiguous).
    pub const MIN_GATE_LOOP_AREA_MM2: f64 = 1.0e6;
    /// Landing envelope after a jump's ramp.
    pub const MIN_LANDING_LENGTH_MM: i64 = 20_000;
    /// A jump leaves a flat lane at least this wide beside its ramp.
    pub const MIN_BYPASS_WIDTH_MM: f64 = 4_000.0;
    pub const MIN_RAMP_LENGTH_MM: i64 = 3_000;
    pub const MAX_LIP_HEIGHT_CM: i64 = 300;
    /// A kerb across the road stays drivable.
    pub const MAX_KERB_HEIGHT_CM: i64 = 20;
    /// Start grid: rows and columns no tighter than a car needs.
    pub const MIN_ROW_SPACING_MM: u32 = 6_000;
    pub const MIN_COLUMN_SPACING_MM: u32 = 3_000;
    /// Nothing taller than this stands within this margin of the drivable corridor (chase-camera line of sight).
    pub const CAMERA_MARGIN_MM: f64 = 2_000.0;
    pub const CAMERA_LOW_MM: f64 = 1_500.0;
}
use limits::*;

/// The named rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rule {
    /// The JSON doesn't parse, has an unknown field, misses a gameplay field, or the bytes aren't canonical.
    Schema,
    Version,
    Header,
    Bounds,
    Terrain,
    RouteShape,
    DrivableWidth,
    WallThickness,
    Gates,
    GateWinding,
    RouteObstructed,
    LandingEnvelope,
    JumpBypass,
    FeatureParams,
    StartCorridor,
    CameraClearance,
    Recovery,
    Segments,
    RefLap,
    UnknownKitPiece,
    KitParams,
    RegistryCollider,
    RegistrySchema,
    GameplayHash,
}

impl Rule {
    pub fn name(self) -> &'static str {
        match self {
            Self::Schema => "schema",
            Self::Version => "version",
            Self::Header => "header",
            Self::Bounds => "bounds",
            Self::Terrain => "terrain",
            Self::RouteShape => "route-shape",
            Self::DrivableWidth => "drivable-width",
            Self::WallThickness => "wall-thickness",
            Self::Gates => "gates",
            Self::GateWinding => "gate-winding",
            Self::RouteObstructed => "route-obstructed",
            Self::LandingEnvelope => "landing-envelope",
            Self::JumpBypass => "jump-bypass",
            Self::FeatureParams => "feature-params",
            Self::StartCorridor => "start-corridor",
            Self::CameraClearance => "camera-clearance",
            Self::Recovery => "recovery",
            Self::Segments => "segments",
            Self::RefLap => "ref-lap",
            Self::UnknownKitPiece => "unknown-kit-piece",
            Self::KitParams => "kit-params",
            Self::RegistryCollider => "registry-collider",
            Self::RegistrySchema => "registry-schema",
            Self::GameplayHash => "gameplay-hash",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Violation {
    pub rule: Rule,
    /// Where: a JSON-ish path (`route.points[12]`, `dressing[3]`, `kit generic/post`).
    pub at: String,
    pub detail: String,
}

impl Violation {
    pub fn new(rule: Rule, at: &str, detail: String) -> Self {
        Self {
            rule,
            at: at.to_owned(),
            detail,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Report {
    pub ok: bool,
    pub violations: Vec<Violation>,
}

impl Report {
    pub fn of(violations: Vec<Violation>) -> Self {
        Self {
            ok: violations.is_empty(),
            violations,
        }
    }

    pub fn has(&self, rule: Rule) -> bool {
        self.violations.iter().any(|v| v.rule == rule)
    }
}

/// An obstacle in plan view for the corridor checks.
struct Solid<'a> {
    what: String,
    pose: &'a Pose,
    fp: Footprint,
}

fn add(v: &mut Vec<Violation>, rule: Rule, at: &str, detail: String) {
    v.push(Violation::new(rule, at, detail));
}

pub fn validate(map: &Map, registry: &Registry) -> Report {
    let mut v: Vec<Violation> = registry.problems().to_vec();

    // Header
    if map.header.version != MAP_VERSION {
        add(
            &mut v,
            Rule::Version,
            "header.version",
            format!("{:?}, expected {MAP_VERSION:?}", map.header.version),
        );
    }
    if map.header.generator.id.is_empty() || map.header.biomes.is_empty() {
        add(
            &mut v,
            Rule::Header,
            "header",
            "generator id and at least one biome are required".into(),
        );
    }
    if map.header.ref_lap_ms == 0 {
        add(
            &mut v,
            Rule::RefLap,
            "header.refLapMs",
            "must be positive".into(),
        );
    }
    let b = map.header.bounds;
    if b.min_x >= b.max_x || b.min_z >= b.max_z {
        add(&mut v, Rule::Bounds, "header.bounds", "empty bounds".into());
    }
    let inside = |x: i32, z: i32| x >= b.min_x && x <= b.max_x && z >= b.min_z && z <= b.max_z;

    // Terrain
    let t = &map.terrain;
    let cells = u64::from(t.cols) * u64::from(t.rows);
    if t.spacing == 0
        || t.cols < 2
        || t.rows < 2
        || t.heights.len() as u64 != cells
        || t.surfaces.len() as u64 != cells
    {
        add(
            &mut v,
            Rule::Terrain,
            "terrain",
            format!(
                "{}×{} grid needs {cells} heights and surfaces, has {} and {}",
                t.cols,
                t.rows,
                t.heights.len(),
                t.surfaces.len()
            ),
        );
    } else {
        let far_x = i64::from(t.origin_x) + i64::from(t.spacing) * i64::from(t.cols - 1);
        let far_z = i64::from(t.origin_z) + i64::from(t.spacing) * i64::from(t.rows - 1);
        if t.origin_x > b.min_x
            || t.origin_z > b.min_z
            || far_x < i64::from(b.max_x)
            || far_z < i64::from(b.max_z)
        {
            add(
                &mut v,
                Rule::Terrain,
                "terrain",
                "the heightfield doesn't cover the bounds".into(),
            );
        }
    }

    // Route shape and width
    let r = &map.route;
    let n = r.points.len();
    if n < 3 {
        add(
            &mut v,
            Rule::RouteShape,
            "route.points",
            format!("{n} points; a route needs at least 3"),
        );
        return Report::of(v);
    }
    for (i, p) in r.points.iter().enumerate() {
        let at = format!("route.points[{i}]");
        if !inside(p.x, p.z) {
            add(&mut v, Rule::Bounds, &at, "outside the bounds".into());
        }
        if p.surface == Surface::OffTrack {
            add(
                &mut v,
                Rule::RouteShape,
                &at,
                "the route can't be off-track".into(),
            );
        }
        if p.width < MIN_DRIVABLE_WIDTH_MM {
            add(
                &mut v,
                Rule::DrivableWidth,
                &at,
                format!("{} mm wide, minimum {MIN_DRIVABLE_WIDTH_MM}", p.width),
            );
        }
        let q = r.points[(i + 1) % n];
        if (i + 1 < n || r.closed)
            && (i64::from(q.x) - i64::from(p.x)).abs() + (i64::from(q.z) - i64::from(p.z)).abs()
                < 100
        {
            add(
                &mut v,
                Rule::RouteShape,
                &at,
                "a point repeats its neighbour (closer than 0.1 m)".into(),
            );
        }
    }
    let geom = RouteGeom::new(r);
    let idx_ok = |i: u32| (i as usize) < n;

    // Gates: order, finish, spacing, winding
    let mut gates = r.gates.clone();
    gates.sort();
    if gates.len() < MIN_GATES {
        add(
            &mut v,
            Rule::Gates,
            "route.gates",
            format!("{} gates; at least {MIN_GATES}", gates.len()),
        );
    }
    if gates.windows(2).any(|w| w[0].at == w[1].at) || gates.iter().any(|g| !idx_ok(g.at)) {
        add(
            &mut v,
            Rule::Gates,
            "route.gates",
            "gates must sit on distinct route points".into(),
        );
    }
    let finishes = gates.iter().filter(|g| g.finish).count();
    if finishes != 1 {
        add(
            &mut v,
            Rule::Gates,
            "route.gates",
            format!("{finishes} finish gates; exactly one"),
        );
    }
    if gates.len() >= 2 && gates.iter().all(|g| idx_ok(g.at)) {
        let s: Vec<f64> = gates.iter().map(|g| geom.s_of(g.at as usize)).collect();
        let mut gaps: Vec<(usize, f64)> = s
            .windows(2)
            .enumerate()
            .map(|(k, w)| (k, w[1] - w[0]))
            .collect();
        if r.closed {
            gaps.push((s.len() - 1, geom.total - s[s.len() - 1] + s[0]));
        }
        for (k, gap) in gaps {
            if gap > MAX_GATE_SPACING_MM {
                add(
                    &mut v,
                    Rule::Gates,
                    &format!("route.gates[{k}]"),
                    format!(
                        "{:.1} m to the next gate, maximum {:.0}",
                        gap / 1000.0,
                        MAX_GATE_SPACING_MM / 1000.0
                    ),
                );
            }
        }
        if r.closed && gates.len() >= MIN_GATES {
            let pts: Vec<(f64, f64)> = gates.iter().map(|g| geom.point(g.at as usize)).collect();
            let area: f64 = pts
                .iter()
                .zip(pts.iter().cycle().skip(1))
                .map(|(a, b)| a.0 * b.1 - b.0 * a.1)
                .sum::<f64>()
                / 2.0;
            if area.abs() < MIN_GATE_LOOP_AREA_MM2 {
                add(
                    &mut v,
                    Rule::GateWinding,
                    "route.gates",
                    format!(
                        "the gates enclose {:.3} m²: a degenerate (collinear) loop",
                        area.abs() / 1.0e6
                    ),
                );
            }
        }
    }

    // Kit pieces: known ids, params in range, footprints
    let mut solids: Vec<Solid> = Vec::new();
    let mut props: Vec<Solid> = Vec::new();
    let check_piece = |kind: &str,
                       i: usize,
                       id: &str,
                       params: &crate::model::Params,
                       pose: &Pose,
                       v: &mut Vec<Violation>|
     -> Option<Footprint> {
        let at = format!("{kind}[{i}]");
        if !inside(pose.x, pose.z) {
            v.push(Violation::new(
                Rule::Bounds,
                &at,
                "outside the bounds".into(),
            ));
        }
        let Some(piece) = registry.get(id) else {
            v.push(Violation::new(
                Rule::UnknownKitPiece,
                &at,
                format!("{id:?} isn't in the kit-piece registry"),
            ));
            return None;
        };
        for (name, value) in params {
            match piece.params.get(name) {
                None => v.push(Violation::new(
                    Rule::KitParams,
                    &at,
                    format!("{id} has no param {name:?}"),
                )),
                Some(spec) if *value < spec.min || *value > spec.max => v.push(Violation::new(
                    Rule::KitParams,
                    &at,
                    format!("{name} = {value}, allowed {}..={}", spec.min, spec.max),
                )),
                _ => {}
            }
        }
        piece.footprint(params)
    };
    for (i, d) in map.dressing.iter().enumerate() {
        if let Some(fp) = check_piece("dressing", i, &d.kit_piece, &d.params, &d.pose, &mut v) {
            if d.collides && fp.thickness() < MIN_WALL_THICKNESS_MM {
                v.push(Violation::new(
                    Rule::WallThickness,
                    &format!("dressing[{i}]"),
                    format!(
                        "{} collider {:.0} mm thick, minimum {MIN_WALL_THICKNESS_MM:.0}",
                        d.kit_piece,
                        fp.thickness()
                    ),
                ));
            }
            // Chase-camera clearance: nothing tall at the road's edge.
            let pts = footprint_points(&fp, &d.pose);
            let near_road = pts.iter().any(|p| {
                let nr = geom.nearest(p.0, p.1);
                nr.lateral.abs() <= nr.half + CAMERA_MARGIN_MM
            });
            if near_road && fp.height() > CAMERA_LOW_MM {
                v.push(Violation::new(
                    Rule::CameraClearance,
                    &format!("dressing[{i}]"),
                    format!(
                        "{} is {:.1} m tall within {:.0} m of the road",
                        d.kit_piece,
                        fp.height() / 1000.0,
                        CAMERA_MARGIN_MM / 1000.0
                    ),
                ));
            }
            if d.collides {
                solids.push(Solid {
                    what: format!("dressing[{i}] {}", d.kit_piece),
                    pose: &d.pose,
                    fp,
                });
            }
        }
    }
    for (i, p) in map.props.iter().enumerate() {
        if let Some(fp) = check_piece("props", i, &p.kit_piece, &p.params, &p.pose, &mut v) {
            props.push(Solid {
                what: format!("props[{i}] {}", p.kit_piece),
                pose: &p.pose,
                fp,
            });
        }
    }

    // Reachable gates: no static collider inside the drivable corridor anywhere.
    for s in &solids {
        if footprint_points(&s.fp, s.pose).iter().any(|p| {
            let nr = geom.nearest(p.0, p.1);
            nr.lateral.abs() < nr.half
        }) {
            add(
                &mut v,
                Rule::RouteObstructed,
                &s.what,
                "a static collider stands in the drivable corridor".into(),
            );
        }
    }

    // Features: params and the jump's landing envelope and bypass.
    let mut feature_zones: Vec<(String, f64, f64, f64, f64)> = Vec::new(); // (what, s0, s1, lateral lo, hi)
    for (i, f) in map.features.iter().enumerate() {
        let at = format!("features[{i}]");
        if !inside(f.pose.x, f.pose.z) {
            add(&mut v, Rule::Bounds, &at, "outside the bounds".into());
        }
        let need = |names: &[&str], v: &mut Vec<Violation>| -> Option<Vec<i64>> {
            let vals: Vec<Option<i64>> = names.iter().map(|k| f.params.get(*k).copied()).collect();
            if vals.iter().any(Option::is_none) {
                v.push(Violation::new(
                    Rule::FeatureParams,
                    &at,
                    format!("{:?} needs {}", f.kind, names.join(", ")),
                ));
                return None;
            }
            Some(vals.into_iter().flatten().collect())
        };
        let nr = geom.nearest(f64::from(f.pose.x), f64::from(f.pose.z));
        match f.kind {
            FeatureKind::Jump => {
                let Some(p) = need(
                    &[
                        "rampLengthMm",
                        "rampWidthMm",
                        "lipHeightCm",
                        "landingLengthMm",
                        "landingWidthMm",
                    ],
                    &mut v,
                ) else {
                    continue;
                };
                let (ramp_len, ramp_w, lip, land_len, land_w) = (p[0], p[1], p[2], p[3], p[4]);
                if ramp_len < MIN_RAMP_LENGTH_MM
                    || ramp_w <= 0
                    || lip <= 0
                    || lip > MAX_LIP_HEIGHT_CM
                {
                    add(
                        &mut v,
                        Rule::FeatureParams,
                        &at,
                        format!("ramp {ramp_len} mm × {ramp_w} mm, lip {lip} cm: out of range"),
                    );
                }
                let (lat, rw) = (nr.lateral, ramp_w as f64);
                let (lo, hi) = (lat - rw / 2.0, lat + rw / 2.0);
                if lo < -nr.half || hi > nr.half {
                    add(
                        &mut v,
                        Rule::LandingEnvelope,
                        &at,
                        "the ramp sticks out of the drivable corridor".into(),
                    );
                }
                let bypass = (lo + nr.half).max(nr.half - hi);
                if bypass < MIN_BYPASS_WIDTH_MM {
                    add(
                        &mut v,
                        Rule::JumpBypass,
                        &at,
                        format!(
                            "{:.1} m beside the ramp, minimum {:.0} m",
                            bypass / 1000.0,
                            MIN_BYPASS_WIDTH_MM / 1000.0
                        ),
                    );
                }
                let (s0, s1) = (nr.s + ramp_len as f64, nr.s + (ramp_len + land_len) as f64);
                if land_len < MIN_LANDING_LENGTH_MM || land_w < ramp_w {
                    add(
                        &mut v,
                        Rule::LandingEnvelope,
                        &at,
                        format!(
                            "landing {land_len} mm × {land_w} mm: needs ≥ {MIN_LANDING_LENGTH_MM} mm long and at least the ramp's width"
                        ),
                    );
                }
                if !geom.closed() && s1 > geom.total {
                    add(
                        &mut v,
                        Rule::LandingEnvelope,
                        &at,
                        "the landing runs past the end of the route".into(),
                    );
                }
                let lw = land_w as f64 / 2.0;
                if geom.min_half(s0, s1) < lat.abs() + lw {
                    add(
                        &mut v,
                        Rule::LandingEnvelope,
                        &at,
                        "the landing leaves the drivable corridor".into(),
                    );
                }
                feature_zones.push((
                    format!("{at} jump ramp"),
                    nr.s,
                    nr.s + ramp_len as f64,
                    lo,
                    hi,
                ));
                feature_zones.push((format!("{at} jump landing"), s0, s1, lat - lw, lat + lw));
            }
            FeatureKind::Kerb => {
                let Some(p) = need(&["heightCm", "depthMm"], &mut v) else {
                    continue;
                };
                if p[0] <= 0 || p[0] > MAX_KERB_HEIGHT_CM || p[1] < 100 {
                    add(
                        &mut v,
                        Rule::FeatureParams,
                        &at,
                        format!(
                            "kerb {} cm high (max {MAX_KERB_HEIGHT_CM}), {} mm deep",
                            p[0], p[1]
                        ),
                    );
                }
                let d = p[1] as f64;
                feature_zones.push((
                    format!("{at} kerb"),
                    nr.s - d / 2.0,
                    nr.s + d / 2.0,
                    -nr.half,
                    nr.half,
                ));
            }
            FeatureKind::Crest | FeatureKind::Whoops | FeatureKind::CreekDip => {}
        }
    }
    // Nothing lands on a landing envelope: no collider, no prop, no other feature.
    for (what, s0, s1, lo, hi) in feature_zones.iter().filter(|z| z.0.ends_with("landing")) {
        let hit = |x: f64, z: f64| {
            let nr = geom.nearest(x, z);
            geom.in_range(nr.s, *s0, *s1) && nr.lateral >= *lo && nr.lateral <= *hi
        };
        for s in solids.iter().chain(props.iter()) {
            if footprint_points(&s.fp, s.pose)
                .iter()
                .any(|p| hit(p.0, p.1))
            {
                add(
                    &mut v,
                    Rule::LandingEnvelope,
                    what,
                    format!("{} sits on the landing", s.what),
                );
            }
        }
        for (other, a0, a1, _, _) in feature_zones
            .iter()
            .filter(|z| &z.0 != what && !z.0.starts_with(what.split(' ').next().unwrap_or("")))
        {
            if geom.in_range(*a0, *s0, *s1) || geom.in_range(*a1, *s0, *s1) {
                add(
                    &mut v,
                    Rule::LandingEnvelope,
                    what,
                    format!("{other} overlaps the landing"),
                );
            }
        }
    }

    // Start corridor: declared length/width/spacing, inside the route, rows clear.
    let st = r.start;
    if !idx_ok(st.at) {
        add(
            &mut v,
            Rule::StartCorridor,
            "route.start",
            "at isn't a route point".into(),
        );
    } else {
        if st.row_spacing < MIN_ROW_SPACING_MM
            || st.column_spacing < MIN_COLUMN_SPACING_MM
            || st.length < st.row_spacing
            || st.width < st.column_spacing
        {
            add(
                &mut v,
                Rule::StartCorridor,
                "route.start",
                format!(
                    "length {} / width {} / rows every {} / columns every {} mm: no clear row fits",
                    st.length, st.width, st.row_spacing, st.column_spacing
                ),
            );
        }
        let s_front = geom.s_of(st.at as usize);
        let s_back = s_front - f64::from(st.length);
        if !geom.closed() && s_back < 0.0 {
            add(
                &mut v,
                Rule::StartCorridor,
                "route.start",
                "the corridor runs off the start of the route".into(),
            );
        }
        let half = f64::from(st.width) / 2.0;
        if geom.min_half(s_back, s_front) < half {
            add(
                &mut v,
                Rule::StartCorridor,
                "route.start",
                "the corridor is wider than the road along it".into(),
            );
        }
        let in_corridor = |x: f64, z: f64| {
            let nr = geom.nearest(x, z);
            geom.in_range(nr.s, s_back, s_front) && nr.lateral.abs() <= half
        };
        for s in solids.iter().chain(props.iter()) {
            if footprint_points(&s.fp, s.pose)
                .iter()
                .any(|p| in_corridor(p.0, p.1))
            {
                add(
                    &mut v,
                    Rule::StartCorridor,
                    "route.start",
                    format!("{} stands in the start corridor", s.what),
                );
            }
        }
        for (what, a0, a1, _, _) in &feature_zones {
            if geom.in_range(*a0, s_back, s_front)
                || geom.in_range(*a1, s_back, s_front)
                || geom.in_range(s_back, *a0, *a1)
            {
                add(
                    &mut v,
                    Rule::StartCorridor,
                    "route.start",
                    format!("{what} is in the start corridor"),
                );
            }
        }
    }

    // Recovery spans and named segments
    if r.recovery.is_empty() {
        add(
            &mut v,
            Rule::Recovery,
            "route.recovery",
            "no span where a car can respawn".into(),
        );
    }
    for (k, s) in r.recovery.iter().enumerate() {
        if !idx_ok(s.from) || !idx_ok(s.to) || (s.from > s.to && !r.closed) {
            add(
                &mut v,
                Rule::Recovery,
                &format!("route.recovery[{k}]"),
                format!("{}..={} isn't a run of route points", s.from, s.to),
            );
        }
    }
    for (k, s) in r.segments.iter().enumerate() {
        if s.name.is_empty()
            || !idx_ok(s.span.from)
            || !idx_ok(s.span.to)
            || (s.span.from > s.span.to && !r.closed)
        {
            add(
                &mut v,
                Rule::Segments,
                &format!("route.segments[{k}]"),
                format!(
                    "{:?} {}..={} isn't a run of route points",
                    s.name, s.span.from, s.span.to
                ),
            );
        }
    }

    // The stored gameplay hash, when present, must match the canonical bytes.
    if let Some(h) = &map.header.gameplay_hash {
        let actual = hex(&gameplay_hash(map));
        if *h != actual {
            add(
                &mut v,
                Rule::GameplayHash,
                "header.gameplayHash",
                format!("{h}, canonical bytes hash to {actual}"),
            );
        }
    }
    Report::of(v)
}
