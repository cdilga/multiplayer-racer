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

/// Course draws tried with the full recipe (the seed's own, then derived ones). Five since R132: a course with no room
/// for a set piece is redrawn (every draw but the last asks for one).
pub const MAX_DRAWS: u32 = 5;

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
    bad.extend(crate::setpieces::check(map));
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

/// Draws tried for each shorter recipe while the ladder still asks for the set pieces.
const SHORTER_DRAWS: u32 = 3;

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
    // R132: a lap carries its set pieces. Every draw but the last asks for them, so a course with no room for one is
    // redrawn, and the last draw (and the fallbacks after it) still always yields a valid track.
    struct Best {
        score: (usize, usize),
        recipe: Vec<Biome>,
        draw: u32,
        map: Map,
        course: Report,
        plan: Plan,
    }
    // The best valid draw that missed only the set pieces or the rhythm (interior mutability: the ladder reads it
    // between steps while the draw closure keeps it).
    let best: std::cell::RefCell<Option<Best>> = std::cell::RefCell::new(None);
    // How many loop-overs each draw's course took (br-xlvx.10.2), by draw: the fewer-loop-overs pass retries only the
    // draws that had more than it allows (br-cxqk: retrying one that had none to drop was a whole wasted generation).
    let loop_overs: std::cell::RefCell<std::collections::BTreeMap<u32, u32>> =
        std::cell::RefCell::new(std::collections::BTreeMap::new());
    let mut try_one = |rec: &[Biome],
                       draw: u32,
                       need_pieces: bool,
                       data: &crate::tuning::GeneratorData|
     -> Option<(Map, Report)> {
        let (map, course) = match crate::generate_tuned_from(streams(seed, draw), rec, data) {
            Ok(m) => {
                loop_overs
                    .borrow_mut()
                    .insert(draw, m.1.corners.get("loop-over").copied().unwrap_or(0));
                m
            }
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
        let mut rejected = check(&map, &registry);
        let valid = rejected.is_empty();
        if need_pieces && data.set_pieces {
            rejected.extend(crate::setpieces::check_minimum(&map));
            // The lap's rhythm (P1-FL15c): enough distinct beats, no one beat running on.
            let rhythm = crate::rhythm::of(&map);
            let mut problems = crate::rhythm::problems(&rhythm, crate::rhythm::shipped());
            // Town reads as a town by its junctions: a Town lap whose forks and set pieces took every straight a side
            // street could join is redrawn (kept as a fallback like the rhythm). Town-only laps: a short Town stretch in a
            // mixed lap may fairly have none.
            if map.header.biomes.iter().all(|b| *b == Biome::Town)
                && !map
                    .dressing
                    .iter()
                    .any(|d| d.kit_piece == "town/side-street")
            {
                problems.push("town: no side street on the lap".into());
            }
            // A valid map short only of its set pieces or its rhythm is kept as the best fallback: the most set pieces,
            // then the fewest rhythm problems.
            if valid && !rejected.is_empty() || valid && !problems.is_empty() {
                let score = (rhythm.set_pieces, usize::MAX - problems.len());
                let mut kept = best.borrow_mut();
                if kept.as_ref().is_none_or(|b: &Best| score > b.score) {
                    *kept = Some(Best {
                        score,
                        recipe: rec.to_vec(),
                        draw,
                        map: map.clone(),
                        course: course.clone(),
                        plan: if rec.len() == lap.len() {
                            if draw == 0 {
                                Plan::Requested
                            } else {
                                Plan::Redrawn(draw)
                            }
                        } else {
                            Plan::Shorter(rec.len())
                        },
                    });
                }
            }
            rejected.extend(problems);
        }
        let ok = rejected.is_empty();
        attempts.push(Attempt {
            recipe: rec.to_vec(),
            draw,
            rejected,
        });
        ok.then_some((map, course))
    };

    // 1. The full recipe on the seed's own course, then derived draws: each must carry its set pieces and keep the
    //    rhythm (P1-FL15c).
    for draw in 0..draws {
        if let Some((map, course)) = try_one(&lap, draw, true, data) {
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
    // 1b. The same draws with fewer loop-overs (br-xlvx.10.2): on a short lap a loop-over's arc and straights can take the
    //     room both set pieces need, and a lap that crosses itself is a bonus while two set pieces are the rule (R132).
    //     Numbered on after the full draws.
    //     One loop-over first (a lap that can't hold two may hold one), then none.
    if data.course.crossover.share > 0.0 {
        let mut fewer = data.clone();
        let mut next = draws;
        let full: std::collections::BTreeMap<u32, u32> = loop_overs.borrow().clone();
        for max in [1u32, 0] {
            if max > 0 && data.course.crossover.max <= max {
                continue;
            }
            fewer.course.crossover.max = max.max(1);
            fewer.course.crossover.share = if max == 0 {
                0.0
            } else {
                data.course.crossover.share
            };
            for draw in 0..draws {
                // One loop-over at most: only the draws that took more. None: every draw (its course is drawn afresh).
                if max > 0 && full.get(&draw).is_none_or(|&n| n <= max) {
                    continue;
                }
                if let Some((map, course)) = try_one(&lap, draw, true, &fewer) {
                    return Prepared {
                        map,
                        course,
                        plan: Plan::Redrawn(next + draw),
                        attempts,
                        valid: true,
                    };
                }
            }
            next += draws;
        }
    }
    // The requested biomes come first (a dropped biome is a broken request): the best full-recipe draw that missed
    // only the set pieces or the rhythm, before any shorter recipe.
    let kept = best.borrow_mut().take();
    if let Some(b) = kept {
        drop(try_one);
        // The log ends on the accepted map (it missed only the set-piece minimum or the rhythm, which its draw's row
        // above says).
        attempts.push(Attempt {
            recipe: b.recipe,
            draw: b.draw,
            rejected: Vec::new(),
        });
        return Prepared {
            map: b.map,
            course: b.course,
            plan: b.plan,
            attempts,
            valid: true,
        };
    }
    // 2. Fewer biomes, still with the set pieces, when no full-recipe draw was valid at all.
    for keep in (1..lap.len()).rev() {
        for draw in 0..SHORTER_DRAWS.min(draws) {
            if let Some((map, course)) = try_one(&lap[..keep], draw, true, data) {
                return Prepared {
                    map,
                    course,
                    plan: Plan::Shorter(keep),
                    attempts,
                    valid: true,
                };
            }
        }
    }
    // 3. Without the set-piece minimum: the best valid draw so far (the most set pieces, the fewest rhythm problems),
    //    else the full recipe's last draw, then fewer biomes on the seed's own course.
    drop(try_one);
    if let Some(b) = best.into_inner() {
        attempts.push(Attempt {
            recipe: b.recipe,
            draw: b.draw,
            rejected: Vec::new(),
        });
        return Prepared {
            map: b.map,
            course: b.course,
            plan: b.plan,
            attempts,
            valid: true,
        };
    }
    let mut try_one = |rec: &[Biome], draw: u32| -> Option<(Map, Report)> {
        let (map, course) = crate::generate_tuned_from(streams(seed, draw), rec, data).ok()?;
        let rejected = check(&map, &registry);
        let ok = rejected.is_empty();
        attempts.push(Attempt {
            recipe: rec.to_vec(),
            draw,
            rejected,
        });
        ok.then_some((map, course))
    };
    if let Some((map, course)) = try_one(&lap, draws.saturating_sub(1)) {
        return Prepared {
            map,
            course,
            plan: Plan::Redrawn(draws.saturating_sub(1)),
            attempts,
            valid: true,
        };
    }
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
