//! The shared item card contract (P1-W01). Physical effects belong to the individual item implementations.

use serde::{Deserialize, Serialize};

pub const ITEM: &str = "jj.item.v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Class {
    Projectile,
    Buff,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Activation {
    SectorEntry,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Direction {
    ForwardRear,
    SelfUse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cleanup {
    NaturalExpiryOrRoundEnd,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Race,
    Derby,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timing {
    pub arming_ms: u32,
    pub cooldown_ms: u32,
    /// Projectiles expire naturally; their causal owner survives a respawn.
    pub lifetime_ms: Option<u32>,
    /// Buffs change authority for a bounded time and never add a second hidden multiplier.
    pub duration_ms: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Presentation {
    pub vfx: String,
    pub sfx: String,
    pub comic: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub item: String,
    pub id: String,
    pub version: u32,
    pub class: Class,
    pub activation: Activation,
    pub direction: Direction,
    pub uses: u32,
    pub offensive: bool,
    pub timing: Timing,
    pub cleanup: Cleanup,
    pub pickup_compatibility: Vec<Mode>,
    pub counterplay: Vec<String>,
    pub presentation: Presentation,
    pub rationale: String,
}

/// Parse and validate at the boundary: a partially valid card never enters the item pool.
pub fn parse(bytes: &[u8]) -> Result<Card, Vec<String>> {
    let card: Card = serde_json::from_slice(bytes).map_err(|e| vec![e.to_string()])?;
    let problems = validate(&card);
    if problems.is_empty() {
        Ok(card)
    } else {
        Err(problems)
    }
}

pub fn validate(card: &Card) -> Vec<String> {
    let mut problems = Vec::new();
    if card.item != ITEM {
        problems.push(format!("item: expected {ITEM}"));
    }
    if card.version != 1 {
        problems.push("version: unsupported item card version".into());
    }
    if card.id.is_empty()
        || !card
            .id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        problems.push("id: use a nonempty lower-case item id".into());
    }
    if card.uses == 0 {
        problems.push("uses: must be positive".into());
    }
    if card.pickup_compatibility.is_empty() {
        problems.push("pickup_compatibility: name at least one round mode".into());
    }
    if card.counterplay.is_empty() || card.counterplay.iter().any(|s| s.trim().is_empty()) {
        problems.push("counterplay: name how another player can respond".into());
    }
    for (field, value) in [
        ("presentation.vfx", &card.presentation.vfx),
        ("presentation.sfx", &card.presentation.sfx),
        ("presentation.comic", &card.presentation.comic),
        ("rationale", &card.rationale),
    ] {
        if value.trim().is_empty() {
            problems.push(format!("{field}: must not be blank"));
        }
    }
    match card.class {
        Class::Projectile => {
            if card.direction != Direction::ForwardRear || !card.offensive {
                problems
                    .push("class: a projectile is offensive and fires forward or rearward".into());
            }
            if card
                .timing
                .lifetime_ms
                .is_none_or(|ms| ms == 0 || ms <= card.timing.arming_ms)
                || card.timing.duration_ms.is_some()
            {
                problems.push("timing: a projectile needs a positive lifetime beyond arming, and no buff duration".into());
            }
        }
        Class::Buff => {
            if card.direction != Direction::SelfUse || card.offensive {
                problems.push(
                    "class: a buff is non-offensive and self-use in either vertical direction"
                        .into(),
                );
            }
            if card
                .timing
                .duration_ms
                .is_none_or(|ms| ms == 0 || ms <= card.timing.arming_ms)
                || card.timing.lifetime_ms.is_some()
            {
                problems.push("timing: a buff needs a positive duration beyond arming, and no projectile lifetime".into());
            }
        }
    }
    problems
}
