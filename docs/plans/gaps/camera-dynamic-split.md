# Dynamic Multi-Camera Split-Screen — algorithm synthesis (items 18 & 19)

> Synthesis of the §5.2 design + a `/deep-research` pass (clustering/tiling math). The research's
> auto-synthesis step died on a session limit, so this is hand-synthesized from its **verified** claims
> (capacitated clustering, abandon-elbow, OT↔Voronoi) plus established results (Lenz impossibility —
> verified in the *first* research pass; squarified treemaps; LEGO dynamic split). Confidence is labeled.
> **All tunable constants below feed the §5.3 A3d live camera-tuning panel — they are starting points to
> playtest, not gospel.** Items 18 and 19 are the **same pipeline at different budgets B**.
>
> **Owner decisions locked 2026-06-29:** keep **all cars in view** as a first-class mode; default to the
> elegant cluster director for **N clusters** (not just two); keep per-player grid as a configurable mode
> named **Wife's Grid Mode**, following players like Mario Kart-style panes rather than being the default.

## The core move: decouple GROUPING from TILING

Conflating "who shares a camera" with "how the screen is cut" is what makes this feel impossible. They're
separable. Pipeline: **cluster → budget-cap → assign → tile → stabilize.**

**Mode policy.** The director exposes three named modes over the same primitives:

- **All cars in view** — one auto-framed/overhead camera that keeps the full field readable.
- **Cluster director** — the default; group nearby cars and split into compact N-cluster viewports only
  when separation earns it.
- **Wife's Grid Mode** — opt-in per-player follow grid, useful when every player wants their own pane.

## Stage 1 — Group: budget-capped capacitated clustering

We must NOT auto-pick K and hope it fits the viewport budget, and we must NOT force B viewports when cars
are naturally together (3 close cars ≠ 3 cameras). Two tiers:

1. **Natural grouping (live, every frame):** single-linkage by a spatial threshold — two cars join the
   same group if within `mergeDist` (operate on **ground-plane** positions, see Stage 3). Density-style,
   so scattered cars fall out as singletons for free. Yields natural count `C ∈ [1, N]`. This is the cheap
   real-time path; cluster-quality criteria (VRC/BIC/Gap) are for *offline* tuning of `mergeDist`, not
   per-frame. *(Research, verified: abandon the elbow method; prefer Variance-Ratio (Calinski-Harabasz),
   BIC/X-means, or Gap statistic when you DO need to choose K analytically.)*
2. **Budget cap:** if `C ≤ B` → use the `C` natural groups directly (use only what you need — 1 camera
   when everyone's together). If `C > B` → **coarsen to B** with a **capacitated assignment**: fix `k = B`
   and run a capacity-constrained clustering (PACK-style: each viewport-center carries a hard cardinality
   cap `U`, e.g. `ceil(N/B)+slack`), seeded from the natural-group centroids, distributing the overflow
   singletons into the nearest non-full viewport. *(Research, verified: capacitated/"PACK" clustering
   enforces a per-cluster max-cardinality `L ≤ Σ ≤ U` with `k` FIXED as input and balances sizes without
   destroying spatial coherence — exactly the per-viewport budget mechanism.)* Cheap alternative that
   works in practice: agglomeratively merge the closest natural groups (dendrogram cut) until `C = B`.

**Why this answers "3 tight / 4 medium / 9 scattered":** natural grouping finds the structure; the budget
cap decides whether the 9 singletons each get a box (big B) or get regionally merged (small B).

## Stage 2 — Tile: a K-policy (relaxing the impossible "fairness")

Lenz (EuroCG'18, verified pass 1): a *fully fair* split (equal-area + direction-indicating + fusible +
centered + continuous) is **impossible for K≥3**, so we relax *direction-indicating* for the crowd:

- **K=1** → full screen.
- **K=2** → **LEGO perpendicular-bisector split** (exact, cheap, KEEPS direction-indicating — the elegant
  case; one `arctan`, two viewports → fullscreen-quad shader; merge-at-midpoint / split-at-fixed-distance).
- **K≥3** → **squarified treemap** weighted by group importance (`carCount` + recent-action bonus).
  *(Bruls/Huizing/van Wijk 2000 — established):* gives a **complete, non-wasteful tiling of compact,
  low-aspect-ratio rectangles**, which is HUD-friendly (rectangles, not organic cells) and trivial to
  compute. This is **item 19's grid** at the extreme (B=N → equal-weight treemap = a clean grid).

**The research-backed "ideal fair-area" upgrade (deferred, not v1):** the verified novel link is that
**capacity-constrained Voronoi tessellation ≡ a semi-discrete optimal-transport problem** (de Goes et al.
2012; Balzer 2009) — you *can* allocate screen/ground area **proportional to group importance** with
organic fair-area cells. But it's a heavier solve and yields **non-rectangular cells** (awkward for HUD and
readability), so it's a documented future option if the treemap's rectangularity ever feels too grid-like —
**treemap wins v1 on cost + readability.**

## Stage 3 — Assign cameras + the angle simplifier

Each group gets one camera at a **shared near-top-down pitch** (where derby is already heading). This is the
**cheat code**: a shared top-down-ish angle collapses the whole problem to **2D ground-plane partitioning**
(cluster + tile on projected ground positions) — no 3D frustum-overlap pathology, which is exactly why
LEGO's tight angle constraints made their split tractable. Each camera frames its group to the
`targetCarScreenFraction` floor (split-before-shrink, §5.5).

## Stage 4 — Stabilize: temporal coherence (no flicker)

- **Hysteresis band:** `splitDist > mergeDist`. Groups merge at `mergeDist`, split only past `splitDist`,
  so a car hovering at the threshold doesn't oscillate.
- **Debounce:** a change in cluster count must persist `> T_debounce` frames before the screen re-tiles.
- **Interpolate:** lerp viewport rects + camera poses over `~0.35 s` on a layout change (no hard cuts).

This is LEGO's merge-when-close / split-when-far with explicit anti-flicker.

## Worked example — 16 players {3 tight, 4 medium, 9 scattered}, budget B=4

1. **Natural grouping** (`mergeDist`): `{3 tight}`→1, `{4 medium}`→1 (or 2 if spread > mergeDist),
   `{9 scattered}`→ up to 9 singletons. Worst case `C = 11`.
2. **Budget cap** `C=11 > B=4` → coarsen: keep `{3}` and `{4}` as 2 viewports; capacitated-cluster the 9
   scattered with `k=2, U≈5` → 2 regional groups of ~4–5. **Result: K=4 viewports.**
3. **Tile** (K=4 ≥3) → squarified treemap weighted by car count `{3,4,4,5}` → 4 panels, the 5- and 4-car
   panels slightly larger; compact rectangles, zero wasted screen.
4. **Cameras:** each panel a near-top-down view framing its group to the car-size floor.
- *Same input, B=16* → 16 equal treemap tiles (item 19). But each ≈ 480×270 on 1080p — too small to read,
  so the **degradation ladder** (markers-not-full-render, §12.6 `FB-perf`) kicks in. This is the honest
  ceiling on "everyone gets a box."

## Tunable params → the §5.3 A3d panel (playtest these)
`mergeDist`, `splitDist`, `T_debounce`, transition-lerp-time, `B` (`maxAutoViewports`),
`targetCarScreenFraction`, importance weights (carCount vs action), treemap target aspect, per-mode camera
pitch/zoom. None have an objective metric → dial by eye (principle: feel params get a panel, not a guess).

## Beads (decompose `FB-camdir` for K>2)
- **FB-camcluster** — natural single-linkage grouping + capacitated budget-coarsen (Stage 1). Test: given
  car positions + B → expected group assignment; the 16-player case asserts K=4.
- **FB-camtile** — K-policy: full / bisector(K=2) / squarified-treemap(K≥3) → viewport rects. Test: rects
  tile the screen with no gaps/overlap; aspect ratios under a bound; B=N → grid.
- **FB-camstable** — hysteresis + debounce + interpolation (Stage 4). Test: scripted scatter→converge→
  scatter trace asserts cluster-count changes < X/sec (no thrash) and smooth rect interpolation.
- **FB-wifes-grid-mode** — named, configurable per-player follow grid: B=N, equal/treemap tiles as
  configured, player-pinned panes, saved setting, not the default. Test: N players keep stable
  player→viewport assignment through join/rejoin and camera transitions.
- Existing: `FB-camdir` becomes the orchestrator over these; `FB-camgrid`=B=N case; `FB-camset` exposes the
  params (A3d). `FB-perf` owns the >~8-viewport degradation ladder.

## Honesty on sourcing
Verified by the research: capacitated/PACK cardinality-capped clustering; abandon-elbow→VRC/BIC/Gap;
CCVT≡optimal-transport. Verified pass 1: Lenz impossibility; 2-player exact bisector; LEGO merge/split
mechanic. Established (not re-verified, session limit): squarified-treemap low-aspect-ratio tiling. The
*pipeline composition itself* (natural→capacitated-cap→K-policy-tile→stabilize, on a 2D ground plane) is my
engineering synthesis, not a cited result — it's what makes the cited pieces fit our real-time, budgeted,
readable-on-a-TV constraints.
