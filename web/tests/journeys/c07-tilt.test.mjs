// P1-C07.2 tilt steering: the maths and the sensor lifecycle (pure node, no browser):
//   node --test web/tests/journeys/c07-tilt.test.mjs
// Clockwise turn of the phone = steer right, on Android and iOS sign conventions and in all four screen orientations;
// dead zone, sensitivity and neutral are settable; tilt replaces only the DRIVE steer axis (R60: no accelerometer boost).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEADZONES, SENSITIVITIES, Tilt, applyTilt, rollDeg, steerFrom, toScreen, wrap } from '../../controller/src/app/tilt.ts';
import { DEFAULTS, sanitise } from '../../controller/src/app/prefs-data.ts';

const G = 9.8;
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
/** A clockwise turn of `deg` seen by the player, as Android reads it in screen axes (reaction to gravity). */
const screenReading = (deg) => [-Math.sin((deg * Math.PI) / 180) * G, Math.cos((deg * Math.PI) / 180) * G];
/** The same reading in device axes for a screen orientation angle (inverse of toScreen). */
const deviceReading = ([sx, sy], angle) => ({ 0: [sx, sy], 90: [sy, -sx], 180: [-sx, -sy], 270: [-sy, sx] })[angle];

test('a clockwise turn reads positive in every orientation and on both platforms', () => {
  for (const angle of [0, 90, 180, 270]) {
    for (const deg of [-60, -30, 0, 15, 30, 80]) {
      const [gx, gy] = deviceReading(screenReading(deg), angle);
      assert.deepEqual(toScreen(gx, gy, angle).map((v) => +v.toFixed(6)), screenReading(deg).map((v) => +v.toFixed(6)), `toScreen at ${angle}`);
      near(rollDeg(gx, gy, angle, 1), deg); // Android: the reading is the reaction to gravity
      near(rollDeg(-gx, -gy, angle, -1), deg); // iOS reports the opposite sign
    }
  }
});

test('dead zone, sensitivity and neutral shape the steer; it is monotonic and clamped', () => {
  const s = { deadzoneDeg: DEADZONES.medium, fullLockDeg: SENSITIVITIES.normal };
  assert.equal(steerFrom(0, 0, s), 0);
  assert.equal(steerFrom(4.9, 0, s), 0, 'inside the dead zone');
  assert.ok(steerFrom(6, 0, s) > 0 && steerFrom(6, 0, s) < 0.1);
  near(steerFrom(30, 0, s), 1);
  assert.equal(steerFrom(70, 0, s), 1, 'full lock clamps');
  assert.equal(steerFrom(-70, 0, s), -1);
  let last = -2;
  for (let d = -90; d <= 90; d += 3) {
    const v = steerFrom(d, 0, s);
    assert.ok(v >= last, `monotonic at ${d}`);
    last = v;
  }
  // Neutral: the pose held at calibration reads straight, whatever the angle was.
  assert.equal(steerFrom(25, 25, s), 0);
  near(steerFrom(55, 25, s), 1);
  // Sharper locks sooner; a larger dead zone waits longer.
  assert.ok(steerFrom(15, 0, { deadzoneDeg: 5, fullLockDeg: SENSITIVITIES.sharp }) > steerFrom(15, 0, { deadzoneDeg: 5, fullLockDeg: SENSITIVITIES.gentle }));
  assert.equal(steerFrom(8, 0, { deadzoneDeg: DEADZONES.large, fullLockDeg: 30 }), 0);
  // The angle wraps: -179 and 179 are 2 degrees apart, not 358.
  near(wrap(179 - -179), -2);
  near(steerFrom(-179, 179, { deadzoneDeg: 0, fullLockDeg: 4 }), 0.5);
});

test('tilt replaces only the DRIVE steer axis: throttle, brake and the whole ACTION stick are untouched (R60)', () => {
  const drive = { x: 0.1, y: -0.8, touch: true };
  const action = { x: 0.9, y: 0.4, touch: true };
  const [d, a] = applyTilt(drive, action, -0.6);
  assert.deepEqual(d, { x: -0.6, y: -0.8, touch: true });
  assert.equal(a, action, 'the action stick is the same object, unread and unwritten');
  const [d2, a2] = applyTilt(drive, action, null);
  assert.equal(d2, drive);
  assert.equal(a2, action);
});

test('it is off by default, persists as a setting, and bad stored values fall back', () => {
  assert.equal(DEFAULTS.tilt, false);
  assert.equal(sanitise({}).tilt, false);
  assert.equal(sanitise({ v: 1, tilt: true, tiltSensitivity: 'sharp', tiltDeadzone: 'large', tiltNeutral: 12.5 }).tilt, true);
  const s = sanitise({ v: 1, tilt: 'on', tiltSensitivity: 'wild', tiltDeadzone: 9, tiltNeutral: 999 });
  assert.deepEqual([s.tilt, s.tiltSensitivity, s.tiltDeadzone, s.tiltNeutral], [false, 'normal', 'medium', 0]);
});

/** A fake window with a controllable DeviceMotionEvent and screen orientation. */
function fakeWindow({ permission, hasApi = true, angle = 90 } = {}) {
  const handlers = new Set();
  return {
    screen: { orientation: { angle } },
    DeviceMotionEvent: hasApi ? (permission === undefined ? {} : { requestPermission: async () => permission }) : undefined,
    addEventListener: (t, f) => t === 'devicemotion' && handlers.add(f),
    removeEventListener: (t, f) => t === 'devicemotion' && handlers.delete(f),
    motion: (gx, gy) => handlers.forEach((f) => f({ accelerationIncludingGravity: { x: gx, y: gy } })),
    listeners: () => handlers.size,
  };
}

test('the sensor: permission inside the tap, live readings, calibration, and honest failure states', async () => {
  const set = { deadzoneDeg: 5, fullLockDeg: 30 };
  // Granted (iOS-style prompt): live after the first reading; neutral set from the held pose.
  const w = fakeWindow({ permission: 'granted', angle: 90 });
  const t = new Tilt(set, w);
  let changes = 0;
  t.onChange = () => (changes += 1);
  assert.equal(t.state, 'off');
  assert.equal(t.steer, null, 'off means no steer value at all');
  assert.equal(await t.enable(), 'waiting');
  assert.equal(t.steer, null, 'no reading yet');
  w.motion(...deviceReading(screenReading(10), 90));
  assert.equal(t.state, 'live');
  assert.ok(changes >= 1);
  near(t.calibrate(), 10);
  w.motion(...deviceReading(screenReading(40), 90));
  near(t.steer, 1);
  w.motion(...deviceReading(screenReading(-20), 90));
  near(t.steer, -1);
  t.disable();
  assert.equal(w.listeners(), 0);
  assert.equal(t.steer, null);
  // Denied.
  assert.equal(await new Tilt(set, fakeWindow({ permission: 'denied' })).enable(), 'denied');
  // No API at all.
  assert.equal(await new Tilt(set, fakeWindow({ hasApi: false })).enable(), 'no-sensor');
  // The API but no sensor: it times out into no-sensor and stops listening.
  const quiet = fakeWindow({});
  const q = new Tilt(set, quiet);
  assert.equal(await q.enable(), 'waiting');
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(q.state, 'no-sensor');
  assert.equal(quiet.listeners(), 0);
  assert.equal(q.calibrate(), null, 'nothing to calibrate against');
});
