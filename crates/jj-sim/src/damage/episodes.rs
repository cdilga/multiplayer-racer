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

use super::{CORE, CarDamage, DamageEvent, EpisodeRecord, OtherBody, Owner, PARTS};
use crate::profile::DamageTuning;
use crate::sim::TICK_HZ;

/// `RigidBody::user_data` tags: the high bits say what a body is, the low 32 which one.
pub const TAG_CAR: u128 = 1 << 32;
pub const TAG_PROP: u128 = 2 << 32;
const TAG_MASK: u128 = 0xffff_ffff << 32;

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
}

#[derive(Clone, Copy)]
struct Open {
    other: OtherBody,
    other_owner: Option<Owner>,
    impulse: f32,
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
}

impl Episodes {
    /// The causal owner of prop `prop` now.
    pub fn owner_of_prop(&self, prop: u32) -> Option<Owner> {
        self.prop_owner.get(&prop).copied()
    }

    /// Reads this step's contacts (call after `step`, with `tick` the counter after it) into the open episodes.
    pub(crate) fn scan(
        &mut self,
        world: &PhysicsWorld,
        pre: &PreStep,
        cars: &[CarParts<'_>],
        t: &DamageTuning,
        tick: u64,
    ) {
        for car in cars {
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
                            let part = if part == CORE {
                                attribute_core(world, car, local, t.attribution_margin_m)
                            } else {
                                part
                            };
                            self.add(car.car, part, kind, pt.data.impulse, closing, tick);
                        }
                    }
                }
            }
        }
    }

    fn add(
        &mut self,
        car: u32,
        part: usize,
        other: OtherBody,
        impulse: f32,
        closing: f32,
        tick: u64,
    ) {
        let key = (car, part as u8, other.key());
        let before = match other {
            OtherBody::Car { car } => Some(Owner { car, tick }),
            OtherBody::Prop { prop } => self.prop_owner.get(&prop).copied(),
            OtherBody::Scenery => None,
        };
        let e = self.open.entry(key).or_insert(Open {
            other,
            other_owner: before,
            impulse: 0.0,
            closing: 0.0,
            start: tick,
            last: tick,
        });
        e.impulse += impulse;
        e.closing = e.closing.max(closing);
        e.last = tick;
        // The car now owns what it hit: a prop it knocked into someone is its doing.
        if let OtherBody::Prop { prop } = other {
            self.prop_owner.insert(prop, Owner { car, tick });
        }
    }

    /// Closes the episodes whose window has run out at `tick`, charges their damage and returns what happened:
    /// each record, then any part that went loose or detached because of it.
    pub(crate) fn close(
        &mut self,
        tick: u64,
        t: &DamageTuning,
        damage: &mut [CarDamage],
    ) -> Vec<DamageEvent> {
        let window = (libm::roundf(t.window_ms * 0.001 * TICK_HZ as f32) as u64).max(1);
        let due: Vec<_> = self
            .open
            .iter()
            .filter(|(_, e)| tick + 1 >= e.start + window)
            .map(|(k, _)| *k)
            .collect();
        let mut events = Vec::new();
        for key in due {
            let Some(e) = self.open.remove(&key) else {
                continue;
            };
            let (car, part) = (key.0, key.1 as usize);
            let Some(d) = damage.get_mut(car as usize) else {
                continue;
            };
            let was = d.state(part, t);
            let loss = if was == super::PartState::Detached {
                0.0
            } else {
                CarDamage::k(part, t) * e.impulse
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
        }
        for (p, o) in &self.prop_owner {
            out.extend(p.to_le_bytes());
            out.extend(o.car.to_le_bytes());
            out.extend(o.tick.to_le_bytes());
        }
    }
}

/// A contact on the core at `local` (vehicle space) belongs to the nearest other part within `margin` metres, else to
/// the core.
fn attribute_core(world: &PhysicsWorld, car: &CarParts<'_>, local: Vector, margin: f32) -> usize {
    let mut best = (margin, CORE);
    for part in 1..PARTS {
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
