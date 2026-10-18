# P1-FL11 (br-bbki.11): the carnage bowl, a derby lab scene with bots that hunt

**What was built.**

- **Derby hunting autopilot** (`crates/jj-sim/src/autopilot/mod.rs`, `Autopilot::hunt`): in a derby a bot picks the
  nearest rival ahead that isn't spawn-protected, keeps it 2 s, leads it by up to 1.2 s and rams flat out; an aim past
  the floor's edge is pulled back inside the bowl. With nobody to hunt it circles the floor.
- **Bots on the grid** (`UiCommand::SetBots { n }`, ABI 11, `bots:N`): any number of autopiloted cars join each round
  after the seats; they count toward the bowl's size and are in the world and the derby ledger, not the results.
  The room view carries `bots`; the TV names them "#2 Bot" onwards.
- **Feel Lab**: a "bots" field with Set bots, and picking the **carnage-bowl** scene sets Derby and 12 bots.
  `maps/lab/carnage-bowl.json` is the generator's 13-car bowl (seed 11), and a lab scene now wins over the generated
  bowl in a derby.
- **jj fixture** `scenarios/derby/carnage-bowl.json`: 13 cars on the autopilot for the round.
- Overview camera: `spreadOfArena` 0.9 → 1.02, so a full 13-car bowl stays in the Overview instead of tripping the
  spread chip.

**Checks.**

- jj-procgen `arena` tests (RCH): `derby_bots_hunt_each_other_round_the_bowl` (13 cars score, 42 takedowns, 86% of
  car-seconds moving, none out of the bowl) and `the_carnage_bowl_lab_scene_is_the_generators_output`. 11 pass, 1
  ignored diagnostic.
- `jj sim scenarios/derby/carnage-bowl.json`: passes its envelope (car 0 scores 217 derby points, every car stays under
  28.8 m from the centre) and the replay matches bit for bit.
- jj-wasm-host 58/58, including `bots_join_a_derby_round_on_the_autopilot_and_score`; jj-protocol goldens re-blessed
  (`abi/main-ui-10.bin`); clippy clean on jj-protocol, jj-wasm-host, jj-sim, jj-procgen; web typecheck clean.
- Journey `r11-overview` 6/6 on eris (Chromium, GPU) with the new spread threshold.
- Live on eris (Chromium, GPU, real jj-server): host with `?tune`, Feel Lab → carnage-bowl → Load scene, one phone
  joins as Davo and readies, the round runs as a derby with 12 bots, 13 cars.

## Looked at

- `tv-carnage-overview-1920x1080.jpg`: the Overview of the bowl at 2:53 left. All 13 cars are in frame on the floor
  with plates "#1 Davo" and "#2 Bot" to "#13 Bot", dust trails behind them, and the band reads "Derby · 2:53 left 1st #1
  Davo 53 pts". No spread chip.
- `tv-carnage-overview-later-1920x1080.jpg`: the same view later; the bots have closed on each other and the pack is
  ramming in the middle of the floor.
- `tv-carnage-chase-1920x1080.jpg`: Camera: Grid, Davo's chase tile at 2:43 left with 367.1 pts. Three bots (#2, #5,
  #9) are piled into Davo's car; smoke rises from two damaged cars, a hit burst and sparks, loose parts on the floor and
  the caption "That's a bonzer way to lose a wheel!".

## Defects found and fixed

- **Bots were unnamed**: their plates read "#2" with no name; they're named "Bot" now.
- **Spread chip on a full bowl**: 13 cars across the floor tripped the "spread out" chip; the threshold is 1.02 of the
  whole-arena frame now, and r11-overview still passes.
- **The generated bowl replaced the lab scene** in a derby; the lab scene now wins.

## Remaining defects

- The white bot's plate ("#10 Bot") is white on white and hard to read in the Overview; the seat palette's white needs
  a dark label.
- The Grid with one human seat is a single chase tile; the bots have no tiles (they're not seats).
- Bots all drive the Cruz Missile.

## Not covered

- Phones: the phone shows the usual derby HUD; bots have no phone.
- WebKit, and a real TV.
