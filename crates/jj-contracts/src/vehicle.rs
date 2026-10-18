//! The vehicle asset contract `jj.vehicle.v1` (plan §6.2; schema `art/contracts/vehicle.schema.json`): a sidecar
//! (`<vehicle>.asset.json`) plus one GLB per LOD, and a validator that checks the GLB data itself, not just the sidecar's
//! claims. It catches the spike-era mistakes: mass fractions summing to 0.92, the origin off the ground, a "round" cabin
//! proxy that was a box.
//!
//! GLB layout: one scene root (the vehicle); its children are the parts (a node named by part id, translated to the
//! part's pivot, with the part's mesh), the anchors (empty nodes named by anchor id) and, in the LOD0 file, the collider
//! proxies (`collider_<part>`, meshes in vehicle space, never rendered), and any interior blocks the sidecar declares
//! (`interior_<id>`, meshes in vehicle space, drawn only when a part that exposes them is loose or gone; P1-V03). Units
//! metres, +y up, +z forward, origin on the ground between the axles.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::glb::{Glb, apply};

pub const CONTRACT: &str = "jj.vehicle.v1";
/// A car's parts (four wheels, four doors).
pub const PARTS: [&str; 11] = [
    "core", "front", "back", "door_FL", "door_FR", "door_RL", "door_RR", "wheel_FL", "wheel_FR",
    "wheel_RL", "wheel_RR",
];
/// A motorbike's parts (br-bwju.5, the bike variant; the two-wheel sim's part layout from br-bwju.4): the rider is a part
/// that comes loose and detaches like a panel (R121), and the two wheels sit on the centreline.
pub const BIKE_PARTS: [&str; 6] = ["core", "front", "back", "rider", "wheel_F", "wheel_R"];

/// The part set a sidecar is held to: a vehicle with a `wheel_F` is a bike, anything else a car.
pub fn part_set(sidecar: &Sidecar) -> &'static [&'static str] {
    if sidecar.parts.contains_key("wheel_F") {
        &BIKE_PARTS
    } else {
        &PARTS
    }
}
pub const ANCHORS: [&str; 6] = [
    "cam_fp",
    "cam_tp_target",
    "com",
    "roof_number",
    "lplate_front",
    "lplate_rear",
];
/// The qualified triangle budgets per LOD (plan §6.2; P1-Q01 requalifies them). A sidecar may ask for less, never more.
/// LOD0 rose from 1300 to 3000 for the sheet-matched bodies (owner 2026-10-18, br-bwju.11): it draws only in tiles at
/// least 540 px tall (the host's lodForTileHeight), so a few cars on a TV pay for it.
pub const TRI_BUDGETS: [usize; 3] = [3000, 900, 600];
/// The most a per-vehicle override (`triBudgetOverride`, br-bwju.12) may raise each LOD's budget to: twice the qualified
/// LOD1 and LOD2 budgets, LOD0 unchanged. An override names why and who approved it; without one a car gets `TRI_BUDGETS`.
pub const TRI_BUDGET_OVERRIDE_CEILING: [usize; 3] = [3000, 1800, 1200];
/// Distance tolerances, metres.
pub const POSITION_TOLERANCE_M: f64 = 0.001;
pub const GROUND_TOLERANCE_M: f64 = 0.02;
pub const AXLE_CENTRE_TOLERANCE_M: f64 = 0.05;
pub const MASS_SUM_TOLERANCE: f64 = 0.01;
/// Triangles per interior block at any LOD (plan §6.3 asks ~40–60): drawn only when exposed, so outside `TRI_BUDGETS`.
pub const INTERIOR_TRI_BUDGET: usize = 80;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sidecar {
    pub contract: String,
    pub id: String,
    pub units: String,
    pub forward: String,
    pub up: String,
    pub lods: Vec<Lod>,
    pub parts: BTreeMap<String, Part>,
    /// Interior blocks by id (P1-V03): what shows through where a part is loose or gone. Optional.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub interiors: BTreeMap<String, Interior>,
    pub anchors: BTreeMap<String, [f64; 3]>,
    pub material: Material,
    /// A per-vehicle raise of the qualified budgets (br-bwju.12: the AU Hawk's far LODs need its round body to be
    /// recognised). Optional; copied from vehicle.json by the bake.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tri_budget_override: Option<TriBudgetOverride>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TriBudgetOverride {
    /// The budget per LOD, LOD0 first, one per LOD; each at most `TRI_BUDGET_OVERRIDE_CEILING`.
    pub max_tris: Vec<usize>,
    /// Why this car needs more (a measurement, not a wish).
    pub why: String,
    /// Who approved it, and when.
    pub approved_by: String,
}

/// The qualified budget for LOD `li` of this sidecar: the override's when it has one, else `TRI_BUDGETS`.
pub fn tri_budget(s: &Sidecar, li: usize) -> usize {
    s.tri_budget_override
        .as_ref()
        .and_then(|o| o.max_tris.get(li).copied())
        .unwrap_or(TRI_BUDGETS[li])
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Interior {
    /// The detachable parts whose loss (or swing) exposes this block.
    pub exposed_by: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lod {
    /// The GLB, relative to the sidecar.
    pub file: String,
    pub max_tris: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Part {
    /// Vehicle-space pivot, metres.
    pub pivot: [f64; 3],
    /// How the part swings when loose (R86); `null` for `core`.
    pub hinge: Option<Hinge>,
    pub mass_fraction: f64,
    pub collider: Collider,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hinge {
    /// Unit axis in vehicle space.
    pub axis: [f64; 3],
    /// Loose limits, degrees.
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColliderKind {
    Convex,
    Cuboid,
    Capsule,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collider {
    #[serde(rename = "type")]
    pub kind: ColliderKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    /// Always 1: the atlas carries the paint key.
    pub count: usize,
    pub atlas: String,
}

/// The named rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rule {
    Schema,
    Contract,
    Axes,
    PartMissing,
    PartUnknown,
    MassSum,
    Hinge,
    ColliderType,
    AnchorMissing,
    Lods,
    Glb,
    PartMissingAtLod,
    Pivot,
    Anchor,
    Materials,
    Draws,
    TriBudget,
    OriginGround,
    OriginAxles,
    ColliderMissing,
    CabinProxyCuboid,
    Interior,
}

impl Rule {
    pub fn name(self) -> &'static str {
        match self {
            Self::Schema => "schema",
            Self::Contract => "contract",
            Self::Axes => "axes",
            Self::PartMissing => "part-missing",
            Self::PartUnknown => "part-unknown",
            Self::MassSum => "mass-sum",
            Self::Hinge => "hinge",
            Self::ColliderType => "collider-type",
            Self::AnchorMissing => "anchor-missing",
            Self::Lods => "lods",
            Self::Glb => "glb",
            Self::PartMissingAtLod => "part-missing-at-lod",
            Self::Pivot => "pivot",
            Self::Anchor => "anchor",
            Self::Materials => "materials",
            Self::Draws => "draws",
            Self::TriBudget => "tri-budget",
            Self::OriginGround => "origin-ground",
            Self::OriginAxles => "origin-axles",
            Self::ColliderMissing => "collider-missing",
            Self::CabinProxyCuboid => "cabin-proxy-cuboid",
            Self::Interior => "interior",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Violation {
    pub rule: Rule,
    pub at: String,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Report {
    pub ok: bool,
    pub violations: Vec<Violation>,
    /// Triangles per LOD, as measured from the GLBs.
    pub tris: Vec<usize>,
}

impl Report {
    pub fn has(&self, rule: Rule) -> bool {
        self.violations.iter().any(|v| v.rule == rule)
    }
}

fn add(v: &mut Vec<Violation>, rule: Rule, at: &str, detail: String) {
    v.push(Violation {
        rule,
        at: at.to_owned(),
        detail,
    });
}

fn close(a: [f64; 3], b: [f64; 3], tol: f64) -> bool {
    (0..3).all(|k| (a[k] - b[k]).abs() <= tol)
}

/// True when every vertex sits on a corner of the points' axis-aligned box: the proxy is a cuboid, however it's meshed.
fn is_cuboid(points: &[[f64; 3]]) -> bool {
    if points.is_empty() {
        return false;
    }
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in points {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    points
        .iter()
        .all(|p| (0..3).all(|k| (p[k] - lo[k]).abs() <= 1e-4 || (p[k] - hi[k]).abs() <= 1e-4))
}

/// Parses a sidecar; unknown or missing fields fail `schema`.
pub fn parse_sidecar(json: &[u8]) -> Result<Sidecar, Report> {
    serde_json::from_slice(json).map_err(|e| Report {
        ok: false,
        violations: vec![Violation {
            rule: Rule::Schema,
            at: "sidecar".into(),
            detail: e.to_string(),
        }],
        tris: vec![],
    })
}

/// Validates a sidecar and its LOD GLBs (`load(file)` returns a LOD file's bytes, so this stays free of I/O).
pub fn validate(sidecar: &Sidecar, mut load: impl FnMut(&str) -> Option<Vec<u8>>) -> Report {
    let mut v = Vec::new();
    let s = sidecar;
    if s.contract != CONTRACT {
        add(
            &mut v,
            Rule::Contract,
            "contract",
            format!("{:?}, expected {CONTRACT:?}", s.contract),
        );
    }
    if s.units != "m" || s.forward != "+z" || s.up != "+y" {
        add(
            &mut v,
            Rule::Axes,
            "units/forward/up",
            format!("{}, {}, {}: expected m, +z, +y", s.units, s.forward, s.up),
        );
    }
    let parts = part_set(s);
    for &p in parts {
        if !s.parts.contains_key(p) {
            add(
                &mut v,
                Rule::PartMissing,
                &format!("parts.{p}"),
                "required part".into(),
            );
        }
    }
    for p in s.parts.keys().filter(|p| !parts.contains(&p.as_str())) {
        add(
            &mut v,
            Rule::PartUnknown,
            &format!("parts.{p}"),
            "not a contract part (everything else belongs to core)".into(),
        );
    }
    let sum: f64 = s.parts.values().map(|p| p.mass_fraction).sum();
    if (sum - 1.0).abs() > MASS_SUM_TOLERANCE || s.parts.values().any(|p| p.mass_fraction <= 0.0) {
        add(
            &mut v,
            Rule::MassSum,
            "parts.*.massFraction",
            format!("fractions sum to {sum:.3}; must be 1 ± {MASS_SUM_TOLERANCE}, each positive"),
        );
    }
    for (id, p) in &s.parts {
        let at = format!("parts.{id}");
        match (&p.hinge, id.as_str()) {
            (Some(_), "core") => add(&mut v, Rule::Hinge, &at, "core doesn't hinge".into()),
            (None, other) if other != "core" => add(
                &mut v,
                Rule::Hinge,
                &at,
                "a detachable part needs a hinge (loose state, R86)".into(),
            ),
            (Some(h), _) => {
                let len = (h.axis[0].powi(2) + h.axis[1].powi(2) + h.axis[2].powi(2)).sqrt();
                if (len - 1.0).abs() > 0.01 || h.min >= h.max || h.min < -180.0 || h.max > 180.0 {
                    add(
                        &mut v,
                        Rule::Hinge,
                        &at,
                        format!(
                            "axis length {len:.3}, limits {}..{}°: needs a unit axis and min < max within ±180°",
                            h.min, h.max
                        ),
                    );
                }
            }
            _ => {}
        }
        if id == "core" && p.collider.kind == ColliderKind::Cuboid {
            add(
                &mut v,
                Rule::CabinProxyCuboid,
                &at,
                "the cabin proxy must be rounded (convex or capsule), not a cuboid".into(),
            );
        }
    }
    for (id, b) in &s.interiors {
        let bad: Vec<&String> = b
            .exposed_by
            .iter()
            .filter(|p| p.as_str() == "core" || !parts.contains(&p.as_str()))
            .collect();
        if b.exposed_by.is_empty() || !bad.is_empty() {
            add(
                &mut v,
                Rule::Interior,
                &format!("interiors.{id}"),
                format!("exposedBy {:?}: one or more detachable parts", b.exposed_by),
            );
        }
    }
    for a in ANCHORS {
        if !s.anchors.contains_key(a) {
            add(
                &mut v,
                Rule::AnchorMissing,
                &format!("anchors.{a}"),
                "required anchor".into(),
            );
        }
    }
    if s.material.count != 1 {
        add(
            &mut v,
            Rule::Materials,
            "material.count",
            format!(
                "{}: one material, the atlas carries the paint key",
                s.material.count
            ),
        );
    }
    if s.lods.is_empty() || s.lods.len() > TRI_BUDGETS.len() {
        add(
            &mut v,
            Rule::Lods,
            "lods",
            format!("{} LODs; 1 to {}", s.lods.len(), TRI_BUDGETS.len()),
        );
    }

    if let Some(o) = &s.tri_budget_override {
        if o.max_tris.len() != s.lods.len() {
            add(
                &mut v,
                Rule::TriBudget,
                "triBudgetOverride.maxTris",
                format!("{} budgets for {} LODs", o.max_tris.len(), s.lods.len()),
            );
        }
        for (li, &t) in o.max_tris.iter().enumerate().take(TRI_BUDGETS.len()) {
            if t > TRI_BUDGET_OVERRIDE_CEILING[li] {
                add(
                    &mut v,
                    Rule::TriBudget,
                    "triBudgetOverride.maxTris",
                    format!(
                        "LOD{li}: {t}; an override may raise it to {} at most",
                        TRI_BUDGET_OVERRIDE_CEILING[li]
                    ),
                );
            }
        }
        if o.why.trim().len() < 10 || o.approved_by.trim().is_empty() {
            add(
                &mut v,
                Rule::TriBudget,
                "triBudgetOverride",
                "an override names why (a measurement) and who approved it".into(),
            );
        }
    }

    let mut tris = Vec::new();
    let mut lod0_pivots: Option<BTreeMap<String, [f64; 3]>> = None;
    for (li, lod) in s.lods.iter().enumerate().take(TRI_BUDGETS.len()) {
        let at = format!("lods[{li}] {}", lod.file);
        let Some(bytes) = load(&lod.file) else {
            add(&mut v, Rule::Glb, &at, "file not found".into());
            continue;
        };
        let glb = match Glb::parse(&bytes) {
            Ok(g) => g,
            Err(e) => {
                add(&mut v, Rule::Glb, &at, e);
                continue;
            }
        };
        let world = glb.world();
        let roots = glb.roots();
        let Some(&root) = roots.first() else {
            add(&mut v, Rule::Glb, &at, "no scene root".into());
            continue;
        };
        let children: BTreeMap<String, usize> = glb.nodes()[root]
            .children
            .iter()
            .filter_map(|&c| {
                glb.nodes()
                    .get(c)
                    .and_then(|n| n.name.clone())
                    .map(|n| (n, c))
            })
            .collect();
        let root_inv_ok = close(
            apply(&world[&root], [0.0; 3]),
            [0.0; 3],
            POSITION_TOLERANCE_M,
        );
        if !root_inv_ok {
            add(
                &mut v,
                Rule::OriginGround,
                &at,
                "the vehicle root isn't at the origin".into(),
            );
        }

        // Parts: present, pivots as declared and identical across LODs; triangles, draws, materials, ground contact.
        let (mut lod_tris, mut draws, mut min_y) = (0usize, 0usize, f64::INFINITY);
        let mut pivots = BTreeMap::new();
        for &p in parts {
            let Some(&ni) = children.get(p) else {
                add(&mut v, Rule::PartMissingAtLod, &at, format!("no {p} node"));
                continue;
            };
            let node = &glb.nodes()[ni];
            let pivot = apply(&world[&ni], [0.0; 3]);
            pivots.insert(p.to_owned(), pivot);
            if let Some(decl) = s.parts.get(p)
                && !close(pivot, decl.pivot, POSITION_TOLERANCE_M)
            {
                add(
                    &mut v,
                    Rule::Pivot,
                    &at,
                    format!(
                        "{p} pivot {pivot:?} in the GLB, {:?} in the sidecar",
                        decl.pivot
                    ),
                );
            }
            let Some(mesh) = node.mesh.and_then(|m| glb.mesh(m)) else {
                add(
                    &mut v,
                    Rule::PartMissingAtLod,
                    &at,
                    format!("{p} has no mesh"),
                );
                continue;
            };
            for prim in &mesh.primitives {
                draws += 1;
                if prim.material != Some(0) {
                    add(
                        &mut v,
                        Rule::Materials,
                        &at,
                        format!("{p} doesn't use the single atlas material"),
                    );
                }
                match glb.triangles(prim) {
                    Ok(t) => lod_tris += t,
                    Err(e) => add(&mut v, Rule::Glb, &at, format!("{p}: {e}")),
                }
                if let Some(&pos) = prim.attributes.get("POSITION") {
                    match glb.positions(pos) {
                        Ok(pts) => {
                            min_y = pts
                                .iter()
                                .map(|q| apply(&world[&ni], *q)[1])
                                .fold(min_y, f64::min)
                        }
                        Err(e) => add(&mut v, Rule::Glb, &at, format!("{p}: {e}")),
                    }
                }
            }
        }
        // Interior blocks: a node per declared block, in vehicle space, on the atlas material, within its budget.
        for id in s.interiors.keys() {
            let name = format!("interior_{id}");
            let Some(mesh) = children
                .get(&name)
                .and_then(|&ni| glb.nodes()[ni].mesh.map(|m| (ni, m)))
                .and_then(|(ni, m)| glb.mesh(m).map(|mesh| (ni, mesh)))
            else {
                add(&mut v, Rule::Interior, &at, format!("no {name} mesh"));
                continue;
            };
            let (ni, mesh) = mesh;
            if !close(apply(&world[&ni], [0.0; 3]), [0.0; 3], POSITION_TOLERANCE_M) {
                add(
                    &mut v,
                    Rule::Interior,
                    &at,
                    format!("{name} isn't in vehicle space (its node moves it)"),
                );
            }
            let mut block_tris = 0;
            for prim in &mesh.primitives {
                if prim.material != Some(0) {
                    add(
                        &mut v,
                        Rule::Materials,
                        &at,
                        format!("{name} doesn't use the single atlas material"),
                    );
                }
                match glb.triangles(prim) {
                    Ok(t) => block_tris += t,
                    Err(e) => add(&mut v, Rule::Glb, &at, format!("{name}: {e}")),
                }
            }
            if block_tris > INTERIOR_TRI_BUDGET {
                add(
                    &mut v,
                    Rule::Interior,
                    &at,
                    format!("{name}: {block_tris} triangles, budget {INTERIOR_TRI_BUDGET}"),
                );
            }
        }
        if glb.material_count() != 1 {
            add(
                &mut v,
                Rule::Materials,
                &at,
                format!("{} materials; exactly one", glb.material_count()),
            );
        }
        if draws > parts.len() {
            add(
                &mut v,
                Rule::Draws,
                &at,
                format!("{draws} draws; at most one per part ({})", parts.len()),
            );
        }
        let budget = lod.max_tris.min(tri_budget(s, li));
        if lod_tris > budget {
            add(
                &mut v,
                Rule::TriBudget,
                &at,
                format!("{lod_tris} triangles, budget {budget}"),
            );
        }
        tris.push(lod_tris);
        if min_y.is_finite() && min_y.abs() > GROUND_TOLERANCE_M {
            add(
                &mut v,
                Rule::OriginGround,
                &at,
                format!("the lowest vertex is at y = {min_y:.3} m; the origin sits on the ground"),
            );
        }
        // The origin sits between the axles: front wheels ahead (+z), rear behind, centred and symmetric.
        if let (Some(fl), Some(fr), Some(rl), Some(rr)) = (
            pivots.get("wheel_FL"),
            pivots.get("wheel_FR"),
            pivots.get("wheel_RL"),
            pivots.get("wheel_RR"),
        ) {
            let (zf, zr) = ((fl[2] + fr[2]) / 2.0, (rl[2] + rr[2]) / 2.0);
            if !(zf > 0.0 && zr < 0.0)
                || (zf + zr).abs() > AXLE_CENTRE_TOLERANCE_M
                || (fl[0] + fr[0]).abs() > 0.02
                || (rl[0] + rr[0]).abs() > 0.02
            {
                add(
                    &mut v,
                    Rule::OriginAxles,
                    &at,
                    format!(
                        "axles at z = {zf:.3} / {zr:.3}: the origin must be centred between them, +z forward, wheels symmetric"
                    ),
                );
            }
        }
        // A bike: the front wheel ahead, the rear behind, the origin centred between them, both on the centreline.
        if let (Some(f), Some(r)) = (pivots.get("wheel_F"), pivots.get("wheel_R"))
            && (!(f[2] > 0.0 && r[2] < 0.0)
                || (f[2] + r[2]).abs() > AXLE_CENTRE_TOLERANCE_M
                || f[0].abs() > 0.02
                || r[0].abs() > 0.02)
        {
            add(
                &mut v,
                Rule::OriginAxles,
                &at,
                format!(
                    "wheels at z = {:.3} / {:.3}, x = {:.3} / {:.3}: the origin must be centred between them, +z forward, both on the centreline",
                    f[2], r[2], f[0], r[0]
                ),
            );
        }
        // Anchors: present at every LOD, where the sidecar says.
        for a in ANCHORS {
            match children.get(a) {
                None => add(&mut v, Rule::AnchorMissing, &at, format!("no {a} node")),
                Some(&ni) => {
                    if let Some(decl) = s.anchors.get(a) {
                        let p = apply(&world[&ni], [0.0; 3]);
                        if !close(p, *decl, POSITION_TOLERANCE_M) {
                            add(
                                &mut v,
                                Rule::Anchor,
                                &at,
                                format!("{a} at {p:?} in the GLB, {decl:?} in the sidecar"),
                            );
                        }
                    }
                }
            }
        }
        // Pivots identical at every LOD.
        match &lod0_pivots {
            None => lod0_pivots = Some(pivots),
            Some(first) => {
                for (p, a) in &pivots {
                    if first
                        .get(p)
                        .is_some_and(|b| !close(*a, *b, POSITION_TOLERANCE_M))
                    {
                        add(
                            &mut v,
                            Rule::Pivot,
                            &at,
                            format!("{p} pivot differs from LOD0"),
                        );
                    }
                }
            }
        }
        // Collider proxies (LOD0): one per part, typed as declared; the cabin is genuinely rounded.
        if li == 0 {
            for &p in parts {
                let name = format!("collider_{p}");
                let Some(&ni) = children.get(&name) else {
                    add(&mut v, Rule::ColliderMissing, &at, format!("no {name}"));
                    continue;
                };
                let pts: Vec<[f64; 3]> = glb.nodes()[ni]
                    .mesh
                    .and_then(|m| glb.mesh(m))
                    .map(|m| {
                        m.primitives
                            .iter()
                            .filter_map(|pr| {
                                pr.attributes
                                    .get("POSITION")
                                    .and_then(|&a| glb.positions(a).ok())
                            })
                            .flatten()
                            .map(|q| apply(&world[&ni], q))
                            .collect()
                    })
                    .unwrap_or_default();
                if pts.is_empty() {
                    add(
                        &mut v,
                        Rule::ColliderMissing,
                        &at,
                        format!("{name} has no mesh"),
                    );
                    continue;
                }
                let kind = s.parts.get(p).map(|x| x.collider.kind);
                let cuboid = is_cuboid(&pts);
                if p == "core" && cuboid {
                    add(
                        &mut v,
                        Rule::CabinProxyCuboid,
                        &at,
                        "the cabin proxy mesh is a box (Spike C's mistake)".into(),
                    );
                }
                if kind == Some(ColliderKind::Cuboid) && !cuboid {
                    add(
                        &mut v,
                        Rule::ColliderType,
                        &at,
                        format!("{name} is declared a cuboid but isn't a box"),
                    );
                }
            }
        }
    }
    Report {
        ok: v.is_empty(),
        violations: v,
        tris,
    }
}

/// What the sim builds a car from (P1-S03a), derived from the baked sidecar and its LOD0 GLB: the chassis proxy's hull
/// points, the wheels' pivots and radius, and the centre of mass. Vehicle space: metres, +y up, +z forward, origin on
/// the ground between the axles. Wheels in the sim's order, front axle first: FL, FR, RL, RR for a car; F, R for a bike.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhysicsGeometry {
    /// The intact body's proxy vertices (core, front, back and doors; not the wheels), deduplicated and sorted. The
    /// sim takes their convex hull; S04 splits it when parts come loose.
    pub hull: Vec<[f64; 3]>,
    pub wheels: Vec<[f64; 3]>,
    pub wheel_radius: f64,
    pub com: [f64; 3],
    /// Every part's own collider proxy (P1-S04a), in the contract's part order ([`part_set`]): the sim builds one convex
    /// collider per part on the chassis body, so a contact's collider names the part.
    pub parts: Vec<PartGeometry>,
}

/// One part for the sim: its pivot, hinge, mass share and collider proxy points (vehicle space, metres).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartGeometry {
    pub name: String,
    pub pivot: [f64; 3],
    /// Unit axis and loose limits (degrees); `None` for `core`.
    pub hinge: Option<([f64; 3], f64, f64)>,
    pub mass_fraction: f64,
    pub points: Vec<[f64; 3]>,
}

/// One part's collider proxy points from a LOD0 GLB, in vehicle space.
pub fn collider_points(glb: &Glb, part: &str) -> Result<Vec<[f64; 3]>, String> {
    let world = glb.world();
    let root = *glb.roots().first().ok_or("no scene root")?;
    let name = format!("collider_{part}");
    let ni = glb.nodes()[root]
        .children
        .iter()
        .copied()
        .find(|&c| glb.nodes().get(c).and_then(|n| n.name.as_deref()) == Some(name.as_str()))
        .ok_or_else(|| format!("no {name}"))?;
    let mesh = glb.nodes()[ni]
        .mesh
        .and_then(|m| glb.mesh(m))
        .ok_or_else(|| format!("{name} has no mesh"))?;
    let mut pts = Vec::new();
    for pr in &mesh.primitives {
        if let Some(&a) = pr.attributes.get("POSITION") {
            pts.extend(glb.positions(a)?.into_iter().map(|q| apply(&world[&ni], q)));
        }
    }
    Ok(pts)
}

/// Rounds to 0.1 mm so the derived numbers are stable text in a profile file.
fn mm10(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// Derives the sim's [`PhysicsGeometry`] from a sidecar and its LOD0 GLB bytes.
pub fn physics_geometry(sidecar: &Sidecar, lod0: &[u8]) -> Result<PhysicsGeometry, String> {
    let glb = Glb::parse(lod0)?;
    let set = part_set(sidecar);
    let mut hull: Vec<[f64; 3]> = Vec::new();
    for part in set.iter().filter(|p| !p.starts_with("wheel_")) {
        hull.extend(
            collider_points(&glb, part)?
                .into_iter()
                .map(|p| p.map(mm10)),
        );
    }
    hull.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    hull.dedup();
    let pivot = |p: &str| {
        sidecar
            .parts
            .get(p)
            .map(|x| x.pivot.map(mm10))
            .ok_or_else(|| format!("no part {p}"))
    };
    // The wheels in contract order are the sim's order (front axle first).
    let wheel_names: Vec<&str> = set
        .iter()
        .copied()
        .filter(|p| p.starts_with("wheel_"))
        .collect();
    let wheels = wheel_names
        .iter()
        .map(|w| pivot(w))
        .collect::<Result<Vec<_>, _>>()?;
    // The wheel's radius is half its proxy's height (a wheel stands on the ground at rest, so this is also its pivot y).
    let w = collider_points(&glb, wheel_names[0])?;
    let (lo, hi) = w
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p[1]), hi.max(p[1]))
        });
    if !lo.is_finite() {
        return Err(format!("collider_{} has no points", wheel_names[0]));
    }
    let com = sidecar
        .anchors
        .get("com")
        .map(|c| c.map(mm10))
        .ok_or("no com anchor")?;
    let mut parts = Vec::new();
    for &name in set {
        let part = sidecar
            .parts
            .get(name)
            .ok_or_else(|| format!("no part {name}"))?;
        let mut points: Vec<[f64; 3]> = collider_points(&glb, name)?
            .into_iter()
            .map(|p| p.map(mm10))
            .collect();
        points.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        points.dedup();
        parts.push(PartGeometry {
            name: name.to_owned(),
            pivot: part.pivot.map(mm10),
            hinge: part.hinge.as_ref().map(|h| (h.axis, h.min, h.max)),
            mass_fraction: part.mass_fraction,
            points,
        });
    }
    Ok(PhysicsGeometry {
        parts,
        hull,
        wheels,
        wheel_radius: mm10((hi - lo) / 2.0),
        com,
    })
}
