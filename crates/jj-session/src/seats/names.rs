//! Player names (plan §9, master §10.6): NFC, trimmed, plain text, at most 32 grapheme clusters. Blank reverts to the
//! default; markup and control characters are refused; case-folded duplicates gain the stable seat-number suffix.
//! 32 graphemes is a text-field bound, never a limit on identities.

use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

pub const MAX_NAME_GRAPHEMES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NameError {
    TooLong,
    /// Control, bidi-override or markup characters.
    Forbidden,
}

/// Bidi controls and other invisible formatting that can spoof a name on the TV.
fn forbidden(c: char) -> bool {
    c.is_control()
        || matches!(c, '<' | '>' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// The stored form of a typed name: `Ok(None)` for blank (use the default).
pub fn clean_name(raw: &str) -> Result<Option<String>, NameError> {
    let nfc: String = raw.nfc().collect();
    let trimmed = nfc.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().any(forbidden) {
        return Err(NameError::Forbidden);
    }
    if trimmed.graphemes(true).count() > MAX_NAME_GRAPHEMES {
        return Err(NameError::TooLong);
    }
    Ok(Some(trimmed.to_owned()))
}

/// The comparison key for duplicates (NFC + lowercase; close to full case folding for names).
pub fn fold(name: &str) -> String {
    name.nfc().flat_map(char::to_lowercase).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned_and_bounded() {
        assert_eq!(clean_name("  Dusty  "), Ok(Some("Dusty".into())));
        assert_eq!(clean_name("   "), Ok(None), "blank reverts to the default");
        assert_eq!(clean_name("e\u{301}"), Ok(Some("é".into())), "NFC");
        assert_eq!(clean_name("<b>Kev</b>"), Err(NameError::Forbidden));
        assert_eq!(
            clean_name("Kev\u{202E}"),
            Err(NameError::Forbidden),
            "bidi override"
        );
        assert_eq!(clean_name("a\u{7}b"), Err(NameError::Forbidden), "control");
        let family = "👨\u{200D}👩\u{200D}👧"; // one grapheme, joined with ZWJ
        assert_eq!(
            clean_name(&family.repeat(32)).map(|n| n.is_some()),
            Ok(true),
            "32 graphemes, not 32 chars"
        );
        assert_eq!(clean_name(&"x".repeat(33)), Err(NameError::TooLong));
        assert_eq!(fold("ÉMMA"), fold("émma"));
    }
}
