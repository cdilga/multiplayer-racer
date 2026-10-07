// Personal controller settings (P1-C07), ported from the POC phone mock's settings sheet (art/ui/poc/phone/phone.js
// `settings()`): stick placement, steering response, camera distance, vibration, reduced motion, remember on this
// device, Test these controls, Sit out, Leave room (+ full screen / keep awake, R101).
//
// The record (master §10.6a) is versioned, per browser origin and realm, and holds preferences only: never seat grants,
// votes, Ready or scores. "Remember on this device" off applies in memory and removes any saved record. A browser that
// won't store says so ("Applied for now") and plays on. Unknown or invalid stored values fall back to the defaults, field
// by field. The response presets only reshape the stick's curve (monotonic over the whole range, full deflection stays 1):
// they never change force, speed, brake authority or stunt thresholds.
import { apply_curve } from '../pkg/jj_wasm_input.js';
import { stickZone, attachStick, type StickHandle } from './sticks';
import type { Stick } from './session';
import { DEFAULTS, PRESETS, sanitise, type CameraDistance, type ControllerPreferences, type Layout, type Steering, type TiltDeadzone, type TiltSensitivity } from './prefs-data';
import type { Tilt } from './tilt';

export { DEFAULTS, PRESETS, sanitise };
export type { CameraDistance, ControllerPreferences, Layout, Steering, TiltDeadzone, TiltSensitivity };

/** Applies the personal curve to one stick sample (per axis, y keeps its sign). */
export function shape(v: Stick, steering: Steering): Stick {
  const { deadzone, gamma } = PRESETS[steering];
  return { x: apply_curve(v.x, deadzone, gamma), y: apply_curve(v.y, deadzone, gamma), touch: v.touch };
}

export const SAVE_FAILED_NOTE = "Applied for now — this browser couldn't remember your settings";

export class Preferences {
  value: ControllerPreferences = { ...DEFAULTS };
  /** Storage refused the last write (or there is none): the settings hold for this session only. */
  saveFailed = false;
  private readonly listeners = new Set<(p: ControllerPreferences) => void>();

  /** Listens for changes; returns the unsubscribe. */
  subscribe(f: (p: ControllerPreferences) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  constructor(
    private readonly realm = 'dev',
    private readonly store: Storage | null = safeStorage(),
  ) {
    this.load();
  }

  private key(): string {
    return `jj.prefs.${this.realm}`;
  }

  private load(): void {
    try {
      const raw = this.store?.getItem(this.key());
      if (raw) this.value = sanitise(JSON.parse(raw));
    } catch {
      this.value = { ...DEFAULTS };
    }
    this.apply();
  }

  /** Changes some settings: applied now, saved if the player lets this device remember. */
  update(patch: Partial<ControllerPreferences>): void {
    this.value = sanitise({ ...this.value, ...patch, v: 1 });
    this.persist();
    this.apply();
    for (const f of this.listeners) f(this.value);
  }

  /** Restores the defaults (the caller confirms first). */
  reset(): void {
    this.update({ ...DEFAULTS });
  }

  private persist(): void {
    this.saveFailed = false;
    try {
      if (!this.store) throw new Error('no storage');
      if (this.value.remember) this.store.setItem(this.key(), JSON.stringify(this.value));
      else this.store.removeItem(this.key());
    } catch {
      this.saveFailed = this.value.remember;
    }
  }

  private apply(): void {
    // Reduced motion uses the kit's motion tokens (data-motion), else the OS preference stands.
    if (this.value.reducedMotion) document.documentElement.dataset.motion = 'reduced';
    else delete document.documentElement.dataset.motion;
  }
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.setItem('jj.probe', '1');
    s.removeItem('jj.probe');
    return s;
  } catch {
    return null;
  }
}

/** Whether this browser can vibrate at all (iOS Safari can't): the toggle says so instead of doing nothing. */
export const hasHaptics = (): boolean => typeof navigator.vibrate === 'function';

export interface SettingsDeps {
  prefs: Preferences;
  /** The sheet opened: the caller releases the sticks and sends `Menu{open:true}` (neutral first). */
  onOpen: () => void;
  /** The sheet closed (Save or Back): the caller makes sure the sticks are neutral, then sends `Menu{open:false}`. */
  onClose: () => void;
  onSitOut: () => void;
  onLeave: () => void;
  /** Identify from the menu: the same command as the tools row's button (the sheet stays open). */
  onIdentify?: () => void;
  you: { number: number; colour: string; name: string };
  /** Whether a reset needs a confirmation the page supplies (default: a second tap). */
  confirm?: (title: string) => Promise<boolean>;
  /** The play screen's tilt sensor (C07.2); its readings steer the DRIVE axis while the setting is on. */
  tilt?: Tilt;
}

const seg = (name: string, label: string, opts: Array<[string, string]>, cur: string) =>
  `<span class="seg${opts.length === 3 ? ' mini' : ''}" role="group" aria-label="${label}">${opts
    .map(([v, t]) => `<button type="button" class="${v === cur ? 'on' : ''}" data-set="${name}" data-v="${v}" aria-pressed="${v === cur}">${t}</button>`)
    .join('')}</span>`;

const toggle = (name: string, label: string, on: boolean, sub = '', disabled = false) =>
  `<div class="row${disabled ? ' off' : ''}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><button type="button" class="toggle${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-toggle="${name}"${disabled ? ' disabled' : ''}></button></div>`;

/** The settings sheet over the play screen. Returns a handle; `close()` is what Save and Back do. */
export class SettingsSheet {
  readonly el: HTMLElement;
  private test: { drive: StickHandle; action: StickHandle } | null = null;
  private testValues: { drive: Stick; action: Stick } = { drive: { x: 0, y: 0, touch: false }, action: { x: 0, y: 0, touch: false } };
  private resetArmed = 0;
  private closed = false;
  private tiltNote = '';
  private restoreTilt: () => void = () => {};
  private unsub: () => void = () => {};

  constructor(
    private readonly host: HTMLElement,
    private readonly d: SettingsDeps,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'menusheet settings-sheet';
    this.el.dataset.overlay = 'settings';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Your controls');
    this.el.style.setProperty('--seat', d.you.colour);
    host.append(this.el);
    this.unsub = d.prefs.subscribe(() => this.render());
    this.render();
    d.onOpen();
  }

  get open(): boolean {
    return !this.closed;
  }

  private render(): void {
    const p = this.d.prefs.value;
    const haptics = hasHaptics();
    const note = this.d.prefs.saveFailed ? `<p class="note warn" data-note="save-failed" role="status">${SAVE_FAILED_NOTE}.</p>` : '';
    this.el.innerHTML = `<div class="settings-body">
      <div class="banner settings-auto" data-box="banner" role="status"><span>Autopilot is driving your car<small>Everyone else keeps racing.</small></span></div>
      <div class="panel" data-box="controls"><h1 class="display italic">Your controls</h1>
        ${seg('layout', 'Stick placement', [['floating', 'Floating sticks'], ['fixed', 'Fixed sticks']], p.layout)}
        <div class="row">Steering${seg('steering', 'Steering response', [['gentle', 'Gentle'], ['direct', 'Direct']], p.steering)}</div>
        <div class="row">Camera distance${seg('cameraDistance', 'Camera distance', [['near', 'Near'], ['host', "Host's"], ['far', 'Far']], p.cameraDistance)}</div>
        ${toggle('vibration', 'Vibration', haptics && p.vibration, haptics ? '' : "This phone can't vibrate from a web page", !haptics)}
        ${toggle('reducedMotion', 'Reduced motion', p.reducedMotion, 'Fewer flashes, no shake')}
        ${toggle('keepAwake', 'Full screen, screen on', p.keepAwake, 'Where this phone allows it')}
        ${toggle('remember', 'Remember on this device', p.remember, 'Until you clear browser data')}
        ${this.tiltRows()}
        ${note}
      </div>
      <div class="actions" data-box="actions">
        <button type="button" class="btn primary big" data-act="save">Save and back to driving</button>
        <button type="button" class="btn identify" data-act="identify" aria-label="Identify: flash my number on the TV">Identify</button>
        <button type="button" class="btn" data-act="test">Test these controls</button>
        <button type="button" class="btn" data-act="reset">Reset controls</button>
        <div class="pair"><button type="button" class="btn" data-act="sitout">Sit out</button><button type="button" class="btn danger" data-act="leave">Leave room</button></div>
        <button type="button" class="btn quiet" data-act="back">Back</button>
      </div></div>`;
    this.wire();
  }

  /** The tilt steering rows (C07.2): off by default; once on, sensitivity, dead zone and Set neutral. */
  private tiltRows(): string {
    const t = this.d.tilt;
    const p = this.d.prefs.value;
    if (!t) return '';
    const live = p.tilt && (t.state === 'live' || t.state === 'waiting');
    const sub = t.state === 'denied' ? 'Motion access was refused' : t.state === 'no-sensor' ? 'This device has no motion sensor' : 'Turn the phone like a wheel; boost stays on the stick';
    const rows = live
      ? `<div class="row">Sensitivity${seg('tiltSensitivity', 'Tilt sensitivity', [['gentle', 'Gentle'], ['normal', 'Normal'], ['sharp', 'Sharp']], p.tiltSensitivity)}</div>
        <div class="row">Dead zone${seg('tiltDeadzone', 'Tilt dead zone', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], p.tiltDeadzone)}</div>
        <div class="row"><span>Straight ahead<small>Hold the phone how you'll drive, then tap</small></span><button type="button" class="btn" data-act="tilt-neutral">Set neutral</button></div>`
      : '';
    const note = this.tiltNote ? `<p class="note" data-note="tilt" role="status">${this.tiltNote}</p>` : '';
    return `${toggle('tilt', 'Tilt steering', live, sub, t.state === 'no-sensor')}${rows}${note}`;
  }

  private async tiltToggle(): Promise<void> {
    const t = this.d.tilt;
    if (!t) return;
    if (this.d.prefs.value.tilt && (t.state === 'live' || t.state === 'waiting')) {
      t.disable();
      this.tiltNote = '';
      return this.d.prefs.update({ tilt: false });
    }
    const st = await t.enable(); // inside the tap: iOS only asks for motion access in a user gesture
    this.tiltNote = st === 'denied' ? 'Motion access was refused, so tilt stays off.' : st === 'no-sensor' ? 'This device has no motion sensor, so tilt stays off.' : 'Tilt is on. Set neutral when you are holding the phone how you will drive.';
    this.d.prefs.update({ tilt: st === 'waiting' || st === 'live' });
    if (st === 'waiting') {
      // A device with the API but no sensor never sends a reading: when the sensor gives up, the setting goes back off.
      const giveUp = setInterval(() => {
        if (this.closed || t.state === 'live') return clearInterval(giveUp);
        if (t.state === 'no-sensor') {
          clearInterval(giveUp);
          this.tiltNote = 'This device has no motion sensor, so tilt stays off.';
          this.d.prefs.update({ tilt: false });
        }
      }, 250);
    }
  }

  private wire(): void {
    const q = (s: string) => this.el.querySelectorAll<HTMLElement>(s);
    q('[data-set]').forEach((b) => b.addEventListener('click', () => this.d.prefs.update({ [b.dataset.set!]: b.dataset.v } as Partial<ControllerPreferences>)));
    q('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle as 'vibration' | 'reducedMotion' | 'keepAwake' | 'remember' | 'tilt';
        if (k === 'tilt') return void this.tiltToggle();
        this.d.prefs.update({ [k]: !this.d.prefs.value[k] });
      }),
    );
    const on = (a: string, f: () => void) => this.el.querySelector(`[data-act=${a}]`)?.addEventListener('click', f);
    on('tilt-neutral', () => {
      const n = this.d.tilt?.calibrate();
      this.tiltNote = n === null || n === undefined ? 'No motion reading yet: move the phone a little and try again.' : 'Straight ahead set.';
      if (n !== null && n !== undefined) this.d.prefs.update({ tiltNeutral: Math.round(n * 10) / 10 });
      else this.render();
    });
    on('save', () => this.close());
    on('back', () => this.close());
    on('test', () => this.startTest());
    on('identify', () => this.d.onIdentify?.());
    on('reset', () => void this.reset());
    on('sitout', () => {
      this.close();
      this.d.onSitOut();
    });
    on('leave', () => {
      this.close();
      this.d.onLeave();
    });
  }

  /** Reset controls: confirmed first (a second tap within 3 s, or the page's own dialog). */
  private async reset(): Promise<void> {
    const ok = this.d.confirm ? await this.d.confirm('Reset your controls?') : this.tapTwice();
    if (ok) this.d.prefs.reset();
  }

  private tapTwice(): boolean {
    const now = Date.now();
    const b = this.el.querySelector<HTMLElement>('[data-act=reset]');
    if (now - this.resetArmed < 3000) return true;
    this.resetArmed = now;
    if (b) {
      b.textContent = 'Tap again to reset';
      setTimeout(() => b.isConnected && (b.textContent = 'Reset controls'), 3000);
    }
    return false;
  }

  /** "Test these controls": two live sticks with their numbers. Nothing here reaches the room: no input, no action. */
  private startTest(): void {
    this.test?.drive.release();
    this.test?.action.release();
    const body = this.el.querySelector('.settings-body')!;
    body.innerHTML = `<div class="panel test-panel" data-box="test"><h1 class="display italic">Test these controls</h1><p>Nothing here reaches the race.</p>
      <div class="test-sticks"><div class="test-col" data-col="drive"></div><div class="test-col" data-col="action"></div></div>
      <div class="test-read tnum" data-read role="status" aria-live="off"></div>
      <button type="button" class="btn primary big" data-act="test-done">Done</button></div>`;
    const cols = body.querySelectorAll<HTMLElement>('.test-col');
    const fixed = this.d.prefs.value.layout === 'fixed';
    const mk = (col: HTMLElement, kind: 'drive' | 'action') => {
      const z = stickZone(kind);
      col.append(z);
      return attachStick(z, (v) => {
        this.testValues[kind] = shape(v, this.d.prefs.value.steering);
        this.readout();
      }, fixed);
    };
    this.test = { drive: mk(cols[0]!, 'drive'), action: mk(cols[1]!, 'action') };
    const tilt = this.d.tilt;
    if (tilt) {
      const prev = tilt.onChange;
      tilt.onChange = () => {
        prev();
        this.readout();
      };
      this.restoreTilt = () => {
        tilt.onChange = prev;
        this.restoreTilt = () => {};
      };
    }
    this.readout();
    body.querySelector('[data-act=test-done]')!.addEventListener('click', () => {
      this.test?.drive.release();
      this.test?.action.release();
      this.test = null;
      this.restoreTilt();
      this.render();
    });
  }

  private readout(): void {
    const f = (s: Stick) => `x ${s.x.toFixed(2)}  y ${s.y.toFixed(2)}`;
    const r = this.el.querySelector('[data-read]');
    const tilt = this.d.tilt?.steer;
    // With tilt on, the steer axis shown is the phone's; the stick's own x is what it would be without it.
    const drive = tilt === null || tilt === undefined ? this.testValues.drive : { ...this.testValues.drive, x: tilt };
    if (r) r.textContent = `Drive ${f(drive)}   Action ${f(this.testValues.action)}${tilt === null || tilt === undefined ? '' : '   (tilt steers)'}`;
  }

  /** The play screen was rebuilt (the phone turned): carry the open sheet onto the new one. */
  rehost(host: HTMLElement): void {
    host.append(this.el);
  }

  /** The live test stick values (for the journey test). */
  inspectTest(): { drive: Stick; action: Stick } | null {
    return this.test ? { drive: { ...this.testValues.drive }, action: { ...this.testValues.action } } : null;
  }

  /** Save and Back, both: the test sticks are let go, the sheet goes, and the caller sends `Menu{open:false}` neutral. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.restoreTilt();
    this.test?.drive.release();
    this.test?.action.release();
    this.test = null;
    this.unsub();
    this.el.remove();
    this.d.onClose();
  }
}
