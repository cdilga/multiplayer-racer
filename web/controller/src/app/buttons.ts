// The Buttons layout (R130, P1-FL13): a steer stick plus on-screen buttons, chosen per player (which inputs get a button,
// in which of the pad's six slots, the stick on the left or the right). It drives the same compact input as the sticks
// (R80): the buttons and the stick compose the one-stick (classic) layout's two sticks, so the host reads them with the
// classic semantics it already has.
// - The steer stick is the left stick's X (only X: its Y is the Gas and Brake buttons').
// - Gas pushes the left stick full up, Brake/Reverse full down (both held: neither). Holding Brake from a stop, then
//   letting go, is the classic launch (the pull-and-release the sticks do).
// - Boost holds the right stick to the right (its held sector); Fire pushes it up (the forward utility: OI!, the item)
//   and Drop down (the rear one: the cone), each once per press. A Fire or Drop press passes through neutral first, so
//   it fires even while Boost is held, and takes the right stick until it is let go.
// Every press is its own pointer: thumbs on the stick, Gas and Boost at once all count (multi-touch).
import { attachStick, type StickHandle } from './sticks';
import { BUTTON_INPUTS, type ButtonInput, type ButtonsLayout } from './prefs-data';
import type { Stick } from './session';

/** The label each input wears on its button. */
export const BUTTON_LABELS: Record<ButtonInput, string> = {
  gas: 'Gas',
  brake: 'Brake',
  boost: 'Boost',
  fire: 'Fire',
  drop: 'Drop',
};

/** What each input does, for screen readers and the settings sheet. */
export const BUTTON_HINTS: Record<ButtonInput, string> = {
  gas: 'Accelerate',
  brake: 'Brake and reverse; hold from a stop and let go to launch',
  boost: 'Boost while held',
  fire: 'Fire forward: OI! or your item',
  drop: 'Drop behind: a cone',
};

/** The pad's slots, row-major from the top as the pad is seen with the stick on the left (mirrored when it's on the right,
 *  so a slot stays where the same thumb finds it). */
export const SLOT_NAMES = ['Top inside', 'Top middle', 'Top outside', 'Bottom inside', 'Bottom middle', 'Bottom outside'] as const;

export interface ButtonsHandle {
  /** The composed sticks, as `attachStick` hands them (the view shapes and sends them like the sticks'). */
  readonly drive: StickHandle;
  readonly action: StickHandle;
  /** Which inputs are held now (for the tests and the tutorial). */
  held(): ButtonInput[];
}

const neutral = (): Stick => ({ x: 0, y: 0, touch: false });

/** Builds the steer zone and the pad into `area` and wires them: `onChange` gets every change, as the sticks' does. */
export function buttonsArea(area: HTMLElement, layout: ButtonsLayout, onChange: () => void, fixed: boolean, vibrate: () => boolean): ButtonsHandle {
  const steer = document.createElement('div');
  steer.className = 'zone steer';
  steer.dataset.box = 'zone-steer';
  steer.setAttribute('aria-label', 'Steer stick: left and right');
  steer.innerHTML = `<span class="tag display">Steer</span><div class="base"><div class="knob"></div></div>`;
  const pad = document.createElement('div');
  pad.className = `pad${layout.steer === 'right' ? ' mirrored' : ''}`;
  pad.dataset.box = 'pad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Driving buttons');
  const at = new Map<number, ButtonInput>();
  for (const k of BUTTON_INPUTS) {
    const s = layout.slots[k];
    if (s !== null) at.set(s, k);
  }
  for (let slot = 0; slot < 6; slot++) {
    const k = at.get(slot);
    const cell = document.createElement('div');
    cell.className = 'slot';
    cell.dataset.slot = String(slot);
    if (k) {
      cell.innerHTML = `<button type="button" class="btn brush padbtn" data-input="${k}" aria-label="${BUTTON_LABELS[k]}: ${BUTTON_HINTS[k]}"><span class="display">${BUTTON_LABELS[k]}</span></button>`;
    }
    pad.append(cell);
  }
  if (layout.steer === 'right') area.append(pad, steer);
  else area.append(steer, pad);

  const pressed = new Map<ButtonInput, Set<number>>(BUTTON_INPUTS.map((k) => [k, new Set<number>()]));
  const isHeld = (k: ButtonInput) => (pressed.get(k)?.size ?? 0) > 0;
  const drive: Stick = neutral();
  const action: Stick = neutral();
  let steerValue: Stick = neutral();
  const compose = () => {
    const [gas, brake] = [isHeld('gas'), isHeld('brake')];
    drive.x = steerValue.x;
    drive.y = gas === brake ? 0 : gas ? -1 : 1;
    drive.touch = steerValue.touch || gas || brake;
    const [fire, drop, boost] = [isHeld('fire'), isHeld('drop'), isHeld('boost')];
    action.x = fire || drop ? 0 : boost ? 1 : 0;
    action.y = fire ? -1 : drop ? 1 : 0;
    action.touch = fire || drop || boost;
  };
  const steerHandle = attachStick(steer, (v) => {
    steerValue = { x: v.x, y: 0, touch: v.touch };
    compose();
    onChange();
  }, fixed, vibrate);

  const press = (btn: HTMLButtonElement, k: ButtonInput, pointer: number, down: boolean) => {
    const set = pressed.get(k)!;
    const was = set.size > 0;
    if (down) set.add(pointer);
    else set.delete(pointer);
    const now = set.size > 0;
    btn.classList.toggle('pressed', now);
    btn.classList.toggle('is-pressed', now);
    if (was === now) return;
    if (now && vibrate() && 'vibrate' in navigator) navigator.vibrate?.(8);
    // A utility press goes through neutral first, so its sector is entered afresh even out of a held Boost.
    if (now && (k === 'fire' || k === 'drop')) {
      action.x = 0;
      action.y = 0;
      action.touch = false;
      onChange();
    }
    compose();
    onChange();
  };
  for (const btn of pad.querySelectorAll<HTMLButtonElement>('.padbtn')) {
    const k = btn.dataset.input as ButtonInput;
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety; the button's own events still arrive.
      }
      press(btn, k, e.pointerId, true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      btn.addEventListener(type, (e) => press(btn, k, (e as PointerEvent).pointerId, false));
    }
    // A long press must not open the phone's menus or select the label.
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const releaseAll = () => {
    steerHandle.release();
    for (const [k, set] of pressed) {
      set.clear();
      pad.querySelector(`[data-input=${k}]`)?.classList.remove('pressed', 'is-pressed');
    }
    compose();
    onChange();
  };
  compose();
  return {
    drive: { get value() { return drive; }, release: releaseAll },
    action: { get value() { return action; }, release: releaseAll },
    held: () => BUTTON_INPUTS.filter(isHeld),
  };
}
