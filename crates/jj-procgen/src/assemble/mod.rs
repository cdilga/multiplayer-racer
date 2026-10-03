//! Map assembly (P1-M03a): turns a generated centerline plus dressing into a `jj.map.v1` document through `jj-map`
//! (gates every 40 m, the start corridor behind the finish, recovery everywhere, bounds, a terrain grid whose surface
//! follows the road), canonicalised so the bytes are the evidence. Integer output, `libm` maths: identical natively and
//! in WASM.

use jj_map::{
    Biome, Bounds, Dressing, Gate, Generator, Header, MAP_VERSION, Map, Prop, Route, RoutePoint,
    Span, StartCorridor, Surface, Terrain, canonicalise,
};

/// Default speed for a generated track's reference lap (plan §8.1: route length ÷ 15 m/s, TUNE).
pub const REF_SPEED_MPS: f64 = 15.0;
/// Gates every this many metres along the route (§7.5: ~every 40 m).
pub const GATE_SPACING_M: f64 = 40.0;
/// The finish line sits this far along the route, so the start corridor fits behind it.
pub const FINISH_AT_M: f64 = 60.0;
pub const START_LENGTH_M: f64 = 48.0;
pub const TERRAIN_SPACING_M: f64 = 10.0;
/// Margin around everything for the bounds.
pub const BOUNDS_MARGIN_M: f64 = 60.0;

/// What a generator hands to assembly.
#[derive(Clone, Debug)]
pub struct TrackSpec {
    pub seed: u64,
    pub generator_id: String,
    pub generator_version: String,
    pub biomes: Vec<Biome>,
    /// A closed loop, metres (x, z), roughly evenly spaced.
    pub centerline: Vec<(f64, f64)>,
    pub width_m: f64,
    pub surface: Surface,
    pub dressing: Vec<Dressing>,
    pub props: Vec<Prop>,
}

pub fn mm(v: f64) -> i32 {
    libm::round(v * 1000.0) as i32
}

/// Cumulative arc length at each point of a closed loop (and the total).
pub fn arc_lengths(pts: &[(f64, f64)]) -> (Vec<f64>, f64) {
    let mut s = vec![0.0];
    for i in 1..=pts.len() {
        let (a, b) = (pts[i - 1], pts[i % pts.len()]);
        s.push(s[i - 1] + libm::hypot(b.0 - a.0, b.1 - a.1));
    }
    let total = s.pop().unwrap_or(0.0);
    (s, total)
}

fn index_at(s: &[f64], target: f64) -> usize {
    s.iter().position(|&v| v >= target).unwrap_or(s.len() - 1)
}

/// Distance from a point to the closed polyline.
pub fn distance_to_loop(pts: &[(f64, f64)], p: (f64, f64)) -> f64 {
    let mut best = f64::INFINITY;
    for i in 0..pts.len() {
        let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
        let (dx, dz) = (b.0 - a.0, b.1 - a.1);
        let len2 = dx * dx + dz * dz;
        let t = if len2 == 0.0 {
            0.0
        } else {
            (((p.0 - a.0) * dx + (p.1 - a.1) * dz) / len2).clamp(0.0, 1.0)
        };
        best = best.min(libm::hypot(p.0 - (a.0 + t * dx), p.1 - (a.1 + t * dz)));
    }
    best
}

pub fn assemble(spec: &TrackSpec) -> Map {
    let pts = &spec.centerline;
    let n = pts.len();
    let (s, total) = arc_lengths(pts);
    let width = mm(spec.width_m) as u32;

    let points: Vec<RoutePoint> = pts
        .iter()
        .map(|&(x, z)| RoutePoint {
            x: mm(x),
            y: 0,
            z: mm(z),
            width,
            bank: 0,
            surface: spec.surface,
        })
        .collect();
    let finish = index_at(&s, FINISH_AT_M);
    let mut gates: Vec<Gate> = Vec::new();
    let mut d = 0.0;
    while d < total - GATE_SPACING_M / 2.0 {
        let at = index_at(&s, (FINISH_AT_M + d) % total) as u32;
        if gates.iter().all(|g| g.at != at) {
            gates.push(Gate {
                at,
                finish: d == 0.0,
            });
        }
        d += GATE_SPACING_M;
    }

    // Bounds over the route and every placed piece, plus a margin; the terrain grid covers them.
    let (mut lo, mut hi) = (
        (f64::INFINITY, f64::INFINITY),
        (f64::NEG_INFINITY, f64::NEG_INFINITY),
    );
    let mut grow = |x: f64, z: f64| {
        lo = (lo.0.min(x), lo.1.min(z));
        hi = (hi.0.max(x), hi.1.max(z));
    };
    for &(x, z) in pts {
        grow(x, z);
    }
    for p in spec
        .dressing
        .iter()
        .map(|d| d.pose)
        .chain(spec.props.iter().map(|p| p.pose))
    {
        grow(f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0);
    }
    let bounds = Bounds {
        min_x: mm(lo.0 - BOUNDS_MARGIN_M),
        min_z: mm(lo.1 - BOUNDS_MARGIN_M),
        max_x: mm(hi.0 + BOUNDS_MARGIN_M),
        max_z: mm(hi.1 + BOUNDS_MARGIN_M),
        kill_y: -20_000,
    };
    let spacing = mm(TERRAIN_SPACING_M);
    let origin_x = bounds.min_x.div_euclid(spacing) * spacing;
    let origin_z = bounds.min_z.div_euclid(spacing) * spacing;
    let cols = ((bounds.max_x - origin_x) / spacing + 2) as u32;
    let rows = ((bounds.max_z - origin_z) / spacing + 2) as u32;
    let half = spec.width_m / 2.0;
    let mut surfaces = Vec::with_capacity((cols * rows) as usize);
    for r in 0..rows {
        for c in 0..cols {
            let p = (
                f64::from(origin_x + c as i32 * spacing) / 1000.0,
                f64::from(origin_z + r as i32 * spacing) / 1000.0,
            );
            surfaces.push(if distance_to_loop(pts, p) <= half {
                spec.surface
            } else {
                Surface::OffTrack
            });
        }
    }

    let map = Map {
        header: Header {
            version: MAP_VERSION.into(),
            generator: Generator {
                id: spec.generator_id.clone(),
                version: spec.generator_version.clone(),
            },
            seed: spec.seed,
            biomes: spec.biomes.clone(),
            bounds,
            ref_lap_ms: libm::round(total / REF_SPEED_MPS * 1000.0) as u32,
            gameplay_hash: None,
        },
        terrain: Terrain {
            origin_x,
            origin_z,
            spacing: spacing as u32,
            cols,
            rows,
            heights: vec![0; (cols * rows) as usize],
            surfaces,
        },
        route: Route {
            closed: true,
            points,
            gates,
            start: StartCorridor {
                at: finish as u32,
                length: mm(START_LENGTH_M) as u32,
                width: width - 2_000,
                row_spacing: 8_000,
                column_spacing: 3_500,
            },
            recovery: vec![Span {
                from: 0,
                to: (n - 1) as u32,
            }],
            segments: vec![],
        },
        features: vec![],
        dressing: spec.dressing.clone(),
        props: spec.props.clone(),
    };
    canonicalise(&map)
}
