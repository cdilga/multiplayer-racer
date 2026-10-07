//! Part health and damage episodes (P1-S04a, plan §6.3, R86): every part of a car is its own collider on the chassis
//! body, so a contact's collider names the part. Contacts that close fast enough aggregate over a short game-time
//! window per (car, part, other body) into an **episode**; an episode turns its summed normal impulse into health loss
//! (`damage = k × Σ impulse`). A part goes intact → loose (health at or below half) → detached (health 0), and this
//! module only records that *state*: springs, detaching and debris are S04b, wrecks S04c. No dents.
//!
//! Part indices follow the vehicle contract's order (`jj_contracts::vehicle::PARTS`): `core`, `front`, `back`, the four
//! doors (FL, FR, RL, RR), the four wheels (FL, FR, RL, RR). `core` has a collider but no health.

pub mod episodes;
pub mod springs;

use serde::{Deserialize, Serialize};

use crate::profile::DamageTuning;

/// The contract's part names, in index order.
pub const PART_NAMES: [&str; PARTS] = [
    "core", "front", "back", "door_FL", "door_FR", "door_RL", "door_RR", "wheel_FL", "wheel_FR",
    "wheel_RL", "wheel_RR",
];
pub const PARTS: usize = 11;
pub const CORE: usize = 0;
pub const FRONT: usize = 1;
pub const BACK: usize = 2;
/// The first door and the first wheel.
pub const DOOR_FL: usize = 3;
pub const WHEEL_FL: usize = 7;

/// The part named `name` (`front`, `door_FL`…).
pub fn part_index(name: &str) -> Option<usize> {
    PART_NAMES.iter().position(|&n| n == name)
}

pub fn is_wheel(part: usize) -> bool {
    part >= WHEEL_FL
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PartState {
    Intact,
    /// Health at or below `loose_fraction` of its start: still attached (the swing is S04b).
    Loose,
    /// Health 0.
    Detached,
}

impl PartState {
    pub fn name(self) -> &'static str {
        match self {
            Self::Intact => "intact",
            Self::Loose => "loose",
            Self::Detached => "detached",
        }
    }
}

/// What a car's part hit, for the wire's cause and the instigator's attribution.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OtherBody {
    /// Another car's chassis (any of its parts).
    Car { car: u32 },
    /// A dynamic prop or debris body (its index in the sim's props).
    Prop { prop: u32 },
    /// Static scenery, barriers, buildings and the ground.
    Scenery,
}

impl OtherBody {
    /// The key that orders and distinguishes other bodies inside an episode key.
    fn key(self) -> (u8, u32) {
        match self {
            Self::Car { car } => (0, car),
            Self::Prop { prop } => (1, prop),
            Self::Scenery => (2, 0),
        }
    }
}

/// The car that last put a qualifying impulse into a body, and when (the causal owner, for S10/W02 attribution).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owner {
    pub car: u32,
    pub tick: u64,
}

/// One finished episode: a part took a window's worth of qualifying impulse from one other body.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeRecord {
    pub car: u32,
    /// The part's index (see [`PART_NAMES`]).
    pub part: u8,
    pub other: OtherBody,
    /// The other body's causal owner: the car itself for a car, the car that last hit it for a prop, none for scenery.
    pub other_owner: Option<Owner>,
    /// Σ of the normal impulses counted in the window, N·s.
    pub impulse: f32,
    /// The fastest closing speed among the counted contacts, m/s.
    pub closing_mps: f32,
    /// The first and the last tick a qualifying impulse landed in the window (the tick counter after that step).
    pub start_tick: u64,
    pub last_tick: u64,
    /// The tick the window closed and the health was charged.
    pub tick: u64,
    /// Health lost to this episode, and the part's health after it.
    pub damage: f32,
    pub health: f32,
}

/// What changed in a car's part states, with the cause (what it hit) and the instigator (the causal owner's car).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum DamageEvent {
    Episode(EpisodeRecord),
    PartLoose {
        car: u32,
        part: u8,
        cause: OtherBody,
        instigator: Option<u32>,
    },
    PartDetached {
        car: u32,
        part: u8,
        cause: OtherBody,
        instigator: Option<u32>,
    },
}

/// A car's part health.
#[derive(Clone, Debug, PartialEq)]
pub struct CarDamage {
    pub health: [f32; PARTS],
    pub start: [f32; PARTS],
}

impl CarDamage {
    pub fn new(t: &DamageTuning) -> Self {
        let mut start = [0.0; PARTS];
        for (i, s) in start.iter_mut().enumerate() {
            *s = match i {
                CORE => 0.0,
                FRONT => t.health_front,
                BACK => t.health_back,
                i if is_wheel(i) => t.health_wheel,
                _ => t.health_door,
            };
        }
        Self {
            health: start,
            start,
        }
    }

    /// The part's state now (the core is always intact: it has no health).
    pub fn state(&self, part: usize, t: &DamageTuning) -> PartState {
        if part == CORE {
            PartState::Intact
        } else if self.health[part] <= 0.0 {
            PartState::Detached
        } else if self.health[part] <= self.start[part] * t.loose_fraction {
            PartState::Loose
        } else {
            PartState::Intact
        }
    }

    /// Every part's state, in index order.
    pub fn states(&self, t: &DamageTuning) -> [PartState; PARTS] {
        std::array::from_fn(|i| self.state(i, t))
    }

    /// The damage constant for `part`.
    pub fn k(part: usize, t: &DamageTuning) -> f32 {
        match part {
            CORE => 0.0,
            FRONT => t.k_front,
            BACK => t.k_back,
            i if is_wheel(i) => t.k_wheel,
            _ => t.k_door,
        }
    }

    /// Charges `damage` to `part` (never below 0).
    pub fn charge(&mut self, part: usize, damage: f32) {
        self.health[part] = (self.health[part] - damage).max(0.0);
    }

    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        for h in self.health {
            out.extend(h.to_bits().to_le_bytes());
        }
    }
}
