//! Race classification and session standings (P1-N07c; master §10.12 Race rules): finishers, unfinished, DNF and DNS,
//! shared places for exact ties, the championship points table with no truncated tail, and the finish bonus. Each round
//! is committed exactly once into the in-memory standings (R84: nothing outlives the host).
//!
//! The host builds a [`RoundFacts`] from the sim's race state at finalisation (P1-S05: finish tick and crossing
//! fraction, the legal-progress high-water mark and the tick it was reached) and the seats (who entered, who is
//! withdrawn, who joined late). [`Standings::commit`] classifies it and adds the points.
//!
//! - **Order.** Finishers by authoritative finish time (tick, then interpolated crossing fraction). Then everyone else
//!   (still racing at the end, or withdrawn) by legal unwrapped progress, then by the tick that progress was reached.
//!   Equal keys share the place (competition ranking: 1, 1, 3); seat order only orders the display.
//! - **Status.** A seat with a finish is Finished, even if it left afterwards: Leave/return can't make a finisher
//!   unfinished or earn a second bonus. Unfinished and withdrawn at finalisation is DNF (frozen progress, placement points
//!   only). Unfinished and present is Unfinished. Never entered is DNS (no place, zero).
//! - **Points.** Ranks 1–10 get `[25, 18, 15, 12, 10, 8, 6, 4, 2, 1]`; every later classified rank gets 1. Finishers get
//!   the ruleset's finish bonus (+5 by default). Late joiners are classified where they actually finish; inherited
//!   progress only voids lap timing, which isn't recorded yet.
//! - **Commit** is idempotent by `RoundId`: the same facts again change nothing, and different facts for a committed
//!   round are refused.

use std::collections::{BTreeMap, BTreeSet};

use jj_types::{RoundId, SeatId};

#[cfg(test)]
mod tests;

/// Championship points for ranks 1–10; every later classified rank gets [`POINTS_PAST_TABLE`].
pub const POINTS: [u32; 10] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
pub const POINTS_PAST_TABLE: u32 = 1;
pub const DEFAULT_FINISH_BONUS: u32 = 5;

/// The points a classified competition rank (1-based) earns.
pub fn points_for_rank(rank: u32) -> u32 {
    match rank {
        0 => 0,
        r if (r as usize) <= POINTS.len() => POINTS[r as usize - 1],
        _ => POINTS_PAST_TABLE,
    }
}

/// Round-level settings (host-configurable, applied from the next round).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ruleset {
    pub finish_bonus: u32,
}

impl Default for Ruleset {
    fn default() -> Self {
        Self {
            finish_bonus: DEFAULT_FINISH_BONUS,
        }
    }
}

/// When a car crossed the finish: the tick, and how far through that tick (0..=65535) the line was crossed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct FinishTime {
    pub tick: u64,
    pub fraction: u16,
}

/// What the race knows about one seat at finalisation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entrant {
    pub seat: SeatId,
    /// False: the seat never had a car in this round (DNS).
    pub entered: bool,
    pub finish: Option<FinishTime>,
    /// Legal unwrapped progress, millimetres (the high-water mark; frozen for a withdrawn seat).
    pub progress_mm: u64,
    /// The tick at which that progress was reached.
    pub progress_tick: u64,
    /// Withdrawn (left or sat out) at finalisation.
    pub withdrawn: bool,
    /// Joined mid-round (drop-in).
    pub late: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoundFacts {
    pub round: RoundId,
    pub ruleset: Ruleset,
    pub entrants: Vec<Entrant>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Status {
    Finished,
    Unfinished,
    Dnf,
    Dns,
}

/// One seat's classification.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Classified {
    pub seat: SeatId,
    pub status: Status,
    /// Competition rank (ties share); `None` for DNS.
    pub place: Option<u32>,
    pub placement_points: u32,
    pub finish_bonus: u32,
    pub points: u32,
    pub late: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoundResult {
    pub round: RoundId,
    /// By place, then seat order; DNS last.
    pub rows: Vec<Classified>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitError {
    /// The round is committed with different facts.
    Conflict { round: RoundId },
    /// A seat appears twice: one seat has one result record for the whole round, however often it left and returned.
    DuplicateSeat { seat: SeatId },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Committed {
    New(RoundResult),
    /// The same facts again: nothing changed.
    Again(RoundResult),
}

/// Ranking key: finishers by finish time, then the rest by progress (more is better) and the tick it was reached.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Key {
    Finished(FinishTime),
    Behind {
        progress: std::cmp::Reverse<u64>,
        tick: u64,
    },
}

/// Classifies a round (no standings change).
pub fn classify(facts: &RoundFacts) -> Result<RoundResult, CommitError> {
    let mut seen = BTreeSet::new();
    for e in &facts.entrants {
        if !seen.insert(e.seat) {
            return Err(CommitError::DuplicateSeat { seat: e.seat });
        }
    }
    let mut ranked: Vec<(Key, &Entrant)> = facts
        .entrants
        .iter()
        .filter(|e| e.entered)
        .map(|e| {
            let key = match e.finish {
                Some(f) => Key::Finished(f),
                None => Key::Behind {
                    progress: std::cmp::Reverse(e.progress_mm),
                    tick: e.progress_tick,
                },
            };
            (key, e)
        })
        .collect();
    ranked.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.seat.cmp(&b.1.seat)));
    let mut rows = Vec::with_capacity(facts.entrants.len());
    let mut place = 0;
    for (i, (key, e)) in ranked.iter().enumerate() {
        if i == 0 || ranked[i - 1].0 != *key {
            place = i as u32 + 1;
        }
        let status = match (e.finish, e.withdrawn) {
            (Some(_), _) => Status::Finished,
            (None, true) => Status::Dnf,
            (None, false) => Status::Unfinished,
        };
        let placement_points = points_for_rank(place);
        let finish_bonus = if status == Status::Finished {
            facts.ruleset.finish_bonus
        } else {
            0
        };
        rows.push(Classified {
            seat: e.seat,
            status,
            place: Some(place),
            placement_points,
            finish_bonus,
            points: placement_points + finish_bonus,
            late: e.late,
        });
    }
    let mut dns: Vec<&Entrant> = facts.entrants.iter().filter(|e| !e.entered).collect();
    dns.sort_by_key(|e| e.seat);
    rows.extend(dns.into_iter().map(|e| Classified {
        seat: e.seat,
        status: Status::Dns,
        place: None,
        placement_points: 0,
        finish_bonus: 0,
        points: 0,
        late: e.late,
    }));
    Ok(RoundResult {
        round: facts.round,
        rows,
    })
}

/// A seat's running totals.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SeatTotal {
    pub points: u32,
    pub rounds: u32,
    pub finishes: u32,
    pub wins: u32,
}

/// A row of the session table: competition rank by points (ties share).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StandingRow {
    pub seat: SeatId,
    pub place: u32,
    pub total: SeatTotal,
}

/// The session's standings: every committed round, in memory only.
#[derive(Clone, Debug, Default)]
pub struct Standings {
    rounds: BTreeMap<RoundId, (RoundFacts, RoundResult)>,
    totals: BTreeMap<SeatId, SeatTotal>,
}

fn canonical(facts: &RoundFacts) -> RoundFacts {
    let mut f = facts.clone();
    f.entrants.sort_by_key(|e| e.seat);
    f
}

impl Standings {
    /// Commits a round exactly once.
    pub fn commit(&mut self, facts: &RoundFacts) -> Result<Committed, CommitError> {
        let facts = canonical(facts);
        if let Some((stored, result)) = self.rounds.get(&facts.round) {
            return if *stored == facts {
                Ok(Committed::Again(result.clone()))
            } else {
                Err(CommitError::Conflict { round: facts.round })
            };
        }
        let result = classify(&facts)?;
        for row in &result.rows {
            let t = self.totals.entry(row.seat).or_default();
            t.points += row.points;
            if row.status != Status::Dns {
                t.rounds += 1;
            }
            if row.status == Status::Finished {
                t.finishes += 1;
            }
            if row.place == Some(1) {
                t.wins += 1;
            }
        }
        self.rounds.insert(facts.round, (facts, result.clone()));
        Ok(Committed::New(result))
    }

    pub fn round(&self, round: RoundId) -> Option<&RoundResult> {
        self.rounds.get(&round).map(|(_, r)| r)
    }

    pub fn total(&self, seat: SeatId) -> SeatTotal {
        self.totals.get(&seat).copied().unwrap_or_default()
    }

    /// The session table: by points, ties sharing a place, then seat order for display.
    pub fn table(&self) -> Vec<StandingRow> {
        let mut rows: Vec<(SeatId, SeatTotal)> =
            self.totals.iter().map(|(s, t)| (*s, *t)).collect();
        rows.sort_by(|a, b| b.1.points.cmp(&a.1.points).then(a.0.cmp(&b.0)));
        let mut out = Vec::with_capacity(rows.len());
        let mut place = 0;
        for (i, (seat, total)) in rows.iter().enumerate() {
            if i == 0 || rows[i - 1].1.points != total.points {
                place = i as u32 + 1;
            }
            out.push(StandingRow {
                seat: *seat,
                place,
                total: *total,
            });
        }
        out
    }
}
