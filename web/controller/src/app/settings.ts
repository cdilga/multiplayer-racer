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

export type Layout = 'floating' | 'fixed';
export type Steering = 'gentle' | 'direct';
export type CameraDistance = 'near' | 'host' | 'far';

export interface ControllerPreferences {
  v: 1;
  layout: Layout;
  steering: Steering;
  cameraDistance: CameraDistance;
  vibration: boolean;
  reducedMotion: boolean;
  /** Full screen and a screen wake lock where the phone allows it (R101). */
  keepAwake: boolean;
  remember: boolean;
}

export const DEFAULTS: ControllerPreferences = {
  v: 1,
  layout: 'floating',
  steering: 'gentle',
  cameraDistance: 'host',
  vibration: true,
  reducedMotion: false,
  keepAwake: true,
  remember: true,
};

/** The approved response presets: dead zone and exponent for `apply_curve`. Both are monotonic and reach 1 at full deflection. */
export const PRESETS: Record<Steering, { deadzone: number; gamma: number }> = {
  gentle: { deadzone: 0.06, gamma: 1.5 },
  direct: { deadzone: 0.03, gamma: 1 },
};

/** Applies the personal curve to one stick sample (per axis, y keeps its sign). */
export function shape(v: Stick, steering: Steering): Stick {
  const { deadzone, gamma } = PRESETS[steering];
  return { x: apply_curve(v.x, deadzone, gamma), y: apply_curve(v.y, deadzone, gamma), touch: v.touch };
}

const oneOf = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** A stored (or any) value read back into a valid record: each unknown or invalid field takes its default. */
export function sanitise(raw: unknown): ControllerPreferences {
  const r = raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 1 ? (raw as Record<string, unknown>) : {};
  return {
    v: 1,
    layout: oneOf(r.layout, ['floating', 'fixed'], DEFAULTS.layout),
    steering: oneOf(r.steering, ['gentle', 'direct'], DEFAULTS.steering),
    cameraDistance: oneOf(r.cameraDistance, ['near', 'host', 'far'], DEFAULTS.cameraDistance),
    vibration: bool(r.vibration, DEFAULTS.vibration),
    reducedMotion: bool(r.reducedMotion, DEFAULTS.reducedMotion),
    keepAwake: bool(r.keepAwake, DEFAULTS.keepAwake),
    remember: bool(r.remember, DEFAULTS.remember),
  };
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
  you: { number: number; colour: string; name: string };
  /** Whether a reset needs a confirmation the page supplies (default: a second tap). */
  confirm?: (title: string) => Promise<boolean>;
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
        ${note}
      </div>
      <div class="actions" data-box="actions">
        <button type="button" class="btn primary big" data-act="save">Save and back to driving</button>
        <button type="button" class="btn" data-act="test">Test these controls</button>
        <button type="button" class="btn" data-act="reset">Reset controls</button>
        <div class="pair"><button type="button" class="btn" data-act="sitout">Sit out</button><button type="button" class="btn danger" data-act="leave">Leave room</button></div>
        <button type="button" class="btn quiet" data-act="back">Back</button>
      </div></div>`;
    this.wire();
  }

  private wire(): void {
    const q = (s: string) => this.el.querySelectorAll<HTMLElement>(s);
    q('[data-set]').forEach((b) => b.addEventListener('click', () => this.d.prefs.update({ [b.dataset.set!]: b.dataset.v } as Partial<ControllerPreferences>)));
    q('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle as 'vibration' | 'reducedMotion' | 'keepAwake' | 'remember';
        this.d.prefs.update({ [k]: !this.d.prefs.value[k] });
      }),
    );
    const on = (a: string, f: () => void) => this.el.querySelector(`[data-act=${a}]`)?.addEventListener('click', f);
    on('save', () => this.close());
    on('back', () => this.close());
    on('test', () => this.startTest());
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
    this.readout();
    body.querySelector('[data-act=test-done]')!.addEventListener('click', () => {
      this.test?.drive.release();
      this.test?.action.release();
      this.test = null;
      this.render();
    });
  }

  private readout(): void {
    const f = (s: Stick) => `x ${s.x.toFixed(2)}  y ${s.y.toFixed(2)}`;
    const r = this.el.querySelector('[data-read]');
    if (r) r.textContent = `Drive ${f(this.testValues.drive)}   Action ${f(this.testValues.action)}`;
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
    this.test?.drive.release();
    this.test?.action.release();
    this.test = null;
    this.unsub();
    this.el.remove();
    this.d.onClose();
  }
}
