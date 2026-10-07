// Small text helpers shared by the round screens (P1-R07).
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });

export const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A name cut at `max` graphemes (the HUD and roster rule: 12), with an ellipsis. */
export function shortName(name: string, max = 12): string {
  const g = [...seg.segment(name)].map((s) => s.segment);
  return g.length > max ? `${g.slice(0, max).join('').trimEnd()}…` : name;
}

export function ordinal(n: number): [number, string] {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return [n, s];
}

export const secs = (ms: number | null): number => (ms === null ? 0 : Math.max(0, Math.ceil(ms / 1000)));

export function raceTime(ms: number | null): string {
  return ms === null ? 'DNF' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`;
}
