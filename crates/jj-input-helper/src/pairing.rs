//! Who may read the keyboards: a keylogger-shaped program has to be strict about it.
//!
//! 1. The socket listens on 127.0.0.1 only, and the handshake's `Host` must be `127.0.0.1:<port>` or
//!    `localhost:<port>` (a DNS-rebinding page names its own host there).
//! 2. The handshake's `Origin` must be one of the game's sites (or one given with `--allow-origin`). Browsers set
//!    `Origin` themselves, so no other website can open the socket.
//! 3. Even then, nothing is sent until the page pairs: with the six-digit code the helper shows its user (typed into
//!    the game's drawer), or with the token an earlier pairing of that same origin stored. Five wrong codes in a row
//!    and the code changes. Tokens are per origin, kept in the helper's state directory, compared in constant time.
//! 4. Devices are opened only while a paired page is connected, and the helper's window says what it's capturing.

use std::collections::BTreeMap;
use std::path::PathBuf;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

const MAX_WRONG: u32 = 5;

/// Whether a handshake's `Host` names this helper's loopback socket.
pub fn host_ok(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"))
}

/// Whether a handshake's `Origin` is allowed (exact match, no trailing slash).
pub fn origin_ok(origin: Option<&str>, allowed: &[String]) -> bool {
    origin.is_some_and(|o| allowed.iter().any(|a| a.trim_end_matches('/') == o))
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the OS random source is available");
    b
}

fn new_code() -> String {
    let n = u32::from_le_bytes(random_bytes::<4>()) % 1_000_000;
    format!("{n:06}")
}

fn eq_ct(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

pub enum Outcome {
    /// Paired: the token the page keeps for next time.
    Paired(String),
    Refused(&'static str),
}

pub struct Pairing {
    code: String,
    wrong: u32,
    /// origin → token.
    tokens: BTreeMap<String, String>,
    store: Option<PathBuf>,
}

impl Pairing {
    /// `store`: the file tokens persist in (None keeps them in memory, for tests).
    pub fn new(store: Option<PathBuf>) -> Self {
        let tokens = store
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            code: new_code(),
            wrong: 0,
            tokens,
            store,
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    /// A page's `pair` message. Returns the outcome and whether the code changed (the caller shows the new one).
    pub fn pair(
        &mut self,
        origin: &str,
        code: Option<&str>,
        token: Option<&str>,
    ) -> (Outcome, bool) {
        if let Some(t) = token {
            return match self.tokens.get(origin) {
                Some(known) if eq_ct(known, t) => (Outcome::Paired(known.clone()), false),
                _ => (Outcome::Refused("unknown token"), false),
            };
        }
        let Some(c) = code else {
            return (Outcome::Refused("no code"), false);
        };
        if eq_ct(c.trim(), &self.code) {
            let token = URL_SAFE_NO_PAD.encode(random_bytes::<24>());
            self.tokens.insert(origin.to_owned(), token.clone());
            self.save();
            self.wrong = 0;
            // A code works once: the next page pairs with a fresh one.
            self.code = new_code();
            return (Outcome::Paired(token), true);
        }
        self.wrong += 1;
        if self.wrong >= MAX_WRONG {
            self.wrong = 0;
            self.code = new_code();
            return (
                Outcome::Refused("wrong code; the helper shows a new one"),
                true,
            );
        }
        (Outcome::Refused("wrong code"), false)
    }

    /// The test seam: a known code.
    pub fn set_code(&mut self, code: &str) {
        code.clone_into(&mut self.code);
    }

    fn save(&self) {
        let Some(p) = &self.store else { return };
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let json = serde_json::to_string_pretty(&self.tokens).expect("tokens serialise");
        if let Err(e) = std::fs::write(p, json) {
            eprintln!("could not save the pairing to {}: {e}", p.display());
        }
    }
}

/// Where tokens live: `$XDG_CONFIG_HOME` (or `~/.config`), `~/Library/Application Support` on macOS, `%APPDATA%` on
/// Windows; `jj-input-helper/pairings.json` under it.
pub fn default_store() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.map(|b| b.join("jj-input-helper").join("pairings.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_and_origin_checks() {
        assert!(host_ok(Some("127.0.0.1:47123"), 47123));
        assert!(host_ok(Some("localhost:47123"), 47123));
        assert!(!host_ok(Some("evil.example:47123"), 47123));
        assert!(!host_ok(None, 47123));
        let allowed = vec!["https://jammers.dilger.dev/".to_owned()];
        assert!(origin_ok(Some("https://jammers.dilger.dev"), &allowed));
        assert!(!origin_ok(
            Some("https://jammers.dilger.dev.evil.example"),
            &allowed
        ));
        assert!(!origin_ok(Some("null"), &allowed));
        assert!(!origin_ok(None, &allowed));
    }

    #[test]
    fn code_pairs_once_and_tokens_are_per_origin() {
        let mut p = Pairing::new(None);
        p.set_code("123456");
        let (Outcome::Paired(token), rotated) = p.pair("https://a", Some("123456"), None) else {
            panic!("the right code pairs")
        };
        assert!(rotated, "a used code is replaced");
        assert!(matches!(
            p.pair("https://b", Some("123456"), None).0,
            Outcome::Refused(_)
        ));
        assert!(matches!(
            p.pair("https://a", None, Some(&token)).0,
            Outcome::Paired(_)
        ));
        assert!(
            matches!(
                p.pair("https://b", None, Some(&token)).0,
                Outcome::Refused(_)
            ),
            "a token is only good for its own origin"
        );
    }

    #[test]
    fn five_wrong_codes_change_it() {
        let mut p = Pairing::new(None);
        p.set_code("123456");
        for _ in 0..4 {
            assert!(!p.pair("o", Some("000000"), None).1);
        }
        assert!(p.pair("o", Some("000000"), None).1);
        assert!(matches!(
            p.pair("o", Some("123456"), None).0,
            Outcome::Refused(_)
        ));
    }

    #[test]
    fn tokens_persist() {
        let dir = std::env::temp_dir().join(format!("jj-helper-test-{}", std::process::id()));
        let file = dir.join("pairings.json");
        let mut p = Pairing::new(Some(file.clone()));
        let code = p.code().to_owned();
        let (Outcome::Paired(t), _) = p.pair("https://a", Some(&code), None) else {
            panic!()
        };
        let mut again = Pairing::new(Some(file));
        assert!(matches!(
            again.pair("https://a", None, Some(&t)).0,
            Outcome::Paired(_)
        ));
        let _ = std::fs::remove_dir_all(dir);
    }
}
