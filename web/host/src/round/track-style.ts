// The host's track style (council review 2026-11-15, round 2: "let's do the canyon one" had no answer except a URL or the
// vote): one of the game's biomes, or the seed's own mix. Chosen on Host menu → Tracks, remembered on this host device,
// applied by procgen/start.ts through a `jj-track-style` window event.

/** The styles a host can choose: the recipe (biome) name and what the menu calls it. '' is each seed's own mix. */
export const TRACK_STYLES: ReadonlyArray<[recipe: string, label: string]> = [
  ['', 'Any style'],
  ['town', 'Town'],
  ['rocks', 'Rocks'],
  ['outback-dirt', 'Outback dirt'],
  ['outback-bitumen', 'Outback bitumen'],
];

const KEY = 'jj-track-style';

/** The style saved on this device, or undefined for the seed's own mix. */
export function savedTrackStyle(): string | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v && TRACK_STYLES.some(([r]) => r === v) ? v : undefined;
  } catch {
    return undefined;
  }
}

let current: string | undefined;

/** The style in force on this page ('' for any). */
export function currentTrackStyle(): string {
  return current ?? savedTrackStyle() ?? '';
}

/** Chooses a style ('' for any): saved on this device, and the preparer draws the next track in it. */
export function chooseTrackStyle(recipe: string): void {
  current = recipe;
  try {
    if (recipe) localStorage.setItem(KEY, recipe);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the choice holds for this page only.
  }
  dispatchEvent(new CustomEvent('jj-track-style', { detail: recipe || null }));
}
