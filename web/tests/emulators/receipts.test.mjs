// P1-F08: the committed emulator receipts must show what the beads cite them for (C02, C03, G03, A03/A07), labelled
// "Android emulator" / "iOS Simulator" with the machine, and two runs must agree. The lane itself runs by hand or on eris
// (`node scripts/emulators/drive.mjs android`, `node scripts/emulators/ios-local.mjs`); this only checks the receipts.
//   node --test web/tests/emulators/
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = join(fileURLToPath(import.meta.url), '../../../../docs/evidence/P1-F08');
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

for (const n of [1, 2]) {
  test(`Android emulator drive run ${n}: C02, C03, G03`, { skip: !existsSync(join(dir, `drive-android-run${n}.json`)) }, () => {
    const r = load(`drive-android-run${n}.json`);
    assert.equal(r.label, 'Android emulator');
    assert.ok(r.machine.host && r.target.browser && r.target.android);
    assert.equal(r.error, null);
    assert.equal(r.page.secureContext, true);
    assert.ok(r.c02.pass, 'two fingers drive both sticks, no zoom or scroll');
    assert.ok(r.c03.pass && r.c03.backMs <= 3000, 'same seat back within 3 s');
    assert.ok(r.g03.autopilotSeen && r.g03.autopilotReleased, 'autopilot took the car and the phone took it back');
  });
  test(`iOS Simulator (no host) run ${n}: touch engine, visibility, clips`, { skip: !existsSync(join(dir, `ios-local-run${n}.json`)) }, () => {
    const r = load(`ios-local-run${n}.json`);
    assert.equal(r.label, 'iOS Simulator');
    assert.ok(r.machine.host && r.target.browser && r.target.runtime);
    assert.equal(r.error, undefined);
    assert.ok(r.twoFinger.pass && r.twoFinger.fixtureNotController === true);
    assert.deepEqual(r.visibility.events.filter((e) => e !== 'pagehide'), ['hidden', 'visible-after-hidden']);
    assert.ok(r.clips.pass && r.clips.total > 0 && r.clips.failed === 0, 'every shipped clip decodes');
  });
}

test('Android emulator: two runs agree', { skip: !existsSync(join(dir, 'drive-android-run2.json')) }, () => {
  const s = (r) => [r.c02.pass, r.c03.pass, r.c03.sameSeat, r.g03.autopilotSeen, r.g03.autopilotReleased, r.page.secureContext];
  assert.deepEqual(s(load('drive-android-run1.json')), s(load('drive-android-run2.json')));
});
