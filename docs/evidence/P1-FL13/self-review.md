# P1-FL13 (br-bbki.14): the Buttons controller layout

`web/tests/journeys/fl13-buttons.test.mjs`, Playwright Chromium and WebKit on eris (at the lap fix), 6/6 twice:

- A real phone and host: switch to Buttons, remap Boost and Gas in Settings, every button is its one-stick intent at the
  host (Gas throttle only, steer with Gas held, Boost while Gas held, Brake never throttle, Fire and Drop one OI! and
  one cone each), then a lap of the greybox on the steer stick and Gas (61-67 s).
- Steer + Gas + Boost held at once by three pointers all register, Chromium and WebKit.
- A stored layout reads back sound (clashes and junk dropped).
- The look in every state at 375x667, 412x915, 667x375 and 915x412, both engines (the captures here).

The lap had been skipped since a6d77e13 ("wedges on a rail"). The cause was the harness, not the pad: CDP's touch
emulation never sends a `pointerup` for one finger lifted while others stay down, so a lifted Gas or Brake stayed held on
the pad (both held reads as neither: the car stalled; Gas stuck: it ran away at 35 m/s). The lap now drives the pad with
per-pointer events on its own elements, as the multi-touch test does; the intents above it stay on real CDP touches. A
real phone's lifted finger gets its own `pointerup`.

## Looked at

- `chromium-915x412-held-steer-gas-boost.png`: landscape, the steer stick pushed right, Boost (blue) and Gas (amber) lit
  as held, Brake, Fire and Drop idle; the strip (#12, 3rd, Lap 2/3, Identify and the icon row) clear of the pad.
- `webkit-412x915-idle.png`: portrait, the steer column down the left with the stick at its foot, the six buttons at the
  bottom right, each over 48 px; a large empty middle.
- `chromium-915x412-settings-arrange.png`: Controls set to Buttons, Steer stick Left/Right, "Your buttons" with the free
  slot "+" and the rest of the arrangement, beside Identify / Test these controls / Reset / Sit out / Leave / Back.
- `webkit-375x667-tutorial.png`: the tutorial's step 1 (Steer) in portrait on the smallest phone.

## Defects found and fixed

- The lap's lifted fingers (above): the harness, fixed; the skip is lifted.

## Remaining defects

- On the smallest portrait phone (375x667) the tutorial card covers most of the pad and part of the steer zone it asks
  you to use, and its Controls / Identify / Skip tutorial buttons wrap onto two rows.
- In portrait the buttons are smallish and the middle of the screen is empty; the pad could grow into it.
- The Settings sheet's bottom fade sits over the arranger's last row (br-0lua).

## Not covered

- Physical phones; Safari (WebKit here is Playwright's).
