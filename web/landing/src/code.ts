// Room-code entry rules (Playtest-1 plan §5.1): 4 characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no O/0/I/1/L),
// entered case-insensitively with stray spaces. Pure functions so the page and tests share one definition.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/** Upper-cases and drops whitespace and the dashes people add when reading a code aloud (' ab c d ' -> 'ABCD'). */
export function normaliseCode(raw: string): string {
  return raw.replace(/[\s \-_.]+/g, '').toUpperCase();
}

export type CodeCheck = { ok: true; code: string } | { ok: false; problem: 'empty' | 'chars' | 'short' | 'long'; message: string };

/** Checks a (raw or normalised) code and says what's wrong in words a player can act on. */
export function checkCode(raw: string): CodeCheck {
  const code = normaliseCode(raw);
  if (!code) return { ok: false, problem: 'empty', message: 'Type the 4-letter code shown on the big screen.' };
  const bad = [...new Set([...code].filter((c) => !CODE_ALPHABET.includes(c)))];
  if (bad.length) {
    return {
      ok: false,
      problem: 'chars',
      message: `Room codes don't use ${bad.join(' ')}. They skip O, 0, I, 1 and L so they're easy to read. Check the screen again.`,
    };
  }
  if (code.length < CODE_LENGTH) return { ok: false, problem: 'short', message: `Room codes are ${CODE_LENGTH} characters. Keep typing.` };
  if (code.length > CODE_LENGTH) return { ok: false, problem: 'long', message: `Room codes are ${CODE_LENGTH} characters, so that's too many.` };
  return { ok: true, code };
}
