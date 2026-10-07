//! The applied-tick input journal (plan §7.2): the one sim funnel. Phones, pads, keys, autopilot, test bots and replays
//! all enter as inputs applied at a tick, and nothing changes sim state except journaled setup commands, so a journal
//! plus the map's canonical bytes reproduces a session's full-state hash exactly.

use serde::{Deserialize, Serialize};

/// One car's controls for a tick, quantised like the wire (`jj_types::axis`): throttle and steer −32767..32767,
/// brake 0..32767, and the ACTION stick's held sectors (§7.3): left is the handbrake drift, right is boost.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DriveInput {
    pub throttle: i16,
    pub steer: i16,
    pub brake: i16,
    #[serde(default)]
    pub drift: bool,
    #[serde(default)]
    pub boost: bool,
}

impl DriveInput {
    pub fn is_neutral(&self) -> bool {
        *self == Self::default()
    }

    /// From a source's interpreted sticks (jj-input's `SourceSemantics`): throttle and brake 0..1, steer −1 left ..
    /// +1 right. The sim's positive steer turns left, so steering flips here, in the one place the host and fixtures
    /// share.
    pub fn from_semantics(
        throttle: f32,
        steer_right: f32,
        brake: f32,
        drift: bool,
        boost: bool,
    ) -> Self {
        use jj_types::axis::quantise_axis;
        Self {
            throttle: quantise_axis(throttle),
            steer: quantise_axis(-steer_right),
            brake: quantise_axis(brake),
            drift,
            boost,
        }
    }
}

/// A spawn pose: position (m) and heading (rad about +y, 0 = +z forward, counter-clockwise seen from above).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpawnPose {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub heading: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Setup {
    SpawnCar {
        car: u32,
        pose: SpawnPose,
    },
    /// Teleports a car with a velocity, stopping its spin (scenario setup, P1-F05a). Journaled like every setup command,
    /// so a run that places cars still replays. `roll` turns it about its own forward axis (radians; π = on its roof).
    PlaceCar {
        car: u32,
        pose: SpawnPose,
        roll: f32,
        linvel: [f32; 3],
    },
    /// The race starts (countdown completion, P1-S05): progress counts from this tick.
    StartRace {
        laps: u32,
    },
    /// A player's Recover button (P1-S05); refused unless the car qualifies.
    Recover {
        car: u32,
    },
    /// A seat joining mid-round (P1-S06): the placement service picks the pose and gate state, deterministically.
    DropIn,
    /// A wheelie release (P1-S03c, R64): jj-input's validated gesture with its preload; refused unless 3 wheels are
    /// down.
    Wheelie {
        car: u32,
        preload_ms: u16,
    },
    /// The autopilot takes a car (`on`) or hands it back to its player (P1-S07; the session decides when, G03).
    Autopilot {
        car: u32,
        on: bool,
    },
    /// A dynamic debris body (a cuboid with these half extents, m), for scenarios before damage makes real debris.
    SpawnDebris {
        pose: SpawnPose,
        half: [f32; 3],
    },
    /// A discrete ACTION utility (P1-S08): jj-input's deliberate sector entry, up ("OI!") or down (drop a cone).
    /// Refused while the car's cooldown runs or the car is held.
    Utility {
        car: u32,
        kind: crate::utility::UtilityKind,
    },
    /// Sets a part's health (scenario setup, R90 "settable", P1-S04b): the damage state without a crash. Clamped to
    /// 0..its starting health; the next tick's state change follows from it like any other.
    PartHealth {
        car: u32,
        part: u8,
        health: f32,
    },
    /// Wrecks a car now, as the stuck-flip rule would (scenario setup, R90 "settable", P1-S04c): its husk stays, its parts
    /// pop off, and it respawns at its anchor after the hold. Refused during a hold or for a finished car.
    Wreck {
        car: u32,
    },
    /// Ends the race now as the finish window closing would (scenario setup, R90 "settable"): the result freezes with the
    /// running order, unfinished cars ranked by legal progress, and the race rules emit `RaceOver`. Refused before the
    /// start or once the race is over.
    EndRace,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// The tick the input is applied at (before that tick's step).
    pub tick: u64,
    pub car: u32,
    pub input: DriveInput,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Journal {
    pub seed: u64,
    /// SHA-256 of the map's canonical bytes (`jj_map::LoadedMap::hash`).
    pub map_hash: [u8; 32],
    pub setup: Vec<(u64, Setup)>,
    pub entries: Vec<Entry>,
}

impl Journal {
    pub fn to_bytes(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("journals encode")
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, postcard::Error> {
        postcard::from_bytes(bytes)
    }
}
