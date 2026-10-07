# Self-review P1-M03 (procgen core, epic roll-up)

Written by the verifier (BrownCreek) when closing the epic. The epic builds no screen of its own: what a person sees from it is the
generated track, so this looks at the four-biome track frames its children captured (headless Chromium, software GL, real host page;
captures are the children's, in `docs/evidence/P1-M04` and `docs/evidence/P1-M08b`) and defers to each child's own self-review for its biome.

## Looked at
- `../P1-M08b/lap-1-town-tv-1080p.jpg`: despite its name, this frame is the end of the first town stretch: the road runs between tall banded
  red towers, a stone-walled ramp ahead, "BIG RED ROCK" sign and a steep-descent diamond. Reads as red rock country; road clear against the ground.
- `../P1-M08b/lap-2-rocks-tv-1080p.jpg`: graded dirt road bending through spinifex and desert oaks, creek-dip sign, rail on the far bend, tarmac far ahead.
- `../P1-M08b/lap-4-bitumen-tv-1080p.jpg`: sealed road with yellow centre dashes, a shopfront each side, water tower, kangaroo sign: the lap back into town.
- `../P1-M04/street-tv-1080p.jpg`: the town hero frame: one tan shopfront, a mailbox, a side-street pad and a water tower; sparse next to
  `art/references/australia/generated/biome-town.png` (no signage, poles or bins in this frame).
- `../P1-M08b/plot-playtest-four-biomes.png`, `seed-bank.txt`, `bot-playtest.txt`: 100 seeds, every one town, rocks, dirt, bitumen, town; no softlock flagged.

## Defects found and fixed
- Checked each frame against its child's description: the M08b file names do not match their contents in two cases (the frame called
  `lap-1-town` shows the rocks exit; `lap-4-bitumen` shows the town); the child's self-review describes them correctly, so the names stand.

## Remaining defects
- The town biome reads thin at TV distance (P1-M04 stays open for its fresh-eyes pass against the reference).
- Biome dressing is far simpler than the reference sheets (smooth towers, flat road ribbons); the look pass (P1-R10) owns it.

## Not covered
- Phones, full-screen toggle, resize, WebKit; a GPU capture; a second independent fresh-eyes pass over the fixed town frame.
