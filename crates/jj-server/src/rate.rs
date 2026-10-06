//! Token buckets for abuse limits (plan §5.1, R66): rates, never player caps. A limited call gets
//! `429 {retryAfterMs}` and succeeds after waiting; nothing is ever refused permanently.

use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rate {
    pub burst: u32,
    /// Milliseconds per refilled token.
    pub refill_ms: u64,
}

/// Room creation per client IP: burst 10, then 1 per 10 s.
pub const ROOM_CREATE: Rate = Rate {
    burst: 10,
    refill_ms: 10_000,
};
/// Endpoint registration per client IP: burst 64, then 4 per s.
pub const ENDPOINT_REGISTER: Rate = Rate {
    burst: 64,
    refill_ms: 250,
};
/// Signalling `POST`s per endpoint: burst 64, then 20 per s.
pub const SIGNAL_POST: Rate = Rate {
    burst: 64,
    refill_ms: 50,
};

#[derive(Clone, Copy, Debug)]
struct Bucket {
    /// Tokens scaled by `refill_ms` so refills stay exact integers.
    milli: u64,
    at_ms: u64,
}

/// Buckets keyed by IP or endpoint. Idle full buckets are dropped (a lifetime, not a count).
pub struct Limiter {
    rate: Rate,
    buckets: HashMap<String, Bucket>,
}

impl Limiter {
    pub fn new(rate: Rate) -> Self {
        Self {
            rate,
            buckets: HashMap::new(),
        }
    }

    /// Takes a token, or says how long until one is available.
    pub fn take(&mut self, key: &str, now_ms: u64) -> Result<(), u64> {
        let full = u64::from(self.rate.burst) * self.rate.refill_ms;
        let b = self.buckets.entry(key.to_owned()).or_insert(Bucket {
            milli: full,
            at_ms: now_ms,
        });
        b.milli = (b.milli + now_ms.saturating_sub(b.at_ms)).min(full);
        b.at_ms = now_ms;
        if b.milli >= self.rate.refill_ms {
            b.milli -= self.rate.refill_ms;
            Ok(())
        } else {
            Err(self.rate.refill_ms - b.milli)
        }
    }

    /// Drops buckets that have refilled completely.
    pub fn prune(&mut self, now_ms: u64) {
        let full = u64::from(self.rate.burst) * self.rate.refill_ms;
        self.buckets
            .retain(|_, b| b.milli + now_ms.saturating_sub(b.at_ms) < full);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_rate_then_recovers() {
        let mut l = Limiter::new(ROOM_CREATE);
        for _ in 0..10 {
            l.take("ip", 0).unwrap();
        }
        assert_eq!(l.take("ip", 0), Err(10_000));
        assert_eq!(l.take("ip", 4_000), Err(6_000));
        l.take("ip", 10_000).unwrap();
        l.prune(1_000_000);
        assert!(l.buckets.is_empty());
    }

    #[test]
    fn hundred_registrations_from_one_ip_all_succeed_within_the_rate() {
        let mut l = Limiter::new(ENDPOINT_REGISTER);
        let mut now = 0;
        let mut ok = 0;
        while ok < 100 {
            match l.take("party", now) {
                Ok(()) => ok += 1,
                Err(wait) => now += wait,
            }
        }
        // 64 at once, then 36 more at 4/s: nine seconds.
        assert_eq!(now, 9_000);
    }
}
