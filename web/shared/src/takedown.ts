// R134 (P1-FL19): a car that wrecks or spins another takes it down, and its boost fills. The TV pops the callout over the
// attacker and the attacker's phone shows it too (the same words in both places).
export type TakedownCallout = 'Takedown';

export const TAKEDOWN_TEXT: Record<TakedownCallout, string> = {
  Takedown: 'TAKEDOWN! BOOST',
};

/** How long the callout stays up on the TV and the phone. */
export const TAKEDOWN_SHOWN_MS = 1800;
