# br-lks5 (P1-C-tutorial-375): the tutorial card on a portrait phone

On a 375x667 portrait phone the tutorial card sat in the controls area and covered most of the Buttons pad and the
sticks' homes it asks you to use, and its Controls / Identify / Skip buttons wrapped. In portrait the card now sits at
the top of the screen, over the strip and toolbar, with tighter type, and its step tag takes its own line so the buttons
share one row (`web/controller/src/app/controller.css`). Landscape is unchanged.

`web/tests/journeys/c06-coach-portrait.test.mjs` (Playwright Chromium and WebKit on eris, 01b5f581, 2/2): with the
tutorial open at 375x667 and 412x915, on the two-stick and the Buttons layouts, the card overlaps no stick base and no
pad button, and its buttons share one row. The C06 tutorial journeys (`c06-tutorial.test.mjs`, 5/5) still pass.

## Looked at

- `webkit-coach-buttons-375x667.png`: the smallest portrait phone in Buttons: the whole card at the top (step tag, the
  three buttons on one row, Steer, the Right/Left goals, the step dots); the steer stick's home and all six pad buttons
  are clear below it.
- `chromium-coach-dual-375x667.png`: the same phone on two sticks: both stick homes clear below the card.
- `chromium-coach-dual-412x915.png`: a taller phone: the card at the top over the toolbar, the Drive and Steer zones
  clear.
- `phone-tutorial-step1.png`: landscape (the C06 journey's capture), unchanged: the card over the middle of the sticks.

## Defects found and fixed

- First try capped the card at 46 % of the controls area: it still reached the top of the stick bases and clipped its own
  goals. The controls area alone is too short on a 375x667 phone, so the card moved to the top of the screen.

## Remaining defects

- In portrait the card covers the toolbar, including Ready, while the Lobby banner below still says "Tap Ready when you
  are". The tutorial ends with its own "Let's race", and Skip is one tap, but a player could look for Ready mid-tutorial.

## Not covered

- Physical phones; Safari (WebKit here is Playwright's); the "one stick (old)" layout.
