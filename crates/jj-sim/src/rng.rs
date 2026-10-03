//! Seeded RNG streams (plan §7.2): xoshiro256** seeded through SplitMix64 from the session seed and a stream name, so
//! each consumer (spawn jitter, items, debris…) draws from its own stream and adding one never shifts another. Integer
//! maths only: identical on every target.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rng {
    s: [u64; 4],
}

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

impl Rng {
    /// The stream `name` of session `seed`.
    pub fn stream(seed: u64, name: &str) -> Self {
        // FNV-1a of the name, folded into the seed.
        let h = name.bytes().fold(0xCBF2_9CE4_8422_2325u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01B3)
        });
        let mut st = seed ^ h;
        Self {
            s: [
                splitmix(&mut st),
                splitmix(&mut st),
                splitmix(&mut st),
                splitmix(&mut st),
            ],
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform in `[0, 1)` from the top 24 bits.
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    pub fn state(&self) -> [u64; 4] {
        self.s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_are_reproducible_and_independent() {
        let mut a = Rng::stream(42, "spawn");
        let mut b = Rng::stream(42, "spawn");
        let mut c = Rng::stream(42, "items");
        let xs: Vec<u64> = (0..8).map(|_| a.next_u64()).collect();
        assert_eq!(xs, (0..8).map(|_| b.next_u64()).collect::<Vec<_>>());
        assert_ne!(xs, (0..8).map(|_| c.next_u64()).collect::<Vec<_>>());
        let f = Rng::stream(7, "x").next_f32();
        assert!((0.0..1.0).contains(&f));
    }
}
