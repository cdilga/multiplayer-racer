// The Derby Overview's host UI (P1-R11, master §6.4, R22/R23):
//   - a thin top edge band while the Overview draws a round: the derby clock and the damage-points standings (every
//     seat, ranked; the run shrinks to fit, never cut), and, when the cars are spread wider than the arena view or read
//     smaller than the TV target, a non-blocking suggestion to switch to the Grid;
//   - the footer's Camera button and the V key: Grid ⇄ Overview at any time, mid-round included, through the world's
//     ~300 ms transition. On a track map the switch is disabled and says why.
import type { RoomView, SimClient } from '../../worker/client';
import type { World } from '../../render/world';
import { esc, shortName } from '../../round/format';
import { tokenData } from '../../../../shared/ui';
import { DERBY_HIT_SHOWN_MS, carDiagram, derbyHitText } from '../../../../shared/src/derby';
import './band.css';

const RACING = new Set(['Countdown', 'Running', 'Finalising']);
const ORD = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const TRACK_EXPLAIN = 'Overview is for derby arenas: on a track every player keeps their own tile.';

export function mountOverviewUi(root: HTMLElement, world: World, client: SimClient, footer: HTMLElement | null): void {
  const band = document.createElement('div');
  band.className = 'jj-ov-band';
  band.hidden = true;
  band.setAttribute('role', 'status');
  band.innerHTML = '<span class="ov-clock" data-ov-clock></span><span class="ov-title" data-ov-title hidden>Damage dealt</span><span class="ov-standings" data-ov-standings><span class="ov-run"></span></span><button class="ov-suggest" type="button" data-act="ov-grid" hidden>Cars spread out · <b>V</b> for the Grid</button>';
  const note = document.createElement('div');
  note.className = 'jj-ov-note';
  note.hidden = true;
  root.append(band, note);
  const clockEl = band.querySelector<HTMLElement>('[data-ov-clock]')!;
  const titleEl = band.querySelector<HTMLElement>('[data-ov-title]')!;
  const standEl = band.querySelector<HTMLElement>('[data-ov-standings]')!;
  const run = standEl.firstElementChild as HTMLElement;
  const suggest = band.querySelector<HTMLButtonElement>('.ov-suggest')!;
  let btn: HTMLButtonElement | null = null;
  if (footer) {
    btn = document.createElement('button');
    btn.className = 'foot-btn quiet';
    btn.type = 'button';
    btn.dataset.act = 'camera';
    footer.querySelector('[data-act=menu]')?.after(btn);
  }
  let room: RoomView | null = null;
  let noteTimer = 0;
  const explain = (text: string) => {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (note.hidden = true), 3500);
  };
  const toggle = () => {
    if (!world.overviewAvailable) return explain(TRACK_EXPLAIN);
    world.setView(world.overviewOn ? 'grid' : 'overview');
  };
  btn?.addEventListener('click', toggle);
  suggest.addEventListener('click', () => world.setView('grid'));
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || t?.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.jj-menu:not([hidden])')) return;
    toggle();
  });

  let standKey = '';
  /** br-bhkz.2: each seat's latest derby hit as last seen (its key and when it changed), for its time in the strip. */
  const hitSeen = new Map<number, { key: string; at: number }>();
  let fitKey = '';
  let fitW = 0;
  const render = () => {
    if (btn) {
      const on = world.overviewOn, can = world.overviewAvailable;
      // Council review 2026-11-15: "Camera: Grid" read as a setting name; it says what it is.
      const label = `Camera view: ${on ? 'Overview' : 'Grid'}`;
      if (btn.textContent !== label) btn.textContent = label;
      btn.setAttribute('aria-disabled', String(!can));
      btn.title = can ? `Switch to the ${on ? 'Grid' : 'Overview'} (V)` : TRACK_EXPLAIN;
      btn.dataset.view = on ? 'overview' : 'grid';
    }
    const show = world.overviewOn && !!room && RACING.has(room.phase);
    if (band.hidden === show) band.hidden = !show;
    document.documentElement.toggleAttribute('data-jj-overview', world.overviewOn);
    if (!show || !room) return;
    const derby = room.mode === 'derby';
    // Council review 2026-11-15: a bare "41 pts" read as the round's points, and the results then said "+25". The strip is
    // titled and counts damage (seats[].derby.points is raw damage dealt); the results' points are what each place earns.
    if (titleEl.hidden === derby) titleEl.hidden = !derby;
    clockEl.textContent = derby && room.derbyLeftMs != null ? `Derby · ${clock(room.derbyLeftMs)} left` : derby ? 'Derby' : 'Overview';
    const seats = room.seats.filter((s) => s.presence !== 'Left' && s.car !== null);
    const ranked = derby ? [...seats].sort((a, b) => (a.derby?.rank ?? 1e9) - (b.derby?.rank ?? 1e9) || a.number - b.number) : [...seats].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
    // br-bhkz.2: each standing carries its car from above (zones toned by health: who is nearly gone is who to hit) and,
    // for a moment after it lands, what its latest hit earned.
    const now = performance.now();
    const hitOf = (s: (typeof ranked)[number]) => {
      const h = derby && s.derby?.hit && s.derby.hit.seq > 0 ? s.derby.hit : null;
      const k = h ? `${h.seq}:${h.points}:${h.what}` : '';
      if (k !== (hitSeen.get(s.number)?.key ?? '')) hitSeen.set(s.number, { key: k, at: now });
      return h && now - hitSeen.get(s.number)!.at < DERBY_HIT_SHOWN_MS ? h : null;
    };
    const hits = new Map(ranked.map((s) => [s.number, hitOf(s)] as const));
    const key = ranked.map((s) => `${s.number}:${s.derby?.rank}:${Math.round(s.derby?.points ?? 0)}:${s.position}:${derby ? s.derby?.health?.join('.') : ''}:${hits.get(s.number) ? hitSeen.get(s.number)!.key : ''}`).join();
    if (key !== standKey) {
      standKey = key;
      run.innerHTML = ranked
        .map((s) => {
          const c = s.colourIndex % tokenData.seatColors.length;
          const place = derby ? s.derby?.rank : s.position;
          return `<span class="ov-item"><b>${place ? ORD(place) : '–'}</b><span class="badge" style="--b:var(--id-${c});--on:var(--id-${c}-on)">#${s.number}</span><span class="nm">${esc(shortName(s.name || 'Player', 12))}</span>${derby && s.derby?.health ? `<span class="ov-car">${carDiagram(s.derby.health)}</span>` : ''}${derby ? `<span class="pts">${Math.round(s.derby?.points ?? 0)}<small> dmg</small></span>` : ''}${hits.get(s.number) ? `<span class="ov-hit" data-ov-hit title="${derbyHitText(hits.get(s.number)!.points, hits.get(s.number)!.what)}">+${Math.max(1, Math.round(hits.get(s.number)!.points))}</span>` : ''}</span>`;
        })
        .join('');
    }
    // Every seat stays in the band, never cut: past its width the run scrolls as a ticker (two copies, so it loops) at a
    // readable size. Council review 2026-11-15: it no longer shrinks first (a 20 px strip was unreadable from the couch).
    if (key !== fitKey || standEl.clientWidth !== fitW) {
      fitKey = key;
      fitW = standEl.clientWidth;
      run.classList.remove('tick');
      run.style.transform = '';
      run.querySelector('.ov-copy')?.remove();
      const w = run.scrollWidth, k = Math.min(1, fitW / Math.max(1, w));
      if (k >= 1) run.style.transform = '';
      else {
        const copy = document.createElement('span');
        copy.className = 'ov-copy';
        copy.innerHTML = run.innerHTML;
        run.append(copy);
        run.style.setProperty('--ov-s', `${Math.max(8, w / 60).toFixed(1)}s`);
        run.classList.add('tick');
      }
    }
    const spread = !!world.overviewStats?.spread;
    if (suggest.hidden === spread) suggest.hidden = !spread;
  };
  client.watchRoom((r) => {
    room = r;
    render();
  });
  window.setInterval(render, 250);
  // Probe and test surface (R90): the choice, whether the Overview draws, its framing data and the camera trace.
  (window as unknown as { __jjOverview: unknown }).__jjOverview = {
    view: () => world.view,
    on: () => world.overviewOn,
    available: () => world.overviewAvailable,
    set: (v: 'auto' | 'grid' | 'overview') => world.setView(v),
    toggle,
    stats: () => world.overviewStats,
    arena: () => world.overviewArena,
    /** Recorded car positions replayed through a fresh rig on this screen (deterministic motion checks). */
    replay: (samples: Array<Array<[number, number, number, number?]>>, dtS: number) => world.replayOverview(samples, dtS),
    pose: () => world.overviewPose,
    band: () => ({ shown: !band.hidden, clock: clockEl.textContent, title: titleEl.hidden ? null : titleEl.textContent, suggest: !suggest.hidden, note: note.hidden ? null : note.textContent, height: band.getBoundingClientRect().height, fontPx: parseFloat(getComputedStyle(run).fontSize) * (run.getBoundingClientRect().height / Math.max(1, run.offsetHeight)) }),
    /** The callout banner the Overview shows now (car, outcome, CSS rect), or null (council review 2026-11-15). */
    banner: () => world.launchCallouts.banner(),
    /** Puts a callout up over a car, as a takedown or landing event would (settable state for the banner checks). */
    callout: (car: number, outcome: 'Takedown' | 'Perfect' | 'Clean' | 'BigAir', ms?: number) => world.launchCallouts.pop(car, outcome, ms),
    trace: (on: boolean) => {
      const frames = world.overviewTrace ?? [];
      world.overviewTrace = on ? [] : null;
      return frames;
    },
  };
}
