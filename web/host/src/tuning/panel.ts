// The owner tuning menu, part 1 (br-2sdu.1): a temporary host-only panel, behind the owner flag, that edits the car's
// tuning live while playtesting. The rows are built from the tuning the sim holds (every field, nested sections as
// groups), so a new profile field shows up without touching this file. A change goes to the sim as a `tune:` UI command,
// applied at a tick boundary and journalled like every UI command, so a tuned session replays. Export downloads a
// `jj.tuning-patch.v1` file that `jj vehicle tune <patch.json>` writes into assets/profiles/ as data.
// Part 2 (br-2sdu.2) adds the input profile (assets/profiles/input.json: deadzones, launch, flick) as `input.*`
// rows. Those travel the same `tune:` command; the host reads its seats with the new value at once and sends the whole
// profile to every connected controller, so a mid-race change reaches phones, hubs and host pads. The export carries
// them as `inputProfile` + `inputSet` (paths as in input.json).
// Part 3 (br-2sdu.3) adds the generator data (assets/profiles/generator.json: course length band and straights, each
// biome's terrain and feature mix, the recipe) as `generator.*` rows. They are not sim values: they take effect when
// Regenerate builds the current seed again with them, and each regenerate is journalled in `inspect().generatorJournal`
// (and on the preparer's seeds, with the document used). The export carries them as `generator` + `generatorSet`.
// br-bbki.7.1 adds the air-control and landing data (assets/profiles/air.json: pitch/yaw rates, controlAfterS, the
// latch, the landing bands, boost and loss) as `air.*` rows, one set for every car, live mid-flight; the export carries
// them as `airProfile` + `airSet`.
import './panel.css';
import { mountFeelLab } from './lab';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface TuningClient {
  input(i: { type: 'ui'; ui: `tune:${string}` | `tune-vehicle:${string}` }): void;
  tuning(): Promise<{ tuning: Record<string, unknown>; input?: Record<string, unknown>; air?: Record<string, unknown>; error: string | null; vehicle?: string; vehicles?: string[] }>;
}

/** What the panel needs of round preparation and the generator (absent on pages that have no procgen worker). */
export interface GeneratorHooks {
  /** The shipped `jj.generator` document. */
  defaults(): Promise<Record<string, Json>>;
  /** The shipped document with `set` applied (`[[path, jsonText]]`), or the validator's message as the error. */
  with(set: Array<[string, string]>): string;
  /** Builds the current seed again with this document (none: the shipped data). */
  regenerate(doc: string | undefined): void;
  /** The newest built track as measured by preparation. */
  built(): { preparation: number; seed: number; lengthM?: number; reliefM?: number } | null;
  /** The Feel Lab scenes (P1-FL03.1), the one loaded (null: generated tracks), and loading one (null: back to generated). */
  scenes: string[];
  scene(): string | null;
  loadScene(name: string | null): Promise<void>;
}

const INPUT_FILE = 'assets/profiles/input.json';
const INPUT = 'input.';
const AIR = 'air.';
const AIR_FILE = 'assets/profiles/air.json';
const GEN = 'generator.';
const GENERATOR_FILE = 'assets/profiles/generator.json';
/** The input and air files' own prose, version and contract are not tunable. */
const NOT_TUNABLE = new Set(['version', 'what', 'contract']);
const tunable = (o?: Record<string, unknown>) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !NOT_TUNABLE.has(k))) as Record<string, Json>;

/** The sim's vehicle tuning plus the input and air profiles, as one flat list of leaves (`input.` and `air.` prefixes). */
function allLeaves(t: { tuning: Record<string, unknown>; input?: Record<string, unknown>; air?: Record<string, unknown> }): Array<[string, Json]> {
  return [...leaves(t.tuning as Record<string, Json>), ...leaves(tunable(t.input), 'input'), ...leaves(tunable(t.air), 'air')];
}
/** A row of a shared profile (input, air), not the selected vehicle's. */
const shared = (path: string) => path.startsWith(INPUT) || path.startsWith(AIR);
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

export async function mountTuningPanel(client: TuningClient, gen?: GeneratorHooks): Promise<{ inspect: () => unknown; lab: ReturnType<typeof mountFeelLab> }> {
  const first = await client.tuning();
  const defaults = new Map(allLeaves(first));
  if (gen) {
    const { version: _v, what: _w, ...doc } = await gen.defaults();
    for (const [path, v] of leaves(doc as Record<string, Json>, 'generator')) defaults.set(path, v);
  }
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
      return `<details${g.startsWith('generator') && g !== 'generator' && g !== 'generator.course' ? '' : ' open'}><summary>${g.replace(/_/g, ' ').replace(/\./g, ' › ').replace(/([a-z])([A-Z])/g, '$1 $2')}</summary>${body}</details>`;
    })
    .join('');
  panel.innerHTML = `<header><h3>Owner tuning</h3><span class="note">vehicle + controls + generator</span></header>
    <p class="err" data-tune-error hidden></p>
    <nav class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-tune-tab="values">Values</button><button type="button" role="tab" aria-selected="false" data-tune-tab="lab">Feel Lab</button></nav>
    <div class="rows" data-tune-pane="values">${rows}</div>
    <div class="rows lab" data-tune-pane="lab" hidden></div>
    ${gen ? '<p class="built" data-tune-built></p>' : ''}
    ${gen && gen.scenes.length ? `<p class="built seed" data-tune-scene-row>scene <select data-tune-scene aria-label="Feel Lab scene"><option value="">Generated tracks</option>${gen.scenes.map((n) => `<option value="${n}">${n}</option>`).join('')}</select><button type="button" data-tune-scene-go title="The next round runs on this Feel Lab scene (Generated tracks: back to the generator)">Load scene</button></p>` : ''}
    <p class="built seed" data-tune-seed-row>session seed <b data-tune-seed>?</b> <input type="number" min="0" step="1" placeholder="seed" data-tune-seed-input aria-label="Seed to play"><button type="button" data-tune-seed-go title="Open a new room on this seed (tracks are this seed + preparation id)">Play seed</button></p>
    <footer>${gen ? '<button type="button" data-tune-regenerate title="Build the current seed again with the generator values">Regenerate track</button>' : ''}<button type="button" data-tune-export>Export patch</button><span data-tune-count>No changes</span></footer>`;

  let genError = false;
  const generatorJournal: Array<{ at: number; seed: number | null; set: Array<[string, string]>; builtLengthM?: number; builtReliefM?: number }> = [];
  const builtEl = panel.querySelector<HTMLElement>('[data-tune-built]') ?? document.createElement('span');
  const errEl = panel.querySelector<HTMLElement>('[data-tune-error]')!;
  const countEl = panel.querySelector<HTMLElement>('[data-tune-count]')!;
  // The session seed (owner 2026-10-17): shown for reasoning about a map, and any seed can be replayed in a new room.
  const seedEl = panel.querySelector<HTMLElement>('[data-tune-seed]')!;
  const seedInput = panel.querySelector<HTMLInputElement>('[data-tune-seed-input]')!;
  const sessionSeed = () => (window as unknown as { __jjSession?: { seed: number } }).__jjSession?.seed;
  // The Feel Lab scene picker (P1-FL03.1, br-bbki.19): the next round runs on the scene's map.
  panel.querySelector('[data-tune-scene-go]')?.addEventListener('click', () => {
    const name = panel.querySelector<HTMLSelectElement>('[data-tune-scene]')!.value || null;
    void gen!.loadScene(name);
  });
  panel.querySelector('[data-tune-seed-go]')!.addEventListener('click', () => {
    const want = seedInput.value.trim() === '' ? sessionSeed() : Number(seedInput.value) >>> 0;
    if (want === undefined) return;
    const url = new URL(location.href);
    url.searchParams.set('seed', String(want));
    location.assign(url);
  });
  const refresh = async () => {
    const t = await client.tuning();
    for (const [path, v] of allLeaves(t)) current.set(path, v);
    if (!genError) {
      errEl.hidden = !t.error;
      errEl.textContent = t.error ?? '';
    }
    const seed = sessionSeed();
    if (seed !== undefined) seedEl.textContent = String(seed);
    const built = gen?.built();
    if (built) builtEl.textContent = `built: seed ${built.seed}, ${built.lengthM} m long, ${built.reliefM} m relief`;
    // A refused input value never reaches the controllers: its row goes back to what the host holds, out of the export.
    for (const path of [...changed.keys()]) {
      if (shared(path) && t.error?.startsWith(`${path}:`)) {
        changed.delete(path);
        const el = panel.querySelector<HTMLInputElement>(`[data-field="${path}"]`);
        const v = current.get(path);
        if (el && typeof v === 'number') el.value = shown(v);
      }
    }
    for (const [path] of defaults) {
      const dirty = JSON.stringify(current.get(path)) !== JSON.stringify(defaults.get(path));
      panel.querySelector(`[data-row="${path}"]`)?.classList.toggle('dirty', dirty);
      // A vehicle can have fields the first one had no row for (a bike's `bike_balance`): nothing to mark then.
      const reset = panel.querySelector<HTMLElement>(`[data-reset="${path}"]`);
      if (reset) reset.hidden = !dirty;
    }
    countEl.textContent = changed.size ? `${changed.size} changed` : 'No changes';
  };
  const vsel = vehicleSelector({ client, panel, first, defaults, current, changed, refresh });
  const genSet = (): Array<[string, string]> => [...changed].filter(([f]) => f.startsWith(GEN)).map(([f, v]) => [f.slice(GEN.length), v]);
  /** A generator value: held here until Regenerate; refused at once if the generator's validator refuses it. */
  const sendGenerator = (path: string, value: Json) => {
    const text = JSON.stringify(value);
    const next = new Map(changed);
    if (JSON.stringify(defaults.get(path)) === text) next.delete(path);
    else next.set(path, text);
    const set = [...next].filter(([f]) => f.startsWith(GEN)).map(([f, v]) => [f.slice(GEN.length), v] as [string, string]);
    try {
      gen!.with(set);
    } catch (e) {
      genError = true;
      errEl.hidden = false;
      errEl.textContent = `${path}: ${e instanceof Error ? e.message : String(e)}`;
      const el = panel.querySelector<HTMLInputElement>(`[data-field="${path}"]`);
      const held = current.get(path);
      if (el && typeof held === 'number') el.value = shown(held);
      else if (el && el.type !== 'checkbox') el.value = JSON.stringify(held);
      return;
    }
    genError = false;
    errEl.hidden = true;
    changed.clear();
    for (const [k, v] of next) changed.set(k, v);
    current.set(path, value);
    void refresh();
  };
  const send = (path: string, value: Json) => {
    if (path.startsWith(GEN)) return sendGenerator(path, value);
    const text = JSON.stringify(value);
    client.input({ type: 'ui', ui: `tune:${path}=${text}` });
    // A value the shipped profile has not got is at its default when it is `null`.
    // The sim holds f32: a typed 0.4 is the shipped 0.4000000059604645.
    const shipped = defaults.get(path);
    const same = typeof value === 'number' && typeof shipped === 'number' ? Math.fround(value) === Math.fround(shipped) : JSON.stringify(shipped) === text;
    if (defaults.has(path) ? same : text === 'null') changed.delete(path);
    else changed.set(path, text);
    setTimeout(() => void refresh(), 150);
  };

  const labPane = panel.querySelector<HTMLElement>('[data-tune-pane="lab"]')!;
  const lab = mountFeelLab(labPane, {
    ids: first.vehicles ?? [],
    selected: () => vsel.selected(),
    choose: (id) => vsel.choose(id),
    tuning: async () => { const t = await client.tuning(); return { vehicle: t.vehicle, tuning: t.tuning }; },
    set: (path, value) => send(path, value),
    refresh,
  });
  panel.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tune-tab]')?.dataset.tuneTab;
    if (!tab) return;
    for (const b of panel.querySelectorAll<HTMLElement>('[data-tune-tab]')) b.setAttribute('aria-selected', String(b.dataset.tuneTab === tab));
    for (const p of panel.querySelectorAll<HTMLElement>('[data-tune-pane]')) p.hidden = p.dataset.tunePane !== tab;
    if (tab === 'lab') lab.open();
  });
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
    if ((e.target as HTMLElement).closest('[data-tune-regenerate]')) {
      const set = genSet();
      const before = gen!.built();
      const doc = set.length ? gen!.with(set) : undefined;
      generatorJournal.push({ at: Date.now(), seed: gen!.built()?.seed ?? null, set });
      gen!.regenerate(doc);
      builtEl.textContent = 'building…';
      void (async () => {
        // The new track is measured when preparation finishes; the readout follows it.
        for (let i = 0; i < 600; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const b = gen!.built();
          const last = generatorJournal.at(-1)!;
          if (b && b.lengthM !== undefined && b.preparation !== before?.preparation) {
            last.builtLengthM = b.lengthM;
            last.builtReliefM = b.reliefM;
            void refresh();
            return;
          }
        }
      })();
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
    const all = [...changed].filter(([f]) => !f.startsWith(GEN));
    const generator = genSet();
    const inputs = all.filter(([f]) => f.startsWith(INPUT)).map(([f, v]) => [f.slice(INPUT.length), v]);
    const air = all.filter(([f]) => f.startsWith(AIR)).map(([f, v]) => [f.slice(AIR.length), v]);
    return {
      contract: 'jj.tuning-patch.v1',
      profile: vsel.file(),
      set: all.filter(([f]) => !shared(f)),
      ...(vsel.others().length ? { otherVehicles: vsel.others() } : {}),
      ...(inputs.length ? { inputProfile: INPUT_FILE, inputSet: inputs } : {}),
      ...(air.length ? { airProfile: AIR_FILE, airSet: air } : {}),
      ...(generator.length ? { generator: GENERATOR_FILE, generatorSet: generator } : {}),
    };
  };
  // Introspection reads back what the sim holds: a test that steps a held clock past a change's tick sees it on its next
  // poll, not only if the single refresh after the send happened to land after that tick.
  return { lab, inspect: () => (void refresh(), { open: !panel.hidden, vehicle: vsel.selected(), current: Object.fromEntries(current), changed: Object.fromEntries(changed), patch: exportPatch(), generatorJournal: generatorJournal.map((j) => ({ ...j })), lab: lab.inspect(), error: errEl.hidden ? null : errEl.textContent })) };
}

type TuningState = Awaited<ReturnType<TuningClient['tuning']>>;

/**
 * Which vehicle the vehicle rows edit (R123). A selector in the header lists the roster's vehicles (the host's `vehicles`);
 * choosing one tells the sim (`tune-vehicle:`), reads that vehicle's tuning into the rows and keeps each vehicle's pending
 * changes apart, so tuning a ute row changes only utes. The export patch is the selected vehicle's; the others' changes
 * ride along as `otherVehicles`. With one vehicle there is no selector.
 */
function vehicleSelector(o: {
  client: TuningClient;
  panel: HTMLElement;
  first: TuningState;
  defaults: Map<string, Json>;
  current: Map<string, Json>;
  changed: Map<string, string>;
  refresh: () => Promise<void>;
}): { file(): string; selected(): string; choose(id: string): Promise<void>; others(): Array<{ profile: string; set: Array<[string, string]> }> } {
  let vehicle = o.first.vehicle ?? '';
  const isVehicleRow = (path: string) => !shared(path) && !path.startsWith(GEN);
  const shippedBy = new Map<string, Map<string, Json>>([[vehicle, new Map(leaves(o.first.tuning as Record<string, Json>))]]);
  /** Other vehicles' pending changes, set aside while another vehicle is selected. */
  const aside = new Map<string, Array<[string, string]>>();
  const file = (id: string) => `assets/profiles/${id}.json`;
  const ids = o.first.vehicles ?? [];
  if (ids.length > 1) {
    const select = document.createElement('select');
    select.dataset.tuneVehicle = '';
    select.setAttribute('aria-label', 'Vehicle to tune');
    select.innerHTML = ids.map((id) => `<option value="${id}"${id === vehicle ? ' selected' : ''}>${id}</option>`).join('');
    o.panel.querySelector('header')?.append(select);
    select.addEventListener('change', () => void choose(select.value));
  }
  async function choose(id: string): Promise<void> {
    o.client.input({ type: 'ui', ui: `tune-vehicle:${id}` });
    let t = await o.client.tuning();
    // The switch lands at a tick boundary; a loaded host takes a while. Never carry on with another vehicle's numbers
    // (the Feel Lab would take them as this vehicle's shipped base).
    for (let i = 0; i < 200 && t.vehicle !== id; i++) {
      await new Promise((r) => setTimeout(r, 50));
      t = await o.client.tuning();
    }
    if (t.vehicle !== id) throw new Error(`the host did not switch the tuning to ${id} (still ${t.vehicle ?? 'none'})`);
    // Only now set the old vehicle's pending changes aside: until the switch lands, an export is still the old vehicle's.
    aside.set(vehicle, [...o.changed].filter(([f]) => isVehicleRow(f)));
    for (const [f] of o.changed) if (isVehicleRow(f)) o.changed.delete(f);
    vehicle = id;
    const pick = o.panel.querySelector<HTMLSelectElement>('[data-tune-vehicle]');
    if (pick) pick.value = id;
    if (!shippedBy.has(id)) shippedBy.set(id, new Map(leaves(t.tuning as Record<string, Json>)));
    for (const [path, v] of shippedBy.get(id)!) o.defaults.set(path, v);
    for (const [f, v] of aside.get(id) ?? []) o.changed.set(f, v);
    // Rows the new vehicle has not got (a bike has no `arcade`, a car no `bike_balance`) go, or they would read the last
    // vehicle's numbers.
    const fresh = new Set(leaves(t.tuning as Record<string, Json>).map(([path]) => path));
    for (const path of [...o.current.keys()]) if (isVehicleRow(path) && !fresh.has(path)) o.current.delete(path);
    for (const path of [...o.defaults.keys()]) if (isVehicleRow(path) && !fresh.has(path)) o.defaults.delete(path);
    for (const [path, v] of leaves(t.tuning as Record<string, Json>)) {
      o.current.set(path, v);
      const el = o.panel.querySelector<HTMLInputElement>(`[data-field="${path}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v === true;
      else el.value = typeof v === 'number' ? shown(v) : JSON.stringify(v);
    }
    await o.refresh();
  }
  return {
    selected: () => vehicle,
    choose,
    file: () => file(vehicle),
    others: () => [...aside].filter(([id, set]) => id !== vehicle && set.length).map(([id, set]) => ({ profile: file(id), set })),
  };
}
