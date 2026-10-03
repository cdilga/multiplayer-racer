//! Clock-offset estimate between two monotonic clocks, with ±RTT/2 uncertainty (plan §5.4, input age).
//!
//! The `cmd` channel carries `Ping{t}`/`Pong{t, hostT}` on connect and every 5 s. Input age is reported from this
//! estimate **with its uncertainty**, never by comparing unsynchronised clocks directly.
//!
//! `offset = remote clock − local clock`. Two ways to feed a sample:
//! - [`ClockOffsetEstimator::add_round_trip`]: the side that pinged knows its send and receive times and the peer's
//!   stamp in between: `offset = remote − (send + recv) / 2`, uncertainty `rtt / 2`, exact bound whatever the path
//!   asymmetry (the error is half the difference of the two one-way delays).
//! - [`ClockOffsetEstimator::add_one_way`]: the other side saw a peer stamp arrive and knows the round trip from
//!   elsewhere (WebRTC's `currentRoundTripTime`, or the peer's own Ping/Pong): the one-way delay lies in `0..=rtt`, so
//!   `offset = remote − recv + rtt / 2`, uncertainty `rtt / 2`.
//!
//! The estimate is the minimum-RTT sample of a sliding window: the tightest bound wins, and the window lets a drifting
//! or re-routed connection move on.

use std::collections::VecDeque;

/// An offset and its uncertainty, in ms. The true offset lies in `offset_ms ± uncertainty_ms`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OffsetEstimate {
    pub offset_ms: f64,
    pub uncertainty_ms: f64,
    pub rtt_ms: f64,
}

impl OffsetEstimate {
    /// The local time of a remote stamp, with the same uncertainty.
    pub fn to_local(&self, remote_ms: f64) -> f64 {
        remote_ms - self.offset_ms
    }
}

/// Keeps the best recent sample per endpoint.
#[derive(Clone, Debug)]
pub struct ClockOffsetEstimator {
    window: usize,
    samples: VecDeque<OffsetEstimate>,
}

impl Default for ClockOffsetEstimator {
    fn default() -> Self {
        Self::new(Self::DEFAULT_WINDOW)
    }
}

impl ClockOffsetEstimator {
    /// A minute of 5 s pings.
    pub const DEFAULT_WINDOW: usize = 12;

    pub fn new(window: usize) -> Self {
        Self {
            window: window.max(1),
            samples: VecDeque::new(),
        }
    }

    /// The pinging side: sent at `local_send`, the peer stamped `remote`, the reply arrived at `local_recv` (ms, full
    /// width: unwrap wire stamps with `jj_types::time` first). A reply that arrived before it was sent is ignored.
    pub fn add_round_trip(
        &mut self,
        local_send: u64,
        remote: u64,
        local_recv: u64,
    ) -> Option<OffsetEstimate> {
        let rtt = local_recv.checked_sub(local_send)? as f64;
        let mid = local_send as f64 + rtt / 2.0;
        Some(self.push(OffsetEstimate {
            offset_ms: remote as f64 - mid,
            uncertainty_ms: rtt / 2.0,
            rtt_ms: rtt,
        }))
    }

    /// The receiving side: a peer stamp `remote_send` arrived at `local_recv`, and the round trip is known to be
    /// `rtt_ms` (≥ 0). Negative or non-finite round trips are ignored.
    pub fn add_one_way(
        &mut self,
        remote_send: u64,
        local_recv: u64,
        rtt_ms: f64,
    ) -> Option<OffsetEstimate> {
        if !(rtt_ms.is_finite() && rtt_ms >= 0.0) {
            return None;
        }
        let offset = remote_send as f64 - local_recv as f64 + rtt_ms / 2.0;
        Some(self.push(OffsetEstimate {
            offset_ms: offset,
            uncertainty_ms: rtt_ms / 2.0,
            rtt_ms,
        }))
    }

    /// The tightest sample in the window, or `None` before the first.
    pub fn estimate(&self) -> Option<OffsetEstimate> {
        self.samples
            .iter()
            .copied()
            .min_by(|a, b| a.rtt_ms.total_cmp(&b.rtt_ms))
    }

    fn push(&mut self, s: OffsetEstimate) -> OffsetEstimate {
        if self.samples.len() == self.window {
            self.samples.pop_front();
        }
        self.samples.push_back(s);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Local clock at 0 when the remote clock reads `offset`; one-way delays `up` (local → remote) and `down`.
    fn ping(
        est: &mut ClockOffsetEstimator,
        offset: i64,
        at: u64,
        up: u64,
        down: u64,
    ) -> OffsetEstimate {
        let remote = (at as i64 + up as i64 + offset) as u64;
        est.add_round_trip(at, remote, at + up + down).unwrap()
    }

    #[test]
    fn recovers_a_known_offset_within_its_uncertainty() {
        let mut est = ClockOffsetEstimator::default();
        // A noisy, asymmetric path: the min-RTT sample bounds the error tightest.
        for (k, (up, down)) in [(40, 12), (9, 31), (6, 7), (55, 20), (18, 18)]
            .into_iter()
            .enumerate()
        {
            ping(&mut est, 123_456, 10_000 + k as u64 * 5_000, up, down);
        }
        let e = est.estimate().unwrap();
        assert_eq!(e.rtt_ms, 13.0, "the tightest round trip");
        assert!((e.offset_ms - 123_456.0).abs() <= e.uncertainty_ms, "{e:?}");
        assert!(
            (e.offset_ms - 123_456.0).abs() <= 0.5 + 1e-9,
            "6 up / 7 down: off by half the asymmetry"
        );
    }

    #[test]
    fn one_way_samples_bound_the_offset_too() {
        let mut est = ClockOffsetEstimator::default();
        // The peer stamped 500_000 on its clock (offset +300_000 from ours); it took 9 ms to arrive on a 20 ms RTT path.
        let e = est.add_one_way(500_000, 200_009, 20.0).unwrap();
        assert!((e.offset_ms - 300_000.0).abs() <= e.uncertainty_ms, "{e:?}");
        assert!(est.add_one_way(1, 2, -1.0).is_none() && est.add_one_way(1, 2, f64::NAN).is_none());
        assert!(
            est.add_round_trip(10, 5, 9).is_none(),
            "a reply before its ping is ignored"
        );
    }

    #[test]
    fn the_window_lets_old_tight_samples_go() {
        let mut est = ClockOffsetEstimator::new(3);
        ping(&mut est, 1_000, 0, 1, 1);
        for k in 1..=3 {
            ping(&mut est, 2_000, k * 5_000, 10, 10);
        }
        let e = est.estimate().unwrap();
        assert_eq!(
            e.offset_ms, 2_000.0,
            "the route changed; the 2 ms sample from the old one has left the window"
        );
    }

    proptest! {
        #[test]
        fn the_true_offset_is_always_inside_the_bound(
            offset in -10_000_000i64..10_000_000,
            pings in proptest::collection::vec((0u64..400, 0u64..400), 1..20),
        ) {
            let mut est = ClockOffsetEstimator::default();
            for (k, (up, down)) in pings.into_iter().enumerate() {
                let s = ping(&mut est, offset, 20_000_000 + k as u64 * 5_000, up, down);
                prop_assert!((s.offset_ms - offset as f64).abs() <= s.uncertainty_ms + 1e-9);
            }
            let e = est.estimate().unwrap();
            prop_assert!((e.offset_ms - offset as f64).abs() <= e.uncertainty_ms + 1e-9);
        }

        #[test]
        fn one_way_bound_holds_for_any_delay_inside_the_round_trip(
            offset in -10_000_000i64..10_000_000, rtt in 0u64..800, frac in 0.0f64..=1.0,
        ) {
            let owd = (rtt as f64 * frac).floor() as u64;
            let peer_send_local = 50_000_000u64;
            let mut est = ClockOffsetEstimator::default();
            let e = est.add_one_way((peer_send_local as i64 + offset) as u64, peer_send_local + owd, rtt as f64).unwrap();
            prop_assert!((e.offset_ms - offset as f64).abs() <= e.uncertainty_ms + 1e-9);
        }
    }
}
