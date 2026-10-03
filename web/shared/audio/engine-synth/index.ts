// Engine synth (P1-A04): a procedural Web Audio engine voice driven entirely by state.
//
//   import { create, assertProfile } from './engine-synth';
//   const voice = create(audioContext, assertProfile(profileJson), { destination: mixer, seed: carNumber });
//   voice.set({ rpm: 3200, throttle: 0.8, boost: 0.4, drift: 0, surface: 'tarmac', damage: 0.1, gear: 3 });
//   voice.dispose();
//
// - `create(ctx, profile)` works on any BaseAudioContext (real-time or OfflineAudioContext). The profile is
//   versioned JSON (`assets/audio/engine/*.json`, contract in `profile.schema.json`); a bad one throws a
//   message listing every problem.
// - `voice.set(partialState)` is the only input. Call it whenever state changes (once per sim tick or frame
//   is plenty); every layer glides to its target. A change of `gear` plays the gear-change dip.
// - `ignition` is the key (P1-A04c): `set({ ignition: true })` from off plays the start (starter crank, the catch
//   and flare, the settle to idle), `false` plays the stop (fuel cut, spool down to silence). Both play out by
//   themselves (scheduled automation, no further calls needed); `voice.ignition()` reports the phase and the rpm
//   being sounded. A voice is created running unless `initial.ignition` is false.
// - A profile without a `boost` section is a car without a turbo: the boost input does nothing and the layer is
//   never built.
// - Pass `initial` to `create` for a car that joins mid-race: the first `set` that changes `gear` plays the dip.
// - `voice.output` is one GainNode; connect it to your mixer, or pass `destination`.
// - Same seed + same sequence of `set` calls on a fresh context = the same audio (nothing uses Math.random).
//   Chromium sums a node's inputs in no fixed order, so with three or more layers live two renders can differ
//   in the last float32 bit (about -138 dBFS); any single layer is bit-identical.
// - One voice owns about 55 nodes while all layers are live; silent layers are disconnected from the graph
//   and cost nothing. `dispose()` frees them. There is no limit on how many voices you create.
// - `createDrivetrain(profile)` turns ground speed + throttle into rpm and gear, for callers that only know
//   speed (the gallery's scripted lap does).
export { create, create as createEngineVoice } from './voice';
export { assertProfile, validateProfile, PROFILE_RULE } from './profile';
export type { ProfileCheck } from './profile';
export { computeTargets, firingHz, speedFromRpm, rpmFromSpeed, mergeState, DEFAULT_STATE } from './mapping';
export type { Targets } from './mapping';
export { createDrivetrain } from './drivetrain';
export type { Drivetrain, DrivetrainOutput } from './drivetrain';
export { mulberry32, mixSeed, noiseBank } from './noise';
export { ENGINE_PHASES, LAYERS, SURFACES } from './types';
export type {
  EnginePhase,
  EngineProfile,
  EngineVoice,
  IgnitionStatus,
  LayerLevels,
  LayerName,
  Surface,
  SurfaceProfile,
  VoiceOptions,
  VoiceState,
} from './types';
