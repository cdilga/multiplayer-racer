//! P1-M03a: seeds are recipes, canonical bytes are the evidence. The same seed gives the same bytes (and the committed
//! golden hashes, which `wasm_parity.rs` checks in WASM too); changing only the dressing stream never moves the route;
//! generated maps pass the `jj-map` validator. Re-bless the goldens after an intended generator change with
//! `JJ_BLESS=1 cargo test -p jj-procgen --test procgen` (and bump `GENERATOR_VERSION`).

use jj_map::{canonical_bytes, gameplay_hash, hex, validate};
use jj_procgen::seed::{Rng, Streams};
use jj_procgen::{generate, generate_from};

const GOLDENS: &str = include_str!("goldens/seeds.txt");
/// The seeds pinned in the goldens: a sample, not a limit.
const GOLDEN_SEEDS: [u64; 8] = [0, 1, 2, 3, 42, 1_000_003, 0xDEAD_BEEF, u64::MAX];

#[test]
fn the_same_seed_gives_identical_canonical_bytes() {
    for seed in GOLDEN_SEEDS {
        assert_eq!(
            canonical_bytes(&generate(seed)),
            canonical_bytes(&generate(seed)),
            "seed {seed}"
        );
    }
    assert_ne!(canonical_bytes(&generate(1)), canonical_bytes(&generate(2)));
}

#[test]
fn seeds_hash_to_the_committed_goldens() {
    let actual: String = GOLDEN_SEEDS
        .iter()
        .map(|&s| format!("{s} {}\n", hex(&gameplay_hash(&generate(s)))))
        .collect();
    if std::env::var_os("JJ_BLESS").is_some() {
        std::fs::write(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/goldens/seeds.txt"),
            &actual,
        )
        .unwrap();
        return;
    }
    assert_eq!(
        GOLDENS, actual,
        "the generator's output changed: bump GENERATOR_VERSION and re-bless (JJ_BLESS=1)"
    );
}

#[test]
fn generated_maps_pass_the_validator() {
    let registry = jj_procgen::registry();
    for seed in (0..64).chain(GOLDEN_SEEDS) {
        let map = generate(seed);
        let report = validate(&map, &registry);
        assert!(report.ok, "seed {seed}: {:?}", report.violations);
        assert!(map.route.gates.iter().any(|g| g.finish) && map.route.gates.len() >= 3);
        assert!(!map.dressing.is_empty() && !map.props.is_empty());
    }
}

#[test]
fn changing_only_the_dressing_stream_never_moves_the_route() {
    for seed in (0..32).chain(GOLDEN_SEEDS) {
        let base = generate(seed);
        for other in [seed.wrapping_add(1), seed ^ 0x5555_5555_5555_5555, !seed] {
            let mut st = Streams::new(seed);
            st.dressing = Rng::stream(other, "dressing");
            let swapped = generate_from(st).0;
            assert_eq!(
                swapped.route, base.route,
                "seed {seed}: the route moved when only the dressing stream changed"
            );
            assert_eq!(swapped.header.ref_lap_ms, base.header.ref_lap_ms);
            assert_ne!(
                swapped.dressing, base.dressing,
                "seed {seed}: the swapped stream should redress the map"
            );
            assert!(validate(&swapped, &jj_procgen::registry()).ok);
        }
    }
}

#[test]
fn changing_the_structure_stream_does_move_the_route() {
    let mut st = Streams::new(7);
    st.structure = Rng::stream(8, "structure");
    assert_ne!(generate_from(st).0.route, generate(7).route);
}
