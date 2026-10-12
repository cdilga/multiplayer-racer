//! P1-W01.1: the real approved cards are the fixtures; malformed data must fail at the boundary.
use jj_contracts::item::{self, Card};
use serde_json::Value;

const CARDS: [&[u8]; 2] = [
    include_bytes!("../../../assets/items/boomerang.json"),
    include_bytes!("../../../assets/items/sanga.json"),
];
fn parse(value: &Value) -> Result<Card, Vec<String>> {
    item::parse(&serde_json::to_vec(value).unwrap())
}

#[test]
fn shipped_cards_validate_and_preserve_every_field_on_round_trip() {
    for bytes in CARDS {
        let card = item::parse(bytes).unwrap();
        assert_eq!(
            item::parse(&serde_json::to_vec(&card).unwrap()).unwrap(),
            card
        );
    }
}

#[test]
fn no_required_card_field_can_be_omitted() {
    for bytes in CARDS {
        let card: Value = serde_json::from_slice(bytes).unwrap();
        for field in card.as_object().unwrap().keys() {
            let mut missing = card.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(parse(&missing).is_err(), "missing {field} was accepted");
        }
        for (group, fields) in [
            ("presentation", vec!["vfx", "sfx", "comic"]),
            ("timing", vec!["arming_ms", "cooldown_ms"]),
        ] {
            for field in fields {
                let mut missing = card.clone();
                missing[group].as_object_mut().unwrap().remove(field);
                assert!(
                    parse(&missing).is_err(),
                    "missing {group}.{field} was accepted"
                );
            }
        }
    }
}

#[test]
fn counterplay_cannot_be_absent_empty_or_blank() {
    for bytes in CARDS {
        for value in [
            serde_json::json!([]),
            serde_json::json!([" "]),
            serde_json::json!(["a wall", ""]),
        ] {
            let mut card: Value = serde_json::from_slice(bytes).unwrap();
            card["counterplay"] = value;
            assert!(
                parse(&card)
                    .unwrap_err()
                    .iter()
                    .any(|s| s.contains("counterplay"))
            );
        }
    }
}

#[test]
fn unsupported_versions_and_unknown_fields_fail_instead_of_silently_changing_a_replay() {
    for bytes in CARDS {
        for (field, value) in [
            ("version", serde_json::json!(2)),
            ("item", serde_json::json!("jj.item.v2")),
            ("activtion", serde_json::json!("held")),
        ] {
            let mut card: Value = serde_json::from_slice(bytes).unwrap();
            card[field] = value;
            assert!(parse(&card).is_err(), "{field} was accepted");
        }
    }
}

#[test]
fn a_card_has_bounded_timing_and_a_direction_that_matches_its_class() {
    for bytes in CARDS {
        let original: Value = serde_json::from_slice(bytes).unwrap();
        let timer = if original["class"] == "projectile" {
            "lifetime_ms"
        } else {
            "duration_ms"
        };
        for value in [Value::Null, serde_json::json!(0), serde_json::json!(100)] {
            let mut card = original.clone();
            card["timing"]["arming_ms"] = serde_json::json!(150);
            card["timing"][timer] = value;
            assert!(parse(&card).is_err(), "invalid {timer} was accepted");
        }
        let mut card = original;
        card["direction"] = serde_json::json!(if timer == "lifetime_ms" {
            "self-use"
        } else {
            "forward-rear"
        });
        assert!(parse(&card).is_err(), "cross-class direction was accepted");
    }
}
