# Self-review P1-M03e

## Looked at
- `scatter-town-cluster-seed1.png`: seed 1 Town, route dark grey, buildings orange, posts blue. Distinct groups of
  buildings with large empty ground between them; nothing touches the road.
- `scatter-rocks-cluster-seed1.png`: seed 1 Rocks, big placeholder domes. Groups are visible but sparse (18 m setback and
  30-40 m footprints leave few pieces).
- `scatter-dirt-poisson-seed1.png`: seed 1 Dirt, ~750 posts evenly spread with a clear verge along the road.
- `scatter-bitumen-poisson-seed1.png`: seed 1 Bitumen at 18 m, sparse even posts and the odd shed.
- `distribution.txt`, `bitumen-radius.txt`: the numbers behind them.

## Defects found and fixed
- Town first came out as pairs of buildings, not clumps (the 40 m setback band cut the clusters): the band is now 3-150 m
  and the parent/children/spread were retuned; Clark-Evans R 0.66, 85 % of 30 m squares empty.
- A 1 mm disagreement between the scatter's ground height and a later re-grounding broke undulation's idempotence test:
  the scatter now reads the ground at the rounded pose.

## Remaining defects
- Rocks has only ~20 pieces a map: the placeholder pieces are huge. M06 owns the real rocks.
- Town's posts/buildings are generic boxes; the look is the biome beads'.

## Not covered
- Top-down plots only: no host render of a scattered map (web/ is outside this bead), no phone/TV matrix.
