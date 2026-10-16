// Controls cards (P1-C14): how to drive each kind of source, drawn with that source's own glyphs. One builder serves the
// host's lobby tiles, the race tile while Identify is held, the input drawer, the host menu's Controls page and the phone's
// Help. It reads the key clusters and wheel profiles it is given (the host's clusters.json and wheels.json, never a copy), the
// pad's and phone's wording from controls.json, so a card cannot drift from the mapping. Pure strings: no DOM, no renderer.
// Layout (R116/R120): the right stick steers and flicks (OI! up, cone down); the left stick drives, brakes and launches (pull back,
// snap forward; its sideways push is nothing, R128). A touch hint never appears on a pad, wheel or key card.
import words from './controls.json';

type Stick = { up: string; down: string; left: string; right: string };
export interface ControlsCluster {
  id: number;
  label: string;
  drive: Stick;
  action: { up: string; down: string };
  identify: string;
  ready: string;
}
export interface ControlsWheel {
  label: string;
  buttons: Partial<Record<'boost' | 'oi' | 'cone' | 'identify' | 'ready', number>>;
}
export interface ControlsData {
  clusters: ControlsCluster[];
  wheels: ControlsWheel[];
}
export type ControlsSource =
  | { kind: 'phone' }
  | { kind: 'pad' }
  | { kind: 'wheel'; profile?: string }
  | { kind: 'keys'; cluster: number };
export type ControlId = 'steer' | 'go' | 'launch' | 'flick' | 'identify' | 'ready';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A KeyboardEvent.code as a keycap label: KeyW is W, ArrowUp is an arrow. */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return arrows[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
const keycap = (code: string) => `<kbd class="jj-key" data-code="${esc(code)}">${esc(keyLabel(code))}</kbd>`;
const keycaps = (...codes: string[]) => codes.map(keycap).join('');
/** A stick glyph: which stick (L or R) and where it is pushed (u, d, l, r; "lr" shows both sides). */
const stick = (side: 'L' | 'R', dir: 'u' | 'd' | 'l' | 'r' | 'lr'): string =>
  dir === 'lr' ? stick(side, 'l') + stick(side, 'r') : `<span class="jj-stick" data-side="${side}" data-dir="${dir}" role="img" aria-label="${side === 'L' ? 'Left' : 'Right'} stick ${{ u: 'up', d: 'down', l: 'left', r: 'right' }[dir]}"><i></i></span>`;
/** A labelled pair: the stick's side (L or R) and where it goes, so a pad card says which stick without a word. */
const sg = (side: 'L' | 'R', ...dirs: Array<'u' | 'd' | 'l' | 'r' | 'lr'>): string => `<span class="jj-sg"><em>${side}</em>${dirs.map((d) => stick(side, d)).join('')}</span>`;
const pill = (text: string) => `<span class="jj-pill">${esc(text)}</span>`;
const then = '<span class="jj-then" aria-label="then">›</span>';

/** The cluster behind a source (the first cluster when its id is unknown, so a card always renders). */
function clusterOf(src: ControlsSource & { kind: 'keys' }, data: ControlsData): ControlsCluster | undefined {
  return data.clusters.find((c) => c.id === src.cluster) ?? data.clusters[0];
}

/** The seat-source kinds a Controls page lists, in order: phone, pad, wheel, then every cluster. */
export function sourceKinds(data: ControlsData): ControlsSource[] {
  return [{ kind: 'phone' }, { kind: 'pad' }, { kind: 'wheel' }, ...data.clusters.map((c): ControlsSource => ({ kind: 'keys', cluster: c.id }))];
}

export function sourceLabel(src: ControlsSource, data: ControlsData): string {
  if (src.kind === 'keys') return clusterOf(src, data)?.label ?? 'Keys';
  return words[src.kind].label;
}

const wheelButton = (src: ControlsSource & { kind: 'wheel' }, data: ControlsData, name: keyof ControlsWheel['buttons'], fallback: string): string => {
  const n = data.wheels.find((w) => w.label === src.profile)?.buttons[name];
  return pill(n === undefined ? fallback : `Button ${n + 1}`);
};

/** One control's glyphs for a source (HTML). */
export function glyphs(src: ControlsSource, id: ControlId, data: ControlsData): string {
  if (src.kind === 'keys') {
    const c = clusterOf(src, data);
    if (!c) return '';
    return {
      steer: keycaps(c.drive.left, c.drive.right),
      go: keycaps(c.drive.up, c.drive.down),
      launch: keycap(c.drive.down) + then + keycap(c.drive.up),
      flick: keycaps(c.action.up, c.action.down),
      identify: keycap(c.identify),
      ready: keycap(c.ready),
    }[id];
  }
  if (src.kind === 'wheel') {
    const w = words.wheel;
    return {
      steer: pill(w.steer),
      go: pill(w.go) + pill(w.brake),
      launch: pill(w.brake) + then + pill(w.go),
      flick: wheelButton(src, data, 'oi', w.oi) + wheelButton(src, data, 'cone', w.cone),
      identify: wheelButton(src, data, 'identify', w.identify),
      ready: wheelButton(src, data, 'ready', w.ready),
    }[id];
  }
  const phone = src.kind === 'phone';
  return {
    steer: sg('R', 'l', 'r'),
    go: sg('L', 'u', 'd'),
    launch: sg('L', 'd') + then + stick('L', 'u'),
    flick: sg('R', 'u', 'd'),
    identify: pill(phone ? words.phone.identify : words.pad.identify),
    ready: pill(phone ? words.phone.ready : words.pad.ready),
  }[id];
}

const ROWS: Array<[ControlId, string, string]> = [
  ['steer', 'Steer', ''],
  ['go', 'Go · brake', ''],
  ['launch', 'Launch', 'pull back, snap'],
  ['flick', 'OI! · cone', 'flick'],
  ['identify', 'Identify', 'hold'],
  ['ready', 'READY', ''],
];

/** One card: a short header and one line per control. `compact` is the two-column form for a tile or a strip. */
export function controlsCard(src: ControlsSource, data: ControlsData, opts: { compact?: boolean; title?: string } = {}): string {
  const id = src.kind === 'keys' ? `keys-${clusterOf(src, data)?.id ?? 0}` : src.kind;
  const label = opts.title ?? sourceLabel(src, data);
  const rows = ROWS.map(([c, name, hint]) => `<li data-ctl="${c}"><span class="jj-cn">${name}</span><span class="jj-cg">${glyphs(src, c, data)}</span>${hint && !opts.compact ? `<small>${hint}</small>` : ''}</li>`).join('');
  return `<section class="jj-cc${opts.compact ? ' compact' : ''}" data-card="${id}" data-kind="${src.kind}" aria-label="${esc(label)} controls"><header><b>${esc(label)}</b></header><ul>${rows}</ul></section>`;
}

/** The Controls page: one card per source kind (phone, pad, wheel, every cluster), plus the wheels the host knows. */
export function controlsPage(data: ControlsData, opts: { compact?: boolean } = {}): string {
  const cards = sourceKinds(data).map((s) => controlsCard(s, data, opts)).join('');
  const wheels = data.wheels.length ? `<p class="jj-cnote" data-wheels>Wheels known: ${data.wheels.map((w) => esc(w.label)).join(', ')}. Any other wheel maps in the input drawer.</p>` : '';
  return `<div class="jj-cpage" data-controls-page>${cards}${wheels}</div>`;
}

export type PromptStepId = 'steer' | 'go' | 'launch' | 'oi' | 'cone';
/** The wording of a first-drive prompt (P1-C06) in this source's own glyphs; null for a phone (its text stays in steps.ts). */
export function promptGlyphs(step: PromptStepId, src: ControlsSource, data: ControlsData): string | null {
  if (src.kind === 'phone') return null;
  if (src.kind === 'keys') {
    const c = clusterOf(src, data);
    if (!c) return null;
    return {
      steer: `${keycap(c.drive.right)}${then}${keycap(c.drive.left)}`,
      go: `${keycap(c.drive.up)} drive ${keycap(c.drive.down)} brake`,
      launch: `Hold ${keycap(c.drive.down)}, then ${keycap(c.drive.up)}`,
      oi: `Tap ${keycap(c.action.up)}`,
      cone: `Tap ${keycap(c.action.down)}`,
    }[step];
  }
  if (src.kind === 'wheel') {
    const w = words.wheel;
    return {
      steer: 'Turn the wheel right, then left',
      go: `${pill(w.go)} go ${pill(w.brake)} stop`,
      launch: `${pill(w.brake)}${then}${pill(w.go)}`,
      oi: `Press ${wheelButton(src, data, 'oi', w.oi)}`,
      cone: `Press ${wheelButton(src, data, 'cone', w.cone)}`,
    }[step];
  }
  return {
    steer: `Right stick ${stick('R', 'r')}${then}${stick('R', 'l')}`,
    go: `Left stick ${stick('L', 'u')} drive ${stick('L', 'd')} brake`,
    launch: `Left stick ${stick('L', 'd')}${then}${stick('L', 'u')} snap`,
    oi: `Right stick flick ${stick('R', 'u')}`,
    cone: `Right stick flick ${stick('R', 'd')}`,
  }[step];
}
