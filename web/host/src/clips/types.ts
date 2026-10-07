// Shared shapes of bug clips (P1-F07) and session recordings (P1-F12): the file is `jj_fixture::clip::Bundle`'s JSON, the
// worker's journal poll is its `journalChunk` answer. Types only, so the worker and main can both import them.

export const CLIP_FORMAT = 'jj.clip.v1';
export const SESSION_FORMAT = 'jj.session.v1';

/** What the worker tells main as the sim runs (`kind: 'journal'`); main keeps every one, so a clip survives a worker fault. */
export interface JournalMessage {
  kind: 'journal';
  /** 0, 1, 2…: a new number means the host rebuilt its sim (every Countdown and Lobby is a new world). */
  world: number;
  tick: number;
  /** The first message of a world: how it began. */
  start: { seed: number; mapHash: string; map: string } | null;
  /** The journal's new part, a postcard `Chunk` in base64. */
  chunk: string | null;
  /** The full-state hash at `tick` (every few seconds, and when asked for). */
  hash: string | null;
  /** Setup commands in the journal when the hash was taken. */
  setup: number;
  phase: string;
  round: number | null;
  freeDrive: boolean;
  pending: { id: number; seed: number } | null;
  /** How long taking this poll cost the worker (ms). */
  ms: number;
}

export interface ClipCheckpoint {
  tick: number;
  hash: string;
  setup: number;
}

/** `jj_fixture::clip::World`. */
export interface ClipWorld {
  index: number;
  label: string;
  round: number | null;
  sessionSeed: number;
  trackSeed: number | null;
  preparation: number | null;
  mapHash: string;
  map: string;
  chunks: string[];
  endTick: number;
  checkpoints: ClipCheckpoint[];
}

export interface ClipFault {
  world: number;
  tick: number;
  message: string;
}

/** `jj_fixture::clip::Bundle`: a `*.jjclip` or `*.jjsession`. */
export interface ClipBundle {
  format: typeof CLIP_FORMAT | typeof SESSION_FORMAT;
  build: string;
  savedAt: string;
  mark: { world: number; tick: number; note: string } | null;
  roster: unknown;
  fault: ClipFault | null;
  summary: unknown;
  notes: Record<string, unknown>;
  worlds: ClipWorld[];
}
