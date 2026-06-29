# Controller Input Research - Keyboard, Phone Touch, and Nipple-Style Sticks

> Date: 2026-06-28
> Scope: evaluate the current Local/Remote input plan, the wheelie/handling plan, and the current controller implementation. The goal is a clean, simple control model for cars driven by keyboard or touchscreen phones.

## Highest-impact findings

1. **The current phone controller has no throttle feathering, but the wheelie design depends on feathering.**
   `player.js` sends phone acceleration as binary `0` or `1` (`static/js/player.js:1397-1418`), while wheelie activation starts at `acceleration > 0.7` (`static/js/systems/PhysicsSystem.js:895-896`, `static/assets/vehicles/default.json:64-68`). This means every normal phone accelerator press is also a wheelie-intent press. If players report "it will not turn", they may be correctly feeling the `0.15` wheelie steering authority, not misusing the stick.

2. **The custom joystick is already nipple-style, but it is linear and unshaped.**
   It is a floating joystick centered where the touch starts, tracks one touch id, clamps travel, and keeps tracking outside the original region (`static/js/Joystick.js:120-211`). It does not apply a dead zone, input curve, activation threshold, or output filtering before `setSteering(x)` (`static/js/player.js:1330-1336`, `static/js/player.js:1502-1504`).

3. **Keyboard and touch currently do not share one input mapper.**
   The real phone page has direct touch handlers plus duplicate keyboard handlers (`static/js/player.js:1363-1394`, `static/js/player.js:1825-1855`). `InputManager`/`TouchController` define a more general model, but they are not wired into the active player entry point (`src/player/main.js` loads `Joystick.js` and `player.js`, not the input modules). This makes Remote keyboard support look planned but not first-class.

4. **Host physics already applies speed-sensitive steering and smoothing.**
   Steering lock is reduced by speed and then smoothed before being sent to Rapier (`static/js/systems/PhysicsSystem.js:857-890`). That is good, but it means touch shaping and physics shaping stack. If the car feels sluggish, changing only joystick size will not fix it.

5. **Testing is biased toward keyboard, not touch.**
   E2E helpers explicitly use keyboard because touch simulation is complex (`tests/e2e/fixtures.ts:135-153`). There is no automated coverage for joystick dead zones, curves, touch cancellation, multitouch pedals, or "phone sent the expected shaped value".

## Research cues

- NippleJS-style virtual sticks are useful here because a dynamic/floating stick adapts to hand size and can be used without aiming at a small fixed target. The tradeoff is discoverability and unintended drift when players look at the TV rather than the phone.
- Empirical work on smartphone-as-controller designs found that fully touch-sensitive controls can reduce visual demand, but they are vulnerable to drifting and unintended operations. For Joystick Jammers, that argues for large blind zones, haptics, a small dead zone, and clear state feedback rather than a tiny precise widget.
- Analog stick best-practice writeups consistently separate three concerns: dead zone, output scaling, and response curve. Treating these as one "sensitivity" slider makes tuning harder.
- Web input should use explicit `touch-action`/default-behavior control. The current CSS and joystick do this reasonably (`static/css/player.css:124-138`, `static/js/Joystick.js:106-117`), but Pointer Events with pointer capture would simplify touch/mouse/desktop parity if this is refactored.

Sources are listed at the end.

## Current plan evaluation

### Local mode: phone as controller, host renders

This is the right product shape. In Local mode, the player is watching the shared host screen, not the phone. Therefore the phone controller must be **blind-operable**:

- The current left-half steering and right-half pedals are directionally correct.
- Floating joystick is a good default because the player can put their thumb down anywhere in the left zone.
- The phone HUD must be light, not a renderer, matching the project architecture.

The main gap is not layout, it is **control semantics**. The left thumb has analog steering, but the right thumb has binary throttle/brake. That is simple, but it conflicts with mechanics that expect partial throttle.

### Remote mode: keyboard and touch

`docs/plans/game-modes-and-flows.md:151-160` correctly calls out keyboard for desktop Remote drivers and touch for phones. The important follow-through is that keyboard must not remain a testing fallback. It should feed the same canonical mapper as touch:

- Desktop keyboard should ramp digital steering into analog steering, not snap instantly from `0` to `1`.
- Touch should use the same output contract after dead zone and curve.
- The host should not care whether input came from keyboard, touch, gamepad, or future real controllers.

Remote can tolerate more on-screen hints because the driver is looking at the same device they control. Local cannot. So the same mapper should drive both modes, but the UI affordances should differ.

### Wheelie and boost plan

`docs/WHEELIE_DESIGN_INTENT.md` says wheelies trade speed for steering and that players should feather throttle. The physics implementation honors the steering loss, but the active phone controller does not give players a way to feather. That is the largest design mismatch.

The safest near-term fix is not an analog accelerator UI. Keep the simple pedal UI, but add a **throttle ramp** and make wheelie activation require a more intentional condition:

- `throttleTarget = buttonHeld ? 1 : 0`
- `throttle` rises over roughly `180-250ms`, falls over `60-100ms`
- wheelie activation requires shaped throttle near full, sustained for roughly `250-350ms`, or a separate boost/stunt intent

This preserves "hold up to go" while giving players a controllable window before the car enters low-steering wheelie behavior.

## Current implementation diagnosis

### What is working

- The joystick is dynamic/floating, tracks touch identifiers, and continues to process the tracked touch after movement (`static/js/Joystick.js:135-211`).
- The control surface is simple: left half steering, right half accelerate/brake, optional centered fire button (`static/css/player.css:112-205`, `static/css/player.css:523-533`).
- Control packets are clamped server-side before being forwarded to the host (`server/app.py:411-426`).
- Host physics already has speed-sensitive steering reduction and a wheelie steering authority model (`static/js/systems/PhysicsSystem.js:857-890`).

### What is likely causing difficulty

- **No dead zone:** tiny touch movement immediately becomes steering. In a TV-focused Local setting, thumb settle jitter is likely.
- **No response curve:** a small thumb movement produces proportional wheel angle. That can feel twitchy near center and still not give enough authority after host speed reduction.
- **Binary throttle:** ordinary driving and intentional wheelie intent are currently indistinguishable from phone input.
- **Duplicate keyboard paths:** keyboard behavior is direct, binary, and implemented twice in `player.js`.
- **No input-state explanation:** wheelie/boost feedback exists on the phone HUD, but the controller does not clearly say "your steering is reduced because the front wheels are up."
- **No touch regression tests:** difficulty may regress silently because the automated path mostly drives with keyboard.

## Recommended control model

Create one canonical mapper that all input sources use before sending to the server:

```js
{
  source: 'touch' | 'keyboard' | 'gamepad',
  steeringRaw: -1..1,
  steering: -1..1,
  throttleRaw: 0..1,
  throttle: 0..1,
  braking: 0..1,
  firePressed: boolean
}
```

Only `steering`, `throttle`/`acceleration`, `braking`, and fire need to be authoritative. `*Raw` fields can stay debug-only unless useful for telemetry.

### Touch steering defaults

Keep the current floating left-half joystick, but add these shaping options:

- `deadZone`: `0.08-0.12`
- `outerDeadZone`: `0.95-1.00`
- `curve`: start around exponent `1.35-1.6`, or a linear/cubic blend around `40-60%` cubic
- `snapToZero`: below `0.03` after shaping
- `filter`: very light, target `40-70ms` time constant at most

The output should be easy to hold near zero, easy to make medium steering corrections, and still able to reach full lock.

Example shaping:

```js
function shapeAxis(raw, deadZone = 0.1, exponent = 1.45) {
  const sign = Math.sign(raw);
  const mag = Math.abs(raw);
  if (mag <= deadZone) return 0;
  const scaled = Math.min(1, (mag - deadZone) / (1 - deadZone));
  return sign * Math.pow(scaled, exponent);
}
```

### Keyboard steering defaults

Keyboard should not send instant `-1/0/1` into the same car tuning used by analog touch. Use a digital-to-analog ramp:

- key press ramp to full: `100-140ms`
- release ramp to zero: `70-100ms`
- opposite keys together: neutral
- optional tap assist: quick tap produces a small pulse, not full sustained lock

This makes keyboard playable in Remote without needing a separate vehicle tune.

### Throttle and wheelie defaults

Keep simple `up` pedal semantics, but add throttle shaping:

- phone/keyboard accelerator button controls `throttleTarget`
- shaped throttle rises over `180-250ms`
- shaped throttle falls over `60-100ms`
- wheelie activation requires `throttle > 0.9` for `250-350ms`, or `boostActive`, rather than any immediate binary press crossing `0.7`

This keeps onboarding simple and lets skilled players avoid accidental wheelies by pulsing throttle.

### Brake/reverse

The existing delayed reverse model is reasonable. The controller should make the state visible:

- brake while moving: "Brake"
- brake while stopped and held past reverse delay: "Reverse"
- brief haptic tick when reverse engages

### Progressive steering and side-tilt recovery

Add this as a sixth workstream. The current physics already has speed-sensitive steering and wheelie steering reduction, but the player-facing feel can still read as binary: steering works, then suddenly does not. A better model is progressive steering authority based on speed, wheel contact, roll angle, wall contact, and stunt state.

The surrounding definition should cover the whole handling neighborhood, not only "wheelie":

- **Grounded:** normal tire steering, still reduced by speed so high-speed inputs do not spin out instantly.
- **Front-light:** front wheels have partial contact or low load; steering should soften before the car fully wheelies.
- **Wheelie / rear-only:** front tires cannot carve normally; allow weak yaw/body influence so players can shape the stunt, not take a racing line.
- **Airborne:** no tire steering; optional air-control torque must be subtle and more stunt-like than precise.
- **Side-tilted / two-wheel:** if the car is on two wheels or partly on its side, steering/throttle/brake can apply a small readable yaw/roll/righting influence so the player has recovery agency.
- **Wall contact / side-load:** steering should bias toward sliding or peeling away from the wall, not rail-locking into it.
- **Bad landing / recovery:** keep the penalty readable, but ramp authority back in rather than snapping from useless to full control.

Side-tilt recovery is worth exploring in the same pass because it uses the same authority model. Keep it weaker than grounded steering so the wheelie tradeoff still matters, and make it config/F2-tunable so playtesting can decide how arcade-forgiving it should be.

### Haptics and feedback

Use short haptic cues, not constant vibration:

- steering reduced by wheelie: one short tick on entering wheelie
- landing boost: stronger short pulse
- bad landing/stun: double pulse
- reconnect/input stalled: subtle repeating pattern until recovered

The phone should also reflect reduced steering authority visually by tinting or narrowing the steering arc while `handlingState === 'wheelie'`.

## NippleJS vs custom joystick

Do **not** add the NippleJS dependency only to solve this. The custom `Joystick` already covers the core mode needed here: dynamic/floating, horizontal lock, multitouch id tracking, and clamped output.

Borrow the NippleJS concepts instead:

- dynamic mode: already present
- `lockX`: already present as `mode: 'horizontal'`
- threshold/dead zone: add
- response curve: add
- pointer capture/cancel handling: add if moving to Pointer Events
- visible resting affordance: add for first-run discoverability

Use NippleJS only if the team wants its manager/event model and maintenance burden is acceptable. The current implementation is small enough that shaping it directly is cleaner.

## Implementation sequence

1. **Add a `ControlMapper` module.**
   It should accept raw touch/keyboard/gamepad state and output canonical shaped controls. Use it from `player.js` first; decide later whether to retire or wire `InputManager`.

2. **Add joystick shaping options.**
   Add `deadZone`, `curve`, `snapToZero`, and optional `threshold` to `Joystick`. Keep defaults close to current behavior but tune phone steering through explicit config.

3. **Route keyboard through the same mapper.**
   Remove duplicate keyboard logic from `player.js` once the mapper is live. Include WASD and Space per the Remote plan.

4. **Make wheelie compatible with binary pedals.**
   Add throttle ramping and a sustained-full-throttle requirement before wheelie lift pulses. This is likely the biggest immediate feel improvement.

5. **Add progressive steering and side-tilt recovery.**
   Replace abrupt authority cliffs with tunable curves where useful, and give tilted cars limited recovery input.

6. **Add controller-state feedback.**
   Show when steering authority is reduced, when reverse engages, when input is disconnected, and when the last input reached the host.

7. **Add focused tests.**
   Unit-test axis shaping and keyboard ramping. Add one Playwright touch test using mobile context and synthetic touch/pointer interaction to confirm the shaped steering value changes as expected.

## Suggested playtest script

Run each test with 2-4 players in Local mode and at least one Remote keyboard driver once Remote mode lands:

- Straight launch: hold accelerator. Confirm the car accelerates predictably and wheelie does not instantly steal steering.
- Slalom: weave through 4 cones or track markers. Confirm small steering corrections are possible.
- Hairpin: approach at speed, brake, turn, accelerate. Confirm the player can feel when steering comes back.
- Wall recovery: hit wall at shallow angle and recover. Confirm steering plus brake/reverse is understandable.
- Derby chase: drive while firing. Confirm fire does not cause accidental steering or throttle release.
- Reconnect: lock phone or background tab while accelerating. Confirm controls release and the phone clearly reconnects.

## Open tuning questions

- Should wheelie be an automatic consequence of full throttle, or should boost/stunt be an explicit intent? Automatic is more playful; explicit is more controllable.
- Should advanced players get a sensitivity slider? Accessibility guidance supports remapping/reconfiguration, but the first fix should be sane defaults and a debug tune panel rather than exposing sliders immediately.
- Should Local phones show a static ghost joystick at rest? It improves discoverability but adds visual clutter on a device players should not need to watch.

## Sources

- NippleJS documentation: https://yoannmoi.net/nipplejs/
- MDN, `touch-action`: https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- MDN, Touch Events: https://developer.mozilla.org/en-US/docs/Web/API/Touch_events
- Hypersect, "Interpreting Analog Sticks": https://blog.hypersect.com/interpreting-analog-sticks/
- Minimuino, "Understanding thumbstick deadzones": https://minimuino.github.io/thumbstick-deadzones/
- Baldauf, Froehlich, Endl, "Investigating On-Screen Gamepad Designs for Smartphone-Controlled Video Games": https://www.matthiasbaldauf.com/publications/Baldauf15a.pdf
- Microsoft Xbox Accessibility Guidelines, input guidance: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107
