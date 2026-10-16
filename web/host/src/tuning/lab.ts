// The Feel Lab tab of the owner tuning menu (P1-FL03, R131). Move a few trade-off sliders that each scale several underlying
// tuning values of the shipped arcade car controller at once (turn-in, grip, power, air control, launch, boost; P1-FL04.2,
// R136), and flip the whole setup between two saved slots (A/B) while the cars keep driving. Everything is applied to EVERY
// roster vehicle, so the grid drives one setup, by the panel's own path: `tune-vehicle:` + `tune:` UI commands, journalled in
// the sim, and counted in the panel's changes, so Export patch carries the lab's setup as ordinary `set` rows. Multipliers
// are against each vehicle's SHIPPED values, so a slot is the same setup whenever it is applied. (FL04's handling presets
// were removed by FL04.2: the arcade controller is the only one.)

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** What the lab needs of the panel. */
export interface LabPanel {
  /** The roster's vehicle ids (empty or one: just the selected vehicle). */
  ids: string[];
  selected(): string;
  choose(id: string): Promise<void>;
  /** The tuning the sim holds for the vehicle it is tuning now, and which vehicle that is. */
  tuning(): Promise<{ vehicle?: string; tuning: Record<string, unknown> }>;
  /** One tuning change on the selected vehicle (the panel's own send: command, changed list, export). */
  set(path: string, value: Json): void;
  /** Reads the sim back into the panel's rows. */
  refresh(): Promise<void>;
}

export interface Setup {
  /** Slider multipliers (1 = the shipped value). */
  m: Record<string, number>;
}

interface Slider {
  id: string;
  label: string;
  hint: string;
  /** Tuning paths and which way the multiplier moves each (1 = with it, -1 = against it). */
  fields: Array<[string, 1 | -1]>;
}

const SLIDERS: Slider[] = [
  { id: 'power', label: 'Power', hint: 'engine force and engine power', fields: [['max_engine_force', 1], ['max_engine_power_w', 1]] },
  { id: 'turn', label: 'Turn-in', hint: 'how hard full stick turns and how fast the nose answers (right: sharper)', fields: [['arcade.turn_g', 1], ['arcade.yaw_max_deg_s', 1], ['arcade.turn_in_s', -1]] },
  { id: 'grip', label: 'Grip ↔ slide', hint: "line-holding grip and the grip a slide keeps; a rear-drive car's slide angle (left: slidier, right: grippier)", fields: [['arcade.grip_g', 1], ['arcade.slide_grip', 1], ['arcade.slide_angle_deg', -1]] },
  { id: 'air', label: 'Air control', hint: 'pitch and roll torque in the air', fields: [['air_pitch_torque', 1], ['air_roll_torque', 1]] },
  { id: 'launch', label: 'Launch', hint: 'wheelie launch reward and drive gain', fields: [['wheelie_launch_reward', 1], ['wheelie_drive_gain', 1]] },
  { id: 'boost', label: 'Boost economy', hint: 'recharge faster, drain slower (right: more boost)', fields: [['boost_recharge_per_s', 1], ['boost_drain_per_s', -1]] },
];
const STORE = 'jj.feellab.slots.v1';
const MIN = -1; // sliders run 0.5x..2x on a log scale, so the middle is exactly 1x
const MAX = 1;

const flat = (): Record<string, number> => Object.fromEntries(SLIDERS.map((s) => [s.id, 1]));
/** 6 significant figures: the sim reads f32, and a patch stays readable. */
const round = (v: number) => Number(v.toPrecision(6));
const fmt = (v: number) => String(round(v));
const times = (m: number) => `${round(m).toFixed(2)}x`;

/** A saved slot's one-line summary. */
function summary(s: Setup | null): string {
  if (!s) return 'empty';
  const moved = SLIDERS.filter((x) => Math.abs((s.m[x.id] ?? 1) - 1) > 0.005).map((x) => `${(x.label.split(' ')[0] ?? '').toLowerCase()} ${times(s.m[x.id] ?? 1)}`);
  return moved.length ? moved.join(', ') : 'sliders at 1x';
}

function leafMap(obj: Record<string, unknown>, prefix = ''): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number') out.set(p, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [a, b] of leafMap(v as Record<string, unknown>, p)) out.set(a, b);
  }
  return out;
}

function loadSlots(): { A: Setup | null; B: Setup | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { A?: Setup | null; B?: Setup | null } | null;
    // Slots saved while FL04's presets existed still carry a `preset` key: it is ignored.
    const keep = (s: unknown): Setup | null => (!!s && typeof (s as Setup).m === 'object' && (s as Setup).m !== null ? { m: { ...(s as Setup).m } } : null);
    return { A: keep(raw?.A), B: keep(raw?.B) };
  } catch {
    return { A: null, B: null };
  }
}

export function mountFeelLab(pane: HTMLElement, panel: LabPanel): { inspect: () => unknown; open: () => void; apply: (s: Setup) => Promise<void> } {
  let setup: Setup = { m: flat() };
  let slots = loadSlots();
  let active: 'A' | 'B' | null = null;
  /** Each vehicle's shipped numbers, captured the first time the lab opens (before the lab has changed anything). */
  const bases = new Map<string, Map<string, number>>();
  let applying: Promise<void> = Promise.resolve();
  let pending = false;
  let applied: Setup | null = null;
  let status = 'Nothing changed yet';
  let appliedCount = 0;

  pane.innerHTML = `
    <p class="lab-note">Trade-off sliders over the arcade car controller every car ships with, applied to every vehicle at once.</p>
    <h4>Trade-offs <small>1x is the shipped value</small></h4>
    <div class="lab-sliders">
      ${SLIDERS.map(
        (s) => `<div class="lab-slider" data-lab-row="${s.id}">
          <div class="lab-head"><label for="lab-${s.id}">${s.label}</label><output data-lab-x="${s.id}">1.00x</output><button type="button" class="lab-one" data-lab-one="${s.id}" title="Back to 1x" aria-label="${s.label} back to 1x">↺</button></div>
          <input id="lab-${s.id}" type="range" min="${MIN}" max="${MAX}" step="0.05" value="0" data-lab-slider="${s.id}">
          <p class="lab-eff" data-lab-eff="${s.id}"></p>
          <p class="lab-note" data-lab-note="${s.id}">${s.hint}</p>
        </div>`,
      ).join('')}
    </div>
    <h4>A / B <small>kept in this browser</small></h4>
    <div class="lab-ab">
      <div class="lab-slot" data-lab-slot="A"><button type="button" data-lab-save="A">Save to A</button><p data-lab-sum="A"></p></div>
      <div class="lab-slot" data-lab-slot="B"><button type="button" data-lab-save="B">Save to B</button><p data-lab-sum="B"></p></div>
    </div>
    <div class="lab-toggle" role="group" aria-label="Apply a saved setup live"><button type="button" data-lab-flip="A">A</button><button type="button" data-lab-flip="B">B</button></div>
    <p class="lab-status" data-lab-status role="status"></p>`;

  const q = <T extends HTMLElement>(sel: string) => pane.querySelector<T>(sel)!;
  const mOf = (id: string) => setup.m[id] ?? 1;

  const render = async () => {
    const sel = bases.get(panel.selected());
    for (const s of SLIDERS) {
      const m = mOf(s.id);
      const input = q<HTMLInputElement>(`[data-lab-slider="${s.id}"]`);
      input.value = String(Math.round(Math.log2(m) * 20) / 20);
      q(`[data-lab-x="${s.id}"]`).textContent = times(m);
      q<HTMLButtonElement>(`[data-lab-one="${s.id}"]`).disabled = m === 1;
      const eff = s.fields
        .map(([path, dir]) => {
          const base = sel?.get(path);
          return base === undefined ? null : `${path.replace('arcade.', '').replace(/_/g, ' ')} ${fmt(base * (dir === 1 ? m : 1 / m))}`;
        })
        .filter(Boolean);
      q(`[data-lab-eff="${s.id}"]`).textContent = eff.length ? `${panel.selected() || 'car'}: ${eff.join(' · ')}` : '';
    }
    for (const k of ['A', 'B'] as const) {
      q(`[data-lab-sum="${k}"]`).textContent = summary(slots[k]);
      q<HTMLButtonElement>(`[data-lab-flip="${k}"]`).disabled = !slots[k];
      q<HTMLButtonElement>(`[data-lab-flip="${k}"]`).setAttribute('aria-pressed', String(active === k));
      pane.querySelector(`[data-lab-slot="${k}"]`)!.classList.toggle('on', active === k);
    }
    q('[data-lab-status]').textContent = status;
  };

  /** Captured once, by whichever call comes first (opening the tab, or a slider moved before that finished). */
  let capturing: Promise<void> | null = null;
  /** Every base is in and the sim is back on the vehicle it started on. */
  let captured = false;
  function capture(): Promise<void> {
    capturing ??= (async () => {
      const ids = panel.ids.length > 1 ? panel.ids : [panel.selected()];
      const home = panel.selected();
      for (const id of ids) {
        // The panel's own vehicle selector can switch the sim in between: keep a base only when the sim says it is this
        // vehicle's (with one vehicle there is nothing to switch, and the snapshot may not name it).
        for (let tries = 0; tries < 10 && !bases.has(id); tries++) {
          if (id !== panel.selected()) await panel.choose(id);
          const t = await panel.tuning();
          if (ids.length === 1 || t.vehicle === id) bases.set(id, leafMap(t.tuning));
        }
        if (!bases.has(id)) throw new Error(`could not read ${id}'s shipped tuning`);
      }
      if (panel.selected() !== home) await panel.choose(home);
      captured = true;
    })();
    return capturing;
  }

  async function run(): Promise<void> {
    await capture();
    const target = structuredClone(setup);
    const home = panel.selected();
    const ids = panel.ids.length > 1 ? panel.ids : [home];
    for (const id of ids) {
      if (id !== panel.selected()) await panel.choose(id);
      const base = bases.get(id) ?? new Map<string, number>();
      for (const s of SLIDERS) {
        for (const [path, dir] of s.fields) {
          const b = base.get(path);
          if (b === undefined) continue;
          const m = target.m[s.id] ?? 1;
          panel.set(path, round(b * (dir === 1 ? m : 1 / m)));
        }
      }
    }
    if (panel.selected() !== home) await panel.choose(home);
    applied = target;
    appliedCount = ids.length;
    status = `Applied to ${ids.length} vehicle${ids.length === 1 ? '' : 's'}: ${summary(target)}`;
    await panel.refresh();
    await render();
  }

  /** Applies the setup to every vehicle; a change made while one is being applied runs once more with the latest. */
  function apply(s: Setup): Promise<void> {
    setup = structuredClone(s);
    status = 'Applying…';
    void render();
    if (pending) return applying;
    pending = true;
    applying = applying.then(async () => {
      pending = false;
      try {
        await run();
      } catch (e) {
        status = `Failed: ${e instanceof Error ? e.message : String(e)}`;
        await render();
      }
    });
    return applying;
  }

  pane.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const one = t.closest<HTMLElement>('[data-lab-one]')?.dataset.labOne;
    if (one) {
      active = null;
      void apply({ ...setup, m: { ...setup.m, [one]: 1 } });
    }
    const save = t.closest<HTMLElement>('[data-lab-save]')?.dataset.labSave as 'A' | 'B' | undefined;
    if (save) {
      slots = { ...slots, [save]: structuredClone(setup) };
      active = save;
      try {
        localStorage.setItem(STORE, JSON.stringify(slots));
      } catch {
        status = 'Saved for this session only (browser storage is unavailable)';
      }
      if (!status.startsWith('Saved')) status = `Saved to ${save}: ${summary(setup)}`;
      void render();
    }
    const flip = t.closest<HTMLElement>('[data-lab-flip]')?.dataset.labFlip as 'A' | 'B' | undefined;
    if (flip && slots[flip]) {
      active = flip;
      void apply(slots[flip]!);
    }
  });
  pane.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const id = el.dataset.labSlider;
    if (!id) return;
    setup = { ...setup, m: { ...setup.m, [id]: 2 ** Number(el.value) } };
    q(`[data-lab-x="${id}"]`).textContent = times(2 ** Number(el.value));
  });
  pane.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const id = el.dataset.labSlider;
    if (!id) return;
    active = null;
    void apply({ ...setup, m: { ...setup.m, [id]: 2 ** Number(el.value) } });
  });

  void render();
  return {
    open: () => void capture().then(render),
    apply,
    inspect: () => ({ captured, setup, applied, appliedCount, active, slots, status, vehicles: panel.ids, bases: Object.fromEntries([...bases].map(([k, v]) => [k, Object.fromEntries(v)])) }),
  };
}
