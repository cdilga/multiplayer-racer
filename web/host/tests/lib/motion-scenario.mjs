// The scripted drive for the motion-sound probe and the owner's listen-through clip (br-0uqj): one car on the page's audio
// surface, fed as JJS1 car records (pose, velocity, flags) through the director's snapshot path on a virtual 120 Hz clock.
// Self-contained on purpose: Playwright serialises it into the page. `realtime` paces the feed against the wall clock (the
// recording needs sound to play out); otherwise it runs as fast as the page goes. Returns what happened, per phase, with
// the motion layers' levels sampled every few records (a buffer, never the console).
export async function motionScenario({ realtime }) {
  const a = window.__jjAudio;
  const HZ = 120;
  const STEP = 2; // sim ticks per record
  const G = 9.81;
  const DRIFT = 32;
  const BOOST = 16;
  const BASE_MS = 1_000_000; // virtual clock origin, clear of other tests' spacing state
  let tick = 1000;
  let z = 0;
  const car = { speed: 20, yaw: 0, y: 0, vy: 0, flags: 0, surface: 0, throttle: 1 };
  const samples = [];
  const marks = [];
  const wall0 = performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function step() {
    const dt = STEP / HZ;
    z += car.speed * dt;
    tick += STEP;
    const h = car.yaw / 2;
    a.feedCars(
      tick,
      [
        {
          id: 0,
          life: 0,
          pos: [0, car.y, z],
          rot: [0, Math.sin(h), 0, Math.cos(h)],
          vel: [0, car.vy, car.speed],
          flags: car.flags | (car.surface << 6),
          boost: 0,
          throttle: car.throttle,
        },
      ],
      BASE_MS + (tick * 1000) / HZ,
    );
    if (realtime) {
      const due = ((tick - 1000) * 1000) / HZ;
      const ahead = due - (performance.now() - wall0);
      if (ahead > 4) await sleep(ahead);
    }
  }

  let n = 0;
  async function seg(name, secs, fn = () => {}) {
    marks.push({ name, startS: +(((tick - 1000) / HZ)).toFixed(3) });
    const steps = Math.round((secs * HZ) / STEP);
    for (let i = 0; i < steps; i++) {
      fn(i / Math.max(1, steps - 1), i * (STEP / HZ));
      await step();
      if (++n % 6 === 0) samples.push({ t: +((tick - 1000) / HZ).toFixed(3), phase: name, car: { ...car, y: +car.y.toFixed(2) }, levels: a.motion()[0] });
    }
  }
  // A ballistic hop of launch speed vy0: the lip (ground samples), then freefall until the car is back at y = 0.
  async function jump(name, vy0) {
    marks.push({ name, startS: +(((tick - 1000) / HZ)).toFixed(3) });
    car.vy = 0;
    await step();
    await step();
    let u = 0;
    for (;;) {
      u += STEP / HZ;
      const y = vy0 * u - 0.5 * G * u * u;
      if (y <= 0 && u > 0.05) break;
      car.y = y;
      car.vy = vy0 - G * u;
      await step();
      if (++n % 3 === 0) samples.push({ t: +((tick - 1000) / HZ).toFixed(3), phase: name, car: { ...car, y: +car.y.toFixed(2) }, levels: a.motion()[0] });
    }
    car.y = 0;
    car.vy = 0; // the ground stops the fall: the landing
    await step();
    marks[marks.length - 1].airS = +u.toFixed(2);
  }

  a.clear();
  const logStart = a.log().length;
  if (realtime) a.startRecording();
  await seg('cruise-tarmac', 1.0, () => {
    car.speed = 20;
  });
  await seg('slide-light', 0.9, (p) => {
    car.flags = DRIFT;
    car.yaw = 0.25 * Math.min(1, p * 2.5);
  });
  await seg('slide-deep', 1.2, (p) => {
    car.yaw = 0.25 + 0.3 * Math.min(1, p * 3);
  });
  await seg('straighten', 0.25, (p) => {
    car.flags = 0; // the slide is let go: the held time is what the exit boost scales by
    car.yaw = 0.55 * (1 - p);
  });
  await seg('exit-boost', 1.4, (p, s) => {
    car.yaw = 0;
    car.flags = s > 0.1 ? BOOST : 0;
    car.speed = 20 + 10 * Math.min(1, p * 2);
  });
  await seg('cruise', 0.9, () => {
    car.flags = 0;
    car.speed = 24;
  });
  await seg('scrub-no-drift-flag', 0.7, (p) => {
    car.yaw = 0.4 * Math.sin(p * Math.PI);
  });
  await seg('cruise-2', 0.6, () => {
    car.yaw = 0;
  });
  await seg('plain-boost', 0.8, () => {
    car.flags = BOOST;
  });
  car.flags = 0;
  car.speed = 28;
  await seg('tarmac-fast', 0.6);
  car.surface = 2;
  await seg('gravel', 0.9);
  car.surface = 1;
  await seg('dirt', 0.9);
  car.surface = 3;
  await seg('off-track', 0.9);
  car.surface = 0;
  await seg('tarmac-back', 0.7);
  await seg('tarmac-slow', 0.8, () => {
    car.speed = 9;
  });
  car.speed = 24;
  await seg('run-up', 0.5);
  await jump('jump-big', 9);
  await seg('after-big', 0.8);
  await jump('jump-medium', 5);
  await seg('after-medium', 0.8);
  await jump('hop-short', 1.2);
  await seg('after-hop', 0.8);
  let recording = null;
  if (realtime) {
    await sleep(500);
    recording = await a.stopRecording();
  }
  const log = a.log().slice(logStart);
  return { samples, marks, log, recording, totalS: +((tick - 1000) / HZ).toFixed(2) };
}
