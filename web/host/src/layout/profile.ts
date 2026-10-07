// Viewing-distance profiles for the host (P1-R08, R14/R47/R96): TV (couch, 3 m), desk (laptop, arm's length) and handheld
// (a phone host). The profile picks the screen scale `k` every round-screen size is multiplied by (TV px at 1080p x k, so
// everything is laid out from the display rect), with a sensible default from the display and a host override that is
// remembered per host. The multipliers are starting values to be judged on real screens (P1-Q02), not measured facts.
import { type Profile, profileFor } from '../../../shared/ui';

export type ProfileChoice = Profile | 'auto';
export const PROFILES: readonly ProfileChoice[] = ['auto', 'tv', 'desk', 'handheld'];
const KEY = 'jj.host.profile';
/** Text never goes under this fraction of the TV size: 13 px where the TV caption is 24 px. */
const HANDHELD_MIN = 13 / 24;
/** The multiplier on the screen's own scale: a desk viewer sits close, so the same text reads smaller. */
const MUL: Record<Profile, number> = { tv: 1, desk: 0.85, handheld: 1 };

let override: ProfileChoice | null = null;
const listeners = new Set<() => void>();

const valid = (v: unknown): v is ProfileChoice => typeof v === 'string' && (PROFILES as readonly string[]).includes(v);

/** The host's choice: `?profile=` wins, then the remembered setting, else auto. */
export function profileChoice(): ProfileChoice {
  if (override) return override;
  try {
    const q = new URLSearchParams(location.search).get('profile');
    if (valid(q)) return q;
    const v = localStorage.getItem(KEY);
    if (valid(v)) return v;
  } catch {
    // Blocked storage: auto.
  }
  return 'auto';
}

export function setProfileChoice(c: ProfileChoice): void {
  override = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // Not remembered; still applies this session.
  }
  for (const f of listeners) f();
}

export const onProfileChange = (f: () => void): (() => void) => (listeners.add(f), () => listeners.delete(f));

/** The profile in force for a display of this size: the host's choice, or the display's default. */
export function activeProfile(w = window.innerWidth, h = window.innerHeight): Profile {
  const c = profileChoice();
  return c === 'auto' ? profileFor(w, h) : c;
}

/** One screen scale for every px in the design (TV px at 1080p): output height / 1080 times the profile's multiplier; a portrait display scales by its width. */
export function screenScale(w = window.innerWidth, h = window.innerHeight): number {
  const base = h > w ? w / 1080 : h / 1080;
  return Math.max(HANDHELD_MIN, base * MUL[activeProfile(w, h)]);
}
