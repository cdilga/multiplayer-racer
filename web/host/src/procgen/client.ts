// Main's side of the procgen worker (P1-M08a): one job at a time per call, answered by job id.
import type { FromProcgen, ToProcgen } from './messages';

export interface PreparedMap {
  seed: number;
  canonical: Uint8Array;
  mapJson: string;
  /** The fallback ladder's attempts (`[{biomes, draw, rejected[]}]`). */
  log: Array<{ biomes: number; draw: number; rejected: string[] }>;
  /** `requested`, `redrawn-N`, `shorter-N` or `conservative`. */
  plan: string;
  valid: boolean;
  ms: number;
}

/** What round preparation needs of a procgen worker (the tests substitute one). */
export interface Procgen {
  /** The seed's validated map for the recipe (comma-separated biome names; default: empty, the seed's own one to four biomes, R125). */
  prepare(seed: number, recipe?: string, generator?: string, arenaCars?: number): Promise<PreparedMap>;
  /** An authored `jj.map.v1` JSON through the sim's validator; rejects with the validator's message. */
  validate(json: string): Promise<{ canonical: Uint8Array; mapJson: string }>;
  /** br-m1xe: the share code for a track this build generates. */
  code?(seed: number, recipe: string): Promise<string>;
  /** br-m1xe: a share code back to its seed and recipe; rejects with why it can't be rebuilt (a typo, another version). */
  read?(code: string): Promise<{ seed: number; recipe: string }>;
}

export class ProcgenClient implements Procgen {
  readonly worker: Worker;
  private next = 1;
  private waiting = new Map<number, { ok: (m: FromProcgen) => void; fail: (e: Error) => void }>();

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./procgen.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromProcgen>) => {
      const w = this.waiting.get(e.data.job);
      if (!w) return;
      this.waiting.delete(e.data.job);
      if (e.data.kind === 'failed') w.fail(new Error(e.data.message));
      else w.ok(e.data);
    };
    this.worker.onerror = (e) => {
      for (const w of this.waiting.values()) w.fail(new Error(e.message));
      this.waiting.clear();
    };
  }

  private call(msg: { kind: 'prepare'; seed: number; recipe?: string; generator?: string; arenaCars?: number } | { kind: 'validate'; json: string } | { kind: 'code'; seed: number; recipe: string } | { kind: 'read'; code: string }): Promise<FromProcgen> {
    const job = this.next++;
    return new Promise((ok, fail) => {
      this.waiting.set(job, { ok, fail });
      this.worker.postMessage({ ...msg, job } satisfies ToProcgen);
    });
  }

  async prepare(seed: number, recipe?: string, generator?: string, arenaCars?: number): Promise<PreparedMap> {
    const m = await this.call({ kind: 'prepare', seed, recipe, generator, arenaCars });
    if (m.kind !== 'prepared') throw new Error('unexpected procgen reply');
    return { seed: m.seed, canonical: m.canonical, mapJson: m.mapJson, log: JSON.parse(m.log), plan: m.plan, valid: m.valid, ms: m.ms };
  }

  async validate(json: string): Promise<{ canonical: Uint8Array; mapJson: string }> {
    const m = await this.call({ kind: 'validate', json });
    if (m.kind !== 'validated') throw new Error('unexpected procgen reply');
    return { canonical: m.canonical, mapJson: m.mapJson };
  }

  async code(seed: number, recipe: string): Promise<string> {
    const m = await this.call({ kind: 'code', seed, recipe });
    if (m.kind !== 'coded') throw new Error('unexpected procgen reply');
    return m.code;
  }

  async read(code: string): Promise<{ seed: number; recipe: string }> {
    const m = await this.call({ kind: 'read', code });
    if (m.kind !== 'read') throw new Error('unexpected procgen reply');
    return { seed: m.seed, recipe: m.recipe };
  }

  terminate(): void {
    this.worker.terminate();
  }
}
