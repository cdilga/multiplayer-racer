//! Seeded track generation producing jj.map.v1 (native and WASM).
//!
//! - [`seed`] (P1-M03a): one seed → named streams.
//! - [`course`] (P1-M03b): the structure stream designs a closed loop of corners and straights.
//! - [`assemble`] (P1-M03a): a centerline plus dressing → a canonical `jj.map.v1` through `jj-map`.
//!
//! - [`features`] (P1-M03d): jumps, crests, whoops and creek dips composed into the route and baked into the heights.
//! - [`scatter`] (P1-M03e): clumped or even dressing around the route from the dressing stream, clear of the road.
//! - [`terrain`] (P1-M03c): undulation along the route with per-biome grade, curvature and bank limits.
//!
//! Props still come from a placeholder (cones by the road) and the scatter's pieces are the generic kit until the biome beads (M04–M07)
//! and seeded scatter (M03e) replace it.

#![forbid(unsafe_code)]

pub mod assemble;
pub mod course;
pub mod features;
pub mod scatter;
pub mod seed;
pub mod signs;
pub mod terrain;

use std::collections::BTreeMap;

use jj_map::{Biome, Map, Pose, Prop, Surface};

use crate::assemble::{TrackSpec, arc_lengths, assemble, mm};
use crate::course::{CornerKind, Course, WIDTH_M};
use crate::seed::Streams;

pub const GENERATOR_ID: &str = "jj.procgen.course";
/// Bump when generated output changes on purpose (and re-bless `tests/goldens/seeds.txt`).
pub const GENERATOR_VERSION: &str = "5";
const STEP_M: f64 = 2.5;

/// What a generation produced, for `jj procgen` and the seed bank.
#[derive(Clone, Debug)]
pub struct Report {
    pub length_m: f64,
    pub attempts: u32,
    pub fallback: bool,
    pub corners: BTreeMap<&'static str, u32>,
    pub rejects: BTreeMap<&'static str, u32>,
}

/// The map for `seed`.
pub fn generate(seed: u64) -> Map {
    generate_report(seed).0
}

pub fn generate_report(seed: u64) -> (Map, Report) {
    generate_from(Streams::new(seed))
}

/// The map from explicit streams (tests swap one stream to show it moves nothing else).
pub fn generate_from(mut st: Streams) -> (Map, Report) {
    let course = course::design(&mut st.structure);
    let centerline = centred(&resample(&course.points));
    let props = placeholder_props(&mut st, &centerline);
    let biomes = vec![Biome::Greybox];
    let mut map = assemble(&TrackSpec {
        seed: st.seed,
        generator_id: GENERATOR_ID.into(),
        generator_version: GENERATOR_VERSION.into(),
        biomes: biomes.clone(),
        centerline,
        width_m: WIDTH_M,
        surface: Surface::Tarmac,
        dressing: Vec::new(),
        props,
    });
    terrain::undulate(&mut map, &mut st.terrain, &terrain::params(biomes[0]));
    features::place(&mut map, &mut st.features, biomes[0]);
    scatter::scatter(
        &mut map,
        &mut st.dressing,
        &scatter::spec(biomes[0]),
        &jj_map::Registry::generic(),
    );
    (map, report(&course))
}

fn report(course: &Course) -> Report {
    let mut corners: BTreeMap<&'static str, u32> =
        CornerKind::ALL.iter().map(|k| (k.name(), 0)).collect();
    for c in &course.corners {
        *corners.entry(c.kind.name()).or_default() += 1;
    }
    Report {
        length_m: course.length_m,
        attempts: course.attempts,
        fallback: course.fallback,
        corners,
        rejects: course.rejects.clone(),
    }
}

/// Resamples a closed polyline to points evenly spaced by arc length (~[`STEP_M`]), keeping the first point.
fn resample(dense: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let (s, total) = arc_lengths(dense);
    let n = libm::round(total / STEP_M) as usize;
    let mut out = Vec::with_capacity(n);
    let mut j = 0;
    for i in 0..n {
        let target = total * i as f64 / n as f64;
        while j + 1 < s.len() && s[j + 1] < target {
            j += 1;
        }
        let (a, b) = (dense[j], dense[(j + 1) % dense.len()]);
        let seg = (if j + 1 < s.len() { s[j + 1] } else { total }) - s[j];
        let t = if seg > 0.0 {
            (target - s[j]) / seg
        } else {
            0.0
        };
        out.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    }
    out
}

/// The loop moved so its bounding box is centred on the origin (whole metres).
fn centred(points: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let (mut lo, mut hi) = (
        (f64::INFINITY, f64::INFINITY),
        (f64::NEG_INFINITY, f64::NEG_INFINITY),
    );
    for &(x, z) in points {
        lo = (lo.0.min(x), lo.1.min(z));
        hi = (hi.0.max(x), hi.1.max(z));
    }
    let (cx, cz) = (
        libm::round((lo.0 + hi.0) / 2.0),
        libm::round((lo.1 + hi.1) / 2.0),
    );
    points.iter().map(|&(x, z)| (x - cx, z - cz)).collect()
}

/// Cones by the road (dressing stream only) until the biome kits bring their own props.
fn placeholder_props(st: &mut Streams, line: &[(f64, f64)]) -> Vec<Prop> {
    let d = &mut st.dressing;
    let (s, total) = arc_lengths(line);
    // A point `off` metres to the side of the route at arc length `dist`.
    let beside = |dist: f64, off: f64| {
        let i = s.iter().position(|&v| v >= dist).unwrap_or(0);
        let (a, b) = (line[i], line[(i + 1) % line.len()]);
        let len = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        (a.0 - (b.1 - a.1) / len * off, a.1 + (b.0 - a.0) / len * off)
    };
    let mut props = Vec::new();
    for _ in 0..4 {
        // Clear of the start corridor (it runs back from the finish at 60 m).
        let dist = d.range(120.0, total - 20.0);
        let side = if d.unit() < 0.5 { -1.0 } else { 1.0 };
        let p = beside(dist, side * (WIDTH_M / 2.0 + d.range(3.0, 5.0)));
        props.push(Prop {
            kit_piece: "generic/cone".into(),
            pose: Pose {
                x: mm(p.0),
                y: 0,
                z: mm(p.1),
                yaw: 0,
            },
            params: BTreeMap::new(),
        });
    }
    props
}
