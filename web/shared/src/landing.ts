// R129 (P1-FL07): how a car came down from a jump, and the words the TV pops over it. An OK landing pops nothing: only the
// landings that change the race (a boost, a loss, a crash) are called out.
export type LandingTier = 'Clean' | 'Ok' | 'Bad' | 'Crash';
export type LandingCallout = 'Clean' | 'BigAir' | 'Bad' | 'Crash';

export const LANDING_TEXT: Record<LandingCallout, string> = {
  Clean: 'CLEAN LANDING! BOOST',
  BigAir: 'BIG AIR! BOOST',
  Bad: 'HARD LANDING!',
  Crash: 'STACKED IT!',
};

/** The callout for a landing, or none (OK). */
export function landingCallout(tier: LandingTier, long: boolean): LandingCallout | null {
  if (tier === 'Clean') return long ? 'BigAir' : 'Clean';
  return tier === 'Ok' ? null : tier;
}

/** How long the callout stays up on the TV. */
export const LANDING_SHOWN_MS = 1600;
