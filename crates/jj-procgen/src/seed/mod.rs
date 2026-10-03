//! Seeds and streams (P1-M03a). One seed is the recipe; each concern draws from its own named stream, so adding or
//! changing one stream (dressing, props…) never shifts another (the route). The canonical bytes, not the seed, are the
//! evidence: a seed only means the same map with the same generator version.
//!
//! RNG: xoshiro256** seeded through SplitMix64 from `seed ^ FNV-1a(stream name)`; integer maths only.

/// A named stream.
#[derive(Clone, Debug, PartialEq, Eq)]
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
    pub fn stream(seed: u64, name: &str) -> Self {
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

    /// Uniform in `[0, 1)` from the top 53 bits (exact in f64).
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform in `[lo, hi)`.
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
}

/// The streams one map uses. Structure shapes the route; dressing places pieces and props around it.
#[derive(Clone, Debug)]
pub struct Streams {
    pub seed: u64,
    pub structure: Rng,
    pub dressing: Rng,
}

impl Streams {
    pub fn new(seed: u64) -> Self {
        Self {
            seed,
            structure: Rng::stream(seed, "structure"),
            dressing: Rng::stream(seed, "dressing"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_are_reproducible_and_separate() {
        let (mut a, mut b) = (Streams::new(5), Streams::new(5));
        let xs: Vec<u64> = (0..6).map(|_| a.structure.next_u64()).collect();
        assert_eq!(
            xs,
            (0..6).map(|_| b.structure.next_u64()).collect::<Vec<_>>()
        );
        assert_ne!(
            xs,
            (0..6).map(|_| a.dressing.next_u64()).collect::<Vec<_>>()
        );
        let u = Rng::stream(1, "x").unit();
        assert!((0.0..1.0).contains(&u));
    }
}
