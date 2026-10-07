## Reviewer

Fresh-eyes Sonnet reviewer, not the builder. Date 2026-10-07. Images were opened and judged before the builder's self-review.md was read.

## Looked at

- `domes-tv-1080p.jpg`: pale graded-dirt road with cream edge lines winding between large banded red-brown towers (one huge in the centre-left, four cones in the middle distance, one cut by the right edge). Spinifex tufts and green flowering shrubs on red earth, rail and posts on the far bend, a dark shadow patch at left, tiny purple pad far down the road. Reads as a red-rock canyon road at TV distance; the towers are the clear subject.
- `domes-tiles-1080p.jpg`: four tiles. Upper tiles show the same towers; lower tiles are inside a tower corridor, very tall banded cones both sides, a pale-yellow trapezoid pad on the road and bunched cars. Colour banding is clear, the pad reads as a marker.
- `domes-laptop-1366.jpg`: same at 1366x768; yellow pad and a yellow/black marker piece ahead of the cars in the lower tiles. Good readability. Bottom strip text ("Keys & pads") low contrast.
- `plot-rocks.png`: top-down: road lap, dark-red squares of varying size (some very large) and smaller ones around it, few green dots.
- `validator-rocks.txt`: ten seeds ok; 23 jumps and 17 crests; ten distinct dome height sets.
- Reference `biome-rocks-olgas.png`: one huge fractured, layered rock wall, a hemispherical dome, stone-walled dirt ramp/jump with "Steep descent / Jump" sign, ledges, boulders, flowering shrubs, spinifex, scattered stones, tyre ruts.

## Verdict

PASS with caveats against the playtest-scope promise ("a single parametric dome/tower family with seeded height; tall and towering is the point; climbs and ramps reuse core features"). The towers are tall, banded and read at once as red rock. Height varies per seed (validator), the road reads against the ground and the scene is uncluttered. It is far from the reference's fractured, ledged, boulder-strewn look: the towers are smooth stacked frustums, closer to traffic cones or termite mounds than to Kata Tjuta domes. The silhouette is conical, not domed, with very straight sides. The jump and climb are not visibly shown: no capture shows an actual ramp, climb or crest, and no "Steep descent / Jump" sign appears. The yellow trapezoid pad is a placeholder-looking marker, not a rock ramp. Accepting the bead scope (one parametric family), I pass it, but the evidence does not demonstrate a climb or jump, and the look is cartoon-smooth.

## Defects

1. All three jpgs, every tower: smooth conical frustums with 3-4 flat colour bands, no ledges, boulders or fractures; they read as cones, not domes (reference is rounded/hemispherical).
2. `domes-tiles-1080p.jpg` lower tiles and `domes-laptop-1366.jpg` lower tiles: the pale-yellow trapezoid and yellow/black bar floating on the road are unexplained markers and look like debug geometry; the laptop one looks like it hovers above the road.
3. No capture shows a climb, crest or jump, nor the steep-descent warning sign promised by the reference and contract; ramps are only a marker.
4. `domes-tv-1080p.jpg`, left: a large flat dark shadow patch across the ground has hard polygonal edges; it looks like a hole in the ground rather than a tower shadow.
5. `domes-tiles-1080p.jpg`, nearest tower in the lower tiles: the cone edge is cropped and the lower-left towers merge into one dark mass, reducing readability.
6. Bottom-centre "Keys & pads" strip and bottom-right build strip: low-contrast text over the scene, unreadable at TV distance.
7. `domes-tiles-1080p.jpg` upper-left: blue car overlaps the lead car and fills the tile; bunched cars cover the road.
8. Sparse ground detail: a handful of spinifex tufts and shrubs; the reference's scattered stones and tyre tracks are absent.

## Disagreements with the self-review

- The self-review says "domes" in captions and filename; the captures show cones. It does mention "smooth bands, no ledges", but still frames this as matching "towering red domes".
- It describes the yellow pad as "the core's feature marker". As a viewer I read it as debug geometry; it should be flagged as a visual defect, not just a note.
- It says "a faint purple feature pad far down the road" is fine; at TV distance it is invisible, so it adds nothing.
- It does not say that no capture shows a climb or jump at all, though the bead promises them (the validator counts jumps but the images never show one).
