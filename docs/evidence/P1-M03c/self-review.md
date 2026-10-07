# Self-review P1-M03c

## Looked at
- `road-edge-10m-vs-2.5m.png` (diagonal straight, 40 m crop, seed chosen by `writes_the_evidence_images`): left, the
  old 10 m grid's painted road; right, the new 2.5 m grid's; the true road edge is the red line. Checked the staircase.
- `overview-greybox-seed1.png`, `overview-town-seed1.png`, `overview-outbackbitumen-seed1.png`, `overview-outbackdirt-seed1.png`, `overview-rocks-seed1.png` (one pixel per cell, hill-shaded): the road is a
  clean closed loop, the ground is gently modelled, rocks is visibly more relief than town and bitumen, no cliffs or
  holes at the road, no pale halo around the road.

## Defects found and fixed
- Edge saw-tooth on diagonals was 7 m on the 10 m grid: grid spacing is now 2.5 m (stair-step <= 1.8 m).
- Hairpin interiors and close road passes had height cliffs under a nearest-point blend: replaced by an inverse-distance
  blend of route bed planes. The M02 40 m road-to-noise blend is now 20-24 m, per biome.

## Remaining defects
- The 2.5 m crop still shows cell-sized steps (smaller, not gone). Only the renderer drawing the road as a ribbon along
  the route removes them; that is host work (web/), outside this bead's paths. Needs a bead if the owner wants it gone.

## Not covered
- No in-game host capture (the bead's anti-narrowing clause asks for the felt outcome in the running game): the host
  render and a recorded drive are web/ and jj-sim work, outside this helper's paths. The overview images are top-down
  height shading, not the game's render.
