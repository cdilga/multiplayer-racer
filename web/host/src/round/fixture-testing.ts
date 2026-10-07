// Dev and test fixtures for the round screens (P1-R07): `host/?roundfixture=<kind>-<n>[-<arg>]` draws any screen state from a
// room view with no server, worker or players, so captures and tests cover N = 1, 2, 8, 32, 99... at any size. The chunk's
// name carries "testing", so a production-realm server never serves it (vite.config.ts). Kinds: `lobby`, `preparing`,
// `countdown` (arg = seconds left, default 3), `race`, `results`; one fixture = one RoomView.
// `window.__jjRoundFixture.set(room)` swaps in any room view (tests load the JSON under web/host/tests/fixtures/).
import { mountGridOverlay } from '../layout/overlay';
import { SyntheticSource } from '../render/synthetic';
import type { World } from '../render/world';
import type { RoomView } from '../worker/client';
import { tokenData } from '../../../shared/ui';
import type { PathStats } from '../../../shared/transport/stats';
import { mountRoundScreens, type RoundClient } from './screens';

const NAMES = ['Dusty', 'Pip', 'Ash', 'Kai', 'Big Kev', 'Mia', 'Snag', 'Shaz', 'Roo Boy', 'Tiggy', 'Mack', 'Maximilian Alexander Fitzgerald!', 'Jojo', 'Nina', 'Bazza', 'Wren', 'さくら', 'Zara', 'Tama', 'Lulu', 'Ned', 'Hamish', 'Priya', 'Wei', 'Sione', 'Ana', 'Jack', 'Ruby', 'Archie', 'Isla', 'Leo', 'Matilda', 'Kiri', 'Ollie', 'Ngữ Phương', 'Dmitri', 'Captain Snag', 'Dusty Ute', 'Bec', 'Tash'];
const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

export type FixtureKind = 'lobby' | 'preparing' | 'countdown' | 'race' | 'results';

/** A room view for `n` players, deterministic. */
export function makeRoom(kind: FixtureKind, n: number, arg?: number): RoomView {
  const pal = tokenData.seatColors;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => ((a * 2654435761) >>> 0) - ((b * 2654435761) >>> 0)); // a fixed shuffle: who is where
  const placeOf = new Map(order.map((car, p) => [car, p + 1]));
  const racing = kind === 'race' || kind === 'countdown' || kind === 'preparing';
  const seats: RoomView['seats'] = Array.from({ length: n }, (_, i) => ({
    seat: i + 1,
    number: i + 1,
    name: NAMES[i % NAMES.length]!,
    rgb: hexRgb(pal[i % pal.length]!.hex),
    colourIndex: i % pal.length,
    ready: kind === 'lobby' ? (i + 1) % 6 !== 0 && (i + 1) % 9 !== 0 : true,
    presence: kind === 'race' && n > 2 && (i + 1) % 7 === 0 ? 'Left' : kind === 'race' && n > 3 && (i + 1) % 11 === 0 ? 'SittingOut' : 'Active',
    local: false,
    car: racing ? i : null,
    laps: kind === 'race' ? i % 3 : null,
    position: kind === 'race' ? placeOf.get(i)! : null,
    finished: false,
    endpoint: `ep-${i + 1}`,
    // The room view's boost is a byte (Host::room_json); the wreck countdown is not sent yet, the fixture exercises the banner.
    ...(kind === 'race' ? { boost: (i * 37) % 256, wreckMs: n > 3 && (i + 1) % 5 === 0 ? 2400 : null } : {}),
  }));
  const results: RoomView['results'] =
    kind === 'results'
      ? order.map((car, p) => ({ number: car + 1, name: NAMES[car % NAMES.length]!, place: p + 1, time_ms: 92_000 + p * 1_370 + (car % 7) * 11, points: Math.max(1, 30 - p * (n > 10 ? 1 : 3)) }))
      : null;
  return {
    phase: { lobby: 'Lobby', preparing: 'Preparing', countdown: 'Countdown', race: 'Running', results: 'Intermission' }[kind] as RoomView['phase'],
    remainingMs: kind === 'countdown' ? (arg ?? 3) * 1000 : kind === 'results' ? 42_000 : null,
    round: kind === 'lobby' ? null : 3,
    laps: 3,
    freeDrive: false,
    armed: false,
    seats,
    results,
    standings: [],
  };
}

export const parseFixture = (spec: string): { kind: FixtureKind; n: number; arg?: number } => {
  const [kind, n, arg] = spec.split('-');
  return { kind: kind as FixtureKind, n: Math.max(0, Number(n ?? 8)), arg: arg === undefined ? undefined : Number(arg) };
};

/** Boots the fixture: the synthetic world with one tile per player, the round screens fed by `set(room)`. */
export function mountFixture(app: HTMLElement, world: World, spec: string): void {
  const { kind, n, arg } = parseFixture(spec);
  let cb: (r: RoomView) => void = () => {};
  const inputs: unknown[] = [];
  const client: RoundClient = {
    room: null,
    get onRoom() {
      return cb;
    },
    set onRoom(f) {
      cb = f;
    },
    input: (i) => void inputs.push(i),
  };
  const joinUrl = `${location.origin}/j/ROO7`;
  let paths: Record<string, PathStats | null> = {};
  let disbands = 0;
  const screens = mountRoundScreens(client, { code: 'ROO7', joinUrl, paths: async () => paths, onDisband: () => void disbands++ });
  const overlay = mountGridOverlay(app, joinUrl);
  // Only a race draws a tile per player; the lobby and results screens cover the world, so it stays cheap there.
  const tiles = kind === 'race' || kind === 'countdown' || kind === 'preparing' ? Math.max(1, n) : 1;
  world.tiles = { count: tiles };
  world.onLayout = (layout, scale) => {
    overlay.render(layout, scale);
    screens.place(world.tileRects(), scale);
  };
  const source = new SyntheticSource({ cars: tiles });
  world.attach(source);
  source.start();
  const room = makeRoom(kind, n, arg);
  screens.show(room);
  (window as unknown as { __jjRoundFixture: unknown }).__jjRoundFixture = {
    set: (r: RoomView) => screens.show(r),
    make: (k: FixtureKind, count: number, a?: number) => makeRoom(k, count, a),
    inputs: () => inputs,
    setPaths: (p: Record<string, PathStats | null>) => void (paths = p),
    disbands: () => disbands,
    /** Per tile: its device-pixel rect (the grid kernel's, P1-R04.3 checks), null without the grid. */
    tileRects: () => world.tileRects(),
  };
  world.start();
  document.documentElement.dataset.jjHost = 'fixture';
}
