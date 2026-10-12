//! Validator integration and the fallback recipe (P1-M03g): [`prepare`] always hands back a validated track.
//!
//! A generated map is accepted only if everything agrees: `jj-map`'s validator (the §8.1 rules, against
//! [`crate::registry`]), the biome transition rules ([`crate::biome::check_transitions`]), every placed feature's envelope
//! ([`crate::features::check_envelope`]) and the wayfinding family ([`crate::biome::wayfinding::check`]). The ladder when
//! one fails (or a boundary finds no straight), each rung deterministic and logged, never an endless silent reroll
//! (master §11.2a):
//!
//! 1. the requested recipe on the seed's own course, then on up to [`MAX_DRAWS`]` - 1` fresh course draws derived from
//!    the seed (each a different but reproducible track for the same seed);
//! 2. the same recipe cut shorter on the seed's own course, one biome at a time (so most of the variety survives);
//! 3. the **conservative recipe**: the recipe's first biome alone on the seed's own course (no boundary to place; the
//!    course design itself falls back to its oval after 64 redraws, see [`crate::course`]).
//!
//! The whole ladder is at most [`MAX_DRAWS`] + recipe-length + 1 generations (tens of ms each), so it fits the round
//! preparation deadline; the caller's wall-clock deadline (P1-M08a) only decides whether to wait for it.

use jj_map::{Biome, Map, Registry, validate};

use crate::Report;
use crate::biome::{self, SelectError};
use crate::features;
use crate::seed::Streams;

/// Course draws tried with the full recipe (the seed's own, then derived ones).
pub const MAX_DRAWS: u32 = 3;

/// How a prepared track came about, best first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Plan {
    /// The requested recipe on the seed's own course.
    Requested,
    /// The requested recipe on a derived course draw (`1..MAX_DRAWS`).
    Redrawn(u32),
    /// A prefix of the recipe (this many biomes) on the seed's own course.
    Shorter(usize),
    /// The first biome alone: the conservative recipe.
    Conservative,
}

/// One rung of the ladder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub recipe: Vec<Biome>,
    pub draw: u32,
    /// Empty when it was accepted; otherwise why it was rejected.
    pub rejected: Vec<String>,
}

/// The seed's validated track and how it was reached.
#[derive(Clone, Debug)]
pub struct Prepared {
    pub map: Map,
    pub course: Report,
    pub plan: Plan,
    pub attempts: Vec<Attempt>,
    /// The final map passed every check. False only if even the conservative recipe failed (then `attempts` says why).
    pub valid: bool,
}

/// Every check a generated map must pass; empty means accepted.
pub fn check(map: &Map, registry: &Registry) -> Vec<String> {
    let mut bad: Vec<String> = validate(map, registry)
        .violations
        .iter()
        .map(|v| format!("{} {}: {}", v.rule.name(), v.at, v.detail))
        .collect();
    bad.extend(biome::check_transitions(map));
    bad.extend(features::check_envelope(map));
    bad.extend(biome::wayfinding::check(map));
    bad
}

/// The streams for course draw `draw` of `seed`: draw 0 is the seed's own; others are derived and reproducible. The
/// header always records the requested seed.
fn streams(seed: u64, draw: u32) -> Streams {
    let derived = if draw == 0 {
        seed
    } else {
        seed ^ u64::from(draw).wrapping_mul(0x9E37_79B9_7F4A_7C15)
    };
    let mut st = Streams::new(derived);
    st.seed = seed;
    st
}

/// The seed's track for `recipe`, validated, with the ladder's log. Deterministic native and WASM.
pub fn prepare(seed: u64, recipe: &[Biome]) -> Prepared {
    prepare_with(seed, recipe, MAX_DRAWS)
}

/// [`prepare`] with `draws` course draws for the full recipe (the Playtest-1 recipe allows more, so every track keeps all
/// four biomes: [`crate::playtest`]). The ladder stays bounded: `draws` + recipe length + `draws` generations at most.
pub fn prepare_with(seed: u64, recipe: &[Biome], draws: u32) -> Prepared {
    prepare_tuned(seed, recipe, draws, crate::tuning::GeneratorData::shipped())
}

/// [`prepare_with`] with explicit generator data (br-2sdu.3).
pub fn prepare_tuned(
    seed: u64,
    recipe: &[Biome],
    draws: u32,
    data: &crate::tuning::GeneratorData,
) -> Prepared {
    let registry = biome::registry();
    let mut lap: Vec<Biome> = Vec::new();
    for &b in recipe {
        if lap.last() != Some(&b) {
            lap.push(b);
        }
    }
    if lap.is_empty() {
        lap.push(Biome::Greybox);
    }
    let mut attempts: Vec<Attempt> = Vec::new();
    let mut try_one = |rec: &[Biome], draw: u32| -> Option<(Map, Report)> {
        let (map, course) = match crate::generate_tuned_from(streams(seed, draw), rec, data) {
            Ok(m) => m,
            Err(e) => {
                attempts.push(Attempt {
                    recipe: rec.to_vec(),
                    draw,
                    rejected: vec![match e {
                        SelectError::NoStraight(n) => format!("no straight for boundary {n}"),
                        SelectError::EmptyRecipe => "empty recipe".into(),
                    }],
                });
                return None;
            }
        };
        let rejected = check(&map, &registry);
        let ok = rejected.is_empty();
        attempts.push(Attempt {
            recipe: rec.to_vec(),
            draw,
            rejected,
        });
        ok.then_some((map, course))
    };

    // 1. The full recipe on the seed's own course, then derived draws.
    for draw in 0..draws {
        if let Some((map, course)) = try_one(&lap, draw) {
            let plan = if draw == 0 {
                Plan::Requested
            } else {
                Plan::Redrawn(draw)
            };
            return Prepared {
                map,
                course,
                plan,
                attempts,
                valid: true,
            };
        }
        // A single-biome recipe has no boundary to fail on: another draw only helps a rejected map.
    }
    // 2. Fewer biomes on the seed's own course.
    for keep in (2..lap.len()).rev() {
        if let Some((map, course)) = try_one(&lap[..keep], 0) {
            return Prepared {
                map,
                course,
                plan: Plan::Shorter(keep),
                attempts,
                valid: true,
            };
        }
    }
    // 3. The conservative recipe, on the seed's own course (and, if that is somehow rejected, the next draws).
    for draw in 0..if lap.len() > 1 { draws } else { 0 } {
        if let Some((map, course)) = try_one(&lap[..1], draw) {
            return Prepared {
                map,
                course,
                plan: Plan::Conservative,
                attempts,
                valid: true,
            };
        }
    }
    // Never silent: hand back the seed's own conservative map, flagged invalid, with every rejection logged.
    let (map, course) = crate::generate_tuned_from(streams(seed, 0), &lap[..1], data)
        .expect("a single biome needs no boundary");
    Prepared {
        map,
        course,
        plan: Plan::Conservative,
        attempts,
        valid: false,
    }
}
