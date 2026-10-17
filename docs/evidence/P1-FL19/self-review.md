# br-bbki.22 (P1-FL19): carnage pays in real races, called out on the TV and the attacker's phone

The sim credited takedowns since 9f63affe (a ram that wrecks or spins another car fills the attacker's boost;
`crates/jj-sim/tests/takedown.rs`), but nothing showed it. Now jj-sim notes a race `Event::Takedown`; the host worker turns
it into `SimEvent::Takedown` (ABI 6), which pops **TAKEDOWN! BOOST** over the attacker on the TV (the launch/landing
callout device), and `HostCmd::Takedown` (cmd 5) to the attacker's phone, which shows the same words on its round banner.

## Tests

- `crates/jj-sim/tests/takedown.rs` (rch): rear-quarter and T-bone rams spin the victim and a ram that breaks a weak
  wheel wrecks it, each filling the attacker's meter; a door rub and a 16 m/s bump pay nothing; replays bit for bit.
- `crates/jj-protocol` and `crates/jj-wasm-host` (rch): every variant has a golden (HostCmd::Takedown, SimEvent::Takedown),
  goldens re-blessed for the version bumps.
- `web/tests/journeys/fl19-takedown.test.mjs` (Playwright Chromium on eris, df77c887): a real phone (Davo) and a synthetic
  seat (Shazza) race on the greybox loop; set up as the T-bone fixture, the ram spins Shazza; the host gets
  `Takedown {attacker 0, victim 1, seat 1, wreck false}`, the TV's callout log shows Takedown over Davo's car, and Davo's
  phone banner reads `TAKEDOWN! BOOST`. The 22 m/s rear-quarter ram swung the victim only 73 degrees in the browser on
  the greybox (under the spin bar), so the journey uses the T-bone.

## Looked at

- `tv-takedown.png` (1920x1080): Davo's tile, a big red TAKEDOWN! BOOST over his car, its door hanging off from the hit;
  Shazza's tile shows the same callout over Davo's car at its edge (every tile that sees the car shows it). The callout
  sits above the car, clear of the place and lap chips.
- `phone-takedown.png` (915x412): the round banner TAKEDOWN! BOOST in red between the two sticks, over neither, under the
  status row.

## Defects found and fixed

- The first captures came after the callouts had expired; the journey now captures the TV the moment the takedown lands
  and waits for the phone banner's words.

## Remaining defects

- None seen.

## Not covered

- A wreck takedown in the browser (the T-bone spins; the wreck case is in the jj-sim fixture). WebKit. Physical phones.
