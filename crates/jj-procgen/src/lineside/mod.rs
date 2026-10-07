//! Lineside rules (P1-M04..M07): pieces placed *by rule* along the road, as data. A biome lists [`Lineside`] rules (houses
//! facing the street, power poles, reflector posts, lane lines, side streets...) and [`SignRule`]s (a warning sign a set
//! distance before each crest or jump, a direction sign at each junction, a sign where the biome starts); the engine
//! walks the route and places them. It is the rule-driven counterpart of [`crate::scatter`] (random fill): lineside
//! pieces keep to the road and its frontage, scatter fills the ground around them and avoids them.
//!
//! - A rule applies only where its biome dominates the route (the selector's weight is at least a half), never in a
//!   transition zone's far side, and never on a corner when `avoid_corners` is set (the corner furniture is the core's).
//! - A piece anchored to the road's *edge* keeps its whole footprint clear of every part of the route and of every piece
//!   already placed, so nothing sits on the road, the start corridor or a jump's landing (those are the road's own width).
//!   A piece anchored to the *centre* (lane lines) lies on the road, flat and never colliding.
//! - Spacing, offsets, sizes and gaps are drawn from the dressing stream; no count is capped: a longer stretch gets more.
//!
//! Integers out, `libm` maths in a fixed order: identical natively and in WASM.

use std::collections::BTreeMap;

use jj_map::{Biome, Dressing, FeatureKind, Footprint, Map, Pose, Prop, Registry};

use crate::scatter::{RoadIndex, reach_m};
use crate::seed::Rng;
use crate::terrain::ground_height_m;

/// Nothing placed by edge-anchored rule comes closer than this to the road edge (the camera margin plus slack), m.
pub const CLEAR_M: f64 = 2.5;
/// How far the drawn road surface sits above the heightfield (the map renderer's route ribbon), so lane lines placed on
/// it show: they are lifted by this much, m.
pub const ROAD_SURFACE_LIFT_M: f64 = 0.07;
/// The longest gap a [`Lineside::link`] is strung across, m.
pub const LINK_MAX_M: f64 = 60.0;
/// Footprints keep this much air between them, m.
pub const GAP_M: f64 = 0.3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
    Both,
    /// One side, drawn per placement.
    Either,
}

/// What the offset is measured from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    /// From the road's edge outward: the piece's *near edge* (its reach) clears the edge by at least the offset.
    Edge,
    /// From the centerline (signed toward the side): the piece lies on the road.
    Centre,
}

/// Which way the piece's front (+z, and its length along x) points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Yaw {
    /// Length (x) along the route.
    Along,
    /// Front toward the road (houses facing the street).
    FaceRoad,
    /// Length (x) pointing away from the road (a side street).
    Across,
    /// Any heading.
    Random,
}

/// One rule: a piece repeated along the route.
#[derive(Clone, Copy, Debug)]
pub struct Lineside {
    pub kit_piece: &'static str,
    /// Distance between placements (m), drawn per placement; a piece's own length belongs in this range.
    pub spacing_m: (f64, f64),
    pub side: Side,
    pub anchor: Anchor,
    /// Edge anchor: metres from the road edge to the piece's near edge. Centre anchor: metres from the centerline
    /// to the piece's centre.
    pub offset_m: (f64, f64),
    pub params: &'static [(&'static str, i64, i64)],
    pub collides: bool,
    pub yaw: Yaw,
    /// Chance (0..1) of leaving a placement out (gaps between houses).
    pub skip: f64,
    /// Keep off corners (the core's chevrons and rail own those).
    pub avoid_corners: bool,
    /// Active for `.0` metres, then off for `.1`, repeating (a rail run at a culvert). `None`: always on.
    pub stretch: Option<(f64, f64)>,
    /// Placed as a dynamic prop (a wheelie bin) instead of static dressing.
    pub prop: bool,
    /// Strung between neighbours of this rule on one side: a piece of this id (power lines, `lengthMm` the gap, `heightCm` the
    /// lower pole's) is placed between each consecutive pair less than [`LINK_MAX_M`] apart.
    pub link: Option<&'static str>,
}

/// A sign placed by rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// At each side street the biome placed (the sign stands just before the junction).
    Junction,
    /// Before every feature of this kind in the biome.
    Feature(FeatureKind),
    /// Where the biome's stretch begins (after the transition zone).
    BiomeEntry,
}

#[derive(Clone, Copy, Debug)]
pub struct SignRule {
    pub kit_piece: &'static str,
    pub trigger: Trigger,
    /// How far before the trigger point along the route the sign stands, m.
    pub before_m: f64,
    /// Metres from the road edge to the sign's near edge.
    pub offset_m: f64,
}

/// The pieces the engine places (so a scatter pass clears its own work and keeps these).
pub fn rule_ids() -> Vec<&'static str> {
    let mut ids = Vec::new();
    for b in crate::biome::ALL {
        let d = crate::biome::def(b).data();
        ids.extend(d.lineside.iter().filter(|r| !r.prop).map(|r| r.kit_piece));
        ids.extend(d.lineside.iter().filter_map(|r| r.link));
        ids.extend(d.signs.iter().map(|s| s.kit_piece));
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

struct Obstacles {
    cell: f64,
    x0: f64,
    z0: f64,
    cols: usize,
    rows: usize,
    grid: Vec<Vec<(f64, f64, f64)>>,
}

impl Obstacles {
    fn new(x0: f64, z0: f64, w: f64, h: f64) -> Self {
        let cell = 24.0;
        let (cols, rows) = (
            libm::ceil(w / cell) as usize + 1,
            libm::ceil(h / cell) as usize + 1,
        );
        Self {
            cell,
            x0,
            z0,
            cols,
            rows,
            grid: vec![Vec::new(); cols * rows],
        }
    }

    fn at(&self, x: f64, z: f64) -> (usize, usize) {
        (
            ((libm::floor((x - self.x0) / self.cell)).max(0.0) as usize).min(self.cols - 1),
            ((libm::floor((z - self.z0) / self.cell)).max(0.0) as usize).min(self.rows - 1),
        )
    }

    fn add(&mut self, x: f64, z: f64, r: f64) {
        let (c, r_) = self.at(x, z);
        self.grid[r_ * self.cols + c].push((x, z, r));
    }

    fn clash(&self, x: f64, z: f64, r: f64) -> bool {
        let (c, rr) = self.at(x, z);
        let span = libm::ceil((r + 30.0) / self.cell) as usize;
        (rr.saturating_sub(span)..=(rr + span).min(self.rows - 1)).any(|row| {
            (c.saturating_sub(span)..=(c + span).min(self.cols - 1)).any(|col| {
                self.grid[row * self.cols + col]
                    .iter()
                    .any(|&(px, pz, pr)| libm::hypot(x - px, z - pz) < r + pr + GAP_M)
            })
        })
    }
}

/// The route as the engine walks it.
struct Walk {
    pts: Vec<(f64, f64)>,
    s: Vec<f64>,
    half: f64,
    corner: Vec<bool>,
    /// The corners themselves, without the run-in either side (a sign may stand on the run-in, not on the turn).
    turn: Vec<bool>,
}

impl Walk {
    fn tangent(&self, i: usize) -> (f64, f64) {
        let n = self.pts.len();
        let (a, b) = (self.pts[i % n], self.pts[(i + 1) % n]);
        let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    }

    fn index_at(&self, s: f64) -> usize {
        self.s
            .iter()
            .position(|&v| v >= s)
            .unwrap_or(self.pts.len() - 1)
    }
}

fn yaw_cdeg(dx: f64, dz: f64) -> i32 {
    libm::round(libm::atan2(dz, dx).to_degrees() * 100.0) as i32
}

/// The yaw (centidegrees) that turns a piece's front (+z) toward the direction `(fx, fz)`.
fn face(fx: f64, fz: f64) -> i32 {
    libm::round(libm::atan2(-fx, fz).to_degrees() * 100.0) as i32
}

/// Everything one run of the engine needs.
pub struct Context<'a> {
    pub biome: Biome,
    pub registry: &'a Registry,
    /// The selector's weight of this biome at route point `i`.
    pub weight: &'a dyn Fn(usize) -> f64,
    /// Arc length where the biome's stretches begin (for [`Trigger::BiomeEntry`]).
    pub entries: &'a [f64],
}

/// Places the biome's rules and signs on `map`. Draws only from `rng` (the dressing stream).
pub fn place(
    map: &mut Map,
    rng: &mut Rng,
    ctx: &Context<'_>,
    rules: &[Lineside],
    signs: &[SignRule],
) {
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let (s, total) = crate::assemble::arc_lengths(&pts);
    let mut turn = vec![false; pts.len()];
    let corner: Vec<bool> = {
        let mut flags = vec![false; pts.len()];
        for c in crate::biome::wayfinding::corners(&pts) {
            // A corner and the straight run-in either side (the furniture and the view).
            let pad = 6usize;
            for f in turn.iter_mut().take((c.to + 1).min(pts.len())).skip(c.from) {
                *f = true;
            }
            for f in flags
                .iter_mut()
                .take((c.to + pad + 1).min(pts.len()))
                .skip(c.from.saturating_sub(pad))
            {
                *f = true;
            }
        }
        flags
    };
    let walk = Walk {
        turn,
        pts: pts.clone(),
        s,
        half,
        corner,
    };
    let b = map.header.bounds;
    let (x0, z0) = (f64::from(b.min_x) / 1000.0, f64::from(b.min_z) / 1000.0);
    let (w, h) = (
        f64::from(b.max_x - b.min_x) / 1000.0,
        f64::from(b.max_z - b.min_z) / 1000.0,
    );
    let road = RoadIndex::new(pts, x0, z0, w, h);
    let mut obstacles = Obstacles::new(x0, z0, w, h);
    for d in &map.dressing {
        let reach = ctx
            .registry
            .get(&d.kit_piece)
            .and_then(|k| k.footprint(&d.params))
            .map_or(0.5, |fp| reach_m(&fp));
        obstacles.add(
            f64::from(d.pose.x) / 1000.0,
            f64::from(d.pose.z) / 1000.0,
            reach,
        );
    }
    let mut dressing: Vec<Dressing> = Vec::new();
    let mut props: Vec<Prop> = Vec::new();
    let mut junctions: Vec<(f64, f64)> = Vec::new(); // (arc length, side) of each side street

    for rule in rules {
        let Some(kit) = ctx.registry.get(rule.kit_piece) else {
            continue;
        };
        let mut linked: Vec<(f64, f64, Pose, i64)> = Vec::new();
        let mut at = rng.range(0.0, rule.spacing_m.1);
        while at < total {
            let (lo, hi) = rule.spacing_m;
            let step = if hi > lo { rng.range(lo, hi) } else { lo };
            let here = at;
            at += step;
            // Every draw happens whether or not the placement survives.
            let side_draw = rng.unit();
            let off = if rule.offset_m.1 > rule.offset_m.0 {
                rng.range(rule.offset_m.0, rule.offset_m.1)
            } else {
                rule.offset_m.0
            };
            // An edge-anchored piece never nearer the road than the clearance (a side street's mouth is the road).
            let off = if rule.anchor == Anchor::Edge && rule.yaw != Yaw::Across {
                off.max(CLEAR_M)
            } else {
                off
            };
            let params: BTreeMap<String, i64> = rule
                .params
                .iter()
                .map(|&(k, lo, hi)| {
                    (
                        k.to_string(),
                        lo + (rng.next_u64() % (hi - lo + 1) as u64) as i64,
                    )
                })
                .collect();
            let random_yaw = (rng.next_u64() % 36_000) as i32;
            let skipped = rng.unit() < rule.skip;
            if skipped {
                continue;
            }
            if let Some((on, off_len)) = rule.stretch
                && libm::fmod(here, on + off_len) >= on
            {
                continue;
            }
            let i = walk.index_at(here);
            if (ctx.weight)(i) < 0.5 || (rule.avoid_corners && walk.corner[i]) {
                continue;
            }
            let sides: &[f64] = match rule.side {
                Side::Left => &[-1.0],
                Side::Right => &[1.0],
                Side::Both => &[-1.0, 1.0],
                Side::Either => {
                    if side_draw < 0.5 {
                        &[-1.0]
                    } else {
                        &[1.0]
                    }
                }
            };
            let Some(fp) = kit.footprint(&params) else {
                continue;
            };
            let reach = reach_m(&fp);
            let (tx, tz) = walk.tangent(i);
            // + lateral is the right of travel, along (-tz, tx).
            let (nx, nz) = (-tz, tx);
            for &side in sides {
                let (cx, cz, yaw) = match rule.anchor {
                    Anchor::Edge => {
                        // Across: the piece's length points away from the road, so its centre is half a length out.
                        let depth = if rule.yaw == Yaw::Across {
                            footprint_x(&fp) / 2.0
                        } else {
                            reach
                        };
                        let lateral = side * (walk.half + off + depth);
                        let yaw = match rule.yaw {
                            Yaw::Along => yaw_cdeg(tx, tz),
                            Yaw::FaceRoad => face(-side * nx, -side * nz),
                            Yaw::Across => yaw_cdeg(side * nx, side * nz),
                            Yaw::Random => random_yaw,
                        };
                        (
                            walk.pts[i].0 + nx * lateral,
                            walk.pts[i].1 + nz * lateral,
                            yaw,
                        )
                    }
                    Anchor::Centre => {
                        let lateral = side * off;
                        let yaw = if rule.yaw == Yaw::Random {
                            random_yaw
                        } else {
                            yaw_cdeg(tx, tz)
                        };
                        (
                            walk.pts[i].0 + nx * lateral,
                            walk.pts[i].1 + nz * lateral,
                            yaw,
                        )
                    }
                };
                if cx < x0 + reach || cz < z0 + reach || cx > x0 + w - reach || cz > z0 + h - reach
                {
                    continue;
                }
                if rule.anchor == Anchor::Edge {
                    if rule.yaw == Yaw::Across {
                        // A side street joins the road: its centre and far end must still be only as far from the route
                        // as the street is long, i.e. no other part of the road is nearer.
                        let len = footprint_x(&fp);
                        let far = (cx + side * nx * len / 2.0, cz + side * nz * len / 2.0);
                        let (d_far, _) = road.nearest(far);
                        let (d_mid, _) = road.nearest((cx, cz));
                        if d_far - walk.half < len * 0.9 || d_mid - walk.half < len * 0.45 {
                            continue;
                        }
                    } else {
                        let (near, _) = road.nearest((cx, cz));
                        if near - walk.half - reach < CLEAR_M - 0.01 {
                            continue;
                        }
                    }
                    if obstacles.clash(
                        cx,
                        cz,
                        if rule.yaw == Yaw::Across {
                            footprint_x(&fp) / 2.0
                        } else {
                            reach
                        },
                    ) {
                        continue;
                    }
                    obstacles.add(
                        cx,
                        cz,
                        if rule.yaw == Yaw::Across {
                            footprint_x(&fp) / 2.0
                        } else {
                            reach
                        },
                    );
                }
                let mut ground = ground_height_m(
                    &map.terrain,
                    libm::round(cx * 1000.0) / 1000.0,
                    libm::round(cz * 1000.0) / 1000.0,
                );
                if rule.yaw == Yaw::Across {
                    // A side street is a low pad across whatever the ground does: its base sits at the lowest ground under it.
                    let len = footprint_x(&fp);
                    for k in 0..=6 {
                        let t = f64::from(k) / 6.0 - 0.5;
                        let (px, pz) = (cx + side * nx * len * t, cz + side * nz * len * t);
                        ground = ground.min(ground_height_m(&map.terrain, px, pz));
                    }
                }
                if rule.anchor == Anchor::Edge && rule.yaw != Yaw::Across && reach >= 3.0 {
                    // A big piece (a dome) stands on the lowest ground under it, sunk a little, so its base never hovers
                    // where the ground falls away.
                    for k in 0..8 {
                        let a = f64::from(k) * core::f64::consts::TAU / 8.0;
                        let (px, pz) = (
                            cx + libm::cos(a) * reach * 0.85,
                            cz + libm::sin(a) * reach * 0.85,
                        );
                        ground = ground.min(ground_height_m(&map.terrain, px, pz));
                    }
                    ground -= 0.3;
                }
                // Lane lines lie on the road surface, which the renderer lifts a few centimetres above the ground (the ribbon).
                let lift = if rule.anchor == Anchor::Centre {
                    ROAD_SURFACE_LIFT_M
                } else {
                    0.0
                };
                let y = libm::round((ground + lift) * 1000.0) as i32;
                let pose = Pose {
                    x: libm::round(cx * 1000.0) as i32,
                    y,
                    z: libm::round(cz * 1000.0) as i32,
                    yaw,
                };
                if rule.prop {
                    props.push(Prop {
                        kit_piece: rule.kit_piece.into(),
                        pose,
                        params: params.clone(),
                    });
                } else {
                    dressing.push(Dressing {
                        kit_piece: rule.kit_piece.into(),
                        pose,
                        params: params.clone(),
                        collides: rule.collides,
                    });
                    if rule.yaw == Yaw::Across {
                        junctions.push((here, side));
                    }
                    if rule.link.is_some() {
                        linked.push((
                            side,
                            here,
                            pose,
                            params.get("heightCm").copied().unwrap_or(800),
                        ));
                    }
                }
            }
        }
        // Strung between neighbours on one side (power lines): a piece centred between each close pair, along their line.
        if let Some(link) = rule.link {
            linked.sort_by(|a, b| {
                (a.0, a.1)
                    .partial_cmp(&(b.0, b.1))
                    .unwrap_or(core::cmp::Ordering::Equal)
            });
            for w in linked.windows(2) {
                let ((sa, ta, pa, ha), (sb, tb, pb, hb)) = (w[0], w[1]);
                let (dx, dz) = (
                    f64::from(pb.x - pa.x) / 1000.0,
                    f64::from(pb.z - pa.z) / 1000.0,
                );
                let dist = libm::hypot(dx, dz);
                if sa != sb || tb - ta > LINK_MAX_M || dist < 8.0 || dist > LINK_MAX_M {
                    continue;
                }
                let mid = ((pa.x + pb.x) / 2, (pa.z + pb.z) / 2);
                let y = libm::round(
                    ground_height_m(
                        &map.terrain,
                        f64::from(mid.0) / 1000.0,
                        f64::from(mid.1) / 1000.0,
                    ) * 1000.0,
                ) as i32;
                dressing.push(Dressing {
                    kit_piece: link.into(),
                    pose: Pose {
                        x: mid.0,
                        y,
                        z: mid.1,
                        yaw: yaw_cdeg(dx, dz),
                    },
                    params: BTreeMap::from([
                        ("lengthMm".into(), libm::round(dist * 1000.0) as i64),
                        ("heightCm".into(), ha.min(hb)),
                    ]),
                    collides: false,
                });
            }
        }
    }

    // Signs by rule.
    let place_once = |rule: &SignRule,
                      s_at: f64,
                      dressing: &mut Vec<Dressing>,
                      obstacles: &mut Obstacles,
                      side: f64|
     -> bool {
        let Some(kit) = ctx.registry.get(rule.kit_piece) else {
            return false;
        };
        let params = BTreeMap::new();
        let Some(fp) = kit.footprint(&params) else {
            return false;
        };
        let reach = reach_m(&fp);
        let i = walk.index_at(s_at.clamp(0.0, total));
        if (ctx.weight)(i) < 0.5 || walk.turn[i] {
            return false;
        }
        let (tx, tz) = walk.tangent(i);
        let (nx, nz) = (-tz, tx);
        let lateral = side * (walk.half + rule.offset_m + reach);
        let (cx, cz) = (walk.pts[i].0 + nx * lateral, walk.pts[i].1 + nz * lateral);
        if cx < x0 + reach || cz < z0 + reach || cx > x0 + w - reach || cz > z0 + h - reach {
            return false;
        }
        let (near, _) = road.nearest((cx, cz));
        if near - walk.half - reach < CLEAR_M || obstacles.clash(cx, cz, reach) {
            return false;
        }
        obstacles.add(cx, cz, reach);
        // The face looks back up the road, at the drivers coming.
        let yaw = face(-tx, -tz);
        let (mx, mz) = (
            libm::round(cx * 1000.0) as i32,
            libm::round(cz * 1000.0) as i32,
        );
        let y = libm::round(
            ground_height_m(&map.terrain, f64::from(mx) / 1000.0, f64::from(mz) / 1000.0) * 1000.0,
        ) as i32;
        dressing.push(Dressing {
            kit_piece: rule.kit_piece.into(),
            pose: Pose {
                x: mx,
                y,
                z: mz,
                yaw,
            },
            params,
            // A sign panel is 100 mm thin: decoration, not a wall (the thickness rule is for colliders).
            collides: false,
        });
        true
    };
    // A sign tries its spot, then spots a little further back and ahead and then the other side of the road, so a house or
    // a dome in the way moves it rather than losing it.
    let place_sign = |rule: &SignRule,
                      s_at: f64,
                      dressing: &mut Vec<Dressing>,
                      obstacles: &mut Obstacles,
                      side: f64| {
        for shift in [0.0, -6.0, 6.0, -12.0, 12.0, -20.0, 20.0, -30.0, 30.0, -45.0] {
            for side in [side, -side] {
                if place_once(rule, s_at + shift, dressing, obstacles, side) {
                    return;
                }
            }
        }
    };

    for rule in signs {
        match rule.trigger {
            Trigger::Junction => {
                for &(s_at, side) in &junctions {
                    // The sign stands on the same side as the street, ahead of its mouth.
                    place_sign(
                        rule,
                        s_at - rule.before_m,
                        &mut dressing,
                        &mut obstacles,
                        side,
                    );
                }
            }
            Trigger::Feature(kind) => {
                for f in map.features.iter().filter(|f| f.kind == kind) {
                    let p = (f64::from(f.pose.x) / 1000.0, f64::from(f.pose.z) / 1000.0);
                    let i = (0..walk.pts.len())
                        .min_by(|&a, &c| {
                            let d = |i: usize| {
                                (walk.pts[i].0 - p.0).powi(2) + (walk.pts[i].1 - p.1).powi(2)
                            };
                            d(a).total_cmp(&d(c))
                        })
                        .unwrap_or(0);
                    place_sign(
                        rule,
                        walk.s[i] - rule.before_m,
                        &mut dressing,
                        &mut obstacles,
                        1.0,
                    );
                }
            }
            Trigger::BiomeEntry => {
                for &e in ctx.entries {
                    place_sign(rule, e - rule.before_m, &mut dressing, &mut obstacles, 1.0);
                }
            }
        }
    }
    map.dressing.extend(dressing);
    map.props.extend(props);
    map.dressing.sort();
    map.props.sort();
}

fn footprint_x(fp: &Footprint) -> f64 {
    match *fp {
        Footprint::Rect { x, .. } => x / 1000.0,
        Footprint::Circle { radius, .. } => radius / 500.0,
    }
}
