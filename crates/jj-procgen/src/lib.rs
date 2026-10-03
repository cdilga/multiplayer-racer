//! Seeded track generation producing jj.map.v1 (native and WASM).
//!
//! P1-M03a: [`seed`] (one seed → named streams) and [`assemble`] (a generated centerline + dressing → a canonical
//! `jj.map.v1` through `jj-map`), driven here by a **placeholder** generator: a smooth seeded loop with buildings and
//! cones around it. The course graph (P1-M03b) replaces the placeholder's structure; the plumbing stays.

#![forbid(unsafe_code)]

pub mod assemble;
pub mod seed;

use std::collections::BTreeMap;

use jj_map::{Biome, Dressing, Map, Pose, Prop, Surface};

use crate::assemble::{TrackSpec, arc_lengths, assemble, distance_to_loop, mm};
use crate::seed::Streams;

pub const PLACEHOLDER_ID: &str = "jj.procgen.placeholder";
pub const PLACEHOLDER_VERSION: &str = "1";
const STEP_M: f64 = 2.5;
const WIDTH_M: f64 = 12.0;

/// The placeholder map for `seed`.
pub fn generate(seed: u64) -> Map {
    generate_from(Streams::new(seed))
}

/// The placeholder map from explicit streams (tests swap one stream to show it moves nothing else).
pub fn generate_from(mut st: Streams) -> Map {
    let centerline = placeholder_loop(&mut st);
    let (dressing, props) = placeholder_dressing(&mut st, &centerline);
    assemble(&TrackSpec {
        seed: st.seed,
        generator_id: PLACEHOLDER_ID.into(),
        generator_version: PLACEHOLDER_VERSION.into(),
        biomes: vec![Biome::Greybox],
        centerline,
        width_m: WIDTH_M,
        surface: Surface::Tarmac,
        dressing,
        props,
    })
}

/// A smooth closed loop through 9 seeded control points (structure stream only), resampled every ~2.5 m.
fn placeholder_loop(st: &mut Streams) -> Vec<(f64, f64)> {
    let k = 9;
    let ctrl: Vec<(f64, f64)> = (0..k)
        .map(|i| {
            let a = 2.0 * core::f64::consts::PI * f64::from(i) / f64::from(k)
                + st.structure.range(-0.15, 0.15);
            let r = st.structure.range(90.0, 150.0);
            (r * libm::cos(a), r * libm::sin(a))
        })
        .collect();
    // Uniform Catmull-Rom through the control points, densely sampled.
    let mut dense = Vec::new();
    for i in 0..k as usize {
        let p = |j: usize| ctrl[(i + j + k as usize - 1) % k as usize];
        let (p0, p1, p2, p3) = (p(0), p(1), p(2), p(3));
        for step in 0..64 {
            let t = f64::from(step) / 64.0;
            let (t2, t3) = (t * t, t * t * t);
            let f = |a: f64, b: f64, c: f64, d: f64| {
                0.5 * (2.0 * b
                    + (-a + c) * t
                    + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2
                    + (-a + 3.0 * b - 3.0 * c + d) * t3)
            };
            dense.push((f(p0.0, p1.0, p2.0, p3.0), f(p0.1, p1.1, p2.1, p3.1)));
        }
    }
    // Resample by arc length.
    let (s, total) = arc_lengths(&dense);
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

/// Buildings outside the loop and cones beside the road (dressing stream only). A draw that lands too near the road is
/// redrawn, so the dressing never constrains the route.
fn placeholder_dressing(st: &mut Streams, line: &[(f64, f64)]) -> (Vec<Dressing>, Vec<Prop>) {
    let d = &mut st.dressing;
    let mut dressing = Vec::new();
    let buildings = 6 + (d.next_u64() % 5) as usize;
    for _ in 0..buildings {
        for _attempt in 0..64 {
            let a = d.range(0.0, 2.0 * core::f64::consts::PI);
            let r = d.range(170.0, 230.0);
            let p = (r * libm::cos(a), r * libm::sin(a));
            if distance_to_loop(line, p) > WIDTH_M / 2.0 + 20.0 {
                dressing.push(Dressing {
                    kit_piece: "generic/box-building".into(),
                    pose: Pose {
                        x: mm(p.0),
                        y: 0,
                        z: mm(p.1),
                        yaw: (d.next_u64() % 36_000) as i32,
                    },
                    params: BTreeMap::from([
                        ("widthMm".into(), 9_000),
                        ("depthMm".into(), 6_000),
                        ("heightCm".into(), 450),
                    ]),
                    collides: true,
                });
                break;
            }
        }
    }
    let mut props = Vec::new();
    let (s, total) = arc_lengths(line);
    for _ in 0..4 {
        // Clear of the start corridor (it runs back from the finish at 60 m).
        let at = d.range(120.0, total - 20.0);
        let i = s.iter().position(|&v| v >= at).unwrap_or(0);
        let (a, b) = (line[i], line[(i + 1) % line.len()]);
        let len = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        let side = if d.unit() < 0.5 { -1.0 } else { 1.0 };
        let off = side * (WIDTH_M / 2.0 + d.range(3.0, 5.0));
        let p = (a.0 - (b.1 - a.1) / len * off, a.1 + (b.0 - a.0) / len * off);
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
    (dressing, props)
}
