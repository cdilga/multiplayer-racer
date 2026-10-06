// Motion tokens with their Reduced variants (tokens.motion.named, from tokens.generated.ts; the POC reads them in
// art/ui/poc/motion/reel.js). Reduced motion removes shake, flashes, overshoot and scale, never information, controls or
// timing (experience direction section 2), so a reduced variant keeps the thing that happens and changes how it moves.
import { tokenData } from './tokens.generated';

export type MotionName = keyof typeof tokenData.motion;
export interface MotionSpec {
  durationMs: number;
  easing: string | undefined;
  repeat: number;
  does: string;
}

type Raw = { durationMs: number; easing?: string; repeat?: number; does: string; reduced: { durationMs: number; repeat?: number; does: string } };
const EASE: Record<string, string> = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  sticker: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export type MotionMode = 'full' | 'reduced';

/** The mode the page is in: `data-motion` on <html> forces one (the kit page and settings do), else the OS preference. */
export function motionMode(root: HTMLElement = document.documentElement): MotionMode {
  const forced = root.dataset.motion;
  if (forced === 'full' || forced === 'reduced') return forced;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
}

/** The named motion's timing in the given (default: current) mode. A reduced variant has no easing overshoot. */
export function motion(name: MotionName, mode: MotionMode = motionMode()): MotionSpec {
  const m = tokenData.motion[name] as Raw;
  const r = mode === 'reduced';
  return {
    durationMs: r ? m.reduced.durationMs : m.durationMs,
    easing: !r && m.easing ? EASE[m.easing] : undefined,
    repeat: (r ? m.reduced.repeat : m.repeat) ?? 1,
    does: r ? m.reduced.does : m.does,
  };
}

/**
 * The seat identify flash (R99, "Cooee #7"): tween the element's opacity-ish flash in the seat colour, fast attack and long
 * decay, `repeat` times. Reduced: no flash at all, the label shows for the same time and holds. Resolves when it is done.
 */
export function identify(el: HTMLElement, mode: MotionMode = motionMode()): Promise<void> {
  const spec = motion('identify-pulse', mode);
  const total = spec.durationMs * spec.repeat;
  if (mode === 'reduced' || typeof el.animate !== 'function') {
    el.classList.add('is-identifying');
    return new Promise((r) => setTimeout(() => (el.classList.remove('is-identifying'), r()), total));
  }
  const a = el.animate(
    [{ filter: 'brightness(1)', offset: 0 }, { filter: 'brightness(2.2) saturate(1.4)', offset: 0.15 }, { filter: 'brightness(1)', offset: 1 }],
    { duration: spec.durationMs, iterations: spec.repeat, easing: 'ease-out' },
  );
  return a.finished.then(() => undefined);
}
