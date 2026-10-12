// The first-drive prompts on a seat's tile (P1-C06): the same six controls as the phone's tutorial card, in the order
// they are taught. The host detects each control for the seat (`room_json` seat `prompt: {step, of, done}`), so this is only
// wording: a short title, one plain line, and the goals that tick. Goal ids match `crates/jj-wasm-host/src/host/prompts.rs`.
import { type ControlsData, type ControlsSource, type PromptStepId, promptGlyphs } from '../../../../shared/ui';

export interface PromptStep {
  title: string;
  text: string;
  goals: Array<[id: string, label: string]>;
}

export const PROMPT_STEPS: PromptStep[] = [
  { title: 'Steer', text: 'Right stick: push right, then left', goals: [['right', 'Right'], ['left', 'Left']] },
  { title: 'Go and stop', text: 'Left stick up to drive, back to brake', goals: [['go', 'Go'], ['stop', 'Brake']] },
  { title: 'Drift', text: 'Left stick all the way to the side, then let go', goals: [['drift', 'Drift']] },
  { title: 'Launch', text: 'Left stick: pull back, then snap forward', goals: [['launch', 'Launch']] },
  { title: 'OI!', text: 'Flick the right stick up', goals: [['oi', 'OI!']] },
  { title: 'Cone', text: 'Flick the right stick down', goals: [['cone', 'Cone']] },
];

export interface SeatPrompt {
  step: number;
  of: number;
  done: string[];
}

const STEP_IDS: PromptStepId[] = ['steer', 'go', 'drift', 'launch', 'oi', 'cone'];

/** The caption's markup for a seat's prompt (escaped: only static wording and the controls card's own glyphs go in). A pad, wheel or
 *  key cluster seat is coached in its own glyphs (P1-C14: W and IJKL, the stick, the pedals), never a phone's wording. */
export function promptHtml(p: SeatPrompt, source?: ControlsSource, data?: ControlsData): string {
  const st = PROMPT_STEPS[p.step];
  if (!st) return '';
  const own = source && data ? promptGlyphs(STEP_IDS[p.step]!, source, data) : null;
  if (own !== null) {
    const goals = st.goals.map(([id, label]) => `<span class="pg${p.done.includes(id) ? ' on' : ''}">${p.done.includes(id) ? '✓ ' : ''}${label}</span>`).join('');
    return `<span class="pn">${p.step + 1}/${p.of}</span><b class="pt">${st.title}</b><span class="px" data-glyphs="${source!.kind}">${own}</span><span class="pgs">${goals}</span>`;
  }
  const goals = st.goals.map(([id, label]) => `<span class="pg${p.done.includes(id) ? ' on' : ''}">${p.done.includes(id) ? '✓ ' : ''}${label}</span>`).join('');
  return `<span class="pn">${p.step + 1}/${p.of}</span><b class="pt">${st.title}</b><span class="px">${st.text}</span><span class="pgs">${goals}</span>`;
}
