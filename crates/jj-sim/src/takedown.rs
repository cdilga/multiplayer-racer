//! Takedowns (R134, Burnout lens; P1-FL19 br-bbki.22): crashes reward someone. In every race, a hit by another car that
//! wrecks the car it hit, or spins it round, is the attacker's takedown: their boost meter fills and the TV and their
//! phone call it out.
//!
//! **Attribution** is the damage module's (P1-S04a/c), never a guess from positions:
//! - a wreck is a takedown when [`DamageEvent::Wrecked`] names another car as its instigator (the car whose hit took the
//!   wheel, or the last car to hit it before it flipped or left the course);
//! - a spin is a takedown when, after a car-on-car episode ([`DamageEvent::Episode`] from another car's chassis, or from
//!   debris that car threw: the record's causal owner) closing at `minClosingMps` or more, the victim's heading turns
//!   `spinDeg` or more within `spinWindowS` of the hit's first contact. An arcade slide (about 40° tail out) never gets
//!   there; a glancing touch that leaves the other car going its way never pays.
//!
//! One credit per hit: a hit that spins the car and then wrecks it pays once. Everything is game ticks and the
//! damage log's own order, so it replays bit for bit natively and in WASM. Nothing is capped: every car can take down
//! and be taken down any number of times.

use serde::{Deserialize, Serialize};

use crate::damage::{DamageEvent, OtherBody};
use crate::sim::TICK_HZ;

pub const TAKEDOWN_JSON: &str = include_str!("../../../assets/profiles/takedown.json");
const CONTRACT: &str = "jj-takedown/1";

/// assets/profiles/takedown.json.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TakedownProfile {
    pub contract: String,
    #[serde(default)]
    pub what: String,
    /// The victim's heading must turn this far, degrees ...
    pub spin_deg: f32,
    /// ... within this long of the hit's first contact, s.
    pub spin_window_s: f32,
    /// A hit counts when its fastest contact closed at least this fast, m/s.
    pub min_closing_mps: f32,
    /// What a takedown adds to the attacker's boost meter (0..1; 1 fills it).
    pub boost: f32,
}

impl TakedownProfile {
    /// The shipped profile.
    pub fn standard() -> Self {
        let p: Self =
            serde_json::from_str(TAKEDOWN_JSON).expect("assets/profiles/takedown.json parses");
        assert_eq!(p.contract, CONTRACT, "takedown.json contract");
        p
    }

    fn window_ticks(&self) -> u64 {
        (self.spin_window_s * TICK_HZ as f32).round() as u64
    }
}

/// How a takedown happened.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TakedownHow {
    Wreck,
    Spin,
}

/// One takedown: who, whom, how, and the tick it was decided.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Takedown {
    pub tick: u64,
    pub attacker: u32,
    pub victim: u32,
    pub how: TakedownHow,
}

/// The last qualifying hit a car took from another car.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Hit {
    attacker: u32,
    start_tick: u64,
    /// The victim's accumulated heading just before the hit, radians.
    base: f32,
    credited: bool,
}

/// A car's heading, unwrapped (accumulated across ±π), with its last [`HISTORY`] ticks.
#[derive(Clone, Debug, Default, PartialEq)]
struct Turn {
    last: Option<f32>,
    acc: f32,
    /// (tick, accumulated heading) for the recent ticks, oldest first.
    history: Vec<(u64, f32)>,
}

/// How many ticks of heading each car keeps: an episode reports its first contact up to its window (6 ticks) late.
const HISTORY: usize = 32;

impl Turn {
    fn push(&mut self, tick: u64, heading: f32) {
        if let Some(last) = self.last {
            let mut d = heading - last;
            while d > core::f32::consts::PI {
                d -= core::f32::consts::TAU;
            }
            while d < -core::f32::consts::PI {
                d += core::f32::consts::TAU;
            }
            self.acc += d;
        }
        self.last = Some(heading);
        if self.history.len() == HISTORY {
            self.history.remove(0);
        }
        self.history.push((tick, self.acc));
    }

    /// The accumulated heading at the end of the latest tick before `tick` (the oldest kept, if `tick` is older).
    fn before(&self, tick: u64) -> f32 {
        self.history
            .iter()
            .rev()
            .find(|&&(t, _)| t < tick)
            .or(self.history.first())
            .map_or(self.acc, |&(_, a)| a)
    }

    /// A teleport (a respawn, a placement) isn't a turn.
    fn reset(&mut self) {
        self.last = None;
        self.history.clear();
    }
}

/// The takedown ledger: every car's last hit and heading, and the takedowns so far.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Takedowns {
    hits: Vec<Option<Hit>>,
    turns: Vec<Turn>,
    seen: usize,
    log: Vec<Takedown>,
}

impl Takedowns {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every takedown so far, in order.
    pub fn log(&self) -> &[Takedown] {
        &self.log
    }

    /// How many takedowns `car` has made.
    pub fn count(&self, car: u32) -> u32 {
        self.log.iter().filter(|t| t.attacker == car).count() as u32
    }

    /// A car was placed (respawned, teleported): the jump in its heading isn't a turn. (Any open hit on it stays: the
    /// wreck that respawned it is read after the placement, and must still know whether its hit already paid.)
    pub fn placed(&mut self, car: u32) {
        if let Some(t) = self.turns.get_mut(car as usize) {
            t.reset();
        }
    }

    /// After the step to `tick`: `headings` are every car's heading (radians) now, or `None` where a heading isn't a
    /// turn (a car carried round a loop turns over its top), and `damage` the sim's whole damage log (read from where
    /// the last call left off). Returns this tick's new takedowns.
    pub fn update(
        &mut self,
        tick: u64,
        headings: &[Option<f32>],
        damage: &[(u64, DamageEvent)],
        p: &TakedownProfile,
    ) -> Vec<Takedown> {
        let n = headings.len();
        if self.turns.len() < n {
            self.turns.resize(n, Turn::default());
            self.hits.resize(n, None);
        }
        for (k, &h) in headings.iter().enumerate() {
            match h {
                Some(h) => self.turns[k].push(tick, h),
                None => self.turns[k].reset(),
            }
        }
        let mut out = Vec::new();
        let window = p.window_ticks();
        for (_, e) in &damage[self.seen.min(damage.len())..] {
            match *e {
                DamageEvent::Episode(r) => {
                    let attacker = match r.other {
                        OtherBody::Car { car } => Some(car),
                        OtherBody::Prop { .. } => r.other_owner.map(|o| o.car),
                        OtherBody::Scenery => None,
                    };
                    let Some(attacker) = attacker else { continue };
                    let v = r.car as usize;
                    if attacker == r.car || v >= n || r.closing_mps < p.min_closing_mps {
                        continue;
                    }
                    // A later hit by the same attacker within the window is the same hit going on.
                    if let Some(h) = self.hits[v]
                        && h.attacker == attacker
                        && r.start_tick <= h.start_tick + window
                    {
                        continue;
                    }
                    self.hits[v] = Some(Hit {
                        attacker,
                        start_tick: r.start_tick,
                        base: self.turns[v].before(r.start_tick),
                        credited: false,
                    });
                }
                DamageEvent::Wrecked {
                    car,
                    instigator: Some(attacker),
                    ..
                } if attacker != car => {
                    let v = car as usize;
                    // The hit that already paid for spinning this car doesn't pay again for its wreck.
                    let paid = self.hits.get(v).copied().flatten().is_some_and(|h| {
                        h.credited && h.attacker == attacker && tick <= h.start_tick + window
                    });
                    if !paid {
                        out.push(Takedown {
                            tick,
                            attacker,
                            victim: car,
                            how: TakedownHow::Wreck,
                        });
                    }
                    if let Some(h) = self.hits.get_mut(v) {
                        *h = None;
                    }
                }
                _ => {}
            }
        }
        self.seen = damage.len();
        let spin = p.spin_deg.to_radians();
        for v in 0..n {
            let Some(mut h) = self.hits[v] else { continue };
            if tick > h.start_tick + window {
                self.hits[v] = None;
                continue;
            }
            if !h.credited && (self.turns[v].acc - h.base).abs() >= spin {
                h.credited = true;
                self.hits[v] = Some(h);
                out.push(Takedown {
                    tick,
                    attacker: h.attacker,
                    victim: v as u32,
                    how: TakedownHow::Spin,
                });
            }
        }
        self.log.extend_from_slice(&out);
        out
    }

    /// The ledger's state for the full-state hash: nothing until a car has been hit or taken down, so sims without
    /// either keep their hashes.
    pub fn hash_into(&self, out: &mut Vec<u8>) {
        if self.log.is_empty() && self.hits.iter().all(Option::is_none) {
            return;
        }
        out.extend((self.log.len() as u32).to_le_bytes());
        for t in &self.log {
            out.extend(t.tick.to_le_bytes());
            out.extend(t.attacker.to_le_bytes());
            out.extend(t.victim.to_le_bytes());
            out.push(t.how as u8);
        }
        for h in &self.hits {
            match h {
                Some(h) => {
                    out.push(1);
                    out.extend(h.attacker.to_le_bytes());
                    out.extend(h.start_tick.to_le_bytes());
                    out.extend(h.base.to_bits().to_le_bytes());
                    out.push(u8::from(h.credited));
                }
                None => out.push(0),
            }
        }
        for t in &self.turns {
            out.extend(t.acc.to_bits().to_le_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::damage::{EpisodeRecord, Owner, WreckWhy};

    fn hit(victim: u32, attacker: u32, start: u64, closing: f32) -> (u64, DamageEvent) {
        (
            start + 6,
            DamageEvent::Episode(EpisodeRecord {
                car: victim,
                part: 1,
                other: OtherBody::Car { car: attacker },
                other_owner: Some(Owner {
                    car: attacker,
                    tick: start,
                }),
                impulse: 4000.0,
                closing_mps: closing,
                start_tick: start,
                last_tick: start + 2,
                tick: start + 6,
                damage: 5.0,
                health: 50.0,
            }),
        )
    }

    /// Steps `t` through `ticks`, the victim (car 1) turning `turn_per_tick` radians each tick; car 0 drives straight.
    fn run(
        t: &mut Takedowns,
        log: &[(u64, DamageEvent)],
        ticks: std::ops::Range<u64>,
        turn_per_tick: f32,
    ) -> Vec<Takedown> {
        let p = TakedownProfile::standard();
        let mut out = Vec::new();
        for tick in ticks {
            let shown: Vec<_> = log.iter().copied().filter(|&(at, _)| at <= tick).collect();
            let heading = (tick as f32 * turn_per_tick).rem_euclid(core::f32::consts::TAU)
                - core::f32::consts::PI;
            out.extend(t.update(tick, &[Some(0.0), Some(heading)], &shown, &p));
        }
        out
    }

    #[test]
    fn a_hit_that_spins_the_car_round_is_the_attackers_takedown() {
        let mut t = Takedowns::new();
        // 1.2 turns a second for a second after the hit: well past the profile's spin.
        let out = run(
            &mut t,
            &[hit(1, 0, 10, 9.0)],
            0..130,
            1.2 * core::f32::consts::TAU / 120.0,
        );
        assert_eq!(out.len(), 1, "{out:?}");
        assert_eq!(
            (out[0].attacker, out[0].victim, out[0].how),
            (0, 1, TakedownHow::Spin)
        );
        assert_eq!(t.count(0), 1);
    }

    #[test]
    fn a_glancing_touch_or_a_slide_pays_nothing() {
        // The car turns 40 degrees (an arcade slide) after a hard hit: no spin.
        let mut t = Takedowns::new();
        assert!(
            run(
                &mut t,
                &[hit(1, 0, 10, 9.0)],
                0..200,
                (40f32).to_radians() / 120.0
            )
            .is_empty()
        );
        // A soft touch, then a full spin: under the closing speed, so no hit to credit.
        let mut t = Takedowns::new();
        assert!(run(&mut t, &[hit(1, 0, 10, 2.0)], 0..200, 0.06).is_empty());
        // A spin long after the hit (the window closed) is the driver's own.
        let mut t = Takedowns::new();
        let late: Vec<_> = (0..400).map(|k| if k < 300 { 0.0 } else { 0.06 }).collect();
        let p = TakedownProfile::standard();
        let log = [hit(1, 0, 10, 9.0)];
        let mut heading = 0.0f32;
        let mut out = Vec::new();
        for (tick, d) in late.iter().enumerate() {
            heading += d;
            let shown: Vec<_> = log
                .iter()
                .copied()
                .filter(|&(at, _)| at <= tick as u64)
                .collect();
            out.extend(t.update(tick as u64, &[Some(0.0), Some(heading)], &shown, &p));
        }
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn a_wreck_by_another_car_pays_once_even_after_its_spin() {
        let wreck = |tick: u64| {
            (
                tick,
                DamageEvent::Wrecked {
                    car: 1,
                    why: WreckWhy::Flipped,
                    cause: Some(OtherBody::Car { car: 0 }),
                    instigator: Some(0),
                },
            )
        };
        // Wrecked with no spin first: one Wreck takedown.
        let mut t = Takedowns::new();
        let out = run(&mut t, &[hit(1, 0, 10, 9.0), wreck(60)], 0..100, 0.0);
        assert_eq!(
            out.iter().map(|t| t.how).collect::<Vec<_>>(),
            [TakedownHow::Wreck]
        );
        // Spun, then wrecked by the same hit: the spin pays, the wreck doesn't again.
        let mut t = Takedowns::new();
        let out = run(&mut t, &[hit(1, 0, 10, 9.0), wreck(110)], 0..140, 0.05);
        assert_eq!(
            out.iter().map(|t| t.how).collect::<Vec<_>>(),
            [TakedownHow::Spin]
        );
        // A wreck of its own (no instigator) pays nobody.
        let mut t = Takedowns::new();
        let solo = (
            50,
            DamageEvent::Wrecked {
                car: 1,
                why: WreckWhy::Flipped,
                cause: None,
                instigator: None,
            },
        );
        assert!(run(&mut t, &[solo], 0..100, 0.0).is_empty());
    }
}
