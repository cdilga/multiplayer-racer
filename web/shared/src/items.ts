/** P1-W01 wire facts decoded by jj-wasm-input. Inventory positions are FIFO, not selectable slots. */
export type ItemId = 'boomerang' | 'sanga' | 'tinnie' | 'esky' | 'roo-bar' | 'bunger' | 'magpie';
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

/** How each item reads on the phone and the TV: name, the one-line how-to, and (for self-use buffs) how long it runs, ms,
 *  and its comic shout. Durations mirror assets/items/<id>.json. */
export const ITEM_INFO: Record<ItemId, { name: string; how: string; buffMs?: number; comic?: string }> = {
  boomerang: { name: 'Boomerang', how: 'flick up to throw · it homes in' },
  sanga: { name: 'Sanga', how: 'flick to eat · speed burst, hits bounce off', buffMs: 6000, comic: 'TANKED UP!' },
  tinnie: { name: 'Tinnie', how: 'flick to crack · big boost', buffMs: 2500, comic: 'PSSST!' },
  esky: { name: 'Esky', how: 'flick to drop behind you' },
  'roo-bar': { name: 'Roo bar', how: 'flick to fit · rams hit double, cost you nothing', buffMs: 10000, comic: 'ROO BAR!' },
  bunger: { name: 'Bunger', how: 'flick up to lob · down to drop · it blasts' },
  magpie: { name: 'Magpie', how: 'flick to let go · swoops the leader' },
};
