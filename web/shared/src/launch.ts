// R127 gated start: how a seat's launch went, and the words the TV (over the car) and the phone (its banner) both use.
export type LaunchOutcome = 'Early' | 'Perfect' | 'Launch';

export const LAUNCH_TEXT: Record<LaunchOutcome, string> = {
  Early: 'EARLY! NO LAUNCH',
  Perfect: 'PERFECT START!',
  Launch: 'LAUNCH!',
};

/** How long the callout stays up, on the TV and the phone. */
export const LAUNCH_SHOWN_MS = 2200;
