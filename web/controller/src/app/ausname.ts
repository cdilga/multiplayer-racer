// The Australian name button (P1-C03 later): "David" becomes "Davo". Two paths, one validator.
//  - When the browser has its built-in on-device model (Chrome's Prompt API, `LanguageModel`, Gemini Nano) and it is
//    already available, ask it for one short nickname with a tight system prompt and validate the reply. No network, no
//    key, no CDN (R70, R79): if the model would need a download, or fails, or the reply fails validation, the fallback runs.
//  - The fallback always works and is the tested path: a sheet of known conversions (ausname.json), then deterministic
//    rules (first syllable + -o, or the doubled consonant + -a/-o), then the same validator.
// The button never changes a name without a tap, and the caller keeps the old value for Undo. Nothing leaves the device.
import sheet from './ausname.json' with { type: 'json' };

export const MAX_NAME_GRAPHEMES = 32;
export type How = 'model' | 'known' | 'rules' | 'same' | 'none';
export interface Converted {
  name: string;
  how: How;
}

const known = sheet.known as Record<string, string>;
const avoid = sheet.avoid as string[];
const graphemes = (s: string): number => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The result validator, shared by both paths: NFC, non-empty, a single plain word, short, and family-friendly. */
export function validResult(name: string): boolean {
  if (!name || name !== name.normalize('NFC') || name !== name.trim()) return false;
  if (graphemes(name) > MAX_NAME_GRAPHEMES) return false;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(name)) return false;
  const low = name.toLowerCase();
  return !avoid.some((bad) => low.includes(bad));
}

const VOWEL = /[aeiouy]/;

/** The rules: deterministic for a given input. Returns null when they have nothing sensible to say. */
export function byRules(core: string): string | null {
  const low = core.toLowerCase();
  // Plain ASCII letters with a vowel: the rules have nothing sensible to say about anything else.
  if (low.length < 2 || !/^[a-z]+$/.test(low) || !/[aeiou]/.test(low)) return null;
  if (/(o|oo|za|zza|y|ie|ey)$/.test(low)) return cap(low); // already in the style
  const m = /^([^aeiou]*[aeiou]+[^aeiouy]?)/.exec(low);
  let stem = m?.[1] ?? low;
  if (stem.length < 3 && low.length > stem.length) stem = low.slice(0, Math.min(low.length, 3));
  const last = stem.charAt(stem.length - 1);
  const endsVowel = VOWEL.test(last);
  const pick = [...low].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  const base = endsVowel ? stem.slice(0, -1) || stem : stem;
  const double = endsVowel ? '' : last; // Gaz + z + a: the doubled consonant
  const out = stem === low && !endsVowel ? `${stem}o` : pick === 0 ? `${base}o` : pick === 1 ? `${stem}${double}${endsVowel ? 'z' : ''}a` : `${stem}${double}o`;
  return cap(out);
}

/** The always-available path: the known-names sheet, then the rules. */
export function fallback(raw: string): Converted {
  const typed = raw.normalize('NFC').trim();
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(typed)) return { name: typed, how: 'none' };
  const sheetHit = known[typed.toLowerCase()];
  if (sheetHit) return validResult(sheetHit) ? { name: sheetHit, how: 'known' } : { name: typed, how: 'none' };
  const ruled = byRules(typed);
  if (!ruled || !validResult(ruled)) return { name: typed, how: 'none' };
  if (ruled.toLowerCase() === typed.toLowerCase()) return { name: typed, how: 'same' };
  return { name: ruled, how: 'rules' };
}

/** The Prompt API's surface we use (it isn't in lib.dom yet). */
export interface LanguageModelLike {
  availability(opts?: unknown): Promise<string>;
  create(opts?: unknown): Promise<{ prompt(text: string): Promise<string>; destroy?: () => void }>;
}

export const SYSTEM_PROMPT =
  'You turn a first name into one short Australian nickname in the -o, -a or -za style, like David to Davo, Steven to Stevo, Gary to Gazza. Reply with the nickname only: one word, no punctuation, no explanation, family-friendly, at most 32 characters.';

/** Asks the on-device model if it is already available; null on anything else (never waits for a download). */
export async function byModel(raw: string, lm: LanguageModelLike | undefined = (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel, timeoutMs = 4000): Promise<string | null> {
  if (!lm) return null;
  try {
    if ((await lm.availability()) !== 'available') return null;
    const run = (async () => {
      const session = await lm.create({ initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }] });
      try {
        return (await session.prompt(raw)).normalize('NFC').trim().replace(/[.!"'“”]+$/u, '').replace(/^["'“”]+/u, '');
      } finally {
        session.destroy?.();
      }
    })();
    const reply = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
    return reply && validResult(reply) ? cap(reply) : null;
  } catch {
    return null;
  }
}

/** What the button does: the model when it can, else the fallback. */
export async function ausName(raw: string, lm?: LanguageModelLike): Promise<Converted> {
  const typed = raw.normalize('NFC').trim();
  if (!typed) return { name: typed, how: 'none' };
  const viaModel = await byModel(typed, lm);
  if (viaModel && viaModel.toLowerCase() !== typed.toLowerCase()) return { name: viaModel, how: 'model' };
  return fallback(typed);
}
