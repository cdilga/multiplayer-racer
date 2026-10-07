// Tutorial-lite (P1-C06), ported from the POC phone mock's coach (art/ui/poc/phone/phone.js, POC1-20, R101): a big
// central card in the Lobby (there's no warm-up drive, R110), one step at a time, each ticking off when the player does
// the gesture: steer, brake/reverse, boost, drift, OI!, cone, wheelie. Skip is one tap and remembered for this player;
// Help shows it again. It only coaches: it never pauses anyone, blocks Ready or holds a race.
import type { Stick } from './session';

type Goals = Record<string, boolean>;
interface Step {
  title: string;
  text: string;
  goals: Array<[string, string]>;
  stick?: (kind: 'drive' | 'action', v: Stick, g: Goals) => void;
  action?: (kind: number, g: Goals) => void;
}

/** `jj-wasm-input` action kinds (KIND_*). */
const WHEELIE = 0;
const OI = 1;
const CONE = 2;

export const STEPS: Step[] = [
  { title: 'Steer', text: 'Push the left stick right, then left.', goals: [['right', 'Right'], ['left', 'Left']], stick: (k, v, g) => {
    if (k === 'drive' && v.x > 0.7) g.right = true;
    if (k === 'drive' && v.x < -0.7) g.left = true;
  } },
  { title: 'Go and stop', text: 'Push the left stick up to drive, then pull it back to brake and reverse.', goals: [['go', 'Go'], ['stop', 'Brake']], stick: (k, v, g) => {
    if (k === 'drive' && v.y < -0.7) g.go = true;
    if (k === 'drive' && g.go && v.y > 0.7) g.stop = true;
  } },
  { title: 'Boost', text: 'Hold the right stick to the right.', goals: [['boost', 'Boost']], stick: (k, v, g) => {
    if (k === 'action' && v.x > 0.7) g.boost = true;
  } },
  { title: 'Drift', text: 'Hold the right stick to the left through a corner.', goals: [['drift', 'Drift']], stick: (k, v, g) => {
    if (k === 'action' && v.x < -0.7) g.drift = true;
  } },
  { title: 'OI!', text: 'Flick the right stick up: your headlights flash and everyone hears it.', goals: [['oi', 'OI!']], action: (a, g) => {
    if (a === OI) g.oi = true;
  } },
  { title: 'Cone', text: 'Flick the right stick down to drop a cone behind you.', goals: [['cone', 'Cone']], action: (a, g) => {
    if (a === CONE) g.cone = true;
  } },
  { title: 'Wheelie', text: 'Pull the left stick all the way back, hold until the ring fills, then let go.', goals: [['wheelie', 'Wheelie']], action: (a, g) => {
    if (a === WHEELIE) g.wheelie = true;
  } },
];

const KEY = 'jj.tutorial';

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEY, 'done');
  } catch {
    // Storage denied: it simply shows again next visit.
  }
}

export class Tutorial {
  step = 0;
  goals: Goals = {};
  done: number[] = [];
  card: HTMLElement | null = null;
  private advancing = false;

  /** Whether a newcomer should see it (not skipped or finished before). */
  static wanted(): boolean {
    return !remembered();
  }

  constructor(private readonly area: HTMLElement) {}

  show(from = 0): void {
    this.step = from;
    this.goals = {};
    this.card?.remove();
    this.card = document.createElement('div');
    this.card.className = 'panel coach';
    this.card.dataset.overlay = 'coach';
    this.area.classList.add('coaching');
    this.area.append(this.card);
    this.render();
  }

  close(finished: boolean): void {
    this.card?.remove();
    this.card = null;
    this.area.classList.remove('coaching');
    remember();
    void finished;
  }

  get open(): boolean {
    return this.card !== null;
  }

  private render(won = false): void {
    if (!this.card) return;
    if (this.step >= STEPS.length) {
      this.card.innerHTML = `<h2 class="display italic">You're ready</h2><p>That's every control. Tap Ready when you are.</p><button class="btn primary big" data-act="done">Let's race</button>`;
      this.card.querySelector('[data-act=done]')!.addEventListener('click', () => this.close(true));
      return;
    }
    const st = STEPS[this.step]!;
    const goals = st.goals.map(([k, label]) => `<span class="goal${this.goals[k] || won ? ' on' : ''}">${this.goals[k] || won ? '✓ ' : ''}${label}</span>`).join('');
    const dots = STEPS.map((_, i) => `<i class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"></i>`).join('');
    this.card.innerHTML = `<div class="coach-top"><span class="tag"><span>Step ${this.step + 1} of ${STEPS.length}</span></span><button class="btn quiet-ink" data-act="skip">Skip tutorial</button></div>
      <h2 class="display italic">${st.title}</h2><p>${st.text}</p><div class="goals">${goals}</div>
      ${won ? '<span class="goodstrip"><span>Nice! On to the next one</span></span>' : `<div class="dots">${dots}</div>`}`;
    this.card.querySelector('[data-act=skip]')!.addEventListener('click', () => this.close(false));
  }

  private check(): void {
    const st = STEPS[this.step];
    if (!st || this.advancing) return;
    if (!st.goals.every(([k]) => this.goals[k])) return this.render();
    this.advancing = true;
    this.done.push(this.step);
    this.render(true);
    setTimeout(() => {
      this.advancing = false;
      this.step += 1;
      this.goals = {};
      this.render();
    }, 700);
  }

  stick(kind: 'drive' | 'action', v: Stick): void {
    const st = STEPS[this.step];
    if (!this.card || !st?.stick) return;
    const before = JSON.stringify(this.goals);
    st.stick(kind, v, this.goals);
    if (JSON.stringify(this.goals) !== before) this.check();
  }

  action(kind: number): void {
    const st = STEPS[this.step];
    if (!this.card || !st?.action) return;
    const before = JSON.stringify(this.goals);
    st.action(kind, this.goals);
    if (JSON.stringify(this.goals) !== before) this.check();
  }

  inspect(): Record<string, unknown> {
    return { open: this.open, step: this.step, done: [...this.done], goals: { ...this.goals } };
  }
}
