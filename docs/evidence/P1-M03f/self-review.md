# Self-review P1-M03f

## Looked at
- `two-biome-lap.png`: a Greybox -> OutbackDirt -> Greybox lap, top-down. Tarmac dark grey, packed dirt brown, the two
  40 m transition zones magenta on the straight; yellow chevron posts and red guard rail on the outside of every corner;
  green gantry legs at the finish line (across the top straight); blue/orange scatter pieces, sparse on the tarmac
  stretches and a dense even field around the dirt one. Checked: the surface changes inside the zones, the scatter
  changes character across them, nothing sits on the road, the corner furniture is on the outside of each turn.
- `transitions.txt`, `wayfinding.txt`: the numbers behind the tests.

## Defects found and fixed
- A boundary straight check that passed on the float centerline failed on the rounded map (a corner starting at the
  window's last point); select now widens its window by a point.
- Features whose envelope reached into a transition zone: placement now needs the whole envelope inside the biome's range.
- Scatter and nnCv tests were fooled by the 4 m rail sections; they now measure the scatter's own pieces.

## Remaining defects
- The chevrons, rail and gantry are stand-ins (plain boxes and posts): P1-R10 builds the real pieces and the look.
- 45 % of seeds can't fit a four-biome lap (no straight for a boundary); that is P1-M03g's fallback to solve.

## Not covered
- Top-down plot only: no host render of the transition, the chevron rows or the gantry (web/ is outside this bead), and
  no phone/TV matrix.
