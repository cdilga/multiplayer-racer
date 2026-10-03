//! The kit-piece registry: versioned data per piece (`assets/kit/<family>/<name>.json`): parameter schema, collider
//! proxy and LOD rule. `jj-map` validates maps against it, `jj-sim` reads the colliders, the renderer builds the
//! geometry in code by id.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::Params;
use crate::validate::{Rule, Violation};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KitPiece {
    /// `<family>/<name>`: the file's path under `assets/kit/` without `.json`.
    pub id: String,
    pub version: u32,
    #[serde(default)]
    pub what: String,
    #[serde(default)]
    pub params: BTreeMap<String, ParamSpec>,
    /// Required: an entry without a collider proxy fails `registry-collider`.
    #[serde(default)]
    pub collider: Option<Collider>,
    pub lod: Lod,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParamSpec {
    pub min: i64,
    pub max: i64,
    pub default: i64,
}

/// A collider proxy on the ground at the piece's origin, y up. Sizes are full extents in millimetres.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum Collider {
    Box { x: Dim, y: Dim, z: Dim },
    Cylinder { radius: Dim, height: Dim },
}

/// A size: millimetres, or a parameter times `scale` (e.g. centimetres → millimetres with 10).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Dim {
    Mm(i64),
    Param {
        param: String,
        #[serde(default = "one")]
        scale: i64,
    },
}

fn one() -> i64 {
    1
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lod {
    pub simplify_beyond_mm: u32,
    #[serde(default)]
    pub cull_beyond_mm: Option<u32>,
}

/// A piece's resolved plan-view footprint and height (mm), for the validator and the sim.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Footprint {
    /// Full sizes along the piece's local x and z.
    Rect {
        x: f64,
        z: f64,
        height: f64,
    },
    Circle {
        radius: f64,
        height: f64,
    },
}

impl Footprint {
    /// The thinnest horizontal dimension (wall thickness).
    pub fn thickness(&self) -> f64 {
        match *self {
            Self::Rect { x, z, .. } => x.min(z),
            Self::Circle { radius, .. } => 2.0 * radius,
        }
    }

    pub fn height(&self) -> f64 {
        match *self {
            Self::Rect { height, .. } | Self::Circle { height, .. } => height,
        }
    }
}

/// The registry: pieces by id, plus any problems found loading it (reported with every map validated against it).
#[derive(Clone, Debug, Default)]
pub struct Registry {
    pieces: BTreeMap<String, KitPiece>,
    problems: Vec<Violation>,
}

/// The generic pieces M01 ships (`assets/kit/generic/`), compiled in so every target validates the greybox alike.
pub const GENERIC_PIECES: [(&str, &str); 5] = [
    (
        "generic/barrier",
        include_str!("../../../assets/kit/generic/barrier.json"),
    ),
    (
        "generic/bin",
        include_str!("../../../assets/kit/generic/bin.json"),
    ),
    (
        "generic/box-building",
        include_str!("../../../assets/kit/generic/box-building.json"),
    ),
    (
        "generic/cone",
        include_str!("../../../assets/kit/generic/cone.json"),
    ),
    (
        "generic/post",
        include_str!("../../../assets/kit/generic/post.json"),
    ),
];

impl Registry {
    /// The generic family only.
    pub fn generic() -> Self {
        Self::from_json(
            GENERIC_PIECES
                .iter()
                .map(|(id, json)| (*id, json.as_bytes())),
        )
    }

    /// Builds a registry from `(id from the file path, JSON bytes)` entries; bad entries are recorded as problems.
    pub fn from_json<'a>(entries: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> Self {
        let mut reg = Self::default();
        for (path_id, bytes) in entries {
            let at = format!("kit {path_id}");
            match serde_json::from_slice::<KitPiece>(bytes) {
                Err(e) => {
                    reg.problems
                        .push(Violation::new(Rule::RegistrySchema, &at, e.to_string()))
                }
                Ok(piece) => {
                    reg.check(path_id, &piece);
                    reg.pieces.insert(piece.id.clone(), piece);
                }
            }
        }
        reg
    }

    fn check(&mut self, path_id: &str, piece: &KitPiece) {
        let at = format!("kit {path_id}");
        if piece.id != path_id {
            self.problems.push(Violation::new(
                Rule::RegistrySchema,
                &at,
                format!("id {:?} doesn't match its path", piece.id),
            ));
        }
        for (name, spec) in &piece.params {
            if !(spec.min <= spec.default && spec.default <= spec.max) {
                self.problems.push(Violation::new(
                    Rule::RegistrySchema,
                    &at,
                    format!("param {name}: default outside {}..={}", spec.min, spec.max),
                ));
            }
        }
        match &piece.collider {
            None => self.problems.push(Violation::new(
                Rule::RegistryCollider,
                &at,
                "no collider proxy".into(),
            )),
            Some(c) => {
                let dims: Vec<&Dim> = match c {
                    Collider::Box { x, y, z } => vec![x, y, z],
                    Collider::Cylinder { radius, height } => vec![radius, height],
                };
                for d in dims {
                    match d {
                        Dim::Param { param, scale }
                            if !piece.params.contains_key(param) || *scale <= 0 =>
                        {
                            self.problems.push(Violation::new(
                                Rule::RegistrySchema,
                                &at,
                                format!(
                                    "collider uses unknown param {param:?} or a non-positive scale"
                                ),
                            ))
                        }
                        Dim::Mm(v) if *v <= 0 => self.problems.push(Violation::new(
                            Rule::RegistrySchema,
                            &at,
                            "collider size ≤ 0".into(),
                        )),
                        _ => {}
                    }
                }
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&KitPiece> {
        self.pieces.get(id)
    }

    pub fn problems(&self) -> &[Violation] {
        &self.problems
    }

    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.pieces.keys().map(String::as_str)
    }
}

impl KitPiece {
    /// A parameter's value for a placement: the placement's, else the default.
    pub fn param(&self, params: &Params, name: &str) -> Option<i64> {
        params
            .get(name)
            .copied()
            .or_else(|| self.params.get(name).map(|s| s.default))
    }

    /// The collider footprint for a placement's params; `None` without a collider.
    pub fn footprint(&self, params: &Params) -> Option<Footprint> {
        let dim = |d: &Dim| -> f64 {
            match d {
                Dim::Mm(v) => *v as f64,
                Dim::Param { param, scale } => {
                    (self.param(params, param).unwrap_or(0) * scale) as f64
                }
            }
        };
        Some(match self.collider.as_ref()? {
            Collider::Box { x, y, z } => Footprint::Rect {
                x: dim(x),
                z: dim(z),
                height: dim(y),
            },
            Collider::Cylinder { radius, height } => Footprint::Circle {
                radius: dim(radius),
                height: dim(height),
            },
        })
    }
}
