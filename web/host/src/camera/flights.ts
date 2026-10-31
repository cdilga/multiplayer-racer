// Where a car flies rather than drives (br-8h3u.1): the route points the map leaves out of its recovery spans (jj-map
// `route.recovery`: jump flights, landings and other hazards). The chase's relief look-ahead mustn't pre-raise for ground
// that falls away under a flight, or the car sinks out of the frame before the lip; everywhere else the car rides the
// ground and the look-ahead keeps the chase smooth over crests and dips.

interface RouteJson {
  route: {
    points: { x: number; y: number; z: number; width: number }[];
    recovery?: { from: number; to: number }[];
  };
}

/** Cell size of the lookup grid, m. */
const CELL_M = 8;
/** A point counts as over a flight this far past the road's half-width, m (a car flies the whole width, and a little wide). */
const REACH_M = 6;

/** `(x, z) => true` over a flight; null when the map has no recovery spans (every point is drivable). */
export function flightZones(map: RouteJson): ((x: number, z: number) => boolean) | null {
  const pts = map.route.points;
  const spans = map.route.recovery;
  const n = pts.length;
  if (!spans?.length || n === 0) return null;
  const recover = new Uint8Array(n);
  for (const { from, to } of spans) {
    if (from <= to) for (let i = from; i <= to && i < n; i++) recover[i] = 1;
    else {
      for (let i = from; i < n; i++) recover[i] = 1;
      for (let i = 0; i <= to && i < n; i++) recover[i] = 1;
    }
  }
  const grid = new Map<string, number[]>();
  let any = false;
  for (let i = 0; i < n; i++) {
    if (recover[i]) continue;
    any = true;
    const p = pts[i]!, r = p.width / 2000 + REACH_M;
    const x = p.x / 1000, z = p.z / 1000;
    for (let gx = Math.floor((x - r) / CELL_M); gx <= Math.floor((x + r) / CELL_M); gx++)
      for (let gz = Math.floor((z - r) / CELL_M); gz <= Math.floor((z + r) / CELL_M); gz++) {
        const k = `${gx},${gz}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
  }
  if (!any) return null;
  return (x, z) => {
    const cell = grid.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`);
    if (!cell) return false;
    for (const i of cell) {
      const p = pts[i]!, r = p.width / 2000 + REACH_M;
      if ((p.x / 1000 - x) ** 2 + (p.z / 1000 - z) ** 2 <= r * r) return true;
    }
    return false;
  };
}
