# P1-W01 (br-p1-w01-qhs): the item system, visual self-review

W01 is the sim, the cards and the wire (its three children, br-p1-w01-qhs.1/.2/.3, closed on CI); what a player sees of it
is the inventory and the item events that W05 draws. These are W05's captures (`docs/evidence/P1-W05/`), looked at again
for what W01 carries.

## Looked at

- `phone-item-844x390.png`: the phone's item chip reads BOOMERANG +1 with its gesture (FLICK up THROW, down BACK):
  the front item from W01's `HostCmd::Inventory`, with the count. It sits in the header beside the connection chip, clear
  of the Ready/Identify buttons and the sticks.
- `phone-item-390x844.png`: the same chip in portrait (here behind the Turn Sideways card in the Lobby): readable but small.
- `race-stations.png`: two delivery-box pickups on the road either side of the car, clear on the TV.
- `picked-up.png`: the road after the pickup, the box gone.
- `boomerang-in-flight.png`: the boomerang is only a small mark ahead of the car at this distance (W02's look).

## Defects found and fixed

- None in W01's part (the chip's look was W05's work).

## Remaining defects

- A boomerang in flight is hard to see from the chase at range (W02's drawing, not W01).
- The TV shows no queue for a car (by design: the queue is the player's, on the phone).

## Not covered

- Full-screen and resize of the phone chip are W05's matrix; the second (back) slot isn't shown in these captures.
