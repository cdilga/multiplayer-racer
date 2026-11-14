//! br-8h3u.7: different seeds must not collapse onto the same course. A sweep of 50 consecutive seeds (the shape of a
//! session: seed + preparation id) gives 50 distinct gameplay hashes and 50 distinct canonical maps.

use std::collections::BTreeSet;

use jj_map::{canonical_bytes, gameplay_hash, hex};
use jj_procgen::generate;

#[test]
fn fifty_consecutive_seeds_give_fifty_distinct_courses() {
    let mut hashes = BTreeSet::new();
    let mut bytes = BTreeSet::new();
    for seed in 1000..1050u64 {
        let map = generate(seed);
        assert!(
            hashes.insert(hex(&gameplay_hash(&map))),
            "seed {seed} repeats an earlier course's gameplay hash"
        );
        assert!(
            bytes.insert(canonical_bytes(&map)),
            "seed {seed} repeats an earlier course's canonical bytes"
        );
    }
    assert_eq!(hashes.len(), 50);
}
