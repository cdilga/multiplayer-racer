// Messages between main and the procgen worker (P1-M08a).

export type ToProcgen =
  | { kind: 'prepare'; job: number; seed: number; recipe?: string; /** A tuned `jj.generator` document (br-2sdu.3); absent = the shipped data. */ generator?: string }
  /** A dev map: authored `jj.map.v1` JSON through the same validator the sim uses. */
  | { kind: 'validate'; job: number; json: string };

export type FromProcgen =
  | { kind: 'prepared'; job: number; seed: number; canonical: Uint8Array; mapJson: string; log: string; plan: string; valid: boolean; ms: number }
  | { kind: 'validated'; job: number; canonical: Uint8Array; mapJson: string }
  | { kind: 'failed'; job: number; message: string };
