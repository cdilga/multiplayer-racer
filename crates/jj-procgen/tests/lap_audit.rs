//! br-8h3u.18 lap audit (owner 2026-10-31: "shortcuts not counting as valid roads, and many issues with not counting
//! laps"). Every course family, each on the seed bank's own biome mixes, with the lines players drive fed through the
//! race rules (`jj_sim::race`) as kinematic paths. The physics isn't in the loop: the rule is what's audited here, and
//! the bots that drive it for real are `forks.rs`'s and `bank.rs`'s.
//!
//! Lines: the road; every fork's and cut's branch; a wide line out to the corridor's edge on each side (half way to the
//! nearest other part of the course); cuts across a fork's island from the road to the branch and back; corner cuts;
//! an airborne line hopping crests sideways; and the road with respawns mid-lap. Each counts every lap exactly once, at
//! its own finish crossing (no lap early, none late, no extra lap), and is never told it missed a gate. A cut across the
//! infield to another part of the lap counts nothing, and the car is told it missed a gate. `JJ_SEEDS=N` widens the sample (a sample, not a limit).
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;

use jj_map::fork::{self, Fork};
use jj_map::looping::LoopDesign;
use jj_map::setpiece::Pit;
use jj_map::{LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::tuning::{GeneratorData, PresetName};
use jj_sim::SpawnPose;
use jj_sim::race::{
    CarView, Course, Effect, Event, GATE_CATCH_UP_M, GATE_OTHER_ROAD_M, RESPAWN_HOLD_TICKS, Race,
    Respawned,
};

const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 2 } else { 20 };
const LAPS: u32 = 3;
/// How far a line moves per tick, m (36 m/s: arcade speed).
const STEP_M: f32 = 0.6;
/// A car's centre rides this far above the road.
const RIDE_M: f32 = 0.5;
/// A lap must have counted this far past its finish crossing, and not this far before it, m.
const ON_TIME_M: f32 = 25.0;
/// A corner cut leaves the road's edge by at most this much, m.
const CORNER_CUT_M: f32 = 8.0;

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

fn family(p: PresetName) -> GeneratorData {
    let mut d = GeneratorData::shipped().clone();
    for q in PresetName::ALL {
        d.course.presets.set_weight(q, f64::from(q == p));
    }
    d
}

/// A generated track as the audit drives it.
struct Track {
    name: String,
    map: LoadedMap,
    p: Vec<[f32; 3]>,
    half: Vec<f32>,
    s: Vec<f32>,
    total: f32,
    /// Route-point normals (left of travel, (-tz, tx)), from the neighbours either side.
    nrm: Vec<[f32; 2]>,
    /// Signed turn at each point (cross of the tangents 5 m either side; > 0: turning left) and the radius there, m.
    turn: Vec<f32>,
    radius: Vec<f32>,
    /// Half way to the nearest other part of the course (route points more than `GATE_OTHER_ROAD_M` round), m.
    corridor: Vec<f32>,
    finish_s: f32,
    forks: Vec<(Fork, Vec<[f32; 2]>)>,
    /// Points that must keep to the road: decks (either level of a crossing), loops, pits.
    on_road: Vec<bool>,
    pits: Vec<Pit>,
    bounds: [f32; 4],
}

impl Track {
    fn new(name: String, map: LoadedMap) -> Self {
        let m = &map.map;
        let n = m.route.points.len();
        let p: Vec<[f32; 3]> = m
            .route
            .points
            .iter()
            .map(|q| {
                [
                    q.x as f32 / 1000.0,
                    q.y as f32 / 1000.0,
                    q.z as f32 / 1000.0,
                ]
            })
            .collect();
        let half: Vec<f32> = m
            .route
            .points
            .iter()
            .map(|q| q.width as f32 / 2000.0)
            .collect();
        let mut s = Vec::with_capacity(n);
        let mut total = 0.0;
        for i in 0..n {
            s.push(total);
            let (a, b) = (p[i], p[(i + 1) % n]);
            total += (b[0] - a[0]).hypot(b[2] - a[2]);
        }
        let tangent = |i: usize, j: usize| {
            let (a, b) = (p[i % n], p[j % n]);
            let (dx, dz) = (b[0] - a[0], b[2] - a[2]);
            let l = dx.hypot(dz).max(1e-6);
            [dx / l, dz / l]
        };
        let nrm: Vec<[f32; 2]> = (0..n)
            .map(|i| {
                let t = tangent(i + n - 1, i + 1);
                [-t[1], t[0]]
            })
            .collect();
        let (mut turn, mut radius) = (Vec::with_capacity(n), Vec::with_capacity(n));
        for i in 0..n {
            let (a, b) = (tangent(i + n - 2, i), tangent(i, i + 2));
            let cross = a[0] * b[1] - a[1] * b[0];
            let angle = (a[0] * b[0] + a[1] * b[1]).clamp(-1.0, 1.0).acos();
            let arc = {
                let d = |x: usize, y: usize| {
                    (p[y % n][0] - p[x % n][0]).hypot(p[y % n][2] - p[x % n][2])
                };
                d(i + n - 2, i) / 2.0 + d(i, i + 2) / 2.0
            };
            turn.push(cross);
            radius.push(if angle > 1e-4 {
                arc / angle
            } else {
                f32::INFINITY
            });
        }
        let corridor: Vec<f32> = (0..n)
            .map(|i| {
                (0..n)
                    .filter(|&j| {
                        let d = (s[j] - s[i]).abs();
                        d.min(total - d) > GATE_OTHER_ROAD_M
                    })
                    .map(|j| (p[j][0] - p[i][0]).hypot(p[j][2] - p[i][2]) - half[j])
                    .fold(f32::INFINITY, f32::min)
                    / 2.0
            })
            .collect();
        let mut gates: Vec<&jj_map::Gate> = m.route.gates.iter().collect();
        gates.sort_by_key(|g| g.at);
        let finish = gates.iter().find(|g| g.finish).map_or(0, |g| g.at as usize);
        let forks: Vec<(Fork, Vec<[f32; 2]>)> = m
            .features
            .iter()
            .filter_map(Fork::of)
            .map(|d| {
                let line = fork::path_of(m, &d)
                    .iter()
                    .map(|q| [q[0] as f32, q[1] as f32])
                    .collect();
                (d, line)
            })
            .collect();
        let mut on_road = vec![false; n];
        let near = |on_road: &mut Vec<bool>, i: usize, r: usize| {
            for k in 0..=2 * r {
                on_road[(i + n + k - r) % n] = true;
            }
        };
        for i in jj_map::bridge::layered_points(m) {
            near(&mut on_road, i, 10);
        }
        for l in m.features.iter().filter_map(LoopDesign::of) {
            on_road[l.entry.saturating_sub(4)..=(l.exit + 4).min(n - 1)].fill(true);
        }
        let pits = jj_map::setpiece::pits(m);
        for (i, q) in p.iter().enumerate() {
            if pits
                .iter()
                .any(|pit| pit.over(f64::from(q[0]), f64::from(q[2])))
            {
                near(&mut on_road, i, 6);
            }
        }
        let b = &m.header.bounds;
        let bounds = [
            b.min_x as f32 / 1000.0,
            b.min_z as f32 / 1000.0,
            b.max_x as f32 / 1000.0,
            b.max_z as f32 / 1000.0,
        ];
        let finish_s = s[finish];
        Self {
            name,
            map,
            p,
            half,
            s,
            total,
            nrm,
            turn,
            radius,
            corridor,
            finish_s,
            forks,
            on_road,
            pits,
            bounds,
        }
    }

    fn n(&self) -> usize {
        self.p.len()
    }

    /// The segment at arc `s` (any lap) and how far along it.
    fn seg(&self, s: f32) -> (usize, f32) {
        let s = s.rem_euclid(self.total);
        let i = match self.s.binary_search_by(|v| v.total_cmp(&s)) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };
        let j = (i + 1) % self.n();
        let end = if j == 0 { self.total } else { self.s[j] };
        let len = end - self.s[i];
        (
            i,
            if len > 0.0 {
                (s - self.s[i]) / len
            } else {
                0.0
            },
        )
    }

    /// The point at arc `s`, `lateral` m to the left of the centreline (each point's own normal, interpolated).
    fn at(&self, s: f32, lateral: f32) -> [f32; 3] {
        let (i, t) = self.seg(s);
        let j = (i + 1) % self.n();
        let (a, b) = (self.p[i], self.p[j]);
        let nx = self.nrm[i][0] * (1.0 - t) + self.nrm[j][0] * t;
        let nz = self.nrm[i][1] * (1.0 - t) + self.nrm[j][1] * t;
        let l = nx.hypot(nz).max(1e-6);
        [
            a[0] + t * (b[0] - a[0]) + nx / l * lateral,
            a[1] + t * (b[1] - a[1]) + RIDE_M,
            a[2] + t * (b[2] - a[2]) + nz / l * lateral,
        ]
    }

    /// `p` (a line's point standing for arc `arc`) flown over any pit the race would count there: a gap is leapt, never
    /// fallen into. An overpass leap's pit counts only on its own upper road.
    fn fly(&self, mut p: [f32; 3], arc: f32) -> [f32; 3] {
        let (i, _) = self.seg(arc);
        for pit in &self.pits {
            let racing = pit.span.is_none_or(|(a, b)| {
                let (a, b) = (a as usize, b as usize);
                if a <= b {
                    a <= i && i <= b
                } else {
                    i >= a || i <= b
                }
            });
            if racing && pit.over(f64::from(p[0]), f64::from(p[2])) {
                p[1] = p[1].max(pit.trigger_y as f32 + 1.0);
            }
        }
        p
    }

    /// The route point a fork leaves from and rejoins at, as arcs: the rejoin is ahead of the split.
    fn fork_span(&self, d: &Fork) -> (f32, f32) {
        let a = self.s[d.from as usize];
        let mut b = self.s[d.to as usize];
        if b <= a {
            b += self.total;
        }
        (a, b)
    }

    /// The lateral offsets of a wide line on side `side` (+1 left, -1 right): out to the corridor's edge, less where it
    /// would fold on the inside of a bend, leave the map, or reach a branch; on the road over decks, loops and pits.
    fn wide(&self, side: f32) -> Vec<f32> {
        let n = self.n();
        let [x0, z0, x1, z1] = self.bounds;
        let branch_pts: Vec<([f32; 2], f32)> = self
            .forks
            .iter()
            .flat_map(|(d, line)| line.iter().map(move |q| (*q, d.width_m as f32 / 2.0)))
            .collect();
        let raw: Vec<f32> = (0..n)
            .map(|i| {
                let mut d = self.corridor[i] - 1.0;
                if self.turn[i] * side > 0.0 {
                    d = d.min(0.6 * self.radius[i]);
                }
                // Stay inside the map: step out along the normal until the bounds (less 5 m).
                let (q, nv) = (self.p[i], self.nrm[i]);
                let mut lim = f32::INFINITY;
                for (o, v, lo, hi) in [(q[0], nv[0] * side, x0, x1), (q[2], nv[1] * side, z0, z1)] {
                    if v > 1e-4 {
                        lim = lim.min((hi - 5.0 - o) / v);
                    } else if v < -1e-4 {
                        lim = lim.min((lo + 5.0 - o) / v);
                    }
                }
                d = d.min(lim);
                // Not onto or past a branch beside the road.
                for (b, bh) in &branch_pts {
                    let (dx, dz) = (b[0] - q[0], b[1] - q[2]);
                    let along_normal = dx * nv[0] * side + dz * nv[1] * side;
                    let across = (dx * nv[1] - dz * nv[0]).abs();
                    if along_normal > 0.0 && across < bh + 3.0 {
                        d = d.min(along_normal - bh - 2.0);
                    }
                }
                if self.on_road[i] {
                    d = d.min(self.half[i] - 0.5);
                }
                d.max(0.0)
            })
            .collect();
        // Ease in and out: the least within 15 m, then a 15 m mean.
        let w = 6;
        let low: Vec<f32> = (0..n)
            .map(|i| {
                (0..=2 * w)
                    .map(|k| raw[(i + n + k - w) % n])
                    .fold(f32::INFINITY, f32::min)
            })
            .collect();
        (0..n)
            .map(|i| {
                side * (0..=2 * w).map(|k| low[(i + n + k - w) % n]).sum::<f32>()
                    / (2 * w + 1) as f32
            })
            .collect()
    }
}

/// A line: positions one tick apart, each with the route arc it stands for (for checkpoints).
#[derive(Default)]
struct Line {
    pos: Vec<[f32; 3]>,
    arc: Vec<f32>,
}

impl Line {
    fn push(&mut self, p: [f32; 3], arc: f32) {
        self.pos.push(p);
        self.arc.push(arc);
    }

    /// Along the road from arc `a` to `b` (any laps), at `lateral(s)` m left, airborne `lift(s)` m.
    fn road(
        &mut self,
        t: &Track,
        a: f32,
        b: f32,
        lateral: &dyn Fn(f32) -> f32,
        lift: &dyn Fn(f32) -> f32,
    ) {
        let mut s = a;
        while s < b {
            let mut q = t.at(s, lateral(s));
            q[1] += lift(s);
            self.push(q, s);
            s += STEP_M;
        }
    }

    /// Straight to `to` (plan), its height eased from the last point's to `to_y`; arcs eased from the last to `to_arc`.
    fn straight(&mut self, to: [f32; 2], to_y: f32, to_arc: f32) {
        let (from, from_arc) = match (self.pos.last(), self.arc.last()) {
            (Some(p), Some(a)) => (*p, *a),
            _ => return,
        };
        let len = (to[0] - from[0]).hypot(to[1] - from[2]);
        let k = (len / STEP_M).ceil().max(1.0) as usize;
        for i in 1..=k {
            let f = i as f32 / k as f32;
            self.push(
                [
                    from[0] + f * (to[0] - from[0]),
                    from[1] + f * (to_y - from[1]),
                    from[2] + f * (to[1] - from[2]),
                ],
                from_arc + f * (to_arc - from_arc),
            );
        }
    }

    /// Along a branch's centreline from fraction `f0` to `f1` of its length, its arcs spread over `(a, b)`.
    fn branch(
        &mut self,
        line: &[[f32; 2]],
        f0: f32,
        f1: f32,
        ya: f32,
        yb: f32,
        (a, b): (f32, f32),
    ) {
        let mut cum = vec![0.0f32];
        for w in line.windows(2) {
            cum.push(cum.last().unwrap() + (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]));
        }
        let len = *cum.last().unwrap();
        let mut u = f0 * len;
        let mut k = 0;
        while u <= f1 * len {
            while k + 2 < cum.len() && cum[k + 1] < u {
                k += 1;
            }
            let seg = (cum[k + 1] - cum[k]).max(1e-6);
            let t = ((u - cum[k]) / seg).clamp(0.0, 1.0);
            let f = u / len;
            self.push(
                [
                    line[k][0] + t * (line[k + 1][0] - line[k][0]),
                    ya + f * (yb - ya) + RIDE_M,
                    line[k][1] + t * (line[k + 1][1] - line[k][1]),
                ],
                a + f * (b - a),
            );
            u += STEP_M;
        }
    }
}

/// How a line takes each fork.
#[derive(Clone, Copy, PartialEq)]
enum ForkWay {
    Road,
    Branch,
    /// Road to a quarter of the span, across the island to the branch, back across the island to the road.
    IslandCuts,
    /// The split and the merge cut across the island: off the road 25 m before the split straight onto the branch a fifth
    /// of the way along it, and off the branch four fifths along straight back to the road 25 m past the merge.
    EndCuts,
}

/// The lap from arc `a` to `b` on the road (lateral and lift as given), taking every fork in between `way`.
fn lap_line(
    t: &Track,
    a: f32,
    b: f32,
    way: ForkWay,
    lateral: &dyn Fn(f32) -> f32,
    lift: &dyn Fn(f32) -> f32,
) -> Line {
    let mut line = Line::default();
    // Every fork occurrence in (a, b), in order.
    let mut spans: Vec<(f32, f32, usize)> = Vec::new();
    if way != ForkWay::Road {
        for (k, (d, _)) in t.forks.iter().enumerate() {
            let (fa, fb) = t.fork_span(d);
            for lap in -1..=(LAPS as i32 + 1) {
                let o = lap as f32 * t.total;
                if fa + o > a && fb + o < b {
                    spans.push((fa + o, fb + o, k));
                }
            }
        }
    }
    spans.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut s = a;
    for (fa, fb, k) in spans {
        if fa < s {
            continue;
        }
        let (d, path) = &t.forks[k];
        let (ya, yb) = (t.p[d.from as usize][1], t.p[d.to as usize][1]);
        match way {
            ForkWay::Branch => {
                line.road(t, s, fa, lateral, lift);
                line.branch(path, 0.0, 1.0, ya, yb, (fa, fb));
            }
            ForkWay::IslandCuts => {
                let span = fb - fa;
                line.road(t, s, fa + 0.25 * span, &|_| 0.0, &|_| 0.0);
                let len = path.len() as f32 - 1.0;
                let b0 = path[(0.35 * len) as usize];
                line.straight(b0, ya + 0.35 * (yb - ya) + RIDE_M, fa + 0.35 * span);
                line.branch(path, 0.35, 0.65, ya, yb, (fa, fb));
                let r = t.at(fa + 0.8 * span, 0.0);
                line.straight([r[0], r[2]], r[1], fa + 0.8 * span);
                line.road(t, fa + 0.8 * span, fb, &|_| 0.0, &|_| 0.0);
            }
            ForkWay::EndCuts => {
                let len = path.len() as f32 - 1.0;
                line.road(t, s, (fa - 25.0).max(s), &|_| 0.0, &|_| 0.0);
                let b0 = path[(0.2 * len) as usize];
                line.straight(b0, ya + 0.2 * (yb - ya) + RIDE_M, fa + 0.2 * (fb - fa));
                line.branch(path, 0.2, 0.8, ya, yb, (fa, fb));
                let r = t.at(fb + 25.0, 0.0);
                line.straight([r[0], r[2]], r[1], fb + 25.0);
                s = fb + 25.0;
                continue;
            }
            ForkWay::Road => unreachable!(),
        }
        s = fb;
    }
    line.road(t, s, b, lateral, lift);
    line
}

/// The corner-cut line from arc `a` to `b`: chords across every bend that stay within `CORNER_CUT_M` of the road's edge
/// and inside the corridor, at most 80 m of road each.
fn corner_cut_line(t: &Track, a: f32, b: f32) -> Line {
    let n = t.n();
    let mut line = Line::default();
    let (i0, _) = t.seg(a);
    let mut i = (i0 + 1) % n;
    let mut base = a + (t.s[i] - a.rem_euclid(t.total)).rem_euclid(t.total);
    line.road(t, a, base, &|_| 0.0, &|_| 0.0);
    while base < b {
        let mut best = 1;
        for j in 2..=32usize {
            let k = (i + j) % n;
            if t.on_road[k] || t.on_road[i] {
                break;
            }
            let (pa, pb) = (t.p[i], t.p[k]);
            let (dx, dz) = (pb[0] - pa[0], pb[2] - pa[2]);
            let l = dx.hypot(dz).max(1e-6);
            let fits = (1..j).all(|m| {
                let q = t.p[(i + m) % n];
                let dev = ((q[0] - pa[0]) * dz - (q[2] - pa[2]) * dx).abs() / l;
                dev <= (t.half[(i + m) % n] + CORNER_CUT_M).min(t.corridor[(i + m) % n] - 1.0)
            });
            if !fits {
                break;
            }
            best = j;
        }
        let k = (i + best) % n;
        let next = base + (t.s[k] - t.s[i]).rem_euclid(t.total);
        let q = t.p[k];
        line.straight([q[0], q[2]], q[1] + RIDE_M, next);
        i = k;
        base = next;
    }
    line
}

/// The airborne line's hop over arc `s`: 45 m long and 4 m high every 100 m, drifting 6 m sideways (alternating), kept
/// on the road over decks, loops and pits.
fn hop(t: &Track, s: f32) -> (f32, f32) {
    let k = (s / 100.0).floor();
    let u = s - k * 100.0;
    if u > 45.0 || t.on_road[t.seg(s).0] {
        return (0.0, 0.0);
    }
    let h = (std::f32::consts::PI * u / 45.0).sin();
    let side = if (k as i64) % 2 == 0 { 1.0 } else { -1.0 };
    (4.0 * h, side * 6.0 * h)
}

/// Drives `line` through a fresh race: the lap must count within `ON_TIME_M` of each finish crossing and never sooner,
/// and the car finish. `respawn_at`: line indices where the car is wrecked (the first time it gets there); it then rides
/// on from the line point nearest its anchor. Returns what went wrong.
fn audit(t: &Track, line: &Line, respawn_at: &[usize]) -> Vec<String> {
    let mut race = Race::new(Course::new(&t.map));
    let first = line.pos[0];
    race.add_car(SpawnPose {
        x: first[0],
        y: first[1],
        z: first[2],
        heading: 0.0,
    });
    race.start(0, LAPS);
    let mut bad = Vec::new();
    let mut tick = 0u64;
    let mut i = 0usize;
    let mut wrecked = vec![false; respawn_at.len()];
    let mut checked: BTreeMap<(u32, bool), bool> = BTreeMap::new();
    let mut fed: BTreeMap<u64, [f32; 3]> = BTreeMap::new();
    let view = |p: [f32; 3]| CarView {
        position: p,
        up_y: 1.0,
        speed: STEP_M * jj_sim::TICK_HZ as f32,
    };
    while i < line.pos.len() {
        tick += 1;
        let fed_at = t.fly(line.pos[i], line.arc[i]);
        fed.insert(tick, fed_at);
        let effects = race.update(tick, &[view(fed_at)]);
        if let Some(Effect::Respawn { why, .. }) =
            effects.iter().find(|e| matches!(e, Effect::Respawn { .. }))
        {
            bad.push(format!(
                "respawned ({why:?}) at arc {:.0}",
                line.arc[i] - t.finish_s
            ));
            break;
        }
        // Checkpoints: just before and just after each finish crossing.
        let u = line.arc[i] - t.finish_s;
        for lap in 1..=LAPS {
            let cross = lap as f32 * t.total;
            for after in [false, true] {
                let mark = if after {
                    cross + ON_TIME_M
                } else {
                    cross - ON_TIME_M
                };
                if u >= mark && !checked.contains_key(&(lap, after)) {
                    checked.insert((lap, after), true);
                    let got = race.laps_completed(0);
                    let want = if after { lap } else { lap - 1 };
                    if got != want {
                        let c = race.car(0).unwrap();
                        let lateral = {
                            let (si, _) = t.seg(line.arc[i]);
                            let q = t.p[si];
                            (line.pos[i][0] - q[0]) * t.nrm[si][0]
                                + (line.pos[i][2] - q[2]) * t.nrm[si][1]
                        };
                        bad.push(format!(
                            "{} lap {lap}: {got} laps counted, {want} wanted; gates passed {} (last gate {:?}, route point {}), {lateral:.1} m off centre",
                            if after { "after" } else { "before" },
                            c.gates_passed,
                            c.last_gate,
                            c.last_gate.map_or(0, |g| race.course.gate_route_point(g)),
                        ));
                    }
                }
            }
        }
        if let Some(k) = respawn_at.iter().position(|&r| r == i)
            && !wrecked[k]
        {
            wrecked[k] = true;
            if let Some(Effect::Respawn { pose, .. }) = race.wreck(tick, 0, Respawned::OutOfBounds)
            {
                let at = [pose.x, pose.y, pose.z];
                for _ in 0..=RESPAWN_HOLD_TICKS {
                    tick += 1;
                    race.update(tick, &[view(at)]);
                }
                // Ride on from the line point nearest the anchor, at or behind here.
                i = (i.saturating_sub((300.0 / STEP_M) as usize)..=i)
                    .min_by(|&a, &b| {
                        let d = |k: usize| (line.pos[k][0] - at[0]).hypot(line.pos[k][2] - at[2]);
                        d(a).total_cmp(&d(b))
                    })
                    .unwrap();
                let off = (line.pos[i][0] - at[0]).hypot(line.pos[i][2] - at[2]);
                if off > 3.0 {
                    bad.push(format!(
                        "resumed {off:.1} m from the anchor (arc {:.0})",
                        line.arc[i] - t.finish_s
                    ));
                }
                continue;
            }
            bad.push(format!(
                "wreck refused at arc {:.0}",
                line.arc[i] - t.finish_s
            ));
        }
        i += 1;
    }
    if !race.is_finished(0) {
        // Where the line passed the gate it is stuck on: how far off centre, against that gate's reach.
        let c = race.car(0).unwrap();
        let g = race.course.gate_count();
        let stuck = c.gates_passed as usize % g.max(1);
        let at = race.course.gate_route_point(stuck);
        let gs = t.s[at];
        if let Some(k) = (1..line.pos.len()).find(|&k| {
            let (a, b) = (
                (line.arc[k - 1] - gs).rem_euclid(t.total),
                (line.arc[k] - gs).rem_euclid(t.total),
            );
            a > t.total - 5.0 && b < 5.0
        }) {
            let q = t.p[at];
            let lateral =
                (line.pos[k][0] - q[0]) * t.nrm[at][0] + (line.pos[k][2] - q[2]) * t.nrm[at][1];
            bad.push(format!(
                "stuck on gate {stuck} (route point {at}): passed it {lateral:.1} m off centre, its reach {:.1} m (half width {:.1}, corridor {:.1})",
                race.course.gate_reach_m(stuck),
                t.half[at],
                t.corridor[at],
            ));
        }
        bad.push(format!(
            "never finished: {} laps, gates passed {} of {} a lap",
            race.laps_completed(0),
            c.gates_passed,
            race.course.gate_count()
        ));
    }
    let laps = race
        .events()
        .iter()
        .filter(|(_, e)| matches!(e, Event::LapCompleted { .. }))
        .count();
    if laps != LAPS as usize {
        bad.push(format!("{laps} laps completed, {LAPS} driven"));
    }
    // A line players drive is never told it missed a gate.
    for (tick, e) in race.events() {
        if let Event::MissedGate { gate, .. } = e {
            let p = fed.get(tick).copied().unwrap_or_default();
            let near: Vec<String> = (0..race.course.gate_count())
                .filter_map(|g| {
                    let [gx, _, gz] = race.course.gate_point(g);
                    let d = (gx - p[0]).hypot(gz - p[2]);
                    let at = race.course.gate_route_point(g);
                    (d < race.course.gate_reach_m(g) + 5.0).then(|| {
                        format!(
                            "g{g}@rp{at} d{d:.0} y{:.1} reach{:.0}",
                            t.p[at][1],
                            race.course.gate_reach_m(g)
                        )
                    })
                })
                .collect();
            bad.push(format!(
                "told it missed gate {gate} (route point {}) at tick {tick}, car at y {:.1}; gates near: {}",
                race.course.gate_route_point(*gate as usize),
                p[1],
                near.join(", ")
            ));
        }
    }
    bad
}

/// The infield cut: on the second lap, from the road straight across to the part of the lap that gains the most road
/// for the least ground (300 m of road up to half a lap gained), then on along the road past the next finish crossing. Returns
/// what went wrong, or `None` when the lap has no such cut.
fn infield_cut(t: &Track) -> Option<Vec<String>> {
    let n = t.n();
    let u = |i: usize| (t.s[i] - t.finish_s).rem_euclid(t.total);
    let mut best: Option<(f32, usize, usize)> = None;
    for i in (0..n).step_by(4) {
        let ui = u(i);
        if ui < 60.0 || t.on_road[i] {
            continue;
        }
        for j in (0..n).step_by(2) {
            let gain = u(j) - ui;
            // Ahead, up to half a lap: further "round" is behind the car (driving back to the start isn't a cut).
            if !(300.0..=(t.total / 2.0).min(t.total - ui - 40.0)).contains(&gain) || t.on_road[j] {
                continue;
            }
            let d = (t.p[j][0] - t.p[i][0]).hypot(t.p[j][2] - t.p[i][2]);
            if d > 0.35 * gain || d > 200.0 {
                continue;
            }
            let score = gain - 3.0 * d;
            if best.is_none_or(|b| score > b.0) {
                best = Some((score, i, j));
            }
        }
    }
    let (_, i, j) = best?;
    let (sa, sb) = (t.finish_s + t.total + u(i), t.finish_s + t.total + u(j));
    let mut line = lap_line(t, t.finish_s - 20.0, sa, ForkWay::Road, &|_| 0.0, &|_| 0.0);
    let to = t.p[j];
    line.straight([to[0], to[2]], to[1] + RIDE_M, sb);
    let rest = lap_line(
        t,
        sb,
        t.finish_s + 2.0 * t.total + ON_TIME_M,
        ForkWay::Road,
        &|_| 0.0,
        &|_| 0.0,
    );
    line.pos.extend(rest.pos);
    line.arc.extend(rest.arc);
    let mut race = Race::new(Course::new(&t.map));
    let first = line.pos[0];
    race.add_car(SpawnPose {
        x: first[0],
        y: first[1],
        z: first[2],
        heading: 0.0,
    });
    race.start(0, LAPS);
    let mut at_cut = None;
    let mut bad = Vec::new();
    for (k, &p) in line.pos.iter().enumerate() {
        race.update(
            k as u64 + 1,
            &[CarView {
                position: t.fly(p, line.arc[k]),
                up_y: 1.0,
                speed: 36.0,
            }],
        );
        if at_cut.is_none() && line.arc[k] >= sa {
            at_cut = Some((race.laps_completed(0), race.progress_m(0)));
        }
    }
    let (laps, progress) = at_cut?;
    let (laps_end, progress_end) = (race.laps_completed(0), race.progress_m(0));
    // ... and the car is told it missed a gate (the TV and phone show where to go back).
    let told = race
        .events()
        .iter()
        .any(|(_, e)| matches!(e, Event::MissedGate { .. }));
    if !told {
        bad.push(format!(
            "infield cut from route point {i} to {j}: never told it missed a gate"
        ));
    }
    if laps_end != laps || progress_end > progress + GATE_CATCH_UP_M + 60.0 {
        bad.push(format!(
            "infield cut from route point {i} to {j} ({:.0} m of road for {:.0} m across): laps {laps} -> {laps_end}, progress {progress:.0} -> {progress_end:.0} m",
            u(j) - u(i),
            (t.p[j][0] - t.p[i][0]).hypot(t.p[j][2] - t.p[i][2]),
        ));
    }
    Some(bad)
}

/// Every line on one track: (line name, what went wrong) for each line driven.
fn audit_track(t: &Track) -> Vec<(&'static str, Vec<String>)> {
    let (a, b) = (t.finish_s - 20.0, t.finish_s + LAPS as f32 * t.total + 40.0);
    let zero = |_: f32| 0.0f32;
    let mut out = Vec::new();
    out.push((
        "road",
        audit(t, &lap_line(t, a, b, ForkWay::Road, &zero, &zero), &[]),
    ));
    if !t.forks.is_empty() {
        out.push((
            "branch",
            audit(t, &lap_line(t, a, b, ForkWay::Branch, &zero, &zero), &[]),
        ));
        out.push((
            "island-cuts",
            audit(
                t,
                &lap_line(t, a, b, ForkWay::IslandCuts, &zero, &zero),
                &[],
            ),
        ));
        out.push((
            "end-cuts",
            audit(t, &lap_line(t, a, b, ForkWay::EndCuts, &zero, &zero), &[]),
        ));
    }
    for (name, side) in [("wide-left", 1.0), ("wide-right", -1.0)] {
        let off = t.wide(side);
        let lateral = |s: f32| {
            let (i, f) = t.seg(s);
            off[i] * (1.0 - f) + off[(i + 1) % t.n()] * f
        };
        out.push((
            name,
            audit(t, &lap_line(t, a, b, ForkWay::Road, &lateral, &zero), &[]),
        ));
    }
    out.push(("corner-cut", audit(t, &corner_cut_line(t, a, b), &[])));
    let air = lap_line(t, a, b, ForkWay::Road, &|s| hop(t, s).1, &|s| hop(t, s).0);
    out.push(("airborne", audit(t, &air, &[])));
    // Respawns: a third of the way round each lap, just past the fifth gate and just short of the ninth.
    let road = lap_line(t, a, b, ForkWay::Road, &zero, &zero);
    let course = Course::new(&t.map);
    let g = course.gate_count();
    let mut marks: Vec<f32> = Vec::new();
    for lap in 0..LAPS {
        let o = t.finish_s + lap as f32 * t.total;
        marks.push(o + t.total / 3.0);
        for (gate, delta) in [(5usize, 2.0f32), (9, -1.0)] {
            if gate < g {
                let gs = (t.s[course.gate_route_point(gate)] - t.finish_s).rem_euclid(t.total);
                marks.push(o + gs + delta);
            }
        }
    }
    let respawn_at: Vec<usize> = marks
        .iter()
        .filter_map(|&m| road.arc.iter().position(|&s| s >= m))
        .collect();
    out.push(("respawn", audit(t, &road, &respawn_at)));
    if let Some(bad) = infield_cut(t) {
        out.push(("infield-cut", bad));
    }
    out
}

fn tracks() -> Vec<Track> {
    let jobs: Vec<(PresetName, u64)> = PresetName::ALL
        .iter()
        .flat_map(|&p| (0..seeds()).map(move |s| (p, s)))
        .collect();
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let chunk = jobs.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let handles: Vec<_> = jobs
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    let registry = jj_procgen::registry();
                    part.iter()
                        .map(|&(family_name, seed)| {
                            let p = jj_procgen::playtest::prepare_data(seed, &family(family_name));
                            let map = load_canonical(&canonical_bytes(&p.map), &registry).unwrap();
                            Track::new(format!("{family_name:?} seed {seed}"), map)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect()
    })
}

#[test]
fn every_line_players_drive_counts_every_lap_once_and_an_infield_cut_counts_nothing() {
    let tracks = tracks();
    let mut failures: Vec<String> = Vec::new();
    let mut runs: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
    let mut cover: BTreeMap<&str, u32> = BTreeMap::new();
    let mut widest: f32 = 0.0;
    for t in &tracks {
        let m = &t.map.map;
        *cover.entry("tracks").or_default() += 1;
        *cover.entry("forks").or_default() += t.forks.iter().filter(|(d, _)| !d.cut).count() as u32;
        *cover.entry("cuts").or_default() += t.forks.iter().filter(|(d, _)| d.cut).count() as u32;
        *cover.entry("loops").or_default() +=
            m.features.iter().filter_map(LoopDesign::of).count() as u32;
        *cover.entry("pits").or_default() += t.pits.len() as u32;
        *cover.entry("layered points").or_default() +=
            jj_map::bridge::layered_points(m).len() as u32;
        widest = widest.max(
            t.wide(1.0)
                .iter()
                .chain(t.wide(-1.0).iter())
                .map(|v| v.abs())
                .fold(0.0, f32::max),
        );
        for (line, bad) in audit_track(t) {
            let e = runs.entry(line).or_default();
            e.0 += 1;
            if !bad.is_empty() {
                e.1 += 1;
                failures.push(format!("{} {line}: {}", t.name, bad.join("; ")));
            }
        }
    }
    // Cut-throughs (P1-FL10) aren't in the shipped generator data; when they ship they are branches like a fork's, and
    // the branch and end-cut lines take them.
    eprintln!("coverage: {cover:?}; widest line {widest:.0} m off centre");
    if !cfg!(debug_assertions) && seeds() >= DEFAULT_SEEDS {
        for k in ["forks", "loops", "pits", "layered points"] {
            assert!(
                cover.get(k).copied().unwrap_or(0) > 0,
                "the sample no longer covers {k}"
            );
        }
        assert!(
            runs.get("infield-cut").is_some_and(|r| r.0 > 0),
            "no lap had an infield cut"
        );
    }
    for (line, (n, f)) in &runs {
        eprintln!("{line:<12} {n:>4} runs, {f:>3} failed");
    }
    for f in &failures {
        eprintln!("{f}");
    }
    assert!(
        failures.is_empty(),
        "{} runs lost or gained laps",
        failures.len()
    );
}
