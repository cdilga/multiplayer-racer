//! Vertical loops (R124, br-xlvx.6). A loop is its own feature carrying its own deck, never route points: every route
//! system works in plan view (x, z) with world +Y as up, and a loop's points would stack in x/z. The route stays a
//! continuous plan polyline from the loop's entry point E to its exit point X (it runs under the loop, where the ribbon
//! is not drawn); the deck leaves the road at E and rejoins it at X.
//!
//! The deck follows a helix in the frame at E (forward f along the road, left l, up +Y), for t in 0..1 and θ = 2πt:
//!
//! ```text
//! along(t)   = A·t + R·sin θ            A = (X − E)·f, the run-out along the road
//! up(t)      = R·(1 − cos θ)            R = radiusMm
//! lateral(t) = S·(t − sin 2πt / 2π)     S = (X − E)·l, the sideways shift that takes the exit clear of the entry
//! ```
//!
//! so it meets the road tangentially at both ends, at the road's own height (interpolated from E to X), and the deck's
//! surface normal points into the loop (it is +Y at both ends). The sim and the renderer use the same triangles.
//!
//! Integer feature params: `entry`, `exit` (route indices of E and X; the loop span is entry..=exit, not wrapping),
//! `radiusMm`, `thicknessMm`, `barrierHeightMm`, `barrierWidthMm`, `segments` (deck sections around the loop).
//! The deck is the route's full width at E.

use crate::jump::JumpMesh;
use crate::model::{Map, Surface};
use std::collections::BTreeMap;

/// Safety envelopes, not limits on the number of loops or participants.
pub mod limits {
    /// A tighter loop needs a speed no car keeps through the top, and its deck turns too sharply for the suspension.
    pub const MIN_RADIUS_MM: i64 = 5_000;
    pub const MIN_THICKNESS_MM: i64 = 200;
    pub const MIN_BARRIER_HEIGHT_MM: i64 = 400;
    pub const MIN_BARRIER_WIDTH_MM: i64 = 200;
    /// Deck sections around the loop: enough that a facet is under ~1.6 m at the smallest radius.
    pub const MIN_SEGMENTS: i64 = 24;
    /// Clear air between the entry and exit decks where they pass side by side, mm.
    pub const MIN_SIDE_CLEARANCE_MM: i64 = 1_000;
    /// The road at E and X must point the same way as the loop's frame (within this, milliradians).
    pub const MAX_HEADING_MRAD: i64 = 60;
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoopDesign {
    pub entry: usize,
    pub exit: usize,
    pub radius_m: f64,
    pub thickness_m: f64,
    pub barrier_h: f64,
    pub barrier_w: f64,
    pub segments: usize,
}

impl LoopDesign {
    /// The design of a loop feature (None for any other kind, or a param missing).
    pub fn of(f: &crate::model::Feature) -> Option<Self> {
        if f.kind != crate::model::FeatureKind::Loop {
            return None;
        }
        Self::of_params(&f.params)
    }

    /// The design from a loop feature's integer params (None if one is missing or out of type range).
    pub fn of_params(p: &BTreeMap<String, i64>) -> Option<Self> {
        let get = |key: &str| p.get(key).copied();
        let index = |key: &str| get(key).and_then(|v| usize::try_from(v).ok());
        Some(Self {
            entry: index("entry")?,
            exit: index("exit")?,
            radius_m: get("radiusMm")? as f64 / 1000.0,
            thickness_m: get("thicknessMm")? as f64 / 1000.0,
            barrier_h: get("barrierHeightMm")? as f64 / 1000.0,
            barrier_w: get("barrierWidthMm")? as f64 / 1000.0,
            segments: index("segments")?,
        })
    }
}

/// The loop's frame and run-out, from the route: E, the unit forward and left vectors in plan, the run-out A and
/// shift S (m), the deck's half-width, and the base heights at E and X.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoopFrame {
    pub e: [f64; 3],
    pub forward: [f64; 2],
    pub left: [f64; 2],
    pub run_out: f64,
    pub shift: f64,
    pub half_width: f64,
    pub y_exit: f64,
}

fn point(map: &Map, i: usize) -> [f64; 3] {
    let q = &map.route.points[i];
    [f64::from(q.x) / 1000.0, f64::from(q.y) / 1000.0, f64::from(q.z) / 1000.0]
}

/// The road's plan direction along the route from point `a` to point `b`.
fn heading(map: &Map, a: usize, b: usize) -> [f64; 2] {
    let (p, q) = (point(map, a), point(map, b));
    let (dx, dz) = (q[0] - p[0], q[2] - p[2]);
    let len = libm::hypot(dx, dz).max(1e-9);
    [dx / len, dz / len]
}

/// The frame at E: forward is the road's direction arriving at E (from the point before it), so the deck leaves the
/// road straight on.
pub fn frame(map: &Map, d: &LoopDesign) -> Option<LoopFrame> {
    let n = map.route.points.len();
    if d.entry == 0 || d.entry >= d.exit || d.exit >= n {
        return None;
    }
    let e = point(map, d.entry);
    let before = point(map, d.entry - 1);
    let (dx, dz) = (e[0] - before[0], e[2] - before[2]);
    let len = libm::hypot(dx, dz);
    if len < 1e-6 {
        return None;
    }
    let forward = [dx / len, dz / len];
    // +X is left when facing +Z: left = up × forward.
    let left = [forward[1], -forward[0]];
    let x = point(map, d.exit);
    let (ex, ez) = (x[0] - e[0], x[2] - e[2]);
    Some(LoopFrame {
        e,
        forward,
        left,
        run_out: ex * forward[0] + ez * forward[1],
        shift: ex * left[0] + ez * left[1],
        half_width: f64::from(map.route.points[d.entry].width) / 2000.0,
        y_exit: x[1],
    })
}

const TAU: f64 = core::f64::consts::TAU;

/// The deck's centre-line point at t (0 at E, 1 at X), world metres.
pub fn centre(fr: &LoopFrame, r: f64, t: f64) -> [f64; 3] {
    let th = TAU * t;
    let along = fr.run_out * t + r * libm::sin(th);
    let up = r * (1.0 - libm::cos(th));
    let lat = fr.shift * (t - libm::sin(th) / TAU);
    [
        fr.e[0] + fr.forward[0] * along + fr.left[0] * lat,
        fr.e[1] + (fr.y_exit - fr.e[1]) * t + up,
        fr.e[2] + fr.forward[1] * along + fr.left[1] * lat,
    ]
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn scale(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn unit(a: [f64; 3]) -> [f64; 3] {
    scale(a, 1.0 / libm::sqrt(dot(a, a)).max(1e-12))
}

/// One deck section: the centre, the unit side (the road's left, level: the deck never rolls) and the unit surface
/// normal (into the loop; +Y at both ends).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Section {
    pub c: [f64; 3],
    pub side: [f64; 3],
    pub normal: [f64; 3],
}

/// The deck's `segments + 1` sections, t = k / segments.
pub fn sections(fr: &LoopFrame, d: &LoopDesign) -> Vec<Section> {
    let left = [fr.left[0], 0.0, fr.left[1]];
    (0..=d.segments)
        .map(|k| {
            let t = k as f64 / d.segments as f64;
            let h = 1e-4;
            let tangent = unit(sub(centre(fr, d.radius_m, t + h), centre(fr, d.radius_m, t - h)));
            // Each cross-section runs straight across the road (along its left vector), so the deck never rolls as the
            // helix moves sideways; the surface normal is perpendicular to both the direction of travel and that line.
            Section { c: centre(fr, d.radius_m, t), side: left, normal: unit(cross(tangent, left)) }
        })
        .collect()
}

/// Closed, shared-vertex prisms (the bridge's layout): the deck and the two barriers, each a ring of four vertices per
/// section with end caps. Positions in metres; the sim collides with exactly these triangles and the renderer draws them.
pub fn loop_mesh(map: &Map, d: &LoopDesign) -> Option<JumpMesh> {
    let fr = frame(map, d)?;
    if d.radius_m <= 0.0 || d.thickness_m <= 0.0 || d.barrier_h <= 0.0 || d.barrier_w <= 0.0 || d.segments < 2 {
        return None;
    }
    let secs = sections(&fr, d);
    let mut verts = Vec::new();
    let mut tris = Vec::new();
    for beam in 0..3 {
        let start = verts.len() as u32;
        for s in &secs {
            let left = add(s.c, scale(s.side, fr.half_width));
            let right = sub(s.c, scale(s.side, fr.half_width));
            let (l, r, depth) = match beam {
                0 => (left, right, d.thickness_m),
                1 => (add(left, scale(s.side, d.barrier_w)), left, d.barrier_h),
                _ => (right, sub(right, scale(s.side, d.barrier_w)), d.barrier_h),
            };
            // The top of a beam is its surface (the deck) or the barrier's crest, which stands up along the normal.
            let lift = if beam == 0 { 0.0 } else { d.barrier_h };
            let (lt, rt) = (add(l, scale(s.normal, lift)), add(r, scale(s.normal, lift)));
            verts.extend([lt, rt, sub(lt, scale(s.normal, depth)), sub(rt, scale(s.normal, depth))]);
        }
        let mut quad = |a, b, c, e| {
            tris.extend([[a, b, c], [a, c, e]]);
        };
        for k in 0..secs.len() - 1 {
            let a = start + k as u32 * 4;
            quad(a + 1, a + 5, a + 4, a);
            quad(a + 2, a + 6, a + 7, a + 3);
            quad(a, a + 4, a + 6, a + 2);
            quad(a + 1, a + 3, a + 7, a + 5);
        }
        let end = start + (secs.len() as u32 - 1) * 4;
        quad(start, start + 2, start + 3, start + 1);
        quad(end, end + 1, end + 3, end + 2);
    }
    Some((verts, tris))
}

/// Material for every triangle of `loop_mesh`, in order: the deck takes the road's surface at E, the barriers are rock.
pub fn triangle_surfaces(map: &Map, d: &LoopDesign) -> Option<Vec<Surface>> {
    let road = map.route.points.get(d.entry)?.surface;
    let per_beam = d.segments * 8 + 4;
    let mut out = Vec::with_capacity(per_beam * 3);
    out.extend(core::iter::repeat_n(road, per_beam));
    out.extend(core::iter::repeat_n(Surface::Rock, per_beam * 2));
    Some(out)
}

/// The least entry speed that keeps a car on the deck through the top without help, m/s (√(5gR): the speed at the top
/// must be at least √(gR), and climbing 2R costs 4gR of v²). The sim's loop assist and the posted speed build on this.
pub fn unassisted_entry_mps(d: &LoopDesign, g: f64) -> f64 {
    libm::sqrt(5.0 * g * d.radius_m)
}

/// Everything wrong with a loop, in words (empty when it is valid).
pub fn problems(map: &Map, p: &BTreeMap<String, i64>) -> Vec<String> {
    let mut out = Vec::new();
    let Some(d) = LoopDesign::of_params(p) else {
        return vec!["missing or invalid loop params".into()];
    };
    for (name, min) in [
        ("radiusMm", limits::MIN_RADIUS_MM),
        ("thicknessMm", limits::MIN_THICKNESS_MM),
        ("barrierHeightMm", limits::MIN_BARRIER_HEIGHT_MM),
        ("barrierWidthMm", limits::MIN_BARRIER_WIDTH_MM),
        ("segments", limits::MIN_SEGMENTS),
    ] {
        if p[name] < min {
            out.push(format!("{name} must be at least {min}"));
        }
    }
    let Some(fr) = frame(map, &d) else {
        out.push("entry and exit must be route points in order, with a road leading into the entry".into());
        return out;
    };
    // The road arriving at E (the stretch before it) and leaving X (the stretch after it) runs the frame's way, so the
    // deck leaves and rejoins it straight on. (Between E and X the route runs diagonally under the loop.)
    let n = map.route.points.len();
    if d.entry < 2 || d.exit + 2 >= n {
        out.push("the loop needs road before its entry and after its exit".into());
        return out;
    }
    for (name, a, b) in [("entry", d.entry - 2, d.entry), ("exit", d.exit, d.exit + 2)] {
        let h = heading(map, a, b);
        let off = libm::atan2(h[0] * fr.forward[1] - h[1] * fr.forward[0], h[0] * fr.forward[0] + h[1] * fr.forward[1]);
        if libm::fabs(off) * 1000.0 > limits::MAX_HEADING_MRAD as f64 {
            out.push(format!("the road at the {name} turns {:.0} mrad off the loop's line", off * 1000.0));
        }
    }
    // The exit deck passes beside the entry deck: they must clear each other by a full width and the barriers.
    let need = 2.0 * (fr.half_width + d.barrier_w) + limits::MIN_SIDE_CLEARANCE_MM as f64 / 1000.0;
    if libm::fabs(fr.shift) < need {
        out.push(format!(
            "the exit is {:.1} m beside the entry; the decks need {:.1} m to clear each other",
            libm::fabs(fr.shift),
            need
        ));
    }
    // A loop that runs out backwards (or barely forwards) folds over its own entry.
    if fr.run_out < d.radius_m {
        out.push(format!("the exit is {:.1} m on from the entry; at least the radius ({:.1} m)", fr.run_out, d.radius_m));
    }
    // The route between E and X runs under the loop: no part of it may be a closed route's wrap.
    if map.route.closed && d.exit - d.entry >= map.route.points.len() / 2 {
        out.push("the loop span must be a short stretch of the route".into());
    }
    out
}
