// The host's round rules (P1-G06): mode (Race or Derby), laps, derby length and intermission length. Each is a UI command
// to the sim (applied from the next round, laps never mid-race) and is remembered on this host device, so the next room
// starts with the same rules.
import type { SimInput } from '../worker/messages';

type Ui = Extract<SimInput, { type: 'ui' }>['ui'];
export interface Rules {
  mode?: 'race' | 'derby';
  /** Laps per round; absent: the track's length class decides. */
  laps?: number;
  derbyMs?: number;
  intermissionMs?: number;
}

const KEY = 'jj.host.rules';
/** The choices the host menu offers (a host can't type a number on a TV). */
export const LAPS = [1, 2, 3, 5, 8];
export const DERBY_MS = [60_000, 120_000, 180_000, 300_000];
export const INTERMISSION_MS = [10_000, 30_000, 60_000];

export function saved(): Rules {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Rules;
  } catch {
    return {};
  }
}

/** The UI command for one rule. */
export function command(rule: keyof Rules, value: number | string): Ui {
  switch (rule) {
    case 'mode':
      return value === 'derby' ? 'mode:derby' : 'mode:race';
    case 'laps':
      return `laps:${Number(value)}`;
    case 'derbyMs':
      return `derby-ms:${Number(value)}`;
    case 'intermissionMs':
      return `intermission-ms:${Number(value)}`;
  }
}

/** Sends one rule to the sim and remembers it on this device. */
export function set(input: (i: SimInput) => void, rule: keyof Rules, value: number | string): void {
  input({ type: 'ui', ui: command(rule, value) });
  const r = { ...saved(), [rule]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage blocked (a private window): the rule still applies to this room.
  }
}

/** Re-sends every remembered rule (a new room on this device starts with them). */
export function applySaved(input: (i: SimInput) => void): void {
  const r = saved();
  for (const k of ['mode', 'laps', 'derbyMs', 'intermissionMs'] as const) {
    const v = r[k];
    // br-qw28: the results hold's choices changed (the vote follows it): an old length is dropped.
    if (k === 'intermissionMs' && !INTERMISSION_MS.includes(Number(v))) continue;
    if (v !== undefined) input({ type: 'ui', ui: command(k, v) });
  }
}
