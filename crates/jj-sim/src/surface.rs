//! Ground surfaces beyond peak grip (R124, br-xlvx.1): what each ground class does to a tyre's slip curve and how hard
//! it drags on a rolling wheel. Data in `assets/surfaces/surfaces.json` (`jj.surfaces.v1`), checked by [`SurfaceTable::parse`];
//! the profile's `tuning.surfaces` keeps the per-car peak-grip multipliers.
//!
//! - **Slip curve:** Rapier's raycast tyre resolves a wheel's sideways velocity in full, then clamps it at
//!   `friction_slip × load`. `side_stiffness < 1` resolves only that share per tick, so on dirt the car runs wider and
//!   slides progressively instead of snapping to the grip limit.
//! - **Rolling drag:** per wheel in contact, a force opposing its rolling velocity (along the wheel, never sideways: slip is the tyre's job) of `load × (rolling_resistance +
//!   speed_drag × speed)`, applied once per tick as `force × dt` (never more than stops the wheel's share of the car).

use jj_map::model::Surface;
use serde::Deserialize;
use std::sync::OnceLock;

pub const SURFACES_JSON: &str = include_str!("../../../assets/surfaces/surfaces.json");

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceTyre {
    pub side_stiffness: f32,
    pub rolling_resistance: f32,
    pub speed_drag: f32,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceTable {
    pub schema: String,
    #[serde(default)]
    pub note: String,
    pub surfaces: Surfaces,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Surfaces {
    pub tarmac: SurfaceTyre,
    pub packed_dirt: SurfaceTyre,
    pub gravel: SurfaceTyre,
    pub rock: SurfaceTyre,
    pub off_track: SurfaceTyre,
}

impl SurfaceTable {
    /// Parse and validate a table: schema tag, every value finite, `side_stiffness` in (0, 1], drags non-negative.
    pub fn parse(json: &str) -> Result<Self, String> {
        let t: SurfaceTable = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if t.schema != "jj.surfaces.v1" {
            return Err(format!("schema {:?}, want jj.surfaces.v1", t.schema));
        }
        let s = &t.surfaces;
        for (name, v) in [
            ("tarmac", &s.tarmac),
            ("packed_dirt", &s.packed_dirt),
            ("gravel", &s.gravel),
            ("rock", &s.rock),
            ("off_track", &s.off_track),
        ] {
            if !(v.side_stiffness.is_finite() && v.side_stiffness > 0.0 && v.side_stiffness <= 1.0)
            {
                return Err(format!("{name}: side_stiffness must be in (0, 1]"));
            }
            for (k, x) in [
                ("rolling_resistance", v.rolling_resistance),
                ("speed_drag", v.speed_drag),
            ] {
                if !(x.is_finite() && x >= 0.0) {
                    return Err(format!("{name}: {k} must be finite and >= 0"));
                }
            }
        }
        Ok(t)
    }

    pub fn tyre(&self, surface: Surface) -> SurfaceTyre {
        let s = &self.surfaces;
        match surface {
            Surface::Tarmac => s.tarmac,
            Surface::PackedDirt => s.packed_dirt,
            Surface::Gravel => s.gravel,
            Surface::Rock => s.rock,
            Surface::OffTrack => s.off_track,
        }
    }
}

/// The built-in table (`assets/surfaces/surfaces.json`).
pub fn table() -> &'static SurfaceTable {
    static T: OnceLock<SurfaceTable> = OnceLock::new();
    T.get_or_init(|| SurfaceTable::parse(SURFACES_JSON).expect("assets/surfaces/surfaces.json"))
}

/// The snapshot/audio class of a ground surface: 0 tarmac, 1 dirt (packed dirt), 2 gravel (gravel, rock), 3 off track.
pub fn audio_class(surface: Surface) -> u8 {
    match surface {
        Surface::Tarmac => 0,
        Surface::PackedDirt => 1,
        Surface::Gravel | Surface::Rock => 2,
        Surface::OffTrack => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_table_validates_and_orders_by_drag() {
        let t = table();
        let crr = |s| t.tyre(s).rolling_resistance;
        assert!(crr(Surface::OffTrack) > crr(Surface::Gravel));
        assert!(crr(Surface::Gravel) > crr(Surface::PackedDirt));
        assert!(crr(Surface::PackedDirt) > crr(Surface::Tarmac));
        assert!(
            t.tyre(Surface::PackedDirt).side_stiffness < t.tyre(Surface::Tarmac).side_stiffness
        );
    }

    #[test]
    fn validator_rejects_bad_values() {
        let bad = SURFACES_JSON.replace("\"side_stiffness\": 0.5", "\"side_stiffness\": 1.4");
        assert!(SurfaceTable::parse(&bad).is_err());
        let bad = SURFACES_JSON.replace("jj.surfaces.v1", "x");
        assert!(SurfaceTable::parse(&bad).is_err());
    }
}
