// Engine profile validation (P1-A04). The profile is versioned JSON data; this is the runtime validator
// and `profile.schema.json` is the same contract as JSON Schema (art/ui/poc/audio/engine/check.mjs proves
// they agree on the Cruz Missile and on a set of broken profiles). No dependencies, so any page can use it.
import type { EngineProfile } from './types';

export interface ProfileCheck {
  ok: boolean;
  /** One line per problem, each starting with the JSON path. */
  errors: string[];
  profile?: EngineProfile;
}

type Rule =
  | { k: 'num'; min: number; max: number; int: boolean }
  | { k: 'str' }
  | { k: 'lit'; v: string | number }
  | { k: 'enum'; v: readonly string[] }
  | { k: 'arr'; of: Rule; min: number }
  | { k: 'obj'; props: Record<string, Rule>; optional?: readonly string[] };

const num = (min: number, max: number, int = false): Rule => ({ k: 'num', min, max, int });
const str: Rule = { k: 'str' };
const lit = (v: string | number): Rule => ({ k: 'lit', v });
const oneOf = (...v: string[]): Rule => ({ k: 'enum', v });
const arr = (of: Rule, min = 1): Rule => ({ k: 'arr', of, min });
const obj = (props: Record<string, Rule>, optional: readonly string[] = []): Rule => ({ k: 'obj', props, optional });

const unit = num(0, 1);
const level = num(0, 4);
const hz = num(1, 16000);
const q = num(0.0001, 100);
const tau = num(0.001, 5);
const speed = num(0, 400);
const wave = obj({ phase: oneOf('sine', 'cosine'), harmonics: arr(num(0, 4), 1) });
const surfaceRule = obj({ brown: unit, crackle: unit, cutoffHz: hz, q, level: unit });

/** The contract. Keep `profile.schema.json` in step (check.mjs compares the two). */
export const PROFILE_RULE: Rule = obj(
  {
    $schema: str,
    format: lit('jj-engine-profile'),
    version: lit(1),
    id: str,
    name: str,
    description: str,
    engine: obj({ cylinders: num(1, 32, true), idleRpm: num(100, 20000), redlineRpm: num(100, 20000), limiterRpm: num(100, 20000) }),
    gearbox: obj({
      ratios: arr(num(0.1, 20), 1),
      finalDrive: num(0.1, 20),
      wheelRadiusM: num(0.05, 2),
      upshiftRpm: num(100, 20000),
      downshiftRpm: num(100, 20000),
      shiftTimeS: num(0, 3),
      launchRpm: num(100, 20000),
      rpmRiseTauS: tau,
      rpmFallTauS: tau,
    }),
    output: obj({ level: level, controlTauS: tau, noiseSeed: num(0, 4294967295, true) }),
    firing: obj({
      level,
      offThrottleLevel: unit,
      mellow: wave,
      bright: wave,
      brightMax: unit,
      bodyFilter: obj({ minHz: hz, maxHz: hz, q, throttleOpen: unit }),
      lope: obj({ depth: unit, fadeOutRpmN: num(0.01, 1) }),
    }),
    intake: obj({ level, minHz: hz, maxHz: hz, q }),
    exhaust: obj({ level, minHz: hz, maxHz: hz, q, pulseDepth: unit, pulseHarmonics: arr(num(0, 4), 1) }),
    boost: obj({ level, whineBaseHz: hz, whineSweepHz: num(0, 16000), whineRpmHz: num(0, 16000), whooshLevel: level, whooshHz: hz, whooshSweepHz: num(0, 16000) }),
    squeal: obj({
      level,
      centerMinHz: hz,
      centerMaxHz: hz,
      q,
      secondRatio: num(1, 4),
      wobbleHz: num(0.1, 60),
      wobbleDepth: unit,
      minSpeedMps: speed,
      fullSpeedMps: speed,
    }),
    surface: obj({ level, fullSpeedMps: num(1, 400), speedExponent: num(0.1, 4), tarmac: surfaceRule, dirt: surfaceRule, gravel: surfaceRule }),
    rattle: obj({ level, baseRateHz: num(0.1, 200), rpmRateScale: num(0, 10), idleShare: unit, bandsHz: arr(hz, 1), q, pulseHarmonics: arr(num(0, 4), 1) }),
    pops: obj({
      level,
      armThrottle: unit,
      fireThrottle: unit,
      minRpmN: unit,
      burstMin: num(1, 64, true),
      burstMax: num(1, 64, true),
      gapMinS: num(0.005, 2),
      gapMaxS: num(0.005, 2),
      bandHz: hz,
      q,
      upshiftShare: unit,
    }),
    gearDip: obj({ depth: unit, rampS: num(0.001, 1), holdS: num(0, 2), recoverTauS: tau }),
  },
  ['$schema'],
);

function typeName(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

function walk(rule: Rule, v: unknown, path: string, errors: string[]): void {
  switch (rule.k) {
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${path}: expected a finite number, got ${typeName(v)}`);
      else if (rule.int && !Number.isInteger(v)) errors.push(`${path}: expected an integer, got ${v}`);
      else if (v < rule.min || v > rule.max) errors.push(`${path}: ${v} is outside ${rule.min}..${rule.max}`);
      return;
    case 'str':
      if (typeof v !== 'string' || v.length === 0) errors.push(`${path}: expected a non-empty string`);
      return;
    case 'lit':
      if (v !== rule.v) errors.push(`${path}: expected ${JSON.stringify(rule.v)}, got ${JSON.stringify(v)}`);
      return;
    case 'enum':
      if (typeof v !== 'string' || !rule.v.includes(v)) errors.push(`${path}: expected one of ${rule.v.join(', ')}, got ${JSON.stringify(v)}`);
      return;
    case 'arr':
      if (!Array.isArray(v)) errors.push(`${path}: expected an array, got ${typeName(v)}`);
      else if (v.length < rule.min) errors.push(`${path}: needs at least ${rule.min} item(s)`);
      else v.forEach((item, i) => walk(rule.of, item, `${path}[${i}]`, errors));
      return;
    case 'obj': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        errors.push(`${path}: expected an object, got ${typeName(v)}`);
        return;
      }
      const rec = v as Record<string, unknown>;
      for (const [key, sub] of Object.entries(rule.props)) {
        if (!(key in rec)) {
          if (!rule.optional?.includes(key)) errors.push(`${path}.${key}: missing`);
          continue;
        }
        walk(sub, rec[key], `${path}.${key}`, errors);
      }
      for (const key of Object.keys(rec)) if (!(key in rule.props)) errors.push(`${path}.${key}: unknown field`);
      return;
    }
  }
}

/** Cross-field rules a per-field range cannot express. Only called when every field is already well-typed. */
function relations(p: EngineProfile, errors: string[]): void {
  const e = p.engine;
  if (!(e.idleRpm < e.redlineRpm)) errors.push('$.engine: idleRpm must be below redlineRpm');
  if (!(e.redlineRpm <= e.limiterRpm)) errors.push('$.engine: redlineRpm must not exceed limiterRpm');
  const g = p.gearbox;
  for (let i = 1; i < g.ratios.length; i++) {
    if (!((g.ratios[i] ?? 0) < (g.ratios[i - 1] ?? 0))) errors.push(`$.gearbox.ratios[${i}]: each gear must be lower than the one before`);
  }
  if (!(g.downshiftRpm < g.upshiftRpm)) errors.push('$.gearbox: downshiftRpm must be below upshiftRpm');
  if (!(g.upshiftRpm <= e.limiterRpm)) errors.push('$.gearbox: upshiftRpm must not exceed limiterRpm');
  if (!(g.downshiftRpm > e.idleRpm)) errors.push('$.gearbox: downshiftRpm must be above idleRpm');
  if (!(g.launchRpm <= e.limiterRpm)) errors.push('$.gearbox: launchRpm must not exceed limiterRpm');
  if (!(p.firing.bodyFilter.minHz <= p.firing.bodyFilter.maxHz)) errors.push('$.firing.bodyFilter: minHz must not exceed maxHz');
  if (!(p.intake.minHz <= p.intake.maxHz)) errors.push('$.intake: minHz must not exceed maxHz');
  if (!(p.exhaust.minHz <= p.exhaust.maxHz)) errors.push('$.exhaust: minHz must not exceed maxHz');
  if (!(p.squeal.centerMinHz <= p.squeal.centerMaxHz)) errors.push('$.squeal: centerMinHz must not exceed centerMaxHz');
  if (!(p.squeal.minSpeedMps < p.squeal.fullSpeedMps)) errors.push('$.squeal: minSpeedMps must be below fullSpeedMps');
  if (!(p.pops.burstMin <= p.pops.burstMax)) errors.push('$.pops: burstMin must not exceed burstMax');
  if (!(p.pops.gapMinS <= p.pops.gapMaxS)) errors.push('$.pops: gapMinS must not exceed gapMaxS');
  if (!(p.pops.fireThrottle < p.pops.armThrottle)) errors.push('$.pops: fireThrottle must be below armThrottle');
}

/** Validate unknown data (usually parsed JSON). Never throws. */
export function validateProfile(data: unknown): ProfileCheck {
  const errors: string[] = [];
  walk(PROFILE_RULE, data, '$', errors);
  if (errors.length === 0) relations(data as EngineProfile, errors);
  return errors.length === 0 ? { ok: true, errors, profile: data as EngineProfile } : { ok: false, errors };
}

/** Validate and return the typed profile, or throw one error listing every problem. */
export function assertProfile(data: unknown): EngineProfile {
  const check = validateProfile(data);
  if (!check.ok || !check.profile) throw new Error(`invalid engine profile:\n  ${check.errors.join('\n  ')}`);
  return check.profile;
}
