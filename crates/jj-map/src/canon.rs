//! Canonical bytes: the postcard encoding of the map with every unordered collection sorted and the stored hash
//! cleared. The gameplay hash is SHA-256 of those bytes. Integers only, so no float formatting is involved and the
//! bytes are the same natively and in WASM.

use sha2::{Digest, Sha256};

use crate::model::Map;

/// The map with sorted collections (biomes deduplicated) and `gameplay_hash` cleared. Route points keep their order.
pub fn canonicalise(map: &Map) -> Map {
    let mut m = map.clone();
    m.header.gameplay_hash = None;
    m.header.biomes.sort();
    m.header.biomes.dedup();
    m.route.gates.sort();
    m.route.recovery.sort();
    m.route.segments.sort();
    m.features.sort();
    m.dressing.sort();
    m.props.sort();
    m
}

pub fn canonical_bytes(map: &Map) -> Vec<u8> {
    // Plain integers, strings, vectors and maps: postcard encoding into a Vec can't fail.
    postcard::to_allocvec(&canonicalise(map)).expect("postcard encodes maps")
}

pub fn gameplay_hash(map: &Map) -> [u8; 32] {
    let digest = Sha256::digest(canonical_bytes(map));
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
