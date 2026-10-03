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
	"pops"
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
	gear: 0
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
	const boostAct = Math.pow(s.boost, 1.4) * run;
	const speedSqueal = smoothstep(p.squeal.minSpeedMps, p.squeal.fullSpeedMps, speed);
	const squealAct = Math.pow(s.drift, 1.3) * speedSqueal;
	const surf = p.surface[s.surface];
	const surfaceAct = Math.pow(speedN, p.surface.speedExponent) * surf.level;
	const rattleShare = p.rattle.idleShare + (1 - p.rattle.idleShare) * Math.max(rpmN, .7 * speedN);
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
			pops: 0
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
		boost: {
			whineHz: p.boost.whineBaseHz + p.boost.whineSweepHz * s.boost + p.boost.whineRpmHz * rpmN,
			whineGain: p.boost.level * boostAct * (.35 + .65 * rpmN),
			whooshGain: p.boost.level * p.boost.whooshLevel * Math.pow(s.boost, 1.2),
			whooshHz: p.boost.whooshHz + p.boost.whooshSweepHz * s.boost
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
var unit = num(0, 1);
var level = num(0, 4);
var hz = num(1, 16e3);
var q = num(1e-4, 100);
var tau = num(.001, 5);
var speed = num(0, 400);
var wave = obj({
	phase: oneOf("sine", "cosine"),
	harmonics: arr(num(0, 4), 1)
});
var surfaceRule = obj({
	brown: unit,
	crackle: unit,
	cutoffHz: hz,
	q,
	level: unit
});
/** The contract. Keep `profile.schema.json` in step (check.mjs compares the two). */
var PROFILE_RULE = obj({
	$schema: str,
	format: lit("jj-engine-profile"),
	version: lit(1),
	id: str,
	name: str,
	description: str,
	engine: obj({
		cylinders: num(1, 32, true),
		idleRpm: num(100, 2e4),
		redlineRpm: num(100, 2e4),
		limiterRpm: num(100, 2e4)
	}),
	gearbox: obj({
		ratios: arr(num(.1, 20), 1),
		finalDrive: num(.1, 20),
		wheelRadiusM: num(.05, 2),
		upshiftRpm: num(100, 2e4),
		downshiftRpm: num(100, 2e4),
		shiftTimeS: num(0, 3),
		launchRpm: num(100, 2e4),
		rpmRiseTauS: tau,
		rpmFallTauS: tau
	}),
	output: obj({
		level,
		controlTauS: tau,
		noiseSeed: num(0, 4294967295, true)
	}),
	firing: obj({
		level,
		offThrottleLevel: unit,
		mellow: wave,
		bright: wave,
		brightMax: unit,
		bodyFilter: obj({
			minHz: hz,
			maxHz: hz,
			q,
			throttleOpen: unit
		}),
		lope: obj({
			depth: unit,
			fadeOutRpmN: num(.01, 1)
		})
	}),
	intake: obj({
		level,
		minHz: hz,
		maxHz: hz,
		q
	}),
	exhaust: obj({
		level,
		minHz: hz,
		maxHz: hz,
		q,
		pulseDepth: unit,
		pulseHarmonics: arr(num(0, 4), 1)
	}),
	boost: obj({
		level,
		whineBaseHz: hz,
		whineSweepHz: num(0, 16e3),
		whineRpmHz: num(0, 16e3),
		whooshLevel: level,
		whooshHz: hz,
		whooshSweepHz: num(0, 16e3)
	}),
	squeal: obj({
		level,
		centerMinHz: hz,
		centerMaxHz: hz,
		q,
		secondRatio: num(1, 4),
		wobbleHz: num(.1, 60),
		wobbleDepth: unit,
		minSpeedMps: speed,
		fullSpeedMps: speed
	}),
	surface: obj({
		level,
		fullSpeedMps: num(1, 400),
		speedExponent: num(.1, 4),
		tarmac: surfaceRule,
		dirt: surfaceRule,
		gravel: surfaceRule
	}),
	rattle: obj({
		level,
		baseRateHz: num(.1, 200),
		rpmRateScale: num(0, 10),
		idleShare: unit,
		bandsHz: arr(hz, 1),
		q,
		pulseHarmonics: arr(num(0, 4), 1)
	}),
	pops: obj({
		level,
		armThrottle: unit,
		fireThrottle: unit,
		minRpmN: unit,
		burstMin: num(1, 64, true),
		burstMax: num(1, 64, true),
		gapMinS: num(.005, 2),
		gapMaxS: num(.005, 2),
		bandHz: hz,
		q,
		upshiftShare: unit
	}),
	gearDip: obj({
		depth: unit,
		rampS: num(.001, 1),
		holdS: num(0, 2),
		recoverTauS: tau
	})
}, ["$schema"]);
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
function create(ctx, profileIn, options = {}) {
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
	const first = computeTargets(profile, st);
	const E = 1e-4;
	const out = gainNode(profile.output.level);
	const dip = gainNode(1);
	const engineBus = gainNode(1);
	chain(engineBus, dip, out);
	if (options.destination) out.connect(options.destination);
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
	const boostOut = gainNode(1);
	const oscW = osc(null, first.boost.whineHz);
	const whineGain = gainNode(first.boost.whineGain);
	const whooshBP = filter("bandpass", first.boost.whooshHz, .9);
	const whooshGain = gainNode(first.boost.whooshGain);
	chain(oscW, whineGain, boostOut);
	chain(srcWhite, whooshBP, whooshGain, boostOut);
	const boostGate = gate(boostOut, engineBus, first.boost.whineGain + first.boost.whooshGain > E);
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
		whineHz: pitch(oscW.frequency),
		whineGain: new Driven(whineGain.gain, first.boost.whineGain),
		whooshHz: new Driven(whooshBP.frequency, first.boost.whooshHz),
		whooshGain: new Driven(whooshGain.gain, first.boost.whooshGain),
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
	const schedulePops = (now, count, strength) => {
		while (pops.length > 0 && now - (pops[0]?.t ?? now) > POP_DECAY_TAU * 8) pops.shift();
		let t = Math.max(now + .02, popUntil - .15);
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
	const apply = (now) => {
		const t = computeTargets(profile, st);
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
		const whine = t.boost.whineGain * on("boost");
		const whoosh = t.boost.whooshGain * on("boost");
		D.whineHz.to(t.boost.whineHz, now, tau);
		D.whineGain.to(whine, now, tau);
		D.whooshHz.to(t.boost.whooshHz, now, tau);
		D.whooshGain.to(whoosh, now, tau);
		wire(boostGate, whine + whoosh > E, now);
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
		const rtG = t.rattle.gain * on("rattle");
		D.rtHz.to(t.rattle.rateHz, now, tau);
		D.rtGain.to(rtG, now, tau);
		wire(rattleGate, rtG > E, now);
		if (st.throttle >= pp.armThrottle) armed = true;
		if (armed && st.throttle <= pp.fireThrottle && t.rpmN >= pp.minRpmN) {
			armed = false;
			if (enabled.pops) schedulePops(now, pp.burstMin + Math.floor(rng() * (pp.burstMax - pp.burstMin + 1)), .4 + .6 * t.rpmN);
		}
		wire(popsGate, now < popUntil, now);
	};
	return {
		output: out,
		profile,
		set(next) {
			if (disposed) return;
			const now = ctx.currentTime;
			const prevGear = st.gear;
			st = mergeState(profile, st, next);
			if (st.gear !== prevGear) {
				startDip(now);
				const rpmN = computeTargets(profile, st).rpmN;
				if (st.gear > prevGear && rpmN >= pp.minRpmN && st.throttle >= pp.fireThrottle && enabled.pops) schedulePops(now, 1, pp.upshiftShare * (.4 + .6 * rpmN));
			}
			apply(now);
		},
		levels() {
			const t = computeTargets(profile, st);
			const now = ctx.currentTime;
			const keep = 1 - dipDepthAt(now);
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
				rattle: e("rattle", l.rattle),
				pops: e("pops", popEnv)
			};
		},
		state: () => ({ ...st }),
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
export { DEFAULT_STATE, LAYERS, PROFILE_RULE, SURFACES, assertProfile, computeTargets, create, create as createEngineVoice, createDrivetrain, firingHz, mergeState, mixSeed, mulberry32, noiseBank, rpmFromSpeed, speedFromRpm, validateProfile };
