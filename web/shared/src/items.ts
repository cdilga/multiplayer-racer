/** P1-W01 wire facts decoded by jj-wasm-input. Inventory positions are FIFO, not selectable slots. */
export type ItemId = 'boomerang' | 'sanga';
export interface ItemInventory { front: ItemId | null; back: ItemId | null }
export type ItemUseRefusal = 'empty' | 'cooldown' | 'protected' | 'blocked' | 'unavailable' | 'notRacing';
export interface ItemEvent {
  tick: number;
  owner: number;
  life: number;
  effect: number;
  item: ItemId;
  kind: 'Picked' | { Used: { direction: 'Forward' | 'Rear' } } | { Hit: { target: number | null } } | 'Caught' | 'Expired';
}
