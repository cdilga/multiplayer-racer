// br-bhkz.2 (owner 2026-11-17: the derby's "strategies to actually win wasn't at all clear. I seemed to die more
// somehow"): how a derby reads on the TV and the phone. The same words and the same car diagram in both places.
//
// - Health zones (`DerbyHud::health`, the room view's `derby.health`): percent 0..100 of the front, the back, the left
//   doors, the right doors and the weakest wheel; 255 where the car has no such part.
// - The latest scoring hit (`hit_seq`, points, `what`): one ram, blast or peck and all it did within half a second.
// - The three things that win a derby, shown until a player has landed a hit.

/** `DerbyHud::hit_what` (jj_protocol::state::derby_hit). */
export const DERBY_HIT_TEXT: Record<number, string> = {
  0: 'HIT!',
  1: 'HEAD-ON!',
  2: 'REAR-ENDER!',
  3: 'T-BONE!',
  4: 'WHEEL HIT!',
  5: 'PART OFF!',
  6: 'WRECKED ’EM!',
};

/** How long a hit's callout stays up after its last change, on the TV and the phone. */
export const DERBY_HIT_SHOWN_MS = 1800;

/** How to win, in the order a player needs it. */
export const DERBY_TIPS = ['Hit them at speed: the faster car wins the hit', 'Doors and wheels are weak · a wheel off is a wreck', 'Shove them into the rocks · grab every box'];
/** The one line that fits a phone. */
export const DERBY_TIP_SHORT = 'Ram at speed · hit doors and wheels';

/** Whole points (damage is fractional: 126.78 reads 127). */
export const derbyPoints = (p: number): string => String(Math.round(p));

/** `+12 T-BONE!` (never `+0`: a hit that scored shows at least 1). */
export const derbyHitText = (points: number, what: number): string => `+${Math.max(1, Math.round(points))} ${DERBY_HIT_TEXT[what] ?? DERBY_HIT_TEXT[0]}`;

export type HealthTone = 'none' | 'gone' | 'low' | 'mid' | 'ok';
/** A zone's tone: no such part, gone, under 30 %, under 60 %, or fine. */
export const healthTone = (pct: number | undefined): HealthTone => (pct === undefined || pct > 100 ? 'none' : pct <= 0 ? 'gone' : pct < 30 ? 'low' : pct < 60 ? 'mid' : 'ok');

const ZONES = ['front', 'back', 'left', 'right', 'wheels'] as const;
const ZONE_WORDS = { front: 'front', back: 'back', left: 'left doors', right: 'right doors', wheels: 'wheels' };

/** What the diagram says, for a screen reader: `front 100 %, back 62 %, left doors gone, …`. */
export const healthLabel = (health: ArrayLike<number>): string =>
  ZONES.map((z, i) => [z, health[i]] as const)
    .filter(([, v]) => healthTone(v) !== 'none')
    .map(([z, v]) => `${ZONE_WORDS[z]} ${v! <= 0 ? 'gone' : `${v} %`}`)
    .join(', ');

/** The car from above, nose up: the front, the two sides, the back and the four wheels, each toned by its health. A zone
 *  whose health dropped since `before` carries `hurt` (the stylesheet flashes it). Inline SVG: no asset, any size. */
export function carDiagram(health: ArrayLike<number>, before?: ArrayLike<number> | null): string {
  const cls = (i: number) => {
    const hurt = before && before[i] !== undefined && health[i] !== undefined && health[i]! < before[i]! ? ' hurt' : '';
    return `class="z ${healthTone(health[i])}${hurt}" data-zone="${ZONES[i]}" data-health="${health[i] ?? 255}"`;
  };
  const wheel = (x: number, y: number) => `<rect ${cls(4)} x="${x}" y="${y}" width="9" height="20" rx="3"/>`;
  return `<svg class="derby-car" viewBox="0 0 64 104" role="img" aria-label="Your car: ${healthLabel(health)}">
    ${wheel(1, 16)}${wheel(54, 16)}${wheel(1, 68)}${wheel(54, 68)}
    <path ${cls(0)} d="M14 30 V16 Q14 4 32 4 Q50 4 50 16 V30 Z"/>
    <rect ${cls(2)} x="14" y="33" width="17" height="38" rx="2"/>
    <rect ${cls(3)} x="33" y="33" width="17" height="38" rx="2"/>
    <path ${cls(1)} d="M14 74 H50 V90 Q50 100 32 100 Q14 100 14 90 Z"/>
  </svg>`;
}
