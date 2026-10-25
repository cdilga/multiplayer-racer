// Kept tracks and best laps (br-m1xe, R125). A generated track is its seed and recipe under one generator version: the
// share code (made and read by the procgen worker, jj-wasm-procgen `share`) carries all three, and regenerates the track
// byte for byte. Round complete has "Keep this track"; the kept tracks live on this host device (no limit to the list),
// and the host's Tracks page races one next or adds another host's code. Best laps are kept per track and per car.
// Both lists are this browser's (localStorage); nothing is uploaded.

/** How the map now shown was made, from the round preparer. */
export interface TrackNow {
  seed: number;
  recipe: string;
  /** A tuned generator document (the owner tuning menu): such a track is kept here but has no share code. */
  generator?: string;
}

/** What the round screens need of the round preparer and the procgen worker. */
export interface TrackSource {
  current(): TrackNow | null;
  code(seed: number, recipe: string): Promise<string>;
  read(code: string): Promise<{ seed: number; recipe: string }>;
}

export interface KeptTrack {
  /** The share code; null for a track built with a tuned generator (it can't be rebuilt elsewhere). */
  code: string | null;
  seed: number;
  recipe: string;
  generator?: string;
  keptAt: number;
}

export interface BestLap {
  ms: number;
  name: string;
  at: number;
}

const FAV = 'jj.host.favourites';
const LAPS = 'jj.host.bestlaps';
let source: TrackSource | null = null;
// A displayed track's code is immutable for this generator. Reuse its reply when Keep is pressed:
// another worker round trip can queue behind generation of the next track during Intermission.
let currentCode: { source: TrackSource; seed: number; recipe: string; code: Promise<string> } | null = null;

export const setTrackSource = (s: TrackSource) => {
  currentCode = null;
  return (source = s);
};
export const trackSource = () => source;

function load<T>(key: string, empty: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : empty;
  } catch {
    return empty;
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage blocked (a private window): the list lasts this visit.
  }
}

/** A track's key: its share code, or a local name for a tuned one. */
export const keyOf = (t: { code: string | null; seed: number; recipe: string }) => t.code ?? `local:${t.seed}:${t.recipe}`;

export function kept(): KeptTrack[] {
  return load<KeptTrack[]>(FAV, []);
}

/** The share code (or local key) of the track now shown; null when it isn't a generated track. */
export async function currentKey(): Promise<{ key: string; track: TrackNow; code: string | null } | null> {
  const t = source?.current();
  if (!t || !source) return null;
  let code: string | null = null;
  if (!t.generator) {
    if (!currentCode || currentCode.source !== source || currentCode.seed !== t.seed || currentCode.recipe !== t.recipe) {
      const entry = { source, seed: t.seed, recipe: t.recipe, code: source.code(t.seed, t.recipe) };
      currentCode = entry;
      // A failed request may be retried; never retain a transient worker failure as the track's identity.
      void entry.code.catch(() => {
        if (currentCode === entry) currentCode = null;
      });
    }
    code = await currentCode.code.catch(() => null);
  }
  return { key: keyOf({ code, seed: t.seed, recipe: t.recipe }), track: t, code };
}

/** Keeps the track now shown (once: keeping it again changes nothing). */
export async function keepCurrent(): Promise<KeptTrack | null> {
  const now = await currentKey();
  if (!now) return null;
  const list = kept();
  const have = list.find((k) => keyOf(k) === now.key);
  if (have) return have;
  const k: KeptTrack = { code: now.code, seed: now.track.seed, recipe: now.track.recipe, ...(now.track.generator ? { generator: now.track.generator } : {}), keptAt: Date.now() };
  save(FAV, [k, ...list]);
  return k;
}

/** Adds another host's code (read by this build's generator: a typo or another version is refused with the reason). */
export async function addCode(code: string): Promise<KeptTrack> {
  if (!source) throw new Error('tracks are generated in a room');
  const t = await source.read(code);
  const clean = await source.code(t.seed, t.recipe);
  const list = kept();
  const have = list.find((k) => k.code === clean);
  if (have) return have;
  const k: KeptTrack = { code: clean, seed: t.seed, recipe: t.recipe, keptAt: Date.now() };
  save(FAV, [k, ...list]);
  return k;
}

export function forget(key: string): void {
  save(FAV, kept().filter((k) => keyOf(k) !== key));
}

/** The best laps on a track, per car (vehicle id → best). */
export function bestLaps(key: string): Record<string, BestLap> {
  return load<Record<string, Record<string, BestLap>>>(LAPS, {})[key] ?? {};
}

/** A round's laps on a track: each car's best lap of the round against the track's record. Returns the cars whose record
 *  it beat (or set). */
export function noteLaps(key: string, laps: Array<{ vehicle: string; ms: number; name: string }>): string[] {
  const all = load<Record<string, Record<string, BestLap>>>(LAPS, {});
  const here = (all[key] ??= {});
  const records: string[] = [];
  for (const l of laps) {
    if (!(l.ms > 0)) continue;
    const best = here[l.vehicle];
    if (!best || l.ms < best.ms) {
      here[l.vehicle] = { ms: l.ms, name: l.name, at: Date.now() };
      records.push(l.vehicle);
    }
  }
  save(LAPS, all);
  return records;
}
