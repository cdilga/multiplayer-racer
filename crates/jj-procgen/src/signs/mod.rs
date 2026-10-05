//! The Australian road-sign kit's data side (P1-M09, plan §8.3, master §11.5a): a sign is **data**: a family, a text
//! and a pictogram (`assets/kit/signs/data/<name>.json`), drawn by one code-built kit on the render side
//! (`web/host/src/render/signs`). Adding a sign never needs new geometry, only a new data file.
//!
//! [`validate`] is the grammar check: each family's shape and colours are fixed (no new shapes, no new colour
//! families: the "incorrect signs" sheet is the failure), legends are upper case from the lettering set and bounded so
//! they fit the panel at a legible height, and a pictogram comes from the known set. M04 and the other biomes pick a
//! sign by id and a pose; the grammar here is what makes the invented "BLOODY BIG JUMPS AHEAD" a believable sign.

use serde::{Deserialize, Serialize};

/// The sign families (the three real grammars the kit draws).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Warning,
    Direction,
    Tourist,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    /// A square turned 45 degrees (warning signs).
    Diamond,
    Rectangle,
}

/// The pictograms the kit knows, each drawn in code from the real symbol convention.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Pictogram {
    /// A crest or jump: a vehicle on a rise.
    Crest,
    SteepDescent,
    UnsealedRoad,
    /// Animals: a kangaroo.
    Kangaroo,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Arrow {
    Ahead,
    Left,
    Right,
}

/// One destination row of a direction sign.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub text: String,
    pub km: u32,
    pub arrow: Arrow,
}

/// Where a sign came from, for the asset sidecar.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sidecar {
    pub family: Family,
    /// `"original"` for a sign drawn from the grammar, or the Wikimedia Commons file page URL of a real sign copied.
    pub source: String,
    /// `"original"`, or the Commons licence of the copied sign.
    pub licence: String,
    #[serde(default)]
    pub note: String,
}

/// A sign: everything the renderer needs, as data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignDef {
    /// `signs/<name>`: the file's name under `assets/kit/signs/data/` and the kit-piece id.
    pub id: String,
    pub version: u32,
    pub family: Family,
    pub shape: Shape,
    /// Panel colour, `#rrggbb` lower case.
    pub background: String,
    /// Legend, pictogram and border colour.
    pub legend: String,
    #[serde(default)]
    pub pictogram: Option<Pictogram>,
    /// Upper-case legend lines (warning, tourist).
    #[serde(default)]
    pub lines: Vec<String>,
    /// Direction signs: the route shield's number, e.g. `A87`.
    #[serde(default)]
    pub shield: Option<String>,
    /// Direction signs: the road name beside the shield, e.g. `STUART HWY`.
    #[serde(default)]
    pub heading: Option<String>,
    #[serde(default)]
    pub rows: Vec<Row>,
    pub sidecar: Sidecar,
}

/// A family's fixed grammar.
#[derive(Clone, Copy, Debug)]
pub struct Grammar {
    pub shape: Shape,
    pub background: &'static str,
    pub legend: &'static str,
    /// Most legend lines (direction: destination rows).
    pub max_lines: usize,
}

pub const fn grammar(family: Family) -> Grammar {
    match family {
        Family::Warning => Grammar {
            shape: Shape::Diamond,
            background: "#ffd100",
            legend: "#111111",
            max_lines: 3,
        },
        Family::Direction => Grammar {
            shape: Shape::Rectangle,
            background: "#00693c",
            legend: "#ffffff",
            max_lines: 3,
        },
        Family::Tourist => Grammar {
            shape: Shape::Rectangle,
            background: "#6b3410",
            legend: "#ffffff",
            max_lines: 3,
        },
    }
}

/// The smallest legend cap height, as a fraction of the sign's panel height, that is legible at the smallest TV-grid tile
/// (192x108): a panel 85% of the tile (92 px) with a 6 px cap is 0.065. Text whose fitted height is below this is
/// rejected, so the length bound comes from the fit, not a character count.
pub const MIN_CAP_FRACTION: f64 = 0.065;

// Layout constants mirrored from web/host/src/render/signs/sign-kit.ts (its test pins the same numbers).
const GAP: f64 = 1.3;
const STROKE: f64 = 1.0;
const WARN_SIDE: f64 = 1.2;
const WARN_RT: f64 = WARN_SIDE * std::f64::consts::FRAC_1_SQRT_2 - 0.12 - 0.01;
const DIR_W: f64 = 2.4;
const TOURIST_W: f64 = 1.8;
const TOURIST_H: f64 = 1.2;

/// A direction sign's panel height in metres: grows with the rows, text never shrinks for them.
pub fn direction_height(rows: usize) -> f64 {
    0.26 + 0.5 + 0.3 * rows as f64 + 0.04
}

/// Width of `text` per metre of cap height (the stroke font's advances, letter gaps and stroke overhang).
pub fn text_width_per_cap(text: &str) -> f64 {
    let mut cells = 0.0;
    for (i, c) in text.chars().enumerate() {
        cells += match c {
            'I' | '.' => 0.0,
            '1' | '-' | '/' | ' ' => 3.0,
            _ => 4.0,
        } + if i > 0 { GAP } else { 0.0 };
    }
    (cells + STROKE) / (6.0 + STROKE)
}

/// The legend's fitted cap height as a fraction of the panel height (the renderer's auto-fit); `None` when the sign has no
/// legend (pictogram only).
pub fn legend_cap_fraction(def: &SignDef) -> Option<f64> {
    let k = |t: &str| text_width_per_cap(t);
    match def.family {
        Family::Warning if def.lines.is_empty() => None,
        Family::Warning => {
            let panel = WARN_SIDE * std::f64::consts::SQRT_2;
            let h = if def.pictogram.is_some() {
                (WARN_RT / (k(&def.lines[0]) + 1.0)).min(WARN_RT * 0.26)
            } else {
                let n = def.lines.len() as f64;
                def.lines
                    .iter()
                    .enumerate()
                    .map(|(i, l)| {
                        2.0 * WARN_RT / (k(l) + 2.3 * (i as f64 - (n - 1.0) / 2.0).abs() + 1.0)
                    })
                    .fold(WARN_RT * 0.5, f64::min)
            };
            Some(h / panel)
        }
        Family::Tourist => {
            let (iw, ih) = (TOURIST_W - 0.26, TOURIST_H - 0.26);
            let n = def.lines.len().max(1) as f64;
            let h = def
                .lines
                .iter()
                .map(|l| iw / k(l))
                .fold(0.3_f64.min(ih / (1.0 + 1.3 * (n - 1.0))), f64::min);
            Some(h / TOURIST_H)
        }
        Family::Direction => {
            let room = DIR_W - 0.26 - 0.2 - 0.24;
            let h = def
                .rows
                .iter()
                .map(|r| room / (k(&r.text) + k(&r.km.to_string()) + 0.5))
                .fold(0.24, f64::min);
            Some(h / direction_height(def.rows.len()))
        }
    }
}

/// The lettering set (the renderer's stroke font has exactly these).
pub fn lettering_ok(text: &str) -> bool {
    !text.is_empty()
        && text.chars().all(|c| {
            c.is_ascii_uppercase() || c.is_ascii_digit() || matches!(c, ' ' | '.' | '-' | '/')
        })
        && text.trim() == text
}

/// Wikimedia Commons licences that allow reuse with the sidecar's record.
const COMMONS_LICENCES: [&str; 6] = [
    "CC0",
    "Public domain",
    "CC BY 4.0",
    "CC BY-SA 4.0",
    "CC BY 3.0",
    "CC BY-SA 3.0",
];

/// Every way `def` breaks its family's grammar (empty = a valid sign).
pub fn validate(def: &SignDef) -> Vec<String> {
    let mut out = Vec::new();
    let g = grammar(def.family);
    let mut bad = |m: String| out.push(format!("{}: {m}", def.id));
    if def.shape != g.shape {
        bad(format!(
            "{:?} signs are {:?}, not {:?} (no new shapes)",
            def.family, g.shape, def.shape
        ));
    }
    if def.background != g.background {
        bad(format!(
            "{:?} background must be {} (no new colour family), got {}",
            def.family, g.background, def.background
        ));
    }
    if def.legend != g.legend {
        bad(format!(
            "{:?} legend must be {}, got {}",
            def.family, g.legend, def.legend
        ));
    }
    if def.sidecar.family != def.family {
        bad("sidecar family differs from the sign's family".into());
    }
    match (def.sidecar.source.as_str(), def.sidecar.licence.as_str()) {
        ("original", "original") => {}
        (src, lic)
            if src.starts_with("https://commons.wikimedia.org/wiki/File:")
                && COMMONS_LICENCES.contains(&lic) => {}
        (src, lic) => bad(format!(
            "sidecar source/licence must be \"original\" or a Commons file page with a reuse licence, got {src:?} / {lic:?}"
        )),
    }
    if def.id.strip_prefix("signs/").is_none_or(|n| {
        n.is_empty()
            || !n
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    }) {
        bad("id must be signs/<kebab-name>".into());
    }
    // Only the road-name heading keeps a character bound (it is set beside the shield); legends are bounded by the fit.
    let line = |what: &str, text: &str, max: usize, out: &mut Vec<String>| {
        if !lettering_ok(text) {
            out.push(format!(
                "{}: {what} {text:?} must be upper case from A-Z 0-9 space . - /",
                def.id
            ));
        }
        if text.chars().count() > max {
            out.push(format!(
                "{}: {what} {text:?} is longer than {max} characters and won't fit",
                def.id
            ));
        }
    };
    let mut extra = Vec::new();
    match def.family {
        Family::Warning | Family::Tourist => {
            if def.shield.is_some() || def.heading.is_some() || !def.rows.is_empty() {
                extra.push(format!(
                    "{}: only direction signs carry a shield, heading or destination rows",
                    def.id
                ));
            }
            let max_lines = if def.pictogram.is_some() {
                1
            } else {
                g.max_lines
            };
            if def.lines.len() > max_lines {
                extra.push(format!(
                    "{}: {} legend lines, at most {max_lines}",
                    def.id,
                    def.lines.len()
                ));
            }
            if def.pictogram.is_none() && def.lines.is_empty() {
                extra.push(format!("{}: a sign needs a legend or a pictogram", def.id));
            }
            if def.family == Family::Tourist && def.pictogram.is_some() {
                extra.push(format!(
                    "{}: tourist signs carry a white legend only",
                    def.id
                ));
            }
            for l in &def.lines {
                line("legend", l, usize::MAX, &mut extra);
            }
        }
        Family::Direction => {
            if def.pictogram.is_some() || !def.lines.is_empty() {
                extra.push(format!(
                    "{}: direction signs carry a shield, heading and destination rows only",
                    def.id
                ));
            }
            match &def.shield {
                Some(s) if is_route(s) => {}
                other => extra.push(format!(
                    "{}: route shield {other:?} must be a letter A/B/C/M/S plus 1-3 digits",
                    def.id
                )),
            }
            if let Some(h) = &def.heading {
                line("heading", h, 12, &mut extra);
            }
            if def.rows.is_empty() || def.rows.len() > g.max_lines {
                extra.push(format!(
                    "{}: direction signs list 1-{} destinations, got {}",
                    def.id,
                    g.max_lines,
                    def.rows.len()
                ));
            }
            for r in &def.rows {
                line("destination", &r.text, usize::MAX, &mut extra);
                if r.km > 9999 {
                    extra.push(format!(
                        "{}: distance {} km has more than 4 digits",
                        def.id, r.km
                    ));
                }
            }
        }
    }
    out.extend(extra);
    if out.is_empty()
        && let Some(f) = legend_cap_fraction(def)
        && f < MIN_CAP_FRACTION
    {
        out.push(format!(
            "{}: the legend would fit at {:.3} of the sign height, below the legible {MIN_CAP_FRACTION} (it won't fit at the smallest tile)",
            def.id, f
        ));
    }
    out
}

fn is_route(s: &str) -> bool {
    let mut c = s.chars();
    matches!(c.next(), Some('A' | 'B' | 'C' | 'M' | 'S'))
        && (1..=3).contains(&c.as_str().len())
        && c.all(|d| d.is_ascii_digit())
}

/// Every sign's data file, compiled in: `(id, JSON)`. A new sign is a new data file plus one line here (and its
/// registry entry beside it); `tests/signs.rs` fails if a file on disk is missing from this list.
pub const SIGN_DATA: [(&str, &str); 15] = [
    (
        "signs/big-red-rock",
        include_str!("../../../../assets/kit/signs/data/big-red-rock.json"),
    ),
    (
        "signs/bloody-big-jumps",
        include_str!("../../../../assets/kit/signs/data/bloody-big-jumps.json"),
    ),
    (
        "signs/crest",
        include_str!("../../../../assets/kit/signs/data/crest.json"),
    ),
    (
        "signs/jumps-crest",
        include_str!("../../../../assets/kit/signs/data/jumps-crest.json"),
    ),
    (
        "signs/junction",
        include_str!("../../../../assets/kit/signs/data/junction.json"),
    ),
    (
        "signs/kangaroo",
        include_str!("../../../../assets/kit/signs/data/kangaroo.json"),
    ),
    (
        "signs/lookout",
        include_str!("../../../../assets/kit/signs/data/lookout.json"),
    ),
    (
        "signs/red-centre",
        include_str!("../../../../assets/kit/signs/data/red-centre.json"),
    ),
    (
        "signs/rest-area",
        include_str!("../../../../assets/kit/signs/data/rest-area.json"),
    ),
    (
        "signs/steep-descent",
        include_str!("../../../../assets/kit/signs/data/steep-descent.json"),
    ),
    (
        "signs/stuart-hwy",
        include_str!("../../../../assets/kit/signs/data/stuart-hwy.json"),
    ),
    (
        "signs/unsealed-road",
        include_str!("../../../../assets/kit/signs/data/unsealed-road.json"),
    ),
    (
        "signs/servo",
        include_str!("../../../../assets/kit/signs/data/servo.json"),
    ),
    (
        "signs/arvo-servo",
        include_str!("../../../../assets/kit/signs/data/arvo-servo.json"),
    ),
    (
        "signs/the-institution",
        include_str!("../../../../assets/kit/signs/data/the-institution.json"),
    ),
];

/// The sign kit's registry entries (`assets/kit/signs/<name>.json`), the same files `jj-map` validates against.
pub const SIGN_PIECES: [(&str, &str); 15] = [
    (
        "signs/big-red-rock",
        include_str!("../../../../assets/kit/signs/big-red-rock.json"),
    ),
    (
        "signs/bloody-big-jumps",
        include_str!("../../../../assets/kit/signs/bloody-big-jumps.json"),
    ),
    (
        "signs/crest",
        include_str!("../../../../assets/kit/signs/crest.json"),
    ),
    (
        "signs/jumps-crest",
        include_str!("../../../../assets/kit/signs/jumps-crest.json"),
    ),
    (
        "signs/junction",
        include_str!("../../../../assets/kit/signs/junction.json"),
    ),
    (
        "signs/kangaroo",
        include_str!("../../../../assets/kit/signs/kangaroo.json"),
    ),
    (
        "signs/lookout",
        include_str!("../../../../assets/kit/signs/lookout.json"),
    ),
    (
        "signs/red-centre",
        include_str!("../../../../assets/kit/signs/red-centre.json"),
    ),
    (
        "signs/rest-area",
        include_str!("../../../../assets/kit/signs/rest-area.json"),
    ),
    (
        "signs/steep-descent",
        include_str!("../../../../assets/kit/signs/steep-descent.json"),
    ),
    (
        "signs/stuart-hwy",
        include_str!("../../../../assets/kit/signs/stuart-hwy.json"),
    ),
    (
        "signs/unsealed-road",
        include_str!("../../../../assets/kit/signs/unsealed-road.json"),
    ),
    (
        "signs/servo",
        include_str!("../../../../assets/kit/signs/servo.json"),
    ),
    (
        "signs/arvo-servo",
        include_str!("../../../../assets/kit/signs/arvo-servo.json"),
    ),
    (
        "signs/the-institution",
        include_str!("../../../../assets/kit/signs/the-institution.json"),
    ),
];

/// All the signs, parsed. Panics on a malformed file (the tests catch it first).
pub fn all() -> Vec<SignDef> {
    SIGN_DATA
        .iter()
        .map(|(id, json)| serde_json::from_str(json).unwrap_or_else(|e| panic!("{id}: {e}")))
        .collect()
}
