// br-8h3u.18 (owner 2026-10-31: "many issues with not counting laps"): a car that turns up on the course further round
// than the race's catch-up allows has missed a gate, and its lap won't count until it goes back for it. The TV marks the
// gate and points the car to it; the phone shows the same words with an arrow. Never a silently stranded lap.

/** What the TV shows over the car, and the phone's banner. */
export const MISSED_GATE_TEXT = 'MISSED GATE! GO BACK';
/** The phone's second line: Recover takes the car back to its last gate, just before the one it missed. */
export const MISSED_GATE_HINT = 'Turn round, or hold Recover';

/** The phone's arrow: the HUD's bearing (1/256ths of a turn clockwise from straight ahead) as degrees for a CSS rotate. */
export function missedGateDegrees(bearing: number): number {
  return (bearing / 256) * 360;
}
