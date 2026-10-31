//! The shared item transaction and lifetime rules (P1-W01). Item implementations provide the
//! physical activation; a refused activation never consumes the front item. Round retirement
//! and natural expiry return effect records so implementations can undo their own changes.
//! Neither operation owns or deletes physics debris.

pub mod boomerang;
pub mod boost;
pub mod esky;
pub mod sanga;
pub mod stations;

use std::collections::BTreeMap;

use jj_contracts::item::{Card, Class, Mode};
use jj_types::{
    LifeId, SeatId,
    items::{ItemId, ItemUseRefusal},
};
use serde::{Deserialize, Serialize};

use crate::utility::UtilityKind;

#[derive(Clone, Debug)]
pub struct Cards {
    boomerang: Card,
    sanga: Card,
    tinnie: Card,
    esky: Card,
}

impl Cards {
    /// Load the same validated, versioned cards as `jj validate`, without runtime asset I/O.
    pub fn shipped() -> Result<Self, Vec<String>> {
        Self::parse_all(
            include_bytes!("../../../../assets/items/boomerang.json"),
            include_bytes!("../../../../assets/items/sanga.json"),
            include_bytes!("../../../../assets/items/tinnie.json"),
            include_bytes!("../../../../assets/items/esky.json"),
        )
    }

    /// The boomerang and sanga cards given, the other two as shipped.
    pub fn parse(boomerang: &[u8], sanga: &[u8]) -> Result<Self, Vec<String>> {
        Self::parse_all(
            boomerang,
            sanga,
            include_bytes!("../../../../assets/items/tinnie.json"),
            include_bytes!("../../../../assets/items/esky.json"),
        )
    }

    pub fn parse_all(
        boomerang: &[u8],
        sanga: &[u8],
        tinnie: &[u8],
        esky: &[u8],
    ) -> Result<Self, Vec<String>> {
        let boomerang = jj_contracts::item::parse(boomerang)?;
        let sanga = jj_contracts::item::parse(sanga)?;
        let tinnie = jj_contracts::item::parse(tinnie)?;
        let esky = jj_contracts::item::parse(esky)?;
        if boomerang.id != "boomerang"
            || sanga.id != "sanga"
            || tinnie.id != "tinnie"
            || esky.id != "esky"
        {
            return Err(vec![
                "item cards must match their registered identities".into(),
            ]);
        }
        Ok(Self {
            boomerang,
            sanga,
            tinnie,
            esky,
        })
    }

    pub fn get(&self, item: ItemId) -> &Card {
        match item {
            ItemId::Boomerang => &self.boomerang,
            ItemId::Sanga => &self.sanga,
            ItemId::Tinnie => &self.tinnie,
            ItemId::Esky => &self.esky,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owner {
    pub seat: SeatId,
    pub life: LifeId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldItem {
    pub item: ItemId,
    pub uses_left: u32,
}

/// Exactly two held items is an explicit game rule, not a participant/source limit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Queue {
    pub front: Option<HeldItem>,
    pub back: Option<HeldItem>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PickupRefusal {
    Full,
    Protected,
    WrongMode,
    Unavailable,
}

#[derive(Clone, Copy, Debug)]
pub struct Context {
    pub owner: Owner,
    pub mode: Mode,
    pub racing: bool,
    pub protected: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventKind {
    Picked,
    Used { direction: UtilityKind },
    Expired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub tick: u64,
    pub owner: Owner,
    /// Zero for a pickup; effects get unique, monotonically increasing identities.
    pub effect: u64,
    pub item: ItemId,
    pub kind: EventKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Effect {
    pub id: u64,
    pub car: u32,
    pub owner: Owner,
    pub item: ItemId,
    pub direction: UtilityKind,
    pub started: u64,
    pub armed_at: u64,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Account {
    queue: Queue,
    ready_at: u64,
    owner: Option<SeatId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Items {
    accounts: BTreeMap<u32, Account>,
    effects: BTreeMap<u64, Effect>,
    next_effect: u64,
    events: Vec<Event>,
}

impl Default for Items {
    fn default() -> Self {
        Self {
            accounts: BTreeMap::new(),
            effects: BTreeMap::new(),
            next_effect: 1,
            events: Vec::new(),
        }
    }
}

fn ticks(ms: u32) -> u64 {
    (u64::from(ms) * u64::from(crate::TICK_HZ)).div_ceil(1000)
}

impl Items {
    pub fn owner_seat(&self, car: u32) -> Option<SeatId> {
        self.accounts.get(&car).and_then(|a| a.owner)
    }
    pub fn queue(&self, car: u32) -> Queue {
        self.accounts
            .get(&car)
            .map_or(Queue::default(), |a| a.queue)
    }
    pub fn events(&self) -> &[Event] {
        &self.events
    }
    pub fn effects(&self) -> impl Iterator<Item = &Effect> {
        self.effects.values()
    }

    /// Only success consumes the caller's pickup. A full queue or protection leaves it available.
    pub fn pickup(
        &mut self,
        cards: &Cards,
        car: u32,
        item: ItemId,
        ctx: Context,
        tick: u64,
    ) -> Result<(), PickupRefusal> {
        let card = cards.get(item);
        if !card.pickup_compatibility.contains(&ctx.mode) {
            return Err(PickupRefusal::WrongMode);
        }
        if card.offensive && ctx.protected {
            return Err(PickupRefusal::Protected);
        }
        let account = self.accounts.entry(car).or_default();
        let held = Some(HeldItem {
            item,
            uses_left: card.uses,
        });
        if account.queue.front.is_none() {
            account.queue.front = held;
        } else if account.queue.back.is_none() {
            account.queue.back = held;
        } else {
            return Err(PickupRefusal::Full);
        }
        account.owner = Some(ctx.owner.seat);
        self.events.push(Event {
            tick,
            owner: ctx.owner,
            effect: 0,
            item,
            kind: EventKind::Picked,
        });
        Ok(())
    }

    /// Activate first, commit second. The caller owns physical collision/force checks and may refuse
    /// with a reason. A self-use card accepts either direction; projectile direction stays explicit.
    pub fn use_front(
        &mut self,
        cards: &Cards,
        car: u32,
        ctx: Context,
        direction: UtilityKind,
        tick: u64,
        activate: impl FnOnce(&Effect) -> Result<(), ItemUseRefusal>,
    ) -> Result<Effect, ItemUseRefusal> {
        let account = self.accounts.get(&car).ok_or(ItemUseRefusal::Empty)?;
        let front = account.queue.front.ok_or(ItemUseRefusal::Empty)?;
        let card = cards.get(front.item);
        if !ctx.racing {
            return Err(ItemUseRefusal::NotRacing);
        }
        if card.offensive && ctx.protected {
            return Err(ItemUseRefusal::Protected);
        }
        if tick < account.ready_at {
            return Err(ItemUseRefusal::Cooldown);
        }
        let next = self
            .next_effect
            .checked_add(1)
            .ok_or(ItemUseRefusal::Unavailable)?;
        let duration = match card.class {
            Class::Projectile => card.timing.lifetime_ms,
            Class::Buff => card.timing.duration_ms,
        }
        .expect("validated card timing");
        let effect = Effect {
            id: self.next_effect,
            car,
            owner: ctx.owner,
            item: front.item,
            direction,
            started: tick,
            armed_at: tick + ticks(card.timing.arming_ms),
            expires_at: tick + ticks(duration),
        };
        activate(&effect)?;
        let account = self.accounts.get_mut(&car).expect("account checked above");
        if front.uses_left > 1 {
            account.queue.front = Some(HeldItem {
                uses_left: front.uses_left - 1,
                ..front
            });
        } else {
            account.queue.front = account.queue.back.take();
        }
        account.ready_at = tick + ticks(card.timing.cooldown_ms);
        self.next_effect = next;
        self.effects.insert(effect.id, effect);
        self.events.push(Event {
            tick,
            owner: effect.owner,
            effect: effect.id,
            item: effect.item,
            kind: EventKind::Used { direction },
        });
        Ok(effect)
    }

    /// A new incarnation holds nothing. Fired effects retain their original causal owner/life.
    pub fn respawn(&mut self, car: u32) {
        self.accounts.remove(&car);
    }

    /// Expire only item effects, in identity order, at a tick boundary. Physical implementations
    /// receive the records to remove their forces/buffs; live physics debris is outside this ledger.
    pub fn expire(&mut self, tick: u64) -> Vec<Effect> {
        let expired: Vec<_> = self
            .effects
            .values()
            .filter(|e| e.expires_at <= tick)
            .copied()
            .collect();
        for effect in &expired {
            self.retire(*effect, tick);
        }
        expired
    }

    fn retire(&mut self, effect: Effect, tick: u64) {
        self.effects.remove(&effect.id);
        self.events.push(Event {
            tick,
            owner: effect.owner,
            effect: effect.id,
            item: effect.item,
            kind: EventKind::Expired,
        });
    }

    pub fn round_end(&mut self, tick: u64) -> Vec<Effect> {
        let effects: Vec<_> = self.effects.values().copied().collect();
        for effect in &effects {
            self.retire(*effect, tick);
        }
        self.accounts.clear();
        effects
    }

    /// Include future-affecting queue/cooldown/identity state in a deterministic simulation hash.
    pub fn hash_into(&self, out: &mut Vec<u8>) {
        if self.accounts.is_empty() && self.effects.is_empty() && self.next_effect == 1 {
            return;
        }
        out.extend(b"jj-items-v1");
        out.extend(
            postcard::to_allocvec(&(&self.accounts, &self.effects, self.next_effect))
                .expect("item state encodes"),
        );
    }
}
