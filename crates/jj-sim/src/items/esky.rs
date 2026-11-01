//! The esky: a heavy box dropped behind the car as dynamic debris. It stays on the road for the round (debris persists).

/// Half extents of the box, m.
pub const HALF: [f32; 3] = [0.55, 0.38, 0.4];
/// Density, kg/m^3: about 170 kg, heavy enough to wreck a bumper and knock a car about. At 800 (535 kg, not the 280 kg
/// this once said) a car meeting it square at racing speed climbed it and was thrown 3 m into the air (br-8h3u.8,
/// crates/jj-sim/tests/item_contact.rs); at this weight the car shoves it aside, slowed and nudged.
pub const DENSITY: f32 = 250.0;
/// Dropped this far behind the rear bumper, m.
pub const BEHIND_M: f32 = 1.2;
/// Thrown backwards at this speed relative to the car, m/s.
pub const TOSS_MPS: f32 = 6.0;
/// The snapshot's debris kind word for an esky.
pub const SNAPSHOT_KIND: u32 = 10;
