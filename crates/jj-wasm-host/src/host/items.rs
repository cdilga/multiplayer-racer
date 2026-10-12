//! P1-W01: reliable per-source item facts. No periodic inventory flood or participant limit.
use super::Host;
use jj_protocol::{
    abi::{Channel, SimToMain},
    cmd::{ActionOutcome, ActionRejection, HostCmd},
    items::{Inventory, ItemDirection, ItemEvent, ItemEventKind},
};
use jj_sim::{CarId, UtilityKind, items::EventKind};
use jj_types::{SeatId, Tick};

impl Host {
    pub(super) fn inventory_for(&self, seat: SeatId) -> Inventory {
        let q = self
            .inputs
            .get(&seat)
            .and_then(|i| i.car)
            .map(|car| self.sim.items().queue(car.0))
            .unwrap_or_default();
        Inventory {
            front: q.front.map(|h| h.item),
            back: q.back.map(|h| h.item),
        }
    }

    fn send_item_command(&mut self, seat: SeatId, cmd: HostCmd) {
        let Some(endpoint) = self
            .seats
            .seat(seat)
            .and_then(|s| s.conn)
            .and_then(|conn| self.endpoint_of(conn))
        else {
            return;
        };
        if endpoint.0.starts_with("local:") {
            return;
        }
        self.out.push(SimToMain::Outbound {
            endpoint,
            channel: Channel::Cmd,
            bytes: self.seat_cmd(seat, cmd),
        });
    }

    pub(super) fn utility_outcome(&mut self, car: CarId, kind: UtilityKind) -> ActionOutcome {
        let before = self.sim.item_refusals().len();
        if self.sim.utility(car, kind) {
            ActionOutcome::Applied {
                tick: Tick(self.sim.tick()),
            }
        } else {
            let reason = if self.sim.item_refusals().len() > before {
                ActionRejection::Item {
                    reason: self.sim.item_refusals().last().expect("new refusal").2,
                }
            } else {
                ActionRejection::NotAvailable
            };
            ActionOutcome::Rejected { reason }
        }
    }

    pub(super) fn collect_items(&mut self) {
        let seats: Vec<_> = self.inputs.keys().copied().collect();
        for seat in seats {
            let inventory = self.inventory_for(seat);
            if self.sent_inventory.get(&seat) != Some(&inventory) {
                self.sent_inventory.insert(seat, inventory);
                self.send_item_command(seat, HostCmd::Inventory(inventory));
            }
        }
        let fresh = self.sim.items().events()[self.seen_item_events..].to_vec();
        self.seen_item_events += fresh.len();
        for e in fresh {
            let kind = match e.kind {
                EventKind::Picked => ItemEventKind::Picked,
                EventKind::Expired => ItemEventKind::Expired,
                EventKind::Used { direction } => ItemEventKind::Used {
                    direction: match direction {
                        UtilityKind::Forward => ItemDirection::Forward,
                        UtilityKind::Rear => ItemDirection::Rear,
                    },
                },
            };
            self.send_item_command(
                e.owner.seat,
                HostCmd::ItemEvent(ItemEvent {
                    tick: Tick(e.tick),
                    owner: e.owner.seat,
                    life: e.owner.life,
                    effect: e.effect,
                    item: e.item,
                    kind,
                }),
            );
        }
    }
}
