// The curated prefill names (P1-C03 data, plan §9): `names.json` is the data, this is its validator and the one place
// the join card draws from. A player who doesn't pick a name gets a random familyFriendly row; they can edit it. The
// list has no cap, and a room's duplicate names get the host's seat-number suffix (jj-session names.rs), not a rule here.
// The checks mirror the host's name rules (NFC, at most 32 graphemes, no control, bidi or markup characters) so a
// prefill can never be refused at Claim.
import data from './names.json' with { type: 'json' };

export type NameStyle = 'diminutive' | 'plain';
export interface NameRow {
  name: string;
  familyFriendly: boolean;
  style: NameStyle;
}

export const MAX_NAME_GRAPHEMES = 32;
/** The -o / -a / -za style of the owner's examples (Davo, Gazza, Shazza), plus the -y / -ie / -zza family (Smithy, Sully). */
export const DIMINUTIVE = /^[A-Z][a-z]+(o|a|za|zza|y|ie|ey|z)$/;
/** The least the list must carry (P1-C03 data AC). */
export const MIN_DIMINUTIVES = 12;

const forbidden = (c: string): boolean => /[\p{Cc}<>‎‏‪-‮⁦-⁩﻿]/u.test(c);
const graphemes = (s: string): number => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;

/** Every problem with a name list, as readable strings (empty = valid). Pure, so the test and a build step share it. */
export function validateNames(file: { schema?: unknown; names?: unknown }): string[] {
  const problems: string[] = [];
  if (typeof file.schema !== 'string' || !file.schema.startsWith('jj.names.')) problems.push('schema must be jj.names.<version>');
  if (!Array.isArray(file.names)) return [...problems, 'names must be an array'];
  const seen = new Map<string, string>();
  let diminutives = 0;
  file.names.forEach((row: Partial<NameRow>, i: number) => {
    const at = `names[${i}]`;
    const name = row?.name;
    if (typeof name !== 'string') return void problems.push(`${at}: name must be a string`);
    if (name !== name.normalize('NFC')) problems.push(`${at} ${name}: not NFC`);
    if (name !== name.trim() || name === '') problems.push(`${at} "${name}": blank or padded`);
    if ([...name].some(forbidden)) problems.push(`${at} ${name}: control, bidi or markup character`);
    if (graphemes(name) > MAX_NAME_GRAPHEMES) problems.push(`${at} ${name}: over ${MAX_NAME_GRAPHEMES} graphemes`);
    if (typeof row.familyFriendly !== 'boolean') problems.push(`${at} ${name}: familyFriendly must be true or false`);
    if (row.style !== 'diminutive' && row.style !== 'plain') problems.push(`${at} ${name}: style must be diminutive or plain`);
    if (row.style === 'diminutive') {
      diminutives += row.familyFriendly === true ? 1 : 0;
      if (!DIMINUTIVE.test(name)) problems.push(`${at} ${name}: marked diminutive but not in the -o/-a/-za/-y/-ie/-z style`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) problems.push(`${at} ${name}: duplicate of ${seen.get(key)}`);
    seen.set(key, name);
  });
  if (diminutives < MIN_DIMINUTIVES) problems.push(`only ${diminutives} family-friendly diminutive names; at least ${MIN_DIMINUTIVES} are required`);
  if (!file.names.some((r: Partial<NameRow>) => r?.familyFriendly === true)) problems.push('no family-friendly name to offer');
  return problems;
}

/** The names the join card may offer: familyFriendly rows only. */
export function offered(rows: readonly NameRow[] = data.names as NameRow[]): string[] {
  return rows.filter((r) => r.familyFriendly).map((r) => r.name);
}

/** A random offered name from the whole list (`rand` is injectable for tests); falls back to "Mate" only if nothing is offered. */
export function prefillName(rand: () => number = Math.random, rows: readonly NameRow[] = data.names as NameRow[]): string {
  const ok = offered(rows);
  return ok[Math.floor(rand() * ok.length)] ?? 'Mate';
}

export const NAMES_FILE = data;
