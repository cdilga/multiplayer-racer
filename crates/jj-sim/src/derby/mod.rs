//! Derby rules and damage-point scoring (P1-S10, master §10.12 "Derby raw points", R56): a 3-minute round on game time, won
//! on damage dealt to opponents. The damage itself is S04's (intact → loose → detached, husks stay, debris stays dynamic);
//! this module only **attributes and scores** it, from the sim's own damage events, so it works on every map and replays
//! bit for bit.
//!
//! - **Points.** Each accepted HP of opponent damage is 1 point, a detach +5 and a wreck +20, once per part and per life.
//!   Integer units throughout: damage in 0.001 HP, score in 1/2000 point, so normal damage earns exactly twice its damage
//!   units and the bonuses are exact integers ([`DETACH_UNITS`], [`WRECK_UNITS`]). An autopilot halves each credited
//!   event once (always exact: every event is an even number of units), so a 10 HP + detach + wreck episode is 35 points
//!   for a human and 17.5 for the autopilot. The control mode is read **at the causal action** (the instigator's impulse),
//!   never at display time: the ledger keeps each car's mode and protection history for it.
//! - **Who scores.** Nobody for self damage, friendly fire (cars sharing a team, none by default), damage taken or dealt
//!   under spawn protection, or the environment (walls, the ground, debris nobody pushed lately).
//! - **Debris.** A prop or detached part is its last instigator's, for [`ATTRIBUTION_TICKS`] (3 s of game time) after that
//!   car's last qualifying impulse into it; after that it is environmental.
//! - **Wrecks.** A wheel-loss wreck is the car that took the wheel. A flip or out-of-bounds wreck is the last car to hit it
//!   within the same 3 s. Each life ends once, so each wreck pays once.
//! - **Round.** `limit_ticks` of game time from the start ([`ROUND_TICKS`] is 3 minutes). It counts the sim's own ticks, so
//!   it pauses with game time. A tick's events all count, including the last tick's. Ranking is raw points; equal points
//!   share a rank (1, 1, 3). A late joiner appears at a safe edge pose under protection (the arena's placement) and ranks
//!   from arrival on raw points alone: no normalisation.
//!
//! The director ends the round on this clock (`jj_session::director`'s game clock), fed from the same tick count, so the
//! session never reaches into the sim.

use serde::{Deserialize, Serialize};

use crate::damage::{DamageEvent, EpisodeRecord, OtherBody, WreckWhy};
use crate::sim::TICK_HZ;

/// Score units in one point (1/2000 point each).
pub const UNITS_PER_POINT: u64 = 2000;
/// Damage units in one HP (0.001 HP each).
pub const DAMAGE_UNITS_PER_HP: f32 = 1000.0;
/// The detach bonus, +5 points.
pub const DETACH_UNITS: u64 = 5 * UNITS_PER_POINT;
/// The wreck bonus, +20 points.
pub const WRECK_UNITS: u64 = 20 * UNITS_PER_POINT;
/// How long debris, and a hit, stay their instigator's: 3 s of game time after the last qualifying impulse.
pub const ATTRIBUTION_TICKS: u64 = 3 * TICK_HZ as u64;
/// The derby round: 3 minutes of game time.
pub const ROUND_TICKS: u64 = 180 * TICK_HZ as u64;

/// What a score event paid for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ScoreKind {
    /// Opponent damage, in damage units (0.001 HP).
    Damage {
        damage_units: u64,
    },
    Detach,
    Wreck,
}

/// One scored event: for the HUD bands, the combo callouts (presentation only, no multiplier) and the A03 cues.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreEvent {
    pub tick: u64,
    pub scorer: u32,
    pub victim: u32,
    /// The victim's part (none for a wreck).
    pub part: Option<u8>,
    pub kind: ScoreKind,
    /// Score units credited (already halved when the scorer was on autopilot at the causal action).
    pub units: u64,
    pub autopilot: bool,
}

/// An attributed hit that passed every rule: who, the tick whose control mode counts, and the tick of the last impulse.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Approved {
    scorer: u32,
    causal: u64,
    impulse: u64,
    autopilot: bool,
}

/// One car's standing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub car: u32,
    /// Raw points in score units (1/2000 point).
    pub units: u64,
    /// Competition rank (ties share).
    pub rank: u32,
    /// The tick the car first appeared: a late joiner ranks from here.
    pub arrived: u64,
}

/// The derby ledger: attribution state and scores for every car that ever appeared.
#[derive(Clone, Debug, Default)]
pub struct Ledger {
    start: u64,
    limit: u64,
    /// How much of the sim's damage log has been read.
    seen: usize,
    units: Vec<u64>,
    arrived: Vec<u64>,
    team: Vec<Option<u32>>,
    /// Per car: `(tick, on)` whenever the autopilot / spawn protection changed.
    mode: Vec<Vec<(u64, bool)>>,
    protection: Vec<Vec<(u64, bool)>>,
    /// The latest approved hit on each car, until a wreck uses it.
    last_hit: Vec<Option<Approved>>,
    /// The latest approved detach on each car, until a wreck uses it.
    last_detach: Vec<Option<Approved>>,
    /// The episode just read, for the detach event that follows it in the log.
    pending: Option<(u32, u8, Option<Approved>)>,
    events: Vec<ScoreEvent>,
}

/// A car's control mode and protection at the end of a tick.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CarFlags {
    pub autopilot: bool,
    pub protected: bool,
}

impl Ledger {
    /// A ledger whose clock starts at `start` (a sim tick) and runs `limit` ticks of game time.
    pub fn new(start: u64, limit: u64) -> Self {
        Self {
            start,
            limit,
            ..Self::default()
        }
    }

    pub fn start_tick(&self) -> u64 {
        self.start
    }

    pub fn limit_ticks(&self) -> u64 {
        self.limit
    }

    /// Cars the ledger has seen.
    pub fn cars(&self) -> usize {
        self.units.len()
    }

    /// Game time left at sim tick `tick`, ticks.
    pub fn time_left_ticks(&self, tick: u64) -> u64 {
        (self.start + self.limit).saturating_sub(tick)
    }

    /// Whether the clock has run out at `tick`.
    pub fn over(&self, tick: u64) -> bool {
        tick >= self.start + self.limit
    }

    /// Declares `a` and `b` teammates: damage between them scores nothing (friendly fire). Cars have no team by default.
    pub fn set_team(&mut self, car: u32, team: Option<u32>) {
        self.grow(car as usize + 1, self.start);
        self.team[car as usize] = team;
    }

    fn grow(&mut self, cars: usize, tick: u64) {
        while self.units.len() < cars {
            self.units.push(0);
            self.arrived.push(tick);
            self.team.push(None);
            self.mode.push(Vec::new());
            self.protection.push(Vec::new());
            self.last_hit.push(None);
            self.last_detach.push(None);
        }
    }

    fn flag_at(history: &[(u64, bool)], tick: u64) -> bool {
        history
            .iter()
            .rev()
            .find(|(t, _)| *t <= tick)
            .is_some_and(|(_, on)| *on)
    }

    /// Whether `car` was under the autopilot at `tick`.
    pub fn autopilot_at(&self, car: u32, tick: u64) -> bool {
        self.mode
            .get(car as usize)
            .is_some_and(|h| Self::flag_at(h, tick))
    }

    /// Whether `car` was spawn-protected at `tick` or the tick before (conservative: the edge counts as protected).
    pub fn protected_at(&self, car: u32, tick: u64) -> bool {
        self.protection
            .get(car as usize)
            .is_some_and(|h| Self::flag_at(h, tick) || Self::flag_at(h, tick.saturating_sub(1)))
    }

    /// Reads one finished tick: every car's flags at its end, then the damage log from where the last call stopped. `tick`
    /// is the sim's tick counter after the step; `log` is `Sim::damage_events`.
    pub fn update(&mut self, tick: u64, flags: &[CarFlags], log: &[(u64, DamageEvent)]) {
        self.update_with_wheels(tick, flags, log, |_, part| crate::damage::is_wheel(part));
    }

    /// Reads damage with the affected vehicle's actual wheel topology (cars and bikes can share a round).
    pub fn update_with_wheels(
        &mut self,
        tick: u64,
        flags: &[CarFlags],
        log: &[(u64, DamageEvent)],
        is_wheel: impl Fn(u32, usize) -> bool,
    ) {
        self.grow(flags.len(), tick);
        for (i, f) in flags.iter().enumerate() {
            for (hist, on) in [
                (&mut self.mode[i], f.autopilot),
                (&mut self.protection[i], f.protected),
            ] {
                if hist.last().is_none_or(|(_, was)| *was != on) {
                    hist.push((tick, on));
                }
            }
        }
        let from = self.seen.min(log.len());
        self.seen = log.len();
        for (at, e) in &log[from..] {
            if *at > self.start + self.limit || *at < self.start {
                continue;
            }
            self.read(*at, e, &is_wheel);
        }
    }

    fn read(&mut self, at: u64, e: &DamageEvent, is_wheel: &impl Fn(u32, usize) -> bool) {
        match e {
            DamageEvent::Episode(r) => {
                let approved = self.approve(r);
                self.pending = Some((r.car, r.part, approved));
                if let Some(a) = approved {
                    let units = (r.damage * DAMAGE_UNITS_PER_HP).round().max(0.0) as u64;
                    self.credit(
                        at,
                        a,
                        r.car,
                        Some(r.part),
                        ScoreKind::Damage {
                            damage_units: units,
                        },
                        units * 2,
                    );
                    self.last_hit[r.car as usize] = Some(a);
                }
            }
            DamageEvent::PartDetached { car, part, .. } => {
                // The detach belongs to the episode that took the part: the log writes them back to back.
                let approved = match self.pending.take() {
                    Some((c, p, a)) if c == *car && p == *part => a,
                    _ => None,
                };
                if let Some(a) = approved {
                    self.credit(at, a, *car, Some(*part), ScoreKind::Detach, DETACH_UNITS);
                    // A wheel-loss wreck is the car that took the wheel.
                    if is_wheel(*car, *part as usize) {
                        self.last_detach[*car as usize] = Some(a);
                    }
                }
            }
            DamageEvent::Wrecked { car, why, .. } => {
                let ci = *car as usize;
                let by = match why {
                    // The car that took the last wheel.
                    WreckWhy::WheelLoss => self.last_detach.get(ci).copied().flatten(),
                    // The last car to hit it, if that was within 3 s.
                    WreckWhy::Flipped | WreckWhy::OutOfBounds => self
                        .last_hit
                        .get(ci)
                        .copied()
                        .flatten()
                        .filter(|a| at <= a.impulse + ATTRIBUTION_TICKS),
                };
                if let Some(a) = by {
                    self.credit(at, a, *car, None, ScoreKind::Wreck, WRECK_UNITS);
                }
                // A life ends once: the next one starts with a clean slate.
                if let (Some(h), Some(d)) =
                    (self.last_hit.get_mut(ci), self.last_detach.get_mut(ci))
                {
                    *h = None;
                    *d = None;
                }
            }
            DamageEvent::PartLoose { .. } => {}
        }
    }

    /// Who an episode is credited to, if anyone: the rules in the module doc.
    fn approve(&self, r: &EpisodeRecord) -> Option<Approved> {
        let (scorer, causal, impulse) = match r.other {
            OtherBody::Car { car } => (car, r.start_tick, r.last_tick),
            // Debris: its last instigator, while that impulse is fresh at the moment this episode opened.
            OtherBody::Prop { .. } => {
                let o = r
                    .other_owner
                    .filter(|o| r.start_tick <= o.tick + ATTRIBUTION_TICKS)?;
                (o.car, o.tick, o.tick)
            }
            OtherBody::Scenery => return None,
        };
        let victim = r.car;
        if scorer == victim {
            return None;
        }
        let team = |c: u32| self.team.get(c as usize).copied().flatten();
        if team(scorer).is_some() && team(scorer) == team(victim) {
            return None;
        }
        if self.protected_at(victim, r.start_tick)
            || self.protected_at(victim, r.last_tick)
            || self.protected_at(scorer, causal)
        {
            return None;
        }
        Some(Approved {
            scorer,
            causal,
            impulse,
            autopilot: self.autopilot_at(scorer, causal),
        })
    }

    fn credit(
        &mut self,
        at: u64,
        a: Approved,
        victim: u32,
        part: Option<u8>,
        kind: ScoreKind,
        full: u64,
    ) {
        // Autopilot halves the credited event once; every full amount is even, so it is exact.
        let units = if a.autopilot { full / 2 } else { full };
        self.units[a.scorer as usize] += units;
        self.events.push(ScoreEvent {
            tick: at,
            scorer: a.scorer,
            victim,
            part,
            kind,
            units,
            autopilot: a.autopilot,
        });
    }

    /// Every scored event, oldest first.
    pub fn events(&self) -> &[ScoreEvent] {
        &self.events
    }

    /// A car's raw points in score units.
    pub fn units(&self, car: u32) -> u64 {
        self.units.get(car as usize).copied().unwrap_or(0)
    }

    /// A car's raw points (halves are exact: 17.5).
    pub fn points(&self, car: u32) -> f64 {
        self.units(car) as f64 / UNITS_PER_POINT as f64
    }

    /// A car's competition rank by raw points: one plus the cars with strictly more (equal points share).
    pub fn rank_of(&self, car: u32) -> u32 {
        let mine = self.units(car);
        1 + self.units.iter().filter(|&&u| u > mine).count() as u32
    }

    /// Every car's standing, best first (ties in car order).
    pub fn rows(&self) -> Vec<Row> {
        let mut rows: Vec<Row> = (0..self.units.len() as u32)
            .map(|car| Row {
                car,
                units: self.units[car as usize],
                rank: self.rank_of(car),
                arrived: self.arrived[car as usize],
            })
            .collect();
        rows.sort_by(|a, b| b.units.cmp(&a.units).then(a.car.cmp(&b.car)));
        rows
    }

    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        out.extend(self.start.to_le_bytes());
        out.extend(self.limit.to_le_bytes());
        for (u, a) in self.units.iter().zip(&self.arrived) {
            out.extend(u.to_le_bytes());
            out.extend(a.to_le_bytes());
        }
    }
}

#[cfg(test)]
mod tests;
