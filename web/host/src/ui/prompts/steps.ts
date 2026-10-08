// The first-drive prompts on a seat's tile (P1-C06): the same seven controls as the phone's tutorial card, in the order
// they are taught. The host detects each control for the seat (`room_json` seat `prompt: {step, of, done}`), so this is only
// wording: a short title, one plain line, and the goals that tick. Goal ids match `crates/jj-wasm-host/src/host/prompts.rs`.
export interface PromptStep {
  title: string;
  text: string;
  goals: Array<[id: string, label: string]>;
}

export const PROMPT_STEPS: PromptStep[] = [
  { title: 'Steer', text: 'Push the left stick right, then left', goals: [['right', 'Right'], ['left', 'Left']] },
  { title: 'Go and stop', text: 'Left stick up to drive, back to brake', goals: [['go', 'Go'], ['stop', 'Brake']] },
  { title: 'Boost', text: 'Hold the right stick right', goals: [['boost', 'Boost']] },
  { title: 'Drift', text: 'Hold the right stick left in a corner', goals: [['drift', 'Drift']] },
  { title: 'OI!', text: 'Flick the right stick up', goals: [['oi', 'OI!']] },
  { title: 'Cone', text: 'Flick the right stick down', goals: [['cone', 'Cone']] },
  { title: 'Wheelie', text: 'Pull the left stick back, hold, let go', goals: [['wheelie', 'Wheelie']] },
];

export interface SeatPrompt {
  step: number;
  of: number;
  done: string[];
}

/** The caption's markup for a seat's prompt (escaped: only static wording goes in). */
export function promptHtml(p: SeatPrompt): string {
  const st = PROMPT_STEPS[p.step];
  if (!st) return '';
  const goals = st.goals.map(([id, label]) => `<span class="pg${p.done.includes(id) ? ' on' : ''}">${p.done.includes(id) ? '✓ ' : ''}${label}</span>`).join('');
  return `<span class="pn">${p.step + 1}/${p.of}</span><b class="pt">${st.title}</b><span class="px">${st.text}</span><span class="pgs">${goals}</span>`;
}
