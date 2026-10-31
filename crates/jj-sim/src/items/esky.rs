//! The esky: a heavy box dropped behind the car as dynamic debris. It stays on the road for the round (debris persists).

/// Half extents of the box, m.
pub const HALF: [f32; 3] = [0.55, 0.38, 0.4];
/// Density, kg/m^3: about 280 kg, heavy enough to wreck a bumper and knock a car about.
pub const DENSITY: f32 = 800.0;
/// Dropped this far behind the rear bumper, m.
pub const BEHIND_M: f32 = 1.2;
/// Thrown backwards at this speed relative to the car, m/s.
pub const TOSS_MPS: f32 = 6.0;
/// The snapshot's debris kind word for an esky.
pub const SNAPSHOT_KIND: u32 = 10;
