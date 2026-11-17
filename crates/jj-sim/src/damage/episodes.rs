//! Damage episodes (P1-S04a, plan §6.3): reading the step's contacts, attributing each to a car's part, and
//! aggregating qualifying normal impulses per (car, part, other body) over a short game-time window.
//!
//! **What counts.** A contact point counts when its bodies were closing along its normal at least `min_closing_mps`
//! (default 4 m/s) just before the step. That drops resting contact (closing ≈ 0), sliding along a wall and a gentle
//! nudge, and the wheel suspension never appears at all (it's a ray, not a contact). The closing speed comes from the
//! bodies' velocities **before** `step` (the solver has already removed the approach by the time contacts are read) at
//! the contact point, exactly where the narrow phase found it.
//!
//! **Attribution.** Each part is its own convex collider on the chassis body, so the collider handle names the part.
//! The one exception is the core (the cabin proxy, no health): the sidecar's cabin bulges past the door skins, so a side
//! hit lands on it first. A contact on the core belongs to the nearest part collider within `attribution_margin_m` of the
//! contact point (in vehicle space); farther than that it's the core's, and costs nothing.
//!
//! **Time.** Everything is game ticks: an episode opens at the first qualifying contact, takes qualifying impulses for
//! `window_ms` (6 ticks at 120 Hz), then closes and charges health. Iteration is in key order (`BTreeMap`), so the
//! result is the same natively and in WASM.

use std::collections::BTreeMap;

use rapier3d::prelude::*;

use super::{CORE, CarDamage, DamageEvent, EpisodeRecord, OtherBody, Owner};
use crate::derby::{ATTRIBUTION_TICKS, DerbyRules};
use crate::items::roo_bar;
use crate::profile::DamageTuning;
use crate::sim::TICK_HZ;

/// `RigidBody::user_data` tags: the high bits say what a body is, the low 32 which one.
pub const TAG_CAR: u128 = 1 << 32;
pub const TAG_PROP: u128 = 2 << 32;
/// Owner's compliant guard rails absorb a hit without costing car parts (br-gw74.9).
pub const TAG_RAIL: u128 = 3 << 32;
const TAG_MASK: u128 = 0xffff_ffff << 32;
/// A sprung trap stays its setter's for this long (0.1 s), so every part the hit touches is one hit.
const TRAP_SPRING_TICKS: u64 = 12;

/// A body's state just before the step.
#[derive(Clone, Copy)]
struct Snap {
    iso: Pose,
    linvel: Vector,
    angvel: Vector,
    com: Vector,
}

impl Snap {
    /// The velocity of the body's material point at world `p`.
    fn velocity_at(&self, p: Vector) -> Vector {
        self.linvel + self.angvel.cross(p - self.com)
    }
}

/// The awake dynamic bodies' pose and velocities just before `step` (a sleeping or fixed body isn't moving).
#[derive(Default)]
pub struct PreStep {
    snaps: Vec<Option<Snap>>,
}

impl PreStep {
    pub(crate) fn capture(&mut self, bodies: &RigidBodySet) {
        self.snaps.iter_mut().for_each(|s| *s = None);
        for (h, b) in bodies.iter() {
            if !b.is_dynamic() || b.is_sleeping() {
                continue;
            }
            let i = h.into_raw_parts().0 as usize;
            if i >= self.snaps.len() {
                self.snaps.resize(i + 1, None);
            }
            self.snaps[i] = Some(Snap {
                iso: *b.position(),
                linvel: b.linvel(),
                angvel: b.angvel(),
                com: b.center_of_mass(),
            });
        }
    }

    fn get(&self, h: RigidBodyHandle) -> Option<&Snap> {
        self.snaps.get(h.into_raw_parts().0 as usize)?.as_ref()
    }
}

/// One car's colliders for the scan: its part colliders in part order.
pub struct CarParts<'a> {
    pub car: u32,
    pub parts: &'a [ColliderHandle],
    pub contact_immune: bool,
    /// A roo bar is fitted (`items::roo_bar`): a ram this car drives costs it nothing and the car it hits double.
    pub ram: bool,
}

#[derive(Clone, Copy)]
struct Open {
    other: OtherBody,
    other_owner: Option<Owner>,
    impulse: f32,
    damage_impulse: f32,
    closing: f32,
    start: u64,
    last: u64,
}

/// The open episodes and the causal owners of props.
#[derive(Default)]
pub struct Episodes {
    /// (car, part, other body's key) → the episode taking impulses now.
    open: BTreeMap<(u32, u8, (u8, u32)), Open>,
    /// The car that last put a qualifying impulse into a prop, and when.
    prop_owner: BTreeMap<u32, Owner>,
    /// Derby only: the car that last struck each car (brought most of the closing speed into it), and when. A wall or
    /// junk it meets soon after is that car's doing (a shove).
    struck: BTreeMap<u32, Owner>,
    /// Traps (a dropped esky): the prop, the car that set it and the tick it was sprung. The first rival to meet it is
    /// the setter's hit, however long it has sat there (every part it touches within [`TRAP_SPRING_TICKS`] of the
    /// first); after that it is junk like any other.
    traps: BTreeMap<u32, (u32, Option<u64>)>,
}

impl Episodes {
    /// The causal owner of prop `prop` now.
    pub fn owner_of_prop(&self, prop: u32) -> Option<Owner> {
        self.prop_owner.get(&prop).copied()
    }

    /// `car` threw prop `prop` at `tick` (a blast): it is that car's from now, as if it had rammed it.
    pub(crate) fn own_prop(&mut self, prop: u32, car: u32, tick: u64) {
        self.prop_owner.insert(prop, Owner { car, tick });
    }

    /// `car` set prop `prop` as a trap (a dropped esky).
    pub(crate) fn set_trap(&mut self, prop: u32, car: u32) {
        self.traps.insert(prop, (car, None));
    }

    /// Reads this step's contacts (call after `step`, with `tick` the counter after it) into the open episodes. `rules`
    /// are the derby's hit rules while a derby round is on (who pays for a hit); none in a race.
    pub(crate) fn scan(
        &mut self,
        world: &PhysicsWorld,
        pre: &PreStep,
        cars: &[CarParts<'_>],
        ts: &[&DamageTuning],
        tick: u64,
        rules: Option<&DerbyRules>,
    ) -> f64 {
        let mut dominance_work = 0.0;
        for car in cars {
            let t = ts[car.car as usize];
            let Some(me) = car
                .parts
                .first()
                .and_then(|&c| world.colliders.get(c))
                .and_then(Collider::parent)
                .and_then(|b| pre.get(b))
            else {
                continue;
            };
            for (part, &mine) in car.parts.iter().enumerate() {
                for pair in world.narrow_phase.contact_pairs_with(mine) {
                    let mine_is_1 = pair.collider1 == mine;
                    let other_c = if mine_is_1 {
                        pair.collider2
                    } else {
                        pair.collider1
                    };
                    let Some(other) = world.colliders.get(other_c) else {
                        continue;
                    };
                    let other_body = other.parent();
                    if other_body
                        .and_then(|b| world.bodies.get(b))
                        .is_some_and(|b| b.user_data & TAG_MASK == TAG_RAIL)
                    {
                        continue;
                    }
                    let other_snap = other_body.and_then(|b| pre.get(b));
                    let kind = match other_body.and_then(|b| world.bodies.get(b)) {
                        Some(b) if b.user_data & TAG_MASK == TAG_CAR => OtherBody::Car {
                            car: b.user_data as u32,
                        },
                        Some(b) if b.user_data & TAG_MASK == TAG_PROP => OtherBody::Prop {
                            prop: b.user_data as u32,
                        },
                        _ => OtherBody::Scenery,
                    };
                    for m in pair.manifolds() {
                        let n = m.data.normal;
                        for pt in &m.points {
                            if pt.data.impulse <= 0.0 {
                                continue;
                            }
                            let local = if mine_is_1 { pt.local_p1 } else { pt.local_p2 };
                            let p = me.iso * local;
                            let v_me = me.velocity_at(p);
                            let v_other = other_snap.map_or(Vector::ZERO, |s| s.velocity_at(p));
                            // A moving one-way surface supplies normal work J·v to the lower
                            // dynamic body. Book that authorised buff work, never fixed-world
                            // collisions or equal-dominance contacts. No energy residual clamp.
                            let dominant = if mine_is_1 {
                                m.data.relative_dominance > 0
                            } else {
                                m.data.relative_dominance < 0
                            };
                            if car.contact_immune
                                && dominant
                                && other_body
                                    .and_then(|h| world.bodies.get(h))
                                    .is_some_and(RigidBody::is_dynamic)
                            {
                                let to_other = if mine_is_1 { n } else { -n };
                                dominance_work += f64::from(pt.data.impulse * v_me.dot(to_other));
                            }
                            // The normal points from collider 1 to collider 2.
                            let rel = if mine_is_1 {
                                v_me - v_other
                            } else {
                                v_other - v_me
                            };
                            let closing = rel.dot(n);
                            if closing < t.min_closing_mps {
                                continue;
                            }
                            // Each contact point belongs to its own part: one flat hit can straddle two.
                            // In a derby a car's hit on the cabin is never free: it lands on the nearest part,
                            // however far (a car that comes down on a rival's roof damages it: a stomp pays).
                            let margin = match (rules, kind) {
                                (Some(_), OtherBody::Car { .. }) => f32::MAX,
                                _ => t.attribution_margin_m,
                            };
                            let part = if part == CORE {
                                attribute_core(world, car, local, margin)
                            } else {
                                part
                            };
                            // How much of the closing speed this car brought: 1 it drove into the other, 0 it was hit.
                            let mine = if mine_is_1 { v_me.dot(n) } else { -v_me.dot(n) };
                            let share = (mine / closing).clamp(0.0, 1.0);
                            // A roo bar: the car that drives the ram pays nothing, the car it rams double.
                            let bar = match kind {
                                OtherBody::Car { .. }
                                    if car.ram && share >= roo_bar::STRIKE_SHARE =>
                                {
                                    roo_bar::SELF_SCALE
                                }
                                OtherBody::Car { car: by }
                                    if share < roo_bar::STRIKE_SHARE
                                        && cars.get(by as usize).is_some_and(|c| c.ram) =>
                                {
                                    roo_bar::HIT_SCALE
                                }
                                _ => 1.0,
                            };
                            self.add(
                                car,
                                part,
                                kind,
                                (pt.data.impulse, closing, share, bar),
                                tick,
                                rules,
                            );
                        }
                    }
                }
            }
        }
        dominance_work
    }

    fn add(
        &mut self,
        car: &CarParts<'_>,
        part: usize,
        other: OtherBody,
        (impulse, closing, share, bar): (f32, f32, f32, f32),
        tick: u64,
        rules: Option<&DerbyRules>,
    ) {
        let key = (car.car, part as u8, other.key());
        if let (Some(_), OtherBody::Car { car: by }) = (rules, other)
            && share < 0.5
        {
            self.struck.insert(car.car, Owner { car: by, tick });
        }
        // Derby: the car that struck this one lately owns the wall or the junk it is shoved into.
        let shover = rules.and_then(|r| {
            self.struck
                .get(&car.car)
                .copied()
                .filter(|o| tick <= o.tick + r.shove_ticks())
        });
        let before = match other {
            OtherBody::Car { car } => Some(Owner { car, tick }),
            OtherBody::Prop { prop } => {
                // A trap springs on the first car to meet it: its setter's hit, as of now.
                let trap = match self.traps.get_mut(&prop) {
                    Some((by, sprung)) if *by != car.car => {
                        let at = *sprung.get_or_insert(tick);
                        (tick <= at + TRAP_SPRING_TICKS).then_some(Owner { car: *by, tick })
                    }
                    _ => None,
                };
                let own = trap.or(self.prop_owner.get(&prop).copied());
                let thrown =
                    own.is_some_and(|o| o.car != car.car && tick <= o.tick + ATTRIBUTION_TICKS);
                if thrown { own } else { shover.or(own) }
            }
            OtherBody::Scenery => shover,
        };
        let e = self.open.entry(key).or_insert(Open {
            other,
            other_owner: before,
            impulse: 0.0,
            damage_impulse: 0.0,
            closing: 0.0,
            start: tick,
            last: tick,
        });
        e.impulse += impulse;
        if !car.contact_immune {
            let scale = match (rules, other) {
                (None, _) => bar,
                (Some(r), OtherBody::Car { .. }) => r.striker_scale(share) * bar,
                // Junk and walls bite in full only when a rival threw the junk or shoved this car into them.
                (Some(r), _) => {
                    let rivals = e
                        .other_owner
                        .is_some_and(|o| o.car != car.car && e.start <= o.tick + ATTRIBUTION_TICKS);
                    if rivals { 1.0 } else { r.junk_take }
                }
            };
            e.damage_impulse += impulse * scale;
        }
        e.closing = e.closing.max(closing);
        e.last = tick;
        // The car now owns what it hit: a prop it knocked into someone is its doing.
        if let OtherBody::Prop { prop } = other {
            self.prop_owner.insert(prop, Owner { car: car.car, tick });
        }
    }

    /// Closes the episodes whose window has run out at `tick`, charges their damage and returns what happened:
    /// each record, then any part that went loose or detached because of it.
    pub(crate) fn close(
        &mut self,
        tick: u64,
        ts: &[&DamageTuning],
        damage: &mut [CarDamage],
        immune: &[bool],
    ) -> Vec<DamageEvent> {
        let window_of = |car: u32| {
            (libm::roundf(ts[car as usize].window_ms * 0.001 * TICK_HZ as f32) as u64).max(1)
        };
        let due: Vec<_> = self
            .open
            .iter()
            .filter(|(k, e)| tick + 1 >= e.start + window_of(k.0))
            .map(|(k, _)| *k)
            .collect();
        let mut events = Vec::new();
        for key in due {
            let Some(e) = self.open.remove(&key) else {
                continue;
            };
            let (car, part) = (key.0, key.1 as usize);
            let t = ts[car as usize];
            let Some(d) = damage.get_mut(car as usize) else {
                continue;
            };
            let was = d.state(part, t);
            let loss = if was == super::PartState::Detached || immune[car as usize] {
                0.0
            } else {
                d.k(part, t) * e.damage_impulse
            };
            let before = d.health[part];
            d.charge(part, loss);
            events.push(DamageEvent::Episode(EpisodeRecord {
                car,
                part: part as u8,
                other: e.other,
                other_owner: e.other_owner,
                impulse: e.impulse,
                closing_mps: e.closing,
                start_tick: e.start,
                last_tick: e.last,
                tick,
                damage: before - d.health[part],
                health: d.health[part],
            }));
            let now = d.state(part, t);
            if now != was {
                let instigator = e.other_owner.map(|o| o.car);
                events.push(match now {
                    super::PartState::Detached => DamageEvent::PartDetached {
                        car,
                        part: part as u8,
                        cause: e.other,
                        instigator,
                    },
                    _ => DamageEvent::PartLoose {
                        car,
                        part: part as u8,
                        cause: e.other,
                        instigator,
                    },
                });
            }
        }
        events
    }

    /// Folds the open episodes and prop owners into a state hash.
    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        for (k, e) in &self.open {
            out.extend(k.0.to_le_bytes());
            out.push(k.1);
            out.extend(e.impulse.to_bits().to_le_bytes());
            out.extend(e.start.to_le_bytes());
            if e.damage_impulse != e.impulse {
                out.extend(b"jj-contact-immunity-v1");
                out.push(k.2.0);
                out.extend(k.2.1.to_le_bytes());
                out.extend(e.damage_impulse.to_bits().to_le_bytes());
            }
        }
        for (p, o) in &self.prop_owner {
            out.extend(p.to_le_bytes());
            out.extend(o.car.to_le_bytes());
            out.extend(o.tick.to_le_bytes());
        }
        if !self.traps.is_empty() {
            out.extend(b"jj-traps-v1");
            for (p, (c, sprung)) in &self.traps {
                out.extend(p.to_le_bytes());
                out.extend(c.to_le_bytes());
                out.extend(sprung.unwrap_or(u64::MAX).to_le_bytes());
            }
        }
        if !self.struck.is_empty() {
            out.extend(b"jj-derby-struck-v1");
            for (c, o) in &self.struck {
                out.extend(c.to_le_bytes());
                out.extend(o.car.to_le_bytes());
                out.extend(o.tick.to_le_bytes());
            }
        }
    }
}

/// A contact on the core at `local` (vehicle space) belongs to the nearest other part within `margin` metres, else to
/// the core.
fn attribute_core(world: &PhysicsWorld, car: &CarParts<'_>, local: Vector, margin: f32) -> usize {
    let mut best = (margin, CORE);
    for part in 1..car.parts.len() {
        let Some(c) = car.parts.get(part).and_then(|&c| world.colliders.get(c)) else {
            continue;
        };
        let d = c.shape().distance_to_local_point(local, true);
        if d < best.0 {
            best = (d, part);
        }
    }
    best.1
}
