# P1-W01 (br-p1-w01-qhs): the item system, visual self-review

W01 is the sim, the cards and the wire (its three children, br-p1-w01-qhs.1/.2/.3, closed on CI); what a player sees of it
is the inventory and the item events that W05 draws. These are W05's captures (`docs/evidence/P1-W05/`), looked at again
for what W01 carries.

## Looked at

- `P1-W05/phone-item-844x390.png`: the phone's item chip reads BOOMERANG +1 with its gesture (FLICK up THROW, down BACK):
  the front item from W01's `HostCmd::Inventory`, with the count. It sits in the header beside the connection chip, clear
  of the Ready/Identify buttons and the sticks.
- `P1-W05/phone-item-390x844.png`: the same chip in portrait, readable, not clipped.
- `P1-W05/picked-up.png`, `race-stations.png`, `boomerang-in-flight.png`: the TV through a pickup and a throw (W04/W02's
  drawing of W01's item events).

## Defects found and fixed

- None in W01's part (the chip's look was W05's work).

## Remaining defects

- The TV shows no queue for a car (by design: the queue is the player's, on the phone).

## Not covered

- Full-screen and resize of the phone chip are W05's matrix; the second (back) slot isn't shown in these captures.
