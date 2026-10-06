//! Hashes, HMACs and random secrets. The server stores only SHA-256 hashes of secrets (plan §5.1).

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

pub fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// `base64url(SHA-256(secret))`: how clients send `hostSecretHash`/`endpointSecretHash`.
pub fn secret_hash(secret: &str) -> String {
    b64url(&Sha256::digest(secret.as_bytes()))
}

pub fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("HMAC takes any key length");
    for p in parts {
        mac.update(p);
    }
    mac.finalize().into_bytes().to_vec()
}

pub fn hmac_sha1(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac =
        <Hmac<sha1::Sha1> as KeyInit>::new_from_slice(key).expect("HMAC takes any key length");
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}

/// Constant-time equality for secrets and tickets.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Randomness for room ids and codes. Tests use a seeded source so runs replay.
pub trait Entropy: Send {
    fn fill(&mut self, buf: &mut [u8]);
    fn next_u32(&mut self) -> u32 {
        let mut b = [0u8; 4];
        self.fill(&mut b);
        u32::from_le_bytes(b)
    }
}

/// The OS generator.
pub struct OsEntropy;

impl Entropy for OsEntropy {
    fn fill(&mut self, buf: &mut [u8]) {
        getrandom::fill(buf).expect("the OS random source is available");
    }
}

/// A seeded SplitMix64 for tests.
pub struct SeededEntropy(pub u64);

impl Entropy for SeededEntropy {
    fn fill(&mut self, buf: &mut [u8]) {
        for chunk in buf.chunks_mut(8) {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^= z >> 31;
            chunk.copy_from_slice(&z.to_le_bytes()[..chunk.len()]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_hash_is_base64url_sha256() {
        // SHA-256("abc"), base64url without padding.
        assert_eq!(
            secret_hash("abc"),
            "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
    }

    #[test]
    fn hmac_sha256_matches_rfc4231_case_2() {
        let mac = hmac_sha256(b"Jefe", &[b"what do ya want ", b"for nothing?"]);
        assert_eq!(
            mac.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn ct_eq_compares() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"ab"));
    }
}
