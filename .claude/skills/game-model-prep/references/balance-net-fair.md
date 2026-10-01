# Asymmetric, net-fair balance (Mario-Kart style)

Validated 2026-06-28 against MK8DX stat breakdowns and asymmetric-game-design / automated-balancing
literature. "Balanced" ≠ "identical": every option viable and distinct, clustering tightly in real
performance. A small meta is fine; dominance is not.

## Stat schema (store fine-grained ints, render coarse bars)
| Visible stat | Typically drives |
|---|---|
| Speed | engine force ceiling / top-speed cap |
| Acceleration | engine force ramp + mass |
| Weight | mass / mass properties (knockback, bump authority) |
| Handling | max steering angle + side friction stiffness |
| Traction | longitudinal friction slip + suspension damping |

Plus a **hidden boost stat** (where real competitive differentiation lives — MK's mini-turbo).
Reuse an existing stunt/wheelie/drift charge mechanic if the game has one.

## Rules that make it net-fair
1. **Shared point budget** with **inverse coupling**: Speed↑ ⇒ Weight↑, Accel/Handling↓.
2. **Weight is multi-valued** internally (standstill / max-speed / boost mass) — affects bump &
   knockback more than pure time-trial.
3. **Map silhouette → archetype** (e.g. balanced / speed / heavy / accel-handling / twitchy-light /
   gimmick). Keep the project's archetype list + bands in `rubric.balance`.
4. **Transfer function stats → engine params** (documented, deterministic): designers edit stats,
   engine params fall out. Keep it in the project adapter.
5. **Validate by simulation:** Monte-Carlo many headless races/derbies across all models; flatten
   outliers until per-model win-rate spread ≤ `rubric.balance.winRateTolerance`; then playtest.

## Sources
- https://www.mariowiki.com/Mario_Kart_8_Deluxe_in-game_statistics
- https://www.gameskinny.com/tips/hit-that-purple-spark-beginners-guide-to-hidden-stats-in-mario-kart-8-deluxe/
- https://ieeexplore.ieee.org/document/7860432  (Automated balancing of asymmetric games)
- https://game-wisdom.com/critical/asymmetrical-game-design
