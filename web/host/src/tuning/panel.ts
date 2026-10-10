// The owner tuning menu, part 1 (br-2sdu.1): a temporary host-only panel, behind the owner flag, that edits the car's
// tuning live while playtesting. The rows are built from the tuning the sim holds (every field, nested sections as
// groups), so a new profile field shows up without touching this file. A change goes to the sim as a `tune:` UI command,
// applied at a tick boundary and journalled like every UI command, so a tuned session replays. Export downloads a
// `jj.tuning-patch.v1` file that `jj vehicle tune <patch.json>` writes into assets/profiles/ as data.
// Part 2 (br-2sdu.2) adds the input profile (assets/profiles/input.json: drift, deadzones, launch, flick) as `input.*`
// rows. Those travel the same `tune:` command; the host reads its seats with the new value at once and sends the whole
// profile to every connected controller, so a mid-race change reaches phones, hubs and host pads. The export carries
// them as `inputProfile` + `inputSet` (paths as in input.json).
import './panel.css';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface TuningClient {
  input(i: { type: 'ui'; ui: `tune:${string}` }): void;
  tuning(): Promise<{ tuning: Record<string, unknown>; input?: Record<string, unknown>; error: string | null }>;
}

const PROFILE_FILE = 'assets/profiles/cruz-missile.json';
const INPUT_FILE = 'assets/profiles/input.json';
const INPUT = 'input.';
/** The input file's own prose and version are not tunable. */
const NOT_TUNABLE = new Set(['version', 'what']);

/** The sim's vehicle tuning plus the input profile, as one flat list of leaves (input paths carry the `input.` prefix). */
function allLeaves(t: { tuning: Record<string, unknown>; input?: Record<string, unknown> }): Array<[string, Json]> {
  const input = Object.fromEntries(Object.entries(t.input ?? {}).filter(([k]) => !NOT_TUNABLE.has(k)));
  return [...leaves(t.tuning as Record<string, Json>), ...leaves(input as Record<string, Json>, 'input')];
}
/** Built into a car's body when it spawns: a change shows on the next car (next round or respawn). */
const AT_SPAWN = new Set(['mass', 'inertia_scale']);

/** Every leaf field by dotted path, in the profile's own order. */
function leaves(obj: Record<string, Json>, prefix = ''): Array<[string, Json]> {
  const out: Array<[string, Json]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v as Record<string, Json>, path));
    else out.push([path, v]);
  }
  return out;
}

/** The sim's f32 values read back with float noise (0.800000011): shown to 6 significant figures. */
const shown = (v: number) => String(Number(v.toPrecision(6)));

const step = (v: number) => {
  const a = Math.abs(v);
  return a === 0 ? 0.01 : 10 ** (Math.floor(Math.log10(a)) - 1);
};

export async function mountTuningPanel(client: TuningClient): Promise<{ inspect: () => unknown }> {
  const first = await client.tuning();
  const defaults = new Map(allLeaves(first));
  const current = new Map(defaults);
  /** Changes in the order made: the export's `set` list (a field changed twice keeps its last value, at its first place). */
  const changed = new Map<string, string>();

  const toggle = document.createElement('button');
  toggle.className = 'jj-tune-toggle';
  toggle.type = 'button';
  toggle.textContent = 'Tune';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('aside');
  panel.className = 'jj-tune';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Owner tuning');
  document.body.append(toggle, panel);

  const groups = new Map<string, Array<[string, Json]>>();
  for (const [path, v] of defaults) {
    const g = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : 'car';
    groups.set(g, [...(groups.get(g) ?? []), [path, v]]);
  }
  const rows = [...groups]
    .map(([g, fields]) => {
      const body = fields
        .map(([path, v]) => {
          const name = path
            .slice(path.lastIndexOf('.') + 1)
            .replace(/_/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase();
          const note = AT_SPAWN.has(path) ? ' <small>next car</small>' : '';
          const input =
            typeof v === 'number'
              ? `<input type="number" data-field="${path}" value="${shown(v)}" step="${step(v)}">`
              : typeof v === 'boolean'
                ? `<input type="checkbox" data-field="${path}" ${v ? 'checked' : ''}>`
                : `<input type="text" data-field="${path}" value='${JSON.stringify(v).replace(/'/g, '&#39;')}'>`;
          return `<label data-row="${path}"><span>${name}${note}</span>${input}<button type="button" class="reset" data-reset="${path}" title="Back to the default" hidden>↺</button></label>`;
        })
        .join('');
      return `<details open><summary>${g.replace(/_/g, ' ')}</summary>${body}</details>`;
    })
    .join('');
  panel.innerHTML = `<header><h3>Owner tuning</h3><span class="note">Cruz Missile + controls · live · journalled</span></header>
    <p class="err" data-tune-error hidden></p>
    <div class="rows">${rows}</div>
    <footer><button type="button" data-tune-export>Export patch</button><span data-tune-count>No changes</span></footer>`;

  const errEl = panel.querySelector<HTMLElement>('[data-tune-error]')!;
  const countEl = panel.querySelector<HTMLElement>('[data-tune-count]')!;
  const refresh = async () => {
    const t = await client.tuning();
    for (const [path, v] of allLeaves(t)) current.set(path, v);
    errEl.hidden = !t.error;
    errEl.textContent = t.error ?? '';
    // A refused input value never reaches the controllers: its row goes back to what the host holds, out of the export.
    for (const path of [...changed.keys()]) {
      if (path.startsWith(INPUT) && t.error?.startsWith(`${path}:`)) {
        changed.delete(path);
        const el = panel.querySelector<HTMLInputElement>(`[data-field="${path}"]`);
        const v = current.get(path);
        if (el && typeof v === 'number') el.value = shown(v);
      }
    }
    for (const [path] of defaults) {
      const dirty = JSON.stringify(current.get(path)) !== JSON.stringify(defaults.get(path));
      panel.querySelector(`[data-row="${path}"]`)?.classList.toggle('dirty', dirty);
      panel.querySelector<HTMLElement>(`[data-reset="${path}"]`)!.hidden = !dirty;
    }
    countEl.textContent = changed.size ? `${changed.size} changed` : 'No changes';
  };
  const send = (path: string, value: Json) => {
    const text = JSON.stringify(value);
    client.input({ type: 'ui', ui: `tune:${path}=${text}` });
    if (JSON.stringify(defaults.get(path)) === text) changed.delete(path);
    else changed.set(path, text);
    setTimeout(() => void refresh(), 150);
  };

  panel.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const path = el.dataset.field;
    if (!path) return;
    let value: Json;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number') value = Number(el.value);
    else {
      try {
        value = JSON.parse(el.value) as Json;
      } catch {
        errEl.hidden = false;
        errEl.textContent = `${path}: not valid JSON`;
        return;
      }
    }
    send(path, value);
  });
  panel.addEventListener('click', (e) => {
    const reset = (e.target as HTMLElement).closest<HTMLElement>('[data-reset]')?.dataset.reset;
    if (reset) {
      const v = defaults.get(reset)!;
      const el = panel.querySelector<HTMLInputElement>(`[data-field="${reset}"]`)!;
      if (el.type === 'checkbox') el.checked = v === true;
      else el.value = typeof v === 'number' ? shown(v) : JSON.stringify(v);
      send(reset, v);
    }
    if ((e.target as HTMLElement).closest('[data-tune-export]')) {
      const patch = exportPatch();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(patch, null, 2) + '\n'], { type: 'application/json' }));
      a.download = `tuning-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });
  // Keys typed into the panel stay in it (host keyboards drive cars).
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) void refresh();
  });

  const exportPatch = () => {
    const all = [...changed];
    const inputs = all.filter(([f]) => f.startsWith(INPUT)).map(([f, v]) => [f.slice(INPUT.length), v]);
    return {
      contract: 'jj.tuning-patch.v1',
      profile: PROFILE_FILE,
      set: all.filter(([f]) => !f.startsWith(INPUT)),
      ...(inputs.length ? { inputProfile: INPUT_FILE, inputSet: inputs } : {}),
    };
  };
  return { inspect: () => ({ open: !panel.hidden, current: Object.fromEntries(current), changed: Object.fromEntries(changed), patch: exportPatch(), error: errEl.hidden ? null : errEl.textContent }) };
}
