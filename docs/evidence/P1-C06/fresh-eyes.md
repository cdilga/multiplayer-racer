## Reviewer

Fresh-eyes Sonnet reviewer, not the builder. Date 2026-10-07. Images were opened and judged before the builder's self-review.md was read.

## Looked at

- `phone-tutorial-step1.png` (844x390 landscape): red outer frame, "#1 SKIP" in the strip, a row of tool buttons (Ready, Identify, Camera, Recover, Help, Leave), saffron rule, and a cream card in the middle: "STEP 1 OF 7", "STEER", "Push the left stick right, then left.", chips Right and Left, seven dots (first blue), "Skip tutorial" button top right. The card covers most of both stick zones; only the DRIVE ring edge and ACTION ring edge show at the sides, with "DRI..." and "...TION" labels cut off.
- `phone-tutorial-oi.png`: "STEP 5 OF 7", "OI!", "Flick the right stick up: your headlights flash and everyone hears it.", one chip "OI!", dots: four green, one blue, two beige. The chip is not ticked.
- `phone-tutorial-done.png`: "YOU'RE READY", "That's every control. Tap Ready when you are.", a wide saffron "Let's race" button. No progress dots.
- Accepted references: `art/ui/accepted/2026-10-07/frames/phone-controller.webp` (a mock showing "#7 Dusty 3rd Lap 2/3", Find my car, DRIVE and ACTION sticks with direction labels Accelerate/Steer/Brake, Front/Drift/Boost/Rear, BOOST meter in the middle) and the POC frame `docs/evidence/P1-U03/frames/tutorial_step=2.jpg` (card with saffron "STEP 2 OF 6" tag, ticked goal chips, green/blue dots, boost and cone pod visible above the card).

## Verdict

FAIL against the bead's promise, PASS as a start. The bead promises prompts for seven controls (steer, brake/reverse, boost, drift, OI!, cone, wheelie) shown on the seat's tile and the controller, skippable and repeatable, never pausing anyone. The evidence is three phone stills, from the tutorial's steps 1, 5 and the end card. No capture shows brake/reverse, boost, drift, cone or wheelie steps, a ticked goal, "Nice!" feedback, skip, or repeat from Help, or anything on the TV tile. The card is legible and large, but it hides the sticks and the boost/cone pod; the Ready button in the strip is still dark on dark (a defect the self-review says is fixed); the player-name strip reads "#1 SKIP", which looks like a stuck label. Against the accepted mock it lacks the position/lap read-out, the saffron step tag, the pod with boost and cone, and ticked chips.

## Defects

1. `phone-tutorial-step1.png`, tools row, first button: "Ready" is dark navy text on a dark navy slab, near invisible; the self-review says this was fixed. It was not (or the capture predates the fix).
2. All three images, centre: the card covers most of both stick zones and the DRIVE/ACTION labels are cut to "DRI" and "TION"; the player's thumbs would be under a paper card, and the POC mock shows this too, but the builder's own review says players may hesitate.
3. `phone-tutorial-oi.png`: the "OI!" goal chip is un-ticked and looks like a button, though the self-review says goals are "ticking as the gesture lands". The dots show four done, but no frame demonstrates a goal clearing.
4. Missing captures: brake/reverse, boost, drift, cone, wheelie steps; the "Nice!" strip; Skip; Help repeat; the TV tile prompt; and any in-race or lobby warm-up context. Only 3 of the 7+ states are evidenced.
5. All images, top strip: "#1 SKIP" is ambiguous (is "Skip" the player's name or a button?), and the boost meter, cone/front slot pod, lap/position are absent compared with the accepted phone mock.
6. `phone-tutorial-step1.png`: goal chips ("Right", "Left") are small beige-on-cream pills with low contrast, around 15px text on a phone; at arm's length in a moving car this is gaze-heavy, against master §4.3.
7. `phone-tutorial-oi.png`: the OI! instruction says "flick the right stick up", while the accepted phone mock labels the ACTION stick's up as "Front" (an item slot); a possible conflict that should be checked against the controls ruling.
8. `phone-tutorial-done.png`: the text says "Tap Ready when you are" but the Ready button is the unreadable one at the top.
9. Frame colour: the whole frame is red as the player colour, while the accepted mock is teal; fine if colour is per player, but the numerals "#1" red on navy have weak contrast.

## Disagreements with the self-review

- "Ready ... now sets that (saffron; green once ready)": the capture still shows a dark Ready button.
- "goals ticking as the gesture lands": no ticked chip appears in any image.
- It describes `phone-tutorial-oi.png` as "a later step mid-way", but never names which step; it is step 5 of 7, which is the OI! step, and this does not prove the cone and wheelie steps exist.
- It accepts the card covering the sticks as "the POC does the same"; the POC's cards leave the boost/cone pod visible, and here the pod is missing entirely.
- It lists portrait, WebKit and real phones as not covered, which I accept, but omits that most of the sequence and the skip/repeat/TV-tile behaviours are not in the evidence either.
