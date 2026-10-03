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

/** Documentation a generated control can read (P1-A04b): a one-line meaning and the unit. */
interface Meta {
  doc?: string;
  unit?: string;
}

type Rule =
  | ({ k: 'num'; min: number; max: number; int: boolean } & Meta)
  | ({ k: 'str' } & Meta)
  | ({ k: 'lit'; v: string | number } & Meta)
  | ({ k: 'enum'; v: readonly string[] } & Meta)
  | ({ k: 'arr'; of: Rule; min: number } & Meta)
  | ({ k: 'obj'; props: Record<string, Rule>; optional?: readonly string[] } & Meta);

const num = (min: number, max: number, int = false): Rule => ({ k: 'num', min, max, int });
const str: Rule = { k: 'str' };
const lit = (v: string | number): Rule => ({ k: 'lit', v });
const oneOf = (...v: string[]): Rule => ({ k: 'enum', v });
const arr = (of: Rule, min = 1): Rule => ({ k: 'arr', of, min });
const obj = (props: Record<string, Rule>, optional: readonly string[] = []): Rule => ({ k: 'obj', props, optional });
/** Attaches the lab metadata (doc always; unit when the field has one). */
const meta = (r: Rule, doc: string, unit?: string): Rule => ({ ...r, doc, ...(unit ? { unit } : {}) });

const unit = meta(num(0, 1), 'A 0-to-1 share.', '0–1');
const level = meta(num(0, 4), 'A layer loudness (1 is the section reference; above 1 pushes).', '×');
const hz = meta(num(1, 16000), 'A frequency.', 'Hz');
const q = meta(num(0.0001, 100), 'Filter resonance: higher is a narrower, rangier band.', 'Q');
const tau = meta(num(0.001, 5), 'A glide time constant (63% of the way in one tau).', 's');
const speed = meta(num(0, 400), 'A ground speed.', 'm/s');
const wave = obj({
  phase: meta(oneOf('sine', 'cosine'), 'Which way the wave starts: sine from zero, cosine from full.'),
  harmonics: meta(arr(num(0, 4), 1), 'Overtone weights: [fundamental, 2nd, 3rd…] relative strengths.', '×'),
});
const surfaceRule = obj({
  brown: meta(unit, 'Rumble share (brown noise) for this surface.'),
  crackle: meta(unit, 'Crackle share (loose grit) for this surface.'),
  cutoffHz: meta(hz, 'Low-pass cutoff the road noise is capped at.'),
  q,
  level: meta(unit, 'Overall share of this surface versus the others.'),
});

/** The contract. Keep `profile.schema.json` in step (check.mjs compares the two). */
export const PROFILE_RULE: Rule = obj(
  {
    $schema: meta(str, 'Pointer to the profile schema; kept by tooling, not a sound parameter.'),
    format: meta(lit('jj-engine-profile'), 'The format tag; must stay jj-engine-profile.'),
    version: meta(lit(1), 'The profile contract version this file speaks.'),
    id: meta(str, 'Stable machine id (used in URLs and file names).'),
    name: meta(str, 'Display name painted in the lab and the game.'),
    description: meta(str, 'One breath of flavour text about how this car should sound.'),
    engine: obj({
      cylinders: meta(num(1, 32, true), 'Cylinder count: sets the firing rate (rpm/60 × cylinders/2).', 'cyl'),
      idleRpm: meta(num(100, 20000), 'Engine speed at closed throttle; also the lope idle.', 'rpm'),
      redlineRpm: meta(num(100, 20000), 'Where the tach marks red; the note stops climbing past it.', 'rpm'),
      limiterRpm: meta(num(100, 20000), 'The hard cut: the highest rpm any control may ask for.', 'rpm'),
    }),
    gearbox: obj({
      ratios: meta(arr(num(0.1, 20), 1), 'Gear ratios highest (1st) to lowest; must fall.', '×'),
      finalDrive: meta(num(0.1, 20), 'Final drive multiplied after the gearbox.', '×'),
      wheelRadiusM: meta(num(0.05, 2), 'Driven wheel radius; converts rpm to road speed.', 'm'),
      upshiftRpm: meta(num(100, 20000), 'The drivetrain shifts up at this engine speed.', 'rpm'),
      downshiftRpm: meta(num(100, 20000), 'The drivetrain shifts back down below this.', 'rpm'),
      shiftTimeS: meta(num(0, 3), 'How long a change takes (the lap driver pauses throttle).', 's'),
      launchRpm: meta(num(100, 20000), 'Clutch-drop speed when pulling away from rest.', 'rpm'),
      rpmRiseTauS: meta(tau, 'How quickly free revs rise (smaller is snappier).', 's'),
      rpmFallTauS: meta(tau, 'How quickly free revs fall back to idle.', 's'),
    }),
    output: obj({
      level: meta(level, 'Master level of the whole voice (A/B matching trims this).', '×'),
      controlTauS: meta(tau, 'Glide time for every live parameter change.', 's'),
      noiseSeed: meta(num(0, 4294967295, true), 'Seed for every random choice (offsets, pop strengths).', 'seed'),
    }),
    firing: obj({
      level,
      offThrottleLevel: meta(unit, 'Firing loudness with the throttle shut (engine braking).'),
      mellow: meta(wave, 'The base pulse wave: its shape sets the round body of the note.'),
      bright: meta(wave, 'The brighter pulse added as revs and throttle rise.'),
      brightMax: meta(unit, 'How much of the bright wave is mixed in at full song.'),
      bodyFilter: obj({
        minHz: meta(hz, 'Body low-pass at closed throttle (the note darkens off song).'),
        maxHz: meta(hz, 'Body low-pass at full throttle (the note opens up).'),
        q,
        throttleOpen: meta(unit, 'How far open the throttle must be before the filter opens.'),
      }),
      lope: obj({
        depth: meta(unit, 'Idle-lope amplitude: the slow am/am wobble at low rpm.'),
        fadeOutRpmN: meta(num(0.01, 1), 'Fraction of redline where the lope is gone.', '×redline'),
      }),
    }),
    intake: obj({ level, minHz: meta(hz, 'Intake band-pass at low revs.'), maxHz: meta(hz, 'Intake band-pass at redline (it sweeps with revs).'), q }),
    exhaust: obj({
      level,
      minHz: meta(hz, 'Exhaust low-pass at low revs.'),
      maxHz: meta(hz, 'Exhaust low-pass at redline.'),
      q,
      pulseDepth: meta(unit, 'How deeply each firing pulse chops the exhaust (the chuff).'),
      pulseHarmonics: meta(arr(num(0, 4), 1), 'Shape of the exhaust chop wave.', '×'),
    }),
    boost: meta(obj({
      level,
      whineBaseHz: meta(hz, 'Turbo whine pitch at zero boost.'),
      whineSweepHz: meta(num(0, 16000), 'How far the whine rises at full boost.', 'Hz'),
      whineRpmHz: meta(num(0, 16000), 'Extra whine rise across the rev range.', 'Hz'),
      whooshLevel: meta(level, 'The broadband hiss under the whine.', '×'),
      whooshHz: meta(hz, 'Centre of the whoosh band-pass.'),
      whooshSweepHz: meta(num(0, 16000), 'How far the whoosh centre rises with boost.', 'Hz'),
    }), 'Turbo or supercharger. Optional: leave it out for a car without one (the Cruz Missile has none).'),
    squeal: obj({
      level,
      centerMinHz: meta(hz, 'Tyre-squeal resonance at the slip threshold.'),
      centerMaxHz: meta(hz, 'Squeal resonance at full slip.'),
      q,
      secondRatio: meta(num(1, 4), 'The second resonance sits at this multiple of the first.', '×'),
      wobbleHz: meta(num(0.1, 60), 'How fast the squeal pitch wobbles.', 'Hz'),
      wobbleDepth: meta(unit, 'How far the wobble sweeps the resonances.'),
      minSpeedMps: meta(speed, 'Below this road speed there is no squeal.'),
      fullSpeedMps: meta(speed, 'Road speed where the squeal is fully on.'),
    }),
    surface: obj({
      level,
      fullSpeedMps: meta(num(1, 400), 'Road speed where the rumble reaches full level.', 'm/s'),
      speedExponent: meta(num(0.1, 4), 'How aggressively rumble grows with speed (1 is linear).', 'exp'),
      tarmac: meta(surfaceRule, 'Smooth tarmac: mostly rumble, no crackle.'),
      dirt: meta(surfaceRule, 'Packed dirt: more crackle, lower cutoff.'),
      gravel: meta(surfaceRule, 'Loose gravel: the crackliest, darkest rumble.'),
    }),
    rattle: obj({
      level,
      baseRateHz: meta(num(0.1, 200), 'Rattle chop rate at idle (loose parts knocking).', 'Hz'),
      rpmRateScale: meta(num(0, 10), 'How much the knock rate rises across the revs.', '×'),
      idleShare: meta(unit, 'Rattle loudness with no damage (nothing should be left loose).'),
      bandsHz: meta(arr(hz, 1), 'Centre frequencies of the metallic knock bands.', 'Hz'),
      q,
      pulseHarmonics: meta(arr(num(0, 4), 1), 'Shape of the knock chop wave.', '×'),
    }),
    pops: obj({
      level,
      armThrottle: meta(unit, 'Throttle above which the pop is armed while on the boost.'),
      fireThrottle: meta(unit, 'Throttle below which an armed pop fires (the lift).'),
      minRpmN: meta(unit, 'Fraction of redline below which no pop fires.', '×redline'),
      burstMin: meta(num(1, 64, true), 'Fewest cracks in one overrun burst.', 'count'),
      burstMax: meta(num(1, 64, true), 'Most cracks in one overrun burst.', 'count'),
      gapMinS: meta(num(0.005, 2), 'Shortest gap between cracks in a burst.', 's'),
      gapMaxS: meta(num(0.005, 2), 'Longest gap between cracks in a burst.', 's'),
      bandHz: meta(hz, 'Centre of the crack band-pass.'),
      q,
      upshiftShare: meta(unit, 'How much of a crack a hard upshift adds.'),
    }),
    gearDip: obj({
      depth: meta(unit, 'How far the engine ducks in level on a gear change.'),
      rampS: meta(num(0.001, 1), 'Time into the dip.', 's'),
      holdS: meta(num(0, 2), 'Time held at the bottom.', 's'),
      recoverTauS: meta(tau, 'How quickly the level climbs back out.', 's'),
    }),
    ignition: meta(obj({
      crankS: meta(num(0.1, 5), 'How long the starter turns the engine over before it catches.', 's'),
      crankRpm: meta(num(30, 2000), 'Engine speed on the starter (below idle): sets the compression chug.', 'rpm'),
      starterHz: meta(hz, 'Starter-motor whine pitch.'),
      starterLevel: meta(level, 'Starter-motor loudness.', '×'),
      crankShare: meta(unit, 'Engine loudness while cranking, as a share of running (the chug under the starter).'),
      catchS: meta(num(0.01, 2), 'Time from the catch to the top of the rev flare.', 's'),
      flareRpm: meta(num(100, 20000), 'Peak of the rev flare when it catches.', 'rpm'),
      settleTauS: meta(tau, 'How quickly the flare falls back to idle (settled after three of these).', 's'),
      stopS: meta(num(0.2, 6), 'Fuel cut to silence: how long the engine spools down.', 's'),
    }), 'Engine start (crank, catch, settle to idle) and stop (cut, spool down).'),
  },
  ['$schema', 'boost'],
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
  if (!(p.ignition.crankRpm < e.idleRpm)) errors.push('$.ignition: crankRpm must be below idleRpm');
  if (!(p.ignition.flareRpm > e.idleRpm)) errors.push('$.ignition: flareRpm must be above idleRpm');
  if (!(p.ignition.flareRpm <= e.limiterRpm)) errors.push('$.ignition: flareRpm must not exceed limiterRpm');
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
