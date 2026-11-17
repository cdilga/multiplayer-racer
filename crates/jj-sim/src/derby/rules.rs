//! The derby's hit rules as data (assets/profiles/derby.json): who pays for a hit. See the profile's `what`.

use serde::{Deserialize, Serialize};

use crate::sim::TICK_HZ;

pub const DERBY_JSON: &str = include_str!("../../../../assets/profiles/derby.json");
const CONTRACT: &str = "jj-derby/1";

/// assets/profiles/derby.json.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerbyRules {
    pub contract: String,
    #[serde(default)]
    pub what: String,
    /// The share of its own damage a car keeps when the whole closing speed was its own (0..1).
    pub striker_take: f32,
    /// The share of damage from scenery and from junk nobody threw (0..1).
    pub junk_take: f32,
    /// A wall or junk hit this soon after another car struck this car is that car's, s.
    pub shove_window_s: f32,
    /// Floor area per item box, m^2.
    pub box_area_m2: f32,
    /// A taken box's recharge, s.
    pub box_recharge_s: f32,
    /// Whether a fresh car (the start and every respawn) is handed one item.
    pub spawn_item: bool,
}

impl DerbyRules {
    /// The shipped rules.
    pub fn standard() -> Self {
        let p: Self = serde_json::from_str(DERBY_JSON).expect("assets/profiles/derby.json parses");
        assert_eq!(p.contract, CONTRACT, "derby.json contract");
        assert!(
            (0.0..=1.0).contains(&p.striker_take) && (0.0..=1.0).contains(&p.junk_take),
            "derby.json shares are 0..1"
        );
        assert!(p.box_area_m2 > 0.0 && p.box_recharge_s >= 0.0 && p.shove_window_s >= 0.0);
        p
    }

    pub fn shove_ticks(&self) -> u64 {
        libm::roundf(self.shove_window_s * TICK_HZ as f32) as u64
    }

    pub fn box_recharge_ticks(&self) -> u64 {
        libm::roundf(self.box_recharge_s * TICK_HZ as f32) as u64
    }

    /// What a car keeps of a car-on-car contact's damage when `share` (0..1) of the closing speed was its own.
    pub fn striker_scale(&self, share: f32) -> f32 {
        1.0 - (1.0 - self.striker_take) * share.clamp(0.0, 1.0)
    }
}
