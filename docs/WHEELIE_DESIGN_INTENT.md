# Wheelie & Boost Design Intent

## The Mechanic
Joystick Jammers uses a dynamic "weight shift" physics model. Under high acceleration (boost or top-tier engines), the rearward torque should lift the front wheels off the ground—creating a **wheelie**.

## The Tradeoff: Speed vs. Control
- **In a Wheelie:** The car gains maximum forward acceleration but loses most steering capability (as the front wheels are no longer contacting the surface).
- **Steering Loss:** Steering input should be significantly dampened (70-90% reduction) when front wheels are airborne.
- **Strategic Use:** Players must decide when to "floor it" for straight-line speed (risking a wheelie and losing the racing line) and when to feather the throttle to keep wheels down for technical cornering.

## The Payoff: Airtime & Landings
- **Stunt State:** Maintaining a wheelie for a threshold duration (e.g., 1.5s) enters a "Stunt State."
- **Landing Boost:** Landing all four wheels cleanly after a wheelie or big jump grants a temporary "Landing Boost."
- **Recovery:** If the car flips or crashes during a wheelie, the penalty is severe (stalling or high damage).

## Observability
- **UI:** The phone controller should subtly vibrate or change color when the car enters a wheelie state.
- **Visuals:** Host camera should have a slight "tilt up" or FOV punch during high-torque starts.
- **Audio:** Engine synth should shift to a higher, more strained pitch during a wheelie.

## Verification & Playtest Expectations
To verify the wheelie and boost polishing pass:

1. **Automated Tests:**
   - Run `npx playwright test tests/e2e/car-movement.spec.ts`.
   - Add new test cases for "Wheelie Detection" (checking if front wheels are airborne during max torque).
   - Add test cases for "Steering Dampening" (verifying turn rate is reduced in wheelie state).

2. **Manual Playtest:**
   - Host a game with `?dev=1`.
   - Join as a player and find a straightaway.
   - Floor the accelerator and verify the front of the car lifts.
   - Attempt to steer during the lift and verify the car mostly continues straight.
   - Release throttle, land, and verify the "Landing Boost" triggers (visual/audio feedback).

3. **Performance:**
   - Open F3 stats overlay.
   - Verify that adding wheelie/boost logic does not cause FPS drops on the host under 16-player load.

