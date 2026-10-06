//#region web/shared/audio/engine-synth/types.ts
/** The surfaces the rumble layer knows. Data lives in the profile; this list is the schema's enum. */
var SURFACES = [
	"tarmac",
	"dirt",
	"gravel"
];
/** Every audible layer of a voice, in mix order. Each is driven by state (see mapping.ts). */
var LAYERS = [
	"firing",
	"intake",
	"exhaust",
	"boost",
	"squeal",
	"surface",
	"rattle",
	"pops",
	"starter"
];
/** Where the engine is in its start and stop (P1-A04c). */
var ENGINE_PHASES = [
	"off",
	"cranking",
	"catching",
	"settling",
	"running",
	"stopping"
];
//#endregion
//#region web/shared/audio/engine-synth/mapping.ts
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var clamp01 = (v) => clamp(v, 0, 1);
var lerp = (a, b, t) => a + (b - a) * t;
/** Geometric interpolation: equal steps in t are equal musical intervals. */
var elerp = (a, b, t) => a * Math.pow(b / a, t);
var smoothstep = (lo, hi, v) => {
	const t = clamp01((v - lo) / (hi - lo));
	return t * t * (3 - 2 * t);
};
var DEFAULT_STATE = Object.freeze({
	rpm: 0,
	throttle: 0,
	boost: 0,
	drift: 0,
	surface: "tarmac",
	damage: 0,
	gear: 0,
	ignition: true
});
/** Ground speed implied by engine speed in a gear (0 in neutral). */
function speedFromRpm(profile, rpm, gear) {
	const ratios = profile.gearbox.ratios;
	if (gear < 1 || ratios.length === 0) return 0;
	const ratio = ratios[Math.min(gear, ratios.length) - 1] ?? 1;
	return rpm / 60 / (ratio * profile.gearbox.finalDrive) * 2 * Math.PI * profile.gearbox.wheelRadiusM;
}
/** Engine speed implied by ground speed in a gear (the inverse of speedFromRpm). */
function rpmFromSpeed(profile, speedMps, gear) {
	const ratios = profile.gearbox.ratios;
	if (gear < 1 || ratios.length === 0) return 0;
	const ratio = ratios[Math.min(gear, ratios.length) - 1] ?? 1;
	return speedMps / (2 * Math.PI * profile.gearbox.wheelRadiusM) * ratio * profile.gearbox.finalDrive * 60;
}
/** Merge a partial update into a state, clamping every field and ignoring anything non-finite or unknown. */
function mergeState(profile, prev, next) {
	const out = { ...prev };
	const fin = (v) => typeof v === "number" && Number.isFinite(v);
	if (fin(next.rpm)) out.rpm = clamp(next.rpm, 0, profile.engine.limiterRpm);
	if (fin(next.throttle)) out.throttle = clamp01(next.throttle);
	if (fin(next.boost)) out.boost = clamp01(next.boost);
	if (fin(next.drift)) out.drift = clamp01(next.drift);
	if (fin(next.damage)) out.damage = clamp01(next.damage);
	if (fin(next.gear)) out.gear = clamp(Math.round(next.gear), 0, profile.gearbox.ratios.length);
	if (typeof next.surface === "string" && SURFACES.includes(next.surface)) out.surface = next.surface;
	if (typeof next.ignition === "boolean") out.ignition = next.ignition;
	if ("speed" in next) {
		if (fin(next.speed)) out.speed = Math.max(0, next.speed);
		else delete out.speed;
	}
	return out;
}
/** Firing frequency in Hz for an engine speed (4-stroke: every cylinder fires once per two revolutions). */
var firingHz = (cylinders, rpm) => rpm / 60 * (cylinders / 2);
function computeTargets(p, s) {
	const e = p.engine;
	const rpmN = clamp01((s.rpm - e.idleRpm) / (e.redlineRpm - e.idleRpm));
	const run = smoothstep(0, e.idleRpm * .7, s.rpm);
	const speed = s.speed ?? speedFromRpm(p, s.rpm, s.gear);
	const speedN = clamp01(speed / p.surface.fullSpeedMps);
	const f0 = firingHz(e.cylinders, s.rpm);
	const f = p.firing;
	const loadGain = lerp(f.offThrottleLevel, 1, s.throttle) * run;
	const brightMix = f.brightMax * s.throttle * (.3 + .7 * rpmN);
	const open = lerp(1 - f.bodyFilter.throttleOpen, 1, s.throttle);
	const bodyHz = elerp(f.bodyFilter.minHz, f.bodyFilter.maxHz, rpmN) * open;
	const lopeFade = clamp01(1 - rpmN / f.lope.fadeOutRpmN);
	const firing = {
		f0,
		lopeHz: f0 / 2,
		lopeDepth: f.lope.depth * lopeFade * lopeFade,
		mellowGain: f.level * loadGain * (1 - brightMix * .6),
		brightGain: f.level * loadGain * brightMix,
		bodyHz
	};
	const intakeAct = Math.pow(s.throttle, 1.5) * (.3 + .7 * rpmN) * run;
	const exhaustAct = lerp(.45, 1, s.throttle) * (.4 + .6 * rpmN) * run;
	const b = p.boost;
	const boostAct = b ? Math.pow(s.boost, 1.4) * run : 0;
	const speedSqueal = smoothstep(p.squeal.minSpeedMps, p.squeal.fullSpeedMps, speed);
	const squealAct = Math.pow(s.drift, 1.3) * speedSqueal;
	const surf = p.surface[s.surface];
	const surfaceAct = Math.pow(speedN, p.surface.speedExponent) * surf.level;
	const rattleShare = p.rattle.idleShare * run + (1 - p.rattle.idleShare) * Math.max(rpmN, .7 * speedN);
	const rattleAct = Math.pow(s.damage, 1.2) * rattleShare;
	const squealHz = elerp(p.squeal.centerMinHz, p.squeal.centerMaxHz, clamp01(.6 * s.drift + .4 * speedN));
	return {
		run,
		rpmN,
		speed,
		speedN,
		f0,
		levels: {
			firing: loadGain,
			intake: intakeAct,
			exhaust: exhaustAct,
			boost: boostAct,
			squeal: squealAct,
			surface: surfaceAct,
			rattle: rattleAct,
			pops: 0,
			starter: 0
		},
		firing,
		intake: {
			gain: p.intake.level * intakeAct,
			hz: elerp(p.intake.minHz, p.intake.maxHz, rpmN)
		},
		exhaust: {
			gain: p.exhaust.level * exhaustAct,
			hz: elerp(p.exhaust.minHz, p.exhaust.maxHz, clamp01(.6 * rpmN + .4 * s.throttle)),
			amHz: f0,
			amDepth: p.exhaust.pulseDepth
		},
		boost: b ? {
			whineHz: b.whineBaseHz + b.whineSweepHz * s.boost + b.whineRpmHz * rpmN,
			whineGain: b.level * boostAct * (.35 + .65 * rpmN),
			whooshGain: b.level * b.whooshLevel * Math.pow(s.boost, 1.2),
			whooshHz: b.whooshHz + b.whooshSweepHz * s.boost
		} : {
			whineHz: 0,
			whineGain: 0,
			whooshGain: 0,
			whooshHz: 0
		},
		squeal: {
			gain: p.squeal.level * squealAct,
			hz1: squealHz,
			hz2: squealHz * p.squeal.secondRatio
		},
		surface: {
			brownGain: p.surface.level * surfaceAct * surf.brown,
			crackleGain: p.surface.level * surfaceAct * surf.crackle,
			cutoffHz: surf.cutoffHz,
			q: surf.q
		},
		rattle: {
			gain: p.rattle.level * rattleAct,
			rateHz: p.rattle.baseRateHz + s.rpm / 60 * p.rattle.rpmRateScale
		}
	};
}
//#endregion
//#region web/shared/audio/engine-synth/noise.ts
/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
/** Mix two seeds into one (order matters). */
function mixSeed(a, b) {
	let h = (a ^ Math.imul(b + 2654435769, 2246822507)) >>> 0;
	h = Math.imul(h ^ h >>> 16, 2146121005) >>> 0;
	h = Math.imul(h ^ h >>> 15, 2221713035) >>> 0;
	return (h ^ h >>> 16) >>> 0;
}
var BANK_SECONDS = 4;
var BANK_SEED = 1246363649;
var banks = /* @__PURE__ */ new WeakMap();
function makeBank(ctx) {
	const len = Math.round(ctx.sampleRate * BANK_SECONDS);
	const mk = () => {
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		return [buf, buf.getChannelData(0)];
	};
	const [white, w] = mk();
	const rw = mulberry32(BANK_SEED);
	for (let i = 0; i < len; i++) w[i] = rw() * 2 - 1;
	const [brown, b] = mk();
	const rb = mulberry32(1246368016);
	let acc = 0;
	let peak = 1e-9;
	for (let i = 0; i < len; i++) {
		acc = acc * .985 + (rb() * 2 - 1) * .1;
		b[i] = acc;
		peak = Math.max(peak, Math.abs(acc));
	}
	const jump = (b[len - 1] ?? 0) - (b[0] ?? 0);
	for (let i = 0; i < len; i++) b[i] = (b[i] ?? 0) - jump * i / len;
	for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(b[i] ?? 0));
	for (let i = 0; i < len; i++) b[i] = (b[i] ?? 0) / peak;
	const [crackle, c] = mk();
	const rc = mulberry32(1246372387);
	const impacts = Math.round(220);
	for (let n = 0; n < impacts; n++) {
		const at = Math.floor(rc() * (len - 1024));
		const amp = .25 + .75 * rc() * rc();
		const decay = .0012 + .004 * rc();
		const span = Math.min(1024, Math.round(decay * ctx.sampleRate * 6));
		for (let i = 0; i < span; i++) c[at + i] = (c[at + i] ?? 0) + (rc() * 2 - 1) * amp * Math.exp(-i / (decay * ctx.sampleRate));
	}
	let cp = 1e-9;
	for (let i = 0; i < len; i++) cp = Math.max(cp, Math.abs(c[i] ?? 0));
	for (let i = 0; i < len; i++) c[i] = (c[i] ?? 0) / cp;
	return {
		seconds: BANK_SECONDS,
		white,
		brown,
		crackle
	};
}
/** The shared noise buffers of a context (built on first use, then cached for the context's life). */
function noiseBank(ctx) {
	let bank = banks.get(ctx);
	if (!bank) {
		bank = makeBank(ctx);
		banks.set(ctx, bank);
	}
	return bank;
}
//#endregion
//#region web/shared/audio/engine-synth/profile.ts
var num = (min, max, int = false) => ({
	k: "num",
	min,
	max,
	int
});
var str = { k: "str" };
var lit = (v) => ({
	k: "lit",
	v
});
var oneOf = (...v) => ({
	k: "enum",
	v
});
var arr = (of, min = 1) => ({
	k: "arr",
	of,
	min
});
var obj = (props, optional = []) => ({
	k: "obj",
	props,
	optional
});
/** Attaches the lab metadata (doc always; unit when the field has one). */
var meta = (r, doc, unit) => ({
	...r,
	doc,
	...unit ? { unit } : {}
});
var unit = meta(num(0, 1), "A 0-to-1 share.", "0–1");
var level = meta(num(0, 4), "A layer loudness (1 is the section reference; above 1 pushes).", "×");
var hz = meta(num(1, 16e3), "A frequency.", "Hz");
var q = meta(num(1e-4, 100), "Filter resonance: higher is a narrower, rangier band.", "Q");
var tau = meta(num(.001, 5), "A glide time constant (63% of the way in one tau).", "s");
var speed = meta(num(0, 400), "A ground speed.", "m/s");
var wave = obj({
	phase: meta(oneOf("sine", "cosine"), "Which way the wave starts: sine from zero, cosine from full."),
	harmonics: meta(arr(num(0, 4), 1), "Overtone weights: [fundamental, 2nd, 3rd…] relative strengths.", "×")
});
var surfaceRule = obj({
	brown: meta(unit, "Rumble share (brown noise) for this surface."),
	crackle: meta(unit, "Crackle share (loose grit) for this surface."),
	cutoffHz: meta(hz, "Low-pass cutoff the road noise is capped at."),
	q,
	level: meta(unit, "Overall share of this surface versus the others.")
});
/** The contract. Keep `profile.schema.json` in step (check.mjs compares the two). */
var PROFILE_RULE = obj({
	$schema: meta(str, "Pointer to the profile schema; kept by tooling, not a sound parameter."),
	format: meta(lit("jj-engine-profile"), "The format tag; must stay jj-engine-profile."),
	version: meta(lit(1), "The profile contract version this file speaks."),
	id: meta(str, "Stable machine id (used in URLs and file names)."),
	name: meta(str, "Display name painted in the lab and the game."),
	description: meta(str, "One breath of flavour text about how this car should sound."),
	engine: obj({
		cylinders: meta(num(1, 32, true), "Cylinder count: sets the firing rate (rpm/60 × cylinders/2).", "cyl"),
		idleRpm: meta(num(100, 2e4), "Engine speed at closed throttle; also the lope idle.", "rpm"),
		redlineRpm: meta(num(100, 2e4), "Where the tach marks red; the note stops climbing past it.", "rpm"),
		limiterRpm: meta(num(100, 2e4), "The hard cut: the highest rpm any control may ask for.", "rpm")
	}),
	gearbox: obj({
		ratios: meta(arr(num(.1, 20), 1), "Gear ratios highest (1st) to lowest; must fall.", "×"),
		finalDrive: meta(num(.1, 20), "Final drive multiplied after the gearbox.", "×"),
		wheelRadiusM: meta(num(.05, 2), "Driven wheel radius; converts rpm to road speed.", "m"),
		upshiftRpm: meta(num(100, 2e4), "The drivetrain shifts up at this engine speed.", "rpm"),
		downshiftRpm: meta(num(100, 2e4), "The drivetrain shifts back down below this.", "rpm"),
		shiftTimeS: meta(num(0, 3), "How long a change takes (the lap driver pauses throttle).", "s"),
		launchRpm: meta(num(100, 2e4), "Clutch-drop speed when pulling away from rest.", "rpm"),
		rpmRiseTauS: meta(tau, "How quickly free revs rise (smaller is snappier).", "s"),
		rpmFallTauS: meta(tau, "How quickly free revs fall back to idle.", "s")
	}),
	output: obj({
		level: meta(level, "Master level of the whole voice (A/B matching trims this).", "×"),
		controlTauS: meta(tau, "Glide time for every live parameter change.", "s"),
		noiseSeed: meta(num(0, 4294967295, true), "Seed for every random choice (offsets, pop strengths).", "seed")
	}),
	firing: obj({
		level,
		offThrottleLevel: meta(unit, "Firing loudness with the throttle shut (engine braking)."),
		mellow: meta(wave, "The base pulse wave: its shape sets the round body of the note."),
		bright: meta(wave, "The brighter pulse added as revs and throttle rise."),
		brightMax: meta(unit, "How much of the bright wave is mixed in at full song."),
		bodyFilter: obj({
			minHz: meta(hz, "Body low-pass at closed throttle (the note darkens off song)."),
			maxHz: meta(hz, "Body low-pass at full throttle (the note opens up)."),
			q,
			throttleOpen: meta(unit, "How far open the throttle must be before the filter opens.")
		}),
		lope: obj({
			depth: meta(unit, "Idle-lope amplitude: the slow am/am wobble at low rpm."),
			fadeOutRpmN: meta(num(.01, 1), "Fraction of redline where the lope is gone.", "×redline")
		})
	}),
	intake: obj({
		level,
		minHz: meta(hz, "Intake band-pass at low revs."),
		maxHz: meta(hz, "Intake band-pass at redline (it sweeps with revs)."),
		q
	}),
	exhaust: obj({
		level,
		minHz: meta(hz, "Exhaust low-pass at low revs."),
		maxHz: meta(hz, "Exhaust low-pass at redline."),
		q,
		pulseDepth: meta(unit, "How deeply each firing pulse chops the exhaust (the chuff)."),
		pulseHarmonics: meta(arr(num(0, 4), 1), "Shape of the exhaust chop wave.", "×")
	}),
	boost: meta(obj({
		level,
		whineBaseHz: meta(hz, "Turbo whine pitch at zero boost."),
		whineSweepHz: meta(num(0, 16e3), "How far the whine rises at full boost.", "Hz"),
		whineRpmHz: meta(num(0, 16e3), "Extra whine rise across the rev range.", "Hz"),
		whooshLevel: meta(level, "The broadband hiss under the whine.", "×"),
		whooshHz: meta(hz, "Centre of the whoosh band-pass."),
		whooshSweepHz: meta(num(0, 16e3), "How far the whoosh centre rises with boost.", "Hz")
	}), "Turbo or supercharger. Optional: leave it out for a car without one (the Cruz Missile has none)."),
	squeal: obj({
		level,
		centerMinHz: meta(hz, "Tyre-squeal resonance at the slip threshold."),
		centerMaxHz: meta(hz, "Squeal resonance at full slip."),
		q,
		secondRatio: meta(num(1, 4), "The second resonance sits at this multiple of the first.", "×"),
		wobbleHz: meta(num(.1, 60), "How fast the squeal pitch wobbles.", "Hz"),
		wobbleDepth: meta(unit, "How far the wobble sweeps the resonances."),
		minSpeedMps: meta(speed, "Below this road speed there is no squeal."),
		fullSpeedMps: meta(speed, "Road speed where the squeal is fully on.")
	}),
	surface: obj({
		level,
		fullSpeedMps: meta(num(1, 400), "Road speed where the rumble reaches full level.", "m/s"),
		speedExponent: meta(num(.1, 4), "How aggressively rumble grows with speed (1 is linear).", "exp"),
		tarmac: meta(surfaceRule, "Smooth tarmac: mostly rumble, no crackle."),
		dirt: meta(surfaceRule, "Packed dirt: more crackle, lower cutoff."),
		gravel: meta(surfaceRule, "Loose gravel: the crackliest, darkest rumble.")
	}),
	rattle: obj({
		level,
		baseRateHz: meta(num(.1, 200), "Rattle chop rate at idle (loose parts knocking).", "Hz"),
		rpmRateScale: meta(num(0, 10), "How much the knock rate rises across the revs.", "×"),
		idleShare: meta(unit, "Rattle loudness with no damage (nothing should be left loose)."),
		bandsHz: meta(arr(hz, 1), "Centre frequencies of the metallic knock bands.", "Hz"),
		q,
		pulseHarmonics: meta(arr(num(0, 4), 1), "Shape of the knock chop wave.", "×")
	}),
	pops: obj({
		level,
		armThrottle: meta(unit, "Throttle above which the pop is armed while on the boost."),
		fireThrottle: meta(unit, "Throttle below which an armed pop fires (the lift)."),
		minRpmN: meta(unit, "Fraction of redline below which no pop fires.", "×redline"),
		burstMin: meta(num(1, 64, true), "Fewest cracks in one overrun burst.", "count"),
		burstMax: meta(num(1, 64, true), "Most cracks in one overrun burst.", "count"),
		gapMinS: meta(num(.005, 2), "Shortest gap between cracks in a burst.", "s"),
		gapMaxS: meta(num(.005, 2), "Longest gap between cracks in a burst.", "s"),
		bandHz: meta(hz, "Centre of the crack band-pass."),
		q,
		upshiftShare: meta(unit, "How much of a crack a hard upshift adds.")
	}),
	gearDip: obj({
		depth: meta(unit, "How far the engine ducks in level on a gear change."),
		rampS: meta(num(.001, 1), "Time into the dip.", "s"),
		holdS: meta(num(0, 2), "Time held at the bottom.", "s"),
		recoverTauS: meta(tau, "How quickly the level climbs back out.", "s")
	}),
	ignition: meta(obj({
		crankS: meta(num(.1, 5), "How long the starter turns the engine over before it catches.", "s"),
		crankRpm: meta(num(30, 2e3), "Engine speed on the starter (below idle): sets the compression chug.", "rpm"),
		starterHz: meta(hz, "Starter-motor whine pitch."),
		starterLevel: meta(level, "Starter-motor loudness.", "×"),
		crankShare: meta(unit, "Engine loudness while cranking, as a share of running (the chug under the starter)."),
		catchS: meta(num(.01, 2), "Time from the catch to the top of the rev flare.", "s"),
		flareRpm: meta(num(100, 2e4), "Peak of the rev flare when it catches.", "rpm"),
		settleTauS: meta(tau, "How quickly the flare falls back to idle (settled after three of these).", "s"),
		stopS: meta(num(.2, 6), "Fuel cut to silence: how long the engine spools down.", "s")
	}), "Engine start (crank, catch, settle to idle) and stop (cut, spool down).")
}, ["$schema", "boost"]);
function typeName(v) {
	return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}
function walk(rule, v, path, errors) {
	switch (rule.k) {
		case "num":
			if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${path}: expected a finite number, got ${typeName(v)}`);
			else if (rule.int && !Number.isInteger(v)) errors.push(`${path}: expected an integer, got ${v}`);
			else if (v < rule.min || v > rule.max) errors.push(`${path}: ${v} is outside ${rule.min}..${rule.max}`);
			return;
		case "str":
			if (typeof v !== "string" || v.length === 0) errors.push(`${path}: expected a non-empty string`);
			return;
		case "lit":
			if (v !== rule.v) errors.push(`${path}: expected ${JSON.stringify(rule.v)}, got ${JSON.stringify(v)}`);
			return;
		case "enum":
			if (typeof v !== "string" || !rule.v.includes(v)) errors.push(`${path}: expected one of ${rule.v.join(", ")}, got ${JSON.stringify(v)}`);
			return;
		case "arr":
			if (!Array.isArray(v)) errors.push(`${path}: expected an array, got ${typeName(v)}`);
			else if (v.length < rule.min) errors.push(`${path}: needs at least ${rule.min} item(s)`);
			else v.forEach((item, i) => walk(rule.of, item, `${path}[${i}]`, errors));
			return;
		case "obj": {
			if (typeof v !== "object" || v === null || Array.isArray(v)) {
				errors.push(`${path}: expected an object, got ${typeName(v)}`);
				return;
			}
			const rec = v;
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
function relations(p, errors) {
	const e = p.engine;
	if (!(e.idleRpm < e.redlineRpm)) errors.push("$.engine: idleRpm must be below redlineRpm");
	if (!(e.redlineRpm <= e.limiterRpm)) errors.push("$.engine: redlineRpm must not exceed limiterRpm");
	const g = p.gearbox;
	for (let i = 1; i < g.ratios.length; i++) if (!((g.ratios[i] ?? 0) < (g.ratios[i - 1] ?? 0))) errors.push(`$.gearbox.ratios[${i}]: each gear must be lower than the one before`);
	if (!(g.downshiftRpm < g.upshiftRpm)) errors.push("$.gearbox: downshiftRpm must be below upshiftRpm");
	if (!(g.upshiftRpm <= e.limiterRpm)) errors.push("$.gearbox: upshiftRpm must not exceed limiterRpm");
	if (!(g.downshiftRpm > e.idleRpm)) errors.push("$.gearbox: downshiftRpm must be above idleRpm");
	if (!(g.launchRpm <= e.limiterRpm)) errors.push("$.gearbox: launchRpm must not exceed limiterRpm");
	if (!(p.firing.bodyFilter.minHz <= p.firing.bodyFilter.maxHz)) errors.push("$.firing.bodyFilter: minHz must not exceed maxHz");
	if (!(p.intake.minHz <= p.intake.maxHz)) errors.push("$.intake: minHz must not exceed maxHz");
	if (!(p.exhaust.minHz <= p.exhaust.maxHz)) errors.push("$.exhaust: minHz must not exceed maxHz");
	if (!(p.squeal.centerMinHz <= p.squeal.centerMaxHz)) errors.push("$.squeal: centerMinHz must not exceed centerMaxHz");
	if (!(p.squeal.minSpeedMps < p.squeal.fullSpeedMps)) errors.push("$.squeal: minSpeedMps must be below fullSpeedMps");
	if (!(p.pops.burstMin <= p.pops.burstMax)) errors.push("$.pops: burstMin must not exceed burstMax");
	if (!(p.pops.gapMinS <= p.pops.gapMaxS)) errors.push("$.pops: gapMinS must not exceed gapMaxS");
	if (!(p.pops.fireThrottle < p.pops.armThrottle)) errors.push("$.pops: fireThrottle must be below armThrottle");
	if (!(p.ignition.crankRpm < e.idleRpm)) errors.push("$.ignition: crankRpm must be below idleRpm");
	if (!(p.ignition.flareRpm > e.idleRpm)) errors.push("$.ignition: flareRpm must be above idleRpm");
	if (!(p.ignition.flareRpm <= e.limiterRpm)) errors.push("$.ignition: flareRpm must not exceed limiterRpm");
}
/** Validate unknown data (usually parsed JSON). Never throws. */
function validateProfile(data) {
	const errors = [];
	walk(PROFILE_RULE, data, "$", errors);
	if (errors.length === 0) relations(data, errors);
	return errors.length === 0 ? {
		ok: true,
		errors,
		profile: data
	} : {
		ok: false,
		errors
	};
}
/** Validate and return the typed profile, or throw one error listing every problem. */
function assertProfile(data) {
	const check = validateProfile(data);
	if (!check.ok || !check.profile) throw new Error(`invalid engine profile:\n  ${check.errors.join("\n  ")}`);
	return check.profile;
}
//#endregion
//#region web/shared/audio/engine-synth/voice.ts
var waveCache = /* @__PURE__ */ new WeakMap();
function periodicWave(ctx, phase, harmonics) {
	let cache = waveCache.get(ctx);
	if (!cache) waveCache.set(ctx, cache = /* @__PURE__ */ new Map());
	const key = `${phase}:${harmonics.join(",")}`;
	let w = cache.get(key);
	if (!w) {
		const coeff = new Float32Array(harmonics.length + 1);
		harmonics.forEach((h, i) => coeff[i + 1] = h);
		const zero = new Float32Array(coeff.length);
		w = phase === "sine" ? ctx.createPeriodicWave(zero, coeff) : ctx.createPeriodicWave(coeff, zero);
		cache.set(key, w);
	}
	return w;
}
function kRate(p) {
	try {
		p.automationRate = "k-rate";
	} catch {}
}
/** An AudioParam we drive: changes inside a small dead band schedule nothing, so steady state is free. */
var Driven = class {
	param;
	rel;
	abs;
	last;
	constructor(param, init, rel = .01, abs = 1e-5) {
		this.param = param;
		this.rel = rel;
		this.abs = abs;
		param.value = init;
		this.last = init;
	}
	to(v, now, tau) {
		if (Math.abs(v - this.last) <= this.abs + this.rel * Math.abs(v)) return;
		this.last = v;
		this.param.setTargetAtTime(v, now, tau);
	}
};
/** How long a layer stays connected after its target hits zero (covers the gain's glide to silence). */
var SETTLE_S = .4;
var POP_DECAY_TAU = .03;
/** Pitch-critical params get a tighter dead band (0.2% is about 3.5 cents). */
var PITCH_REL = .002;
/** Crossfade length when a live profile swap rebuilds the graph (P1-A04b). */
var SWAP_S = .03;
/** The starter engages and the engine's chug fades in over this. */
var ENGAGE_S = .06;
/** The starter lets go after the catch over this. */
var STARTER_RELEASE_S = .08;
/** The fuel cut: the engine layers drop to CUT_SHARE over this, then fade to silence by `stopS`. */
var CUT_S = .08;
var CUT_SHARE = .45;
/** Time constants of the post-cut fade per `stopS` (e^-7 is about -61 dB, so the final step to 0 is inaudible). */
var STOP_TAUS = 7;
/** The spool-down ends at this fraction of the crank speed. */
var STOP_END_OF_CRANK = .5;
/** Starter whine: a buzzy motor wave, a deep sag in level and a pitch dip at every compression stroke. */
var STARTER_HARMONICS = [
	1,
	.75,
	.55,
	.4,
	.3,
	.2,
	.14,
	.1
];
var STARTER_CHUG_DEPTH = .7;
var STARTER_SAG_CENTS = 60;
/** The catch fires one cough through the pops layer, at this share of a full crack. */
var CATCH_COUGH = .5;
var cents = (ratio) => 1200 * Math.log2(Math.max(ratio, 1e-6));
function buildGraph(ctx, tail, profileIn, options, fadeInAt) {
	const profile = assertProfile(profileIn);
	const rng = mulberry32(mixSeed(profile.output.noiseSeed, options.seed ?? 0));
	const bank = noiseBank(ctx);
	const nodes = [];
	const sources = [];
	const tau = profile.output.controlTauS;
	const gainNode = (v, k = true) => {
		const g = ctx.createGain();
		nodes.push(g);
		g.gain.value = v;
		if (k) kRate(g.gain);
		return g;
	};
	const filter = (type, hz, q) => {
		const f = ctx.createBiquadFilter();
		nodes.push(f);
		f.type = type;
		f.frequency.value = hz;
		f.Q.value = q;
		kRate(f.frequency);
		kRate(f.Q);
		return f;
	};
	const osc = (w, hz) => {
		const o = ctx.createOscillator();
		nodes.push(o);
		if (w) o.setPeriodicWave(w);
		else o.type = "sine";
		o.frequency.value = hz;
		kRate(o.frequency);
		sources.push(o);
		return o;
	};
	const noise = (buffer) => {
		const s = ctx.createBufferSource();
		nodes.push(s);
		s.buffer = buffer;
		s.loop = true;
		sources.push(s);
		return s;
	};
	const chain = (...n) => {
		for (let i = 0; i < n.length - 1; i++) n[i]?.connect(n[i + 1]);
	};
	const gate = (from, to, on) => {
		const g = {
			from,
			to,
			on: false,
			activeAt: -Infinity
		};
		if (on) wire(g, true, 0);
		return g;
	};
	const wire = (g, connect, now) => {
		if (connect) {
			g.activeAt = now;
			if (g.on) return;
			if (g.to instanceof AudioParam) g.from.connect(g.to);
			else g.from.connect(g.to);
			g.on = true;
		} else if (g.on && now - g.activeAt > SETTLE_S) {
			if (g.to instanceof AudioParam) g.from.disconnect(g.to);
			else g.from.disconnect(g.to);
			g.on = false;
		}
	};
	let st = mergeState(profile, { ...DEFAULT_STATE }, options.initial ?? {});
	const enabled = Object.fromEntries(LAYERS.map((l) => [l, true]));
	let disposed = false;
	const E = 1e-4;
	const ig = profile.ignition;
	const idle = profile.engine.idleRpm;
	let seq = {
		kind: st.ignition ? "start" : "stop",
		at: -Infinity,
		base: idle,
		fromIgn: st.ignition ? 1 : 0,
		fromCents: 0,
		fromStarter: 0
	};
	const startEnds = [
		ig.crankS,
		ig.crankS + ig.catchS,
		ig.crankS + ig.catchS + 3 * ig.settleTauS
	];
	const cutS = Math.min(CUT_S, ig.stopS / 4);
	const stopTau = (ig.stopS - cutS) / STOP_TAUS;
	const phaseAt = (t) => {
		const u = t - seq.at;
		if (seq.kind === "stop") return u < ig.stopS ? "stopping" : "off";
		return u < startEnds[0] ? "cranking" : u < startEnds[1] ? "catching" : u < startEnds[2] ? "settling" : "running";
	};
	/** Detune (cents) on the pitched oscillators, engine-layer gain and starter gain as scheduled, at time t. */
	const envAt = (t) => {
		const u = t - seq.at;
		if (seq.kind === "start") {
			const cCrank = cents(ig.crankRpm / seq.base);
			const cFlare = cents(ig.flareRpm / seq.base);
			const starter = u < ig.crankS ? lerp(seq.fromStarter, ig.starterLevel, clamp01(u / (ENGAGE_S / 2))) : ig.starterLevel * clamp01(1 - (u - ig.crankS) / STARTER_RELEASE_S);
			if (u < startEnds[0]) return {
				cents: cCrank,
				ign: lerp(seq.fromIgn, ig.crankShare, clamp01(u / ENGAGE_S)),
				starter
			};
			if (u < startEnds[1]) {
				const x = (u - startEnds[0]) / ig.catchS;
				return {
					cents: lerp(cCrank, cFlare, x),
					ign: lerp(ig.crankShare, 1, x),
					starter
				};
			}
			return {
				cents: cFlare * Math.exp(-(u - startEnds[1]) / ig.settleTauS),
				ign: 1,
				starter
			};
		}
		const cEnd = cents(ig.crankRpm * STOP_END_OF_CRANK / seq.base);
		const starter = lerp(seq.fromStarter, 0, clamp01(u / .05));
		if (u >= ig.stopS) return {
			cents: cEnd,
			ign: 0,
			starter
		};
		const ign = u < cutS ? lerp(seq.fromIgn, seq.fromIgn * CUT_SHARE, u / cutS) : seq.fromIgn * CUT_SHARE * Math.exp(-(u - cutS) / stopTau);
		return {
			cents: lerp(seq.fromCents, cEnd, u / ig.stopS),
			ign,
			starter
		};
	};
	/**
	* The state the layers follow: the voice's own rpm, throttle and boost while it starts or stops. Road speed is
	* only derived from rpm and gear while the engine runs under its own power; otherwise it is the caller's speed or
	* 0 (a spooling-down or cranking engine is not driving the wheels), so the road layers don't hang on its rpm.
	*/
	const effective = (t) => {
		const ph = phaseAt(t);
		if (ph === "running") return st;
		const speed = st.speed ?? 0;
		if (ph === "off") return {
			...st,
			rpm: 0,
			throttle: 0,
			boost: 0,
			speed
		};
		if (ph === "stopping") return {
			...st,
			rpm: seq.base,
			throttle: 0,
			boost: 0,
			speed
		};
		return {
			...st,
			rpm: Math.max(st.rpm, idle),
			throttle: ph === "cranking" ? 0 : st.throttle,
			boost: 0,
			speed
		};
	};
	const first = computeTargets(profile, effective(ctx.currentTime));
	/** The rpm the pitched oscillators were last aimed at (the base the detune is relative to). */
	let lastBase = effective(ctx.currentTime).rpm;
	const out = gainNode(fadeInAt < 0 ? profile.output.level : 0);
	const dip = gainNode(1);
	const ign = gainNode(envAt(ctx.currentTime).ign);
	const engineBus = gainNode(1);
	chain(engineBus, ign, dip, out);
	out.connect(tail);
	if (fadeInAt >= 0) out.gain.linearRampToValueAtTime(profile.output.level, fadeInAt + SWAP_S);
	const srcWhite = noise(bank.white);
	const srcBrown = noise(bank.brown);
	const srcCrackle = noise(bank.crackle);
	const f = profile.firing;
	const f0 = Math.max(first.firing.f0, 1);
	const oscM = osc(periodicWave(ctx, f.mellow.phase, f.mellow.harmonics), f0);
	const oscB = osc(periodicWave(ctx, f.bright.phase, f.bright.harmonics), f0);
	const gM = gainNode(first.firing.mellowGain);
	const gB = gainNode(first.firing.brightGain);
	const body = filter("lowpass", first.firing.bodyHz, f.bodyFilter.q);
	const lopeAmp = gainNode(1 - first.firing.lopeDepth / 2, false);
	const oscL = osc(null, Math.max(first.firing.lopeHz, .5));
	const lopeDepth = gainNode(first.firing.lopeDepth / 2);
	oscM.connect(gM);
	oscB.connect(gB);
	gM.connect(body);
	chain(body, lopeAmp, engineBus);
	oscL.connect(lopeDepth);
	const brightGate = gate(gB, body, first.firing.brightGain > E);
	const lopeGate = gate(lopeDepth, lopeAmp.gain, first.firing.lopeDepth > .004);
	const exhLP = filter("lowpass", first.exhaust.hz, profile.exhaust.q);
	const exhAM = gainNode(first.exhaust.gain * (1 - first.exhaust.amDepth / 2), false);
	const oscAM = osc(periodicWave(ctx, "cosine", profile.exhaust.pulseHarmonics), Math.max(first.exhaust.amHz, 1));
	const exhDepth = gainNode(first.exhaust.gain * first.exhaust.amDepth / 2);
	chain(srcWhite, exhLP, exhAM, engineBus);
	chain(oscAM, exhDepth);
	exhDepth.connect(exhAM.gain);
	const intakeBP = filter("bandpass", first.intake.hz, profile.intake.q);
	const intakeGain = gainNode(first.intake.gain);
	chain(srcWhite, intakeBP, intakeGain, engineBus);
	const boost = profile.boost ? (() => {
		const boostOut = gainNode(1);
		const oscW = osc(null, first.boost.whineHz);
		const whineGain = gainNode(first.boost.whineGain);
		const whooshBP = filter("bandpass", first.boost.whooshHz, .9);
		const whooshGain = gainNode(first.boost.whooshGain);
		chain(oscW, whineGain, boostOut);
		chain(srcWhite, whooshBP, whooshGain, boostOut);
		return {
			gate: gate(boostOut, engineBus, first.boost.whineGain + first.boost.whooshGain > E),
			whineHz: new Driven(oscW.frequency, oscW.frequency.value, PITCH_REL, .01),
			whineGain: new Driven(whineGain.gain, first.boost.whineGain),
			whooshHz: new Driven(whooshBP.frequency, first.boost.whooshHz),
			whooshGain: new Driven(whooshGain.gain, first.boost.whooshGain)
		};
	})() : null;
	const sq = profile.squeal;
	const squealOut = gainNode(1);
	const sqBP1 = filter("bandpass", first.squeal.hz1, sq.q);
	const sqBP2 = filter("bandpass", first.squeal.hz2, sq.q);
	const sqMix2 = gainNode(.6);
	const sqGainN = gainNode(first.squeal.gain);
	const oscSq = osc(null, sq.wobbleHz);
	const sqD1 = gainNode(first.squeal.hz1 * sq.wobbleDepth);
	const sqD2 = gainNode(first.squeal.hz2 * sq.wobbleDepth);
	chain(srcWhite, sqBP1, sqGainN);
	chain(srcWhite, sqBP2, sqMix2, sqGainN);
	chain(sqGainN, squealOut);
	oscSq.connect(sqD1);
	oscSq.connect(sqD2);
	sqD1.connect(sqBP1.frequency);
	sqD2.connect(sqBP2.frequency);
	const squealGate = gate(squealOut, out, first.squeal.gain > E);
	const surfaceOut = gainNode(1);
	const surfLP = filter("lowpass", first.surface.cutoffHz, first.surface.q);
	const brownG = gainNode(first.surface.brownGain);
	const crackG = gainNode(first.surface.crackleGain);
	chain(srcBrown, brownG, surfLP, surfaceOut);
	chain(srcCrackle, crackG, surfLP);
	const surfaceGate = gate(surfaceOut, out, first.surface.brownGain + first.surface.crackleGain > E);
	const rt = profile.rattle;
	const rattleOut = gainNode(1);
	const rtAM = gainNode(0, false);
	const oscRt = osc(periodicWave(ctx, "cosine", rt.pulseHarmonics), first.rattle.rateHz);
	const rtGain = gainNode(first.rattle.gain);
	for (const hz of rt.bandsHz) chain(srcWhite, filter("bandpass", hz, rt.q), rtAM);
	chain(rtAM, rtGain, rattleOut);
	oscRt.connect(rtAM.gain);
	const rattleGate = gate(rattleOut, out, first.rattle.gain > E);
	const pp = profile.pops;
	const popsOut = gainNode(1);
	const popBP = filter("bandpass", pp.bandHz, pp.q);
	const popGain = gainNode(0, false);
	chain(srcWhite, popBP, popGain);
	chain(srcBrown, popGain);
	chain(popGain, popsOut);
	const popsGate = gate(popsOut, out, false);
	const oscSt = osc(periodicWave(ctx, "sine", STARTER_HARMONICS), ig.starterHz);
	const stAM = gainNode(1 - STARTER_CHUG_DEPTH / 2, false);
	const oscChug = osc(periodicWave(ctx, "cosine", [1, .35]), firingHz(profile.engine.cylinders, ig.crankRpm));
	const chugDepth = gainNode(STARTER_CHUG_DEPTH / 2);
	const chugSag = gainNode(STARTER_SAG_CENTS);
	const stGain = gainNode(0);
	const stMute = gainNode(1);
	chain(oscSt, stAM, stGain, stMute);
	oscChug.connect(chugDepth);
	chugDepth.connect(stAM.gain);
	oscChug.connect(chugSag);
	chugSag.connect(oscSt.detune);
	const starterGate = gate(stMute, out, false);
	const pitchParams = [
		oscM.detune,
		oscB.detune,
		oscL.detune,
		oscAM.detune
	];
	for (const p of pitchParams) {
		kRate(p);
		p.value = envAt(ctx.currentTime).cents;
	}
	for (const s of sources) if (s === srcWhite || s === srcBrown || s === srcCrackle) s.start(0, rng() * bank.seconds);
	else s.start(0);
	const pitch = (p) => new Driven(p, p.value, PITCH_REL, .01);
	const D = {
		f0M: pitch(oscM.frequency),
		f0B: pitch(oscB.frequency),
		lopeHz: pitch(oscL.frequency),
		amHz: pitch(oscAM.frequency),
		gM: new Driven(gM.gain, first.firing.mellowGain),
		gB: new Driven(gB.gain, first.firing.brightGain),
		bodyHz: new Driven(body.frequency, first.firing.bodyHz),
		lopeBase: new Driven(lopeAmp.gain, lopeAmp.gain.value),
		lopeDepth: new Driven(lopeDepth.gain, lopeDepth.gain.value),
		exhHz: new Driven(exhLP.frequency, first.exhaust.hz),
		exhBase: new Driven(exhAM.gain, exhAM.gain.value),
		exhDepth: new Driven(exhDepth.gain, exhDepth.gain.value),
		intakeHz: new Driven(intakeBP.frequency, first.intake.hz),
		intakeGain: new Driven(intakeGain.gain, first.intake.gain),
		stMute: new Driven(stMute.gain, 1),
		sqHz1: new Driven(sqBP1.frequency, first.squeal.hz1),
		sqHz2: new Driven(sqBP2.frequency, first.squeal.hz2),
		sqD1: new Driven(sqD1.gain, sqD1.gain.value),
		sqD2: new Driven(sqD2.gain, sqD2.gain.value),
		sqGain: new Driven(sqGainN.gain, first.squeal.gain),
		brown: new Driven(brownG.gain, first.surface.brownGain),
		crackle: new Driven(crackG.gain, first.surface.crackleGain),
		surfHz: new Driven(surfLP.frequency, first.surface.cutoffHz),
		surfQ: new Driven(surfLP.Q, first.surface.q),
		rtHz: new Driven(oscRt.frequency, first.rattle.rateHz),
		rtGain: new Driven(rtGain.gain, first.rattle.gain)
	};
	const dipCfg = profile.gearDip;
	let dipAt = -Infinity;
	let dipFrom = 0;
	const dipDepthAt = (t) => {
		const u = t - dipAt;
		if (u < 0) return 0;
		if (u < dipCfg.rampS) return lerp(dipFrom, dipCfg.depth, u / dipCfg.rampS);
		const v = u - dipCfg.rampS - dipCfg.holdS;
		return v <= 0 ? dipCfg.depth : dipCfg.depth * Math.exp(-v / dipCfg.recoverTauS);
	};
	let armed = st.throttle >= pp.armThrottle;
	let popUntil = -Infinity;
	const pops = [];
	const startDip = (now) => {
		dipFrom = dipDepthAt(now);
		dipAt = now;
		const p = dip.gain;
		p.cancelScheduledValues(now);
		p.setValueAtTime(1 - dipFrom, now);
		p.linearRampToValueAtTime(1 - dipCfg.depth, now + dipCfg.rampS);
		p.setValueAtTime(1 - dipCfg.depth, now + dipCfg.rampS + dipCfg.holdS);
		p.setTargetAtTime(1, now + dipCfg.rampS + dipCfg.holdS, dipCfg.recoverTauS);
	};
	const schedulePops = (now, count, strength, from = now + .02) => {
		while (pops.length > 0 && now - (pops[0]?.t ?? now) > POP_DECAY_TAU * 8) pops.shift();
		let t = Math.max(from, popUntil - .15);
		for (let i = 0; i < count; i++) {
			if (i > 0) t += lerp(pp.gapMinS, pp.gapMaxS, rng());
			const peak = pp.level * strength * (.45 + .55 * rng());
			popBP.frequency.setValueAtTime(pp.bandHz * (.75 + .5 * rng()), t);
			popGain.gain.setValueAtTime(0, t);
			popGain.gain.linearRampToValueAtTime(peak, t + .003);
			popGain.gain.setTargetAtTime(0, t + .003, POP_DECAY_TAU);
			pops.push({
				t,
				peak
			});
			popUntil = t + POP_DECAY_TAU * 8;
		}
		wire(popsGate, true, now);
	};
	const scheduleStart = (now) => {
		const from = envAt(now);
		seq = {
			kind: "start",
			at: now,
			base: Math.max(st.rpm, idle),
			fromIgn: from.ign,
			fromCents: from.cents,
			fromStarter: from.starter
		};
		const cCrank = cents(ig.crankRpm / seq.base);
		const cFlare = cents(ig.flareRpm / seq.base);
		const tc = now + ig.crankS;
		const tf = tc + ig.catchS;
		for (const p of pitchParams) {
			p.cancelScheduledValues(now);
			p.setValueAtTime(cCrank, now);
			p.setValueAtTime(cCrank, tc);
			p.linearRampToValueAtTime(cFlare, tf);
			p.setTargetAtTime(0, tf, ig.settleTauS);
		}
		const g = ign.gain;
		g.cancelScheduledValues(now);
		g.setValueAtTime(from.ign, now);
		g.linearRampToValueAtTime(ig.crankShare, now + ENGAGE_S);
		g.setValueAtTime(ig.crankShare, tc);
		g.linearRampToValueAtTime(1, tf);
		const sg = stGain.gain;
		sg.cancelScheduledValues(now);
		sg.setValueAtTime(from.starter, now);
		sg.linearRampToValueAtTime(ig.starterLevel, now + ENGAGE_S / 2);
		sg.setValueAtTime(ig.starterLevel, tc);
		sg.linearRampToValueAtTime(0, tc + STARTER_RELEASE_S);
		wire(starterGate, true, now);
		if (enabled.pops) schedulePops(now, 1, CATCH_COUGH, tc);
	};
	const scheduleStop = (now) => {
		const from = envAt(now);
		seq = {
			kind: "stop",
			at: now,
			base: lastBase,
			fromIgn: from.ign,
			fromCents: from.cents,
			fromStarter: from.starter
		};
		const cEnd = cents(ig.crankRpm * STOP_END_OF_CRANK / seq.base);
		for (const p of pitchParams) {
			p.cancelScheduledValues(now);
			p.setValueAtTime(from.cents, now);
			p.linearRampToValueAtTime(cEnd, now + ig.stopS);
		}
		const g = ign.gain;
		g.cancelScheduledValues(now);
		g.setValueAtTime(from.ign, now);
		g.linearRampToValueAtTime(from.ign * CUT_SHARE, now + cutS);
		g.setTargetAtTime(0, now + cutS, stopTau);
		g.setValueAtTime(0, now + ig.stopS);
		const sg = stGain.gain;
		sg.cancelScheduledValues(now);
		sg.setValueAtTime(from.starter, now);
		sg.linearRampToValueAtTime(0, now + .05);
		popGain.gain.cancelScheduledValues(now);
		while (pops.length > 0 && (pops.at(-1)?.t ?? 0) >= now) pops.pop();
		popUntil = Math.min(popUntil, now + POP_DECAY_TAU * 8);
	};
	const apply = (now) => {
		const phase = phaseAt(now);
		const es = effective(now);
		lastBase = es.rpm;
		const t = computeTargets(profile, es);
		const on = (l) => enabled[l] ? 1 : 0;
		const hz = Math.max(t.firing.f0, 1);
		D.f0M.to(hz, now, tau);
		D.f0B.to(hz, now, tau);
		D.lopeHz.to(Math.max(t.firing.lopeHz, .5), now, tau);
		D.amHz.to(hz, now, tau);
		const gMt = t.firing.mellowGain * on("firing");
		const gBt = t.firing.brightGain * on("firing");
		D.gM.to(gMt, now, tau);
		D.gB.to(gBt, now, tau);
		wire(brightGate, gBt > E, now);
		D.bodyHz.to(t.firing.bodyHz, now, tau);
		D.lopeBase.to(1 - t.firing.lopeDepth / 2, now, tau);
		D.lopeDepth.to(t.firing.lopeDepth / 2, now, tau);
		wire(lopeGate, t.firing.lopeDepth * on("firing") > .004, now);
		const exG = t.exhaust.gain * on("exhaust");
		D.exhHz.to(t.exhaust.hz, now, tau);
		D.exhBase.to(exG * (1 - t.exhaust.amDepth / 2), now, tau);
		D.exhDepth.to(exG * t.exhaust.amDepth / 2, now, tau);
		D.intakeHz.to(t.intake.hz, now, tau);
		D.intakeGain.to(t.intake.gain * on("intake"), now, tau);
		if (boost) {
			const whine = t.boost.whineGain * on("boost");
			const whoosh = t.boost.whooshGain * on("boost");
			boost.whineHz.to(t.boost.whineHz, now, tau);
			boost.whineGain.to(whine, now, tau);
			boost.whooshHz.to(t.boost.whooshHz, now, tau);
			boost.whooshGain.to(whoosh, now, tau);
			wire(boost.gate, whine + whoosh > E, now);
		}
		const sqG = t.squeal.gain * on("squeal");
		D.sqHz1.to(t.squeal.hz1, now, tau);
		D.sqHz2.to(t.squeal.hz2, now, tau);
		D.sqD1.to(t.squeal.hz1 * sq.wobbleDepth, now, tau);
		D.sqD2.to(t.squeal.hz2 * sq.wobbleDepth, now, tau);
		D.sqGain.to(sqG, now, tau);
		wire(squealGate, sqG > E, now);
		const sfB = t.surface.brownGain * on("surface");
		const sfC = t.surface.crackleGain * on("surface");
		D.brown.to(sfB, now, tau * 2);
		D.crackle.to(sfC, now, tau * 2);
		D.surfHz.to(t.surface.cutoffHz, now, tau * 2);
		D.surfQ.to(t.surface.q, now, tau * 2);
		wire(surfaceGate, sfB + sfC > E, now);
		const rattle = phase === "stopping" || phase === "off" ? computeTargets(profile, {
			...es,
			rpm: 0
		}).rattle : t.rattle;
		const rtG = rattle.gain * on("rattle");
		D.rtHz.to(rattle.rateHz, now, tau);
		D.rtGain.to(rtG, now, tau);
		wire(rattleGate, rtG > E, now);
		if (phase === "running" || phase === "settling") {
			if (es.throttle >= pp.armThrottle) armed = true;
			if (armed && es.throttle <= pp.fireThrottle && t.rpmN >= pp.minRpmN) {
				armed = false;
				if (enabled.pops) schedulePops(now, pp.burstMin + Math.floor(rng() * (pp.burstMax - pp.burstMin + 1)), .4 + .6 * t.rpmN);
			}
		} else armed = false;
		wire(popsGate, now < popUntil, now);
		D.stMute.to(on("starter"), now, tau);
		wire(starterGate, phase === "cranking" || phase === "catching", now);
	};
	return {
		output: out,
		profile,
		/** Begins the fade that retires this graph behind a replacement (P1-A04b live swaps). */
		fadeOutAt(now) {
			out.gain.cancelScheduledValues(now);
			out.gain.setValueAtTime(out.gain.value, now);
			out.gain.linearRampToValueAtTime(0, now + SWAP_S);
		},
		layerEnabled: (layer) => enabled[layer],
		set(next) {
			if (disposed) return;
			const now = ctx.currentTime;
			const prevGear = st.gear;
			const prevIgnition = st.ignition;
			st = mergeState(profile, st, next);
			if (st.ignition !== prevIgnition) {
				if (st.ignition) scheduleStart(now);
				else scheduleStop(now);
			}
			if (st.gear !== prevGear) {
				startDip(now);
				const rpmN = computeTargets(profile, st).rpmN;
				if (st.gear > prevGear && phaseAt(now) === "running" && rpmN >= pp.minRpmN && st.throttle >= pp.fireThrottle && enabled.pops) schedulePops(now, 1, pp.upshiftShare * (.4 + .6 * rpmN));
			}
			apply(now);
		},
		levels() {
			const now = ctx.currentTime;
			const phase = phaseAt(now);
			const es = effective(now);
			const env = envAt(now);
			const t = computeTargets(profile, es);
			const rattle = phase === "stopping" || phase === "off" ? computeTargets(profile, {
				...es,
				rpm: 0
			}).levels.rattle : t.levels.rattle;
			const keep = (1 - dipDepthAt(now)) * env.ign;
			while (pops.length > 0 && now - (pops[0]?.t ?? now) > POP_DECAY_TAU * 8) pops.shift();
			let popEnv = 0;
			for (const p of pops) if (now >= p.t) popEnv = Math.max(popEnv, p.peak / Math.max(pp.level, 1e-6) * Math.exp(-(now - p.t) / POP_DECAY_TAU));
			popEnv = clamp01(popEnv);
			const l = t.levels;
			const e = (name, v) => enabled[name] ? v : 0;
			return {
				firing: e("firing", l.firing * keep),
				intake: e("intake", l.intake * keep),
				exhaust: e("exhaust", l.exhaust * keep),
				boost: e("boost", l.boost * keep),
				squeal: e("squeal", l.squeal),
				surface: e("surface", l.surface),
				rattle: e("rattle", rattle),
				pops: e("pops", popEnv),
				starter: e("starter", clamp01(env.starter / Math.max(ig.starterLevel, 1e-6)))
			};
		},
		state: () => ({ ...st }),
		ignition() {
			const now = ctx.currentTime;
			const phase = phaseAt(now);
			const ends = {
				cranking: seq.at + startEnds[0],
				catching: seq.at + startEnds[1],
				settling: seq.at + startEnds[2],
				running: Infinity,
				stopping: seq.at + ig.stopS,
				off: Infinity
			};
			return {
				phase,
				rpm: phase === "running" ? st.rpm : phase === "off" ? 0 : lastBase * Math.pow(2, envAt(now).cents / 1200),
				endsAt: ends[phase]
			};
		},
		setLayerEnabled(layer, isOn) {
			if (disposed) return;
			enabled[layer] = isOn;
			apply(ctx.currentTime);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const s of sources) try {
				s.stop();
			} catch {}
			for (const n of nodes) n.disconnect();
		}
	};
}
/**
* Creates a car's engine voice. `output` is one persistent GainNode: a live profile swap
* (`setProfile`, P1-A04b) rebuilds the graph behind it with a ${SWAP_S * 1000} ms equal crossfade,
* carrying the current state and layer enables, so playback never stops (event layers — an
* in-flight gear dip or pop — restart with the new graph).
*/
function create(ctx, profileIn, options = {}) {
	const hub = ctx.createGain();
	hub.gain.value = 1;
	if (options.destination) hub.connect(options.destination);
	let inner = buildGraph(ctx, hub, profileIn, options, -1);
	let disposed = false;
	return {
		get output() {
			return hub;
		},
		get profile() {
			return inner.profile;
		},
		set(state) {
			inner.set(state);
		},
		levels() {
			return inner.levels();
		},
		state() {
			return inner.state();
		},
		ignition() {
			return inner.ignition();
		},
		setLayerEnabled(layer, enabled) {
			inner.setLayerEnabled(layer, enabled);
		},
		setProfile(next) {
			if (disposed) return;
			const now = ctx.currentTime;
			inner.fadeOutAt(now);
			const replacement = buildGraph(ctx, hub, next, {
				...options,
				initial: inner.state()
			}, now);
			for (const l of LAYERS) replacement.setLayerEnabled(l, inner.layerEnabled(l));
			replacement.set(inner.state());
			const old = inner;
			inner = replacement;
			setTimeout(() => old.dispose(), Math.ceil(430.00000000000006) + 100);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			inner.dispose();
			hub.disconnect();
		}
	};
}
//#endregion
//#region web/shared/audio/engine-synth/drivetrain.ts
function createDrivetrain(profile) {
	const g = profile.gearbox;
	const e = profile.engine;
	const top = g.ratios.length;
	let gear = 1;
	let rpm = e.idleRpm;
	let shiftLeft = 0;
	return {
		reset() {
			gear = 1;
			rpm = e.idleRpm;
			shiftLeft = 0;
		},
		step(dt, speedMps, throttle) {
			const th = clamp(throttle, 0, 1);
			if (shiftLeft > 0) shiftLeft = Math.max(0, shiftLeft - dt);
			const wheelRpm = rpmFromSpeed(profile, Math.max(0, speedMps), gear);
			if (shiftLeft === 0) {
				if (wheelRpm >= g.upshiftRpm && gear < top && th > .05) {
					gear += 1;
					shiftLeft = g.shiftTimeS;
				} else if (wheelRpm <= g.downshiftRpm && gear > 1) {
					gear -= 1;
					shiftLeft = g.shiftTimeS;
				}
			}
			const wheelTarget = rpmFromSpeed(profile, Math.max(0, speedMps), gear);
			const slip = lerp(e.idleRpm, g.launchRpm, th);
			const target = shiftLeft > 0 ? Math.max(e.idleRpm, wheelTarget) : Math.max(e.idleRpm, wheelTarget, gear === 1 ? slip : 0);
			const tau = target > rpm ? g.rpmRiseTauS : g.rpmFallTauS;
			rpm += (target - rpm) * (1 - Math.exp(-dt / tau));
			rpm = clamp(rpm, e.idleRpm, e.limiterRpm);
			return {
				rpm,
				gear,
				shifting: shiftLeft > 0
			};
		}
	};
}
//#endregion
export { DEFAULT_STATE, ENGINE_PHASES, LAYERS, PROFILE_RULE, SURFACES, assertProfile, computeTargets, create, create as createEngineVoice, createDrivetrain, firingHz, mergeState, mixSeed, mulberry32, noiseBank, rpmFromSpeed, speedFromRpm, validateProfile };
