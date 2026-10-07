//! The ACTION stick's discrete utilities (P1-S08, plan §7.6): something to do with up and down before weapons exist.
//! Up fires the forward utility, an "OI!" flash (the headlights flash and a comic "OI!" pops over the car: a harmless
//! cue, rendered by the host from [`UtilityEvent::Oi`]); down drops a traffic cone behind the car, a light dynamic prop
//! that stays for the round like every other prop (R58) and can be pushed and driven over. jj-input decides what counts
//! as a deliberate sector entry (a cancelled touch fires nothing); the sim applies each one as a journaled command and
//! holds a per-car cooldown in game time. Cooldowns are rule cadences, not count caps: a car can drop any number of
//! cones over a round.

use serde::{Deserialize, Serialize};

use crate::sim::TICK_HZ;

/// Which utility: the ACTION stick's up (forward) or down (rear) sector.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UtilityKind {
    /// Up: the "OI!" flash.
    Forward,
    /// Down: drop a cone.
    Rear,
}

impl UtilityKind {
    pub fn index(self) -> usize {
        match self {
            Self::Forward => 0,
            Self::Rear => 1,
        }
    }
}

/// What an accepted utility did, for the host's cues and the scenario traces.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UtilityEvent {
    /// The "OI!" flash fired from `car`.
    Oi { car: u32 },
    /// `car` dropped a cone; `prop` is its index among the sim's props (the snapshot's debris records).
    Cone { car: u32, prop: u32 },
}

/// The rules (TUNE values; the owner's playtest decides them, plan §7.6 and Q-A3).
pub mod rules {
    /// Game time between two "OI!" flashes from one car, s.
    pub const OI_COOLDOWN_S: f32 = 0.5;
    /// Game time between two cones from one car, s.
    pub const CONE_COOLDOWN_S: f32 = 2.5;
    /// The cone's base lands this far behind the car's rear bumper, m.
    pub const CONE_BEHIND_M: f32 = 1.5;
    /// A weighted traffic cone: 0.7 m tall, 0.36 m across the base, 8 kg (a rubber-based road cone).
    pub const CONE_HALF_HEIGHT_M: f32 = 0.35;
    pub const CONE_RADIUS_M: f32 = 0.18;
    pub const CONE_MASS_KG: f32 = 8.0;
}

/// A cooldown in ticks.
pub fn cooldown_ticks(kind: UtilityKind) -> u64 {
    let s = match kind {
        UtilityKind::Forward => rules::OI_COOLDOWN_S,
        UtilityKind::Rear => rules::CONE_COOLDOWN_S,
    };
    libm::roundf(s * TICK_HZ as f32) as u64
}

/// The cone's density for its mass (a solid cone of the rules' size).
pub fn cone_density() -> f32 {
    let volume = core::f32::consts::PI
        * rules::CONE_RADIUS_M
        * rules::CONE_RADIUS_M
        * (2.0 * rules::CONE_HALF_HEIGHT_M)
        / 3.0;
    rules::CONE_MASS_KG / volume
}

/// What a prop is, for renderers: generic debris (map props and injected debris) or a dropped cone.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PropKind {
    #[default]
    Debris,
    Cone,
    /// A detached car part (P1-S04b): a dynamic debris body shaped like its sidecar proxy, listed in the debris records
    /// (so indices stay stable) and described by the snapshot's part records.
    Part,
}

impl PropKind {
    /// The snapshot's per-debris kind word.
    pub fn code(self) -> u32 {
        match self {
            Self::Debris => 0,
            Self::Cone => 1,
            Self::Part => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cooldowns_are_game_ticks() {
        assert_eq!(cooldown_ticks(UtilityKind::Forward), 60);
        assert_eq!(cooldown_ticks(UtilityKind::Rear), 300);
    }

    #[test]
    fn cone_density_gives_its_mass() {
        let volume = core::f32::consts::PI * 0.18 * 0.18 * 0.7 / 3.0;
        assert!((cone_density() * volume - rules::CONE_MASS_KG).abs() < 1e-3);
    }
}
