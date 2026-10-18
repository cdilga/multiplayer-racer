//! Share codes for kept tracks (br-m1xe, R125). A generated track is its generator version, its seed and its recipe (the
//! biome list; empty is the seed's own mix): the same three regenerate it byte for byte. The code carries them in a few
//! groups of Crockford base32 with a check character, e.g. `T30-4K9C-2M7Q-X1HB-G`, and a code from another generator
//! version is refused by name: that version can't be rebuilt here.
//!
//! Layout before base32: the version (u16 big-endian), the seed as a LEB128 varint, then one byte per biome (its index in
//! [`BIOMES`]); the check character is the sum of those bytes mod 32.

use jj_map::Biome;

/// Biomes in code order. Append only: a biome's index is part of every code that names it.
pub const BIOMES: [Biome; 5] = [
    Biome::Greybox,
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareTrack {
    pub version: u16,
    pub seed: u64,
    pub recipe: Vec<Biome>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShareError {
    /// Not a share code at all (wrong characters or too short).
    Malformed,
    /// A character was mistyped: the check doesn't match.
    Check,
    /// Made with another generator version, which this build can't rebuild.
    Version { code: u16, ours: u16 },
}

impl std::fmt::Display for ShareError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ShareError::Malformed => write!(f, "that isn't a track code"),
            ShareError::Check => write!(f, "that code has a typo in it"),
            ShareError::Version { code, ours } => write!(
                f,
                "that track was made by track generator {code}; this game builds tracks with generator {ours} and can't rebuild it exactly"
            ),
        }
    }
}

/// This build's generator version as a number.
pub fn our_version() -> u16 {
    jj_procgen::GENERATOR_VERSION
        .parse()
        .expect("GENERATOR_VERSION is a number")
}

/// The code for a track this build generates.
pub fn encode(seed: u64, recipe: &[Biome]) -> String {
    let mut bytes = our_version().to_be_bytes().to_vec();
    let mut s = seed;
    loop {
        let b = (s & 0x7f) as u8;
        s >>= 7;
        bytes.push(if s == 0 { b } else { b | 0x80 });
        if s == 0 {
            break;
        }
    }
    for b in recipe {
        bytes.push(BIOMES.iter().position(|x| x == b).expect("a known biome") as u8);
    }
    let check = ALPHABET[(bytes.iter().map(|&b| u32::from(b)).sum::<u32>() % 32) as usize] as char;
    // Base32 the bytes (5 bits a character), then group in fours after a "T<version>" lead for people to read out.
    let mut chars = String::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for &b in &bytes[2..] {
        acc = (acc << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            chars.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        chars.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char);
    }
    let groups: Vec<String> = chars
        .as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8(c.to_vec()).unwrap())
        .collect();
    format!("T{}-{}-{check}", our_version(), groups.join("-"))
}

/// Reads a code (case, spaces and dashes don't matter; O and I read as 0 and 1).
pub fn decode(code: &str) -> Result<ShareTrack, ShareError> {
    let code = code.trim().to_ascii_uppercase();
    let rest = code.strip_prefix('T').ok_or(ShareError::Malformed)?;
    // The version runs to the first separator (a dash or a space).
    let (version, body) = rest.split_once(['-', ' ']).ok_or(ShareError::Malformed)?;
    let version: u16 = version.parse().map_err(|_| ShareError::Malformed)?;
    let mut chars: Vec<u8> = body
        .bytes()
        .filter(|c| !matches!(c, b'-' | b' '))
        .map(|c| match c {
            b'O' => b'0',
            b'I' | b'L' => b'1',
            c => c,
        })
        .collect();
    let check = chars.pop().ok_or(ShareError::Malformed)?;
    let mut bytes = version.to_be_bytes().to_vec();
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in chars {
        let v = ALPHABET
            .iter()
            .position(|&a| a == c)
            .ok_or(ShareError::Malformed)? as u32;
        acc = (acc << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((acc >> bits) & 0xff) as u8);
        }
    }
    let sum = bytes.iter().map(|&b| u32::from(b)).sum::<u32>() % 32;
    if ALPHABET[sum as usize] != check {
        return Err(ShareError::Check);
    }
    if version != our_version() {
        return Err(ShareError::Version {
            code: version,
            ours: our_version(),
        });
    }
    let (mut seed, mut shift, mut i) = (0u64, 0u32, 2usize);
    loop {
        let b = *bytes.get(i).ok_or(ShareError::Malformed)?;
        i += 1;
        if shift > 63 {
            return Err(ShareError::Malformed);
        }
        seed |= u64::from(b & 0x7f) << shift;
        shift += 7;
        if b & 0x80 == 0 {
            break;
        }
    }
    let recipe = bytes[i..]
        .iter()
        .map(|&b| BIOMES.get(b as usize).copied().ok_or(ShareError::Malformed))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ShareTrack {
        version,
        seed,
        recipe,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip_and_name_their_version() {
        for (seed, recipe) in [
            (0u64, vec![]),
            (1, vec![Biome::Rocks]),
            (
                9_007_199_254_740_991,
                vec![
                    Biome::Town,
                    Biome::Rocks,
                    Biome::OutbackDirt,
                    Biome::OutbackBitumen,
                ],
            ),
            (u64::MAX, vec![Biome::OutbackBitumen]),
            (1_234_567, vec![]),
        ] {
            let code = encode(seed, &recipe);
            assert!(code.starts_with(&format!("T{}-", our_version())), "{code}");
            let t = decode(&code).unwrap();
            assert_eq!((t.seed, &t.recipe), (seed, &recipe), "{code}");
            // People read and type it any old way.
            assert_eq!(decode(&code.to_lowercase().replace('-', " ")).unwrap(), t);
        }
    }

    #[test]
    fn a_typo_or_another_generator_version_is_refused_clearly() {
        let code = encode(424_242, &[Biome::Rocks]);
        let mut typo: Vec<char> = code.chars().collect();
        let k = typo.len() - 3;
        typo[k] = if typo[k] == 'A' { 'B' } else { 'A' };
        assert_eq!(
            decode(&typo.iter().collect::<String>()),
            Err(ShareError::Check)
        );
        let other = our_version() - 1;
        let old = code.replacen(&format!("T{}-", our_version()), &format!("T{other}-"), 1);
        // The check covers the version, so a hand-edited version reads as a typo; a real old code names its version.
        let real_old = {
            let t = decode(&code).unwrap();
            let mut bytes = other.to_be_bytes().to_vec();
            let mut s = t.seed;
            loop {
                let b = (s & 0x7f) as u8;
                s >>= 7;
                bytes.push(if s == 0 { b } else { b | 0x80 });
                if s == 0 {
                    break;
                }
            }
            bytes.push(2);
            let check =
                ALPHABET[(bytes.iter().map(|&b| u32::from(b)).sum::<u32>() % 32) as usize] as char;
            let body = code.trim_start_matches(&format!("T{}-", our_version()));
            let body = &body[..body.len() - 1];
            format!("T{other}-{body}{check}")
        };
        assert_eq!(decode(&old), Err(ShareError::Check));
        let err = decode(&real_old).unwrap_err();
        assert_eq!(
            err,
            ShareError::Version {
                code: other,
                ours: our_version()
            }
        );
        assert!(
            err.to_string().contains(&format!("generator {other}")),
            "{err}"
        );
        assert_eq!(decode("hello"), Err(ShareError::Malformed));
    }

    #[test]
    fn a_kept_track_regenerates_byte_identical_from_its_code() {
        let data = jj_procgen::tuning::GeneratorData::shipped().clone();
        for (seed, recipe) in [(11u64, vec![]), (5, vec![Biome::Rocks, Biome::Town])] {
            let made = if recipe.is_empty() {
                jj_procgen::playtest::prepare_data(seed, &data)
            } else {
                jj_procgen::prepare_tuned(
                    seed,
                    &recipe,
                    jj_procgen::playtest::PLAYTEST_DRAWS,
                    &data,
                )
            };
            let t = decode(&encode(seed, &recipe)).unwrap();
            let again = if t.recipe.is_empty() {
                jj_procgen::playtest::prepare_data(t.seed, &data)
            } else {
                jj_procgen::prepare_tuned(
                    t.seed,
                    &t.recipe,
                    jj_procgen::playtest::PLAYTEST_DRAWS,
                    &data,
                )
            };
            assert_eq!(
                jj_map::canonical_bytes(&made.map),
                jj_map::canonical_bytes(&again.map),
                "seed {seed}"
            );
        }
    }
}
