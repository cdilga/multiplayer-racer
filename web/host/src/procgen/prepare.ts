// Round preparation on main (P1-M08a, plan §4.4, master §11.2a). The sim's director asks for a map (`PrepareRequested`
// with a seed = the session seed + the preparation id, so a bug clip names the exact track); main hands the seed to the
// procgen worker, the renderer BUILDS the map without showing it, then main sends `MapReady` with the canonical bytes.
// The sim validates them and commits at the next Countdown; only then does the renderer swap the new map in, so the old
// presentation stays until the new one is usable.
// - A job the director has since superseded (a reroll, a retry) never reaches the sim or the renderer's scene.
// - A map that can't be made (the whole fallback ladder failed, or a dev map the validator refuses) is answered with an
//   empty `MapReady`: the sim fails the preparation, the director retries once with the conservative recipe and then
//   settles in the Lobby (the round screens show it). Nothing invalid is ever loaded, and nothing rerolls forever.
import type { MapJson } from '../render/map/map';
import type { StagedMap } from '../render/world';
import type { RoomView, SimEventJson } from '../worker/client';
import type { SimInput } from '../worker/messages';
import type { Procgen } from './client';

/** What the preparer needs of the sim client. */
export interface PrepareHost {
  input(input: SimInput): void;
  watchRoom(f: (room: RoomView) => void): () => void;
  watchEvents(f: (events: SimEventJson[]) => void): () => void;
}

/** What it needs of the renderer (`World`). */
export interface Presenter {
  stageMap(map: MapJson): StagedMap;
  commitMap(staged: StagedMap): unknown;
}

export interface PrepareOptions {
  host: PrepareHost;
  presenter: Presenter;
  procgen: Procgen;
  /** The recipe (comma-separated biome names); default is the worker's Playtest-1 four. */
  recipe?: string;
  /** The recipe after a failed preparation (the director's one conservative retry): the placeholder biome alone. */
  conservativeRecipe?: string;
  /** A dev map (`?test&map=<name>`): the authored JSON replaces the generated map, through the same validator. */
  devMap?: () => Promise<string>;
  /** Runs once a map is staged and before it's offered to the sim (a frame, a shader warm-up). */
  afterStage?: () => Promise<void>;
  /** A refusal or failure the host should show. */
  onError?: (message: string) => void;
  /** The preparation failed for good (the conservative retry failed too): the host offers Retry or the Lobby. */
  onFailed?: (message: string) => void;
}

export interface PrepareStats {
  /** `PrepareRequested`s seen, maps sent to the sim, jobs finished after being superseded (dropped before the sim), failures and refusals. */
  requested: number;
  delivered: number;
  superseded: number;
  failed: number;
  refused: number;
  /** Maps swapped into the scene (one per round that raced a prepared map). */
  committed: number;
  lastPlan: string;
  lastError: string;
}

export class RoundPreparer {
  stats: PrepareStats = { requested: 0, delivered: 0, superseded: 0, failed: 0, refused: 0, committed: 0, lastPlan: '', lastError: '' };
  /** Every request in order: the preparation id and the seed that named its track. */
  seeds: Array<{ preparation: number; seed: number; plan?: string; ms?: number; attempts?: number }> = [];
  /** The newest preparation the sim asked for, and the newest map main handed it. */
  current = 0;
  delivered = 0;
  /** The map now shown (the last one committed at a Countdown), for the R90 readout and the captures. */
  committed: MapJson | null = null;
  private staged: { preparation: number; map: StagedMap } | null = null;
  private failedLast = false;
  /** `stats.failed` when the host was last told a preparation failed for good (or last saw a good map). */
  private toldFailed = 0;
  private unsub: Array<() => void> = [];

  constructor(private o: PrepareOptions) {}

  /** Tells the sim that main prepares its maps, and starts listening. */
  attach(): void {
    this.unsub.push(this.o.host.watchEvents((events) => this.onEvents(events)));
    this.unsub.push(this.o.host.watchRoom((room) => this.onRoom(room)));
    this.o.host.input({ type: 'ui', ui: 'prepare-maps', on: true });
  }

  detach(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  /** Draws the next track seed (supersedes the pending preparation; the director cancels it and asks again). */
  reroll(): void {
    this.o.host.input({ type: 'ui', ui: 'reroll' });
  }

  /** Whether a built map is waiting for the next Countdown. */
  get stagedFor(): number | null {
    return this.staged?.preparation ?? null;
  }

  private onEvents(events: SimEventJson[]): void {
    for (const e of events) {
      const r = e.PrepareRequested as { preparation: number; seed: number } | undefined;
      if (r) void this.request(Number(r.preparation), Number(r.seed));
    }
  }

  private discard(): void {
    this.staged?.map.renderer.dispose();
    this.staged = null;
  }

  private async request(preparation: number, seed: number): Promise<void> {
    this.current = preparation;
    this.stats.requested++;
    const entry: RoundPreparer['seeds'][number] = { preparation, seed };
    this.seeds.push(entry);
    if (!Number.isSafeInteger(seed)) console.warn(`jj: track seed ${seed} is beyond 2^53: the generator can't name it exactly`);
    console.info(`jj: preparing track seed ${seed} (preparation ${preparation})`);
    // A new request supersedes whatever was built for an older one.
    this.discard();
    try {
      let json: string;
      let canonical: Uint8Array;
      if (this.o.devMap) {
        const authored = await this.o.devMap();
        try {
          ({ canonical, mapJson: json } = await this.o.procgen.validate(authored));
        } catch (e) {
          this.stats.refused++;
          throw new Refused(e instanceof Error ? e.message : String(e));
        }
        entry.plan = 'dev-map';
      } else {
        const p = await this.o.procgen.prepare(seed, this.failedLast ? this.o.conservativeRecipe ?? 'greybox' : this.o.recipe);
        entry.plan = p.plan;
        entry.ms = Math.round(p.ms);
        entry.attempts = p.log.length;
        this.stats.lastPlan = p.plan;
        if (!p.valid) throw new Error(`no valid map for seed ${seed}: ${p.log.at(-1)?.rejected.join('; ') ?? ''}`);
        json = p.mapJson;
        canonical = p.canonical;
      }
      if (preparation !== this.current) {
        this.stats.superseded++;
        return;
      }
      const map = this.o.presenter.stageMap(JSON.parse(json) as MapJson);
      await this.o.afterStage?.();
      if (preparation !== this.current) {
        map.renderer.dispose();
        this.stats.superseded++;
        return;
      }
      this.staged = { preparation, map };
      this.delivered = preparation;
      this.stats.delivered++;
      this.failedLast = false;
      this.o.host.input({ type: 'map-ready', preparation, bytes: canonical });
    } catch (e) {
      if (preparation !== this.current) {
        this.stats.superseded++;
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      this.stats.failed++;
      this.stats.lastError = message;
      this.failedLast = !(e instanceof Refused);
      console.error(`jj: preparation ${preparation} (seed ${seed}) failed: ${message}`);
      this.o.onError?.(message);
      // The sim fails the preparation on an unreadable map: the director retries once, then settles in the Lobby.
      this.o.host.input({ type: 'map-ready', preparation, bytes: new Uint8Array() });
    }
  }

  /** The sim committed the map at the Countdown: show it. If the sim refused it, or moved on, drop it. */
  private onRoom(room: RoomView): void {
    const staged = this.staged;
    const p = room.preparation;
    if (p?.verdict === 'ok') this.toldFailed = this.stats.failed;
    // Nothing is pending, the sim holds no good map and a failure has happened since the last good one: it failed for good.
    if (p && !p.pending && !p.prepared && p.verdict !== 'ok' && this.stats.failed > this.toldFailed && (room.phase === 'Lobby' || room.phase === 'Intermission')) {
      this.toldFailed = this.stats.failed;
      this.o.onFailed?.(this.stats.lastError);
    }
    if (!staged || !p) return;
    if ((room.phase === 'Countdown' || room.phase === 'Running') && p.verdict === 'ok' && !p.prepared && staged.preparation === this.delivered) {
      this.staged = null;
      this.o.presenter.commitMap(staged.map);
      this.committed = staged.map.map;
      this.stats.committed++;
    } else if (room.phase === 'Lobby' && !p.pending && p.verdict !== 'ok') {
      this.discard();
    }
  }
}

class Refused extends Error {}
