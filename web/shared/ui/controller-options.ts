// P1-C12: browser device facts are guidance, never source/seat limits. Keep scanning every API entry.
export function morePadsHint(pads: readonly (Gamepad | null)[], userAgent = navigator.userAgent): string {
  const chromium = /(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent);
  return chromium && pads.filter((p) => p?.connected).length >= 4
    ? 'For more pads, join this room on another laptop or phone and plug them in there, or use Firefox.'
    : '';
}
