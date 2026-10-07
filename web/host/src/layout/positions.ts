// The race positions the grid's chrome shows (P1-R04.3/R04.style): the footer's docked ticker and the Players cell both
// read this one list, which the host chrome sets from the room view. Every racer, in order: no count limit.

export interface Position {
  place: number;
  number: number;
  name: string;
  /** The seat's identity colour index (tokens --id-N). */
  colour: number;
}

let list: Position[] = [];
const subs = new Set<(l: Position[]) => void>();

export function setPositions(next: Position[]): void {
  list = next;
  for (const f of subs) f(list);
}

export function positions(): Position[] {
  return list;
}

export function onPositions(f: (l: Position[]) => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
