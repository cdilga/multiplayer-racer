//! W03's self-use buff. Its duration comes from the validated item card and ledger;
//! this view never changes vehicle mass, forces, controls or poses.

use jj_types::items::ItemId;
use serde::{Deserialize, Serialize};

use super::Items;

pub const DOMINANCE: i8 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Active {
    pub effect: u64,
    pub expires_at: u64,
    pub remaining_ticks: u64,
}

/// Refresh selects the latest expiry for this car; multiple uses never
/// multiply dominance or immunity. Fired records keep their original causal life.
pub fn active(items: &Items, car: u32, tick: u64) -> Option<Active> {
    let effect = items
        .effects()
        .filter(|e| e.item == ItemId::Sanga && e.car == car && e.expires_at > tick)
        .max_by_key(|e| (e.expires_at, e.id))?;
    Some(Active {
        effect: effect.id,
        expires_at: effect.expires_at,
        remaining_ticks: effect.expires_at - tick,
    })
}
