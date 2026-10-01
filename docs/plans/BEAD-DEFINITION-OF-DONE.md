# Bead Definition of Done — anti-drift standard

> Written 2026-07-03 after tracing why user-visible gameplay complaints (derby
> bottom-of-bowl visibility, cars launching out of bounds, no OOB reset, QR too
> small, borked weapon sounds, controller layout) had *no beads* despite being
> designed in detail. Two failures caused it. This doc fixes both.

## The two failure modes we are guarding against

1. **Coverage drop (design → bead).** `feedback-design-pass.md` section 13 promised
   ~45 `FB-*` beads; only 8 were cut into `br`. Nothing linked the plan's
   work-breakdown to the tracker, so ~35 rows evaporated silently.
   **Guard:** `scripts/reconcile_plans_to_beads.py` — every `FB-*`/`br-*` a plan
   names must exist in `br` or be allowlisted. Run `--gate` in CI.

2. **Scope narrowing (bead → close).** The 8 that *were* cut closed on
   geometry/unit assertions. `br-fb-bowltransition-3ij` passes every bowl-profile
   test and still lets cars launch out the side, because "vertical lip / no
   launch-out" was never an acceptance criterion. "Fresh validation" just re-ran
   the same narrow unit tests — no play-shaped check.
   **Guard:** the acceptance-criteria template below. A bead is not done until the
   *felt* outcome holds in the running game.

## Required fields for every gameplay/UX bead

Set these with `br update <id> --design ... --acceptance ...`:

- **Source plan row** — backlink to the doc + section (or "user feedback <date>")
  the bead implements. Makes coverage auditable and lets the reconcile gate see it.
- **Behavioral acceptance (observable)** — what a human/vision-harness can *see* in
  the running game. Not "the function returns X" — "in derby on the deepest bowl,
  all live cars stay on-screen across a full round including shrink."
- **Evidence required before close** — the artifact that proves the behavior:
  a Playwright host-path test, a Rapier sim assertion, a vision-rubric run
  (`br-modes-remote-play-design-48a.11.3` headless render + `.11.5` vision judge),
  and/or a screenshot/gif. Unit-green alone never closes a gameplay bead.
- **Anti-narrowing clause** — verbatim:
  > Done only when the FELT, observable outcome above holds in the RUNNING game via
  > the real host path. Passing unit/geometry tests is necessary but NOT sufficient.

## Closure rule

A validator (never the implementer) closes a bead only after producing the
**Evidence required** artifact and confirming the **Behavioral acceptance** in the
running game. If the acceptance criteria can be satisfied by a unit test that a
user would still call broken, the criteria are too narrow — widen them first.

## The reconcile gate

```
python3 scripts/reconcile_plans_to_beads.py          # report: PRESENT / REHOMED / MISSING
python3 scripts/reconcile_plans_to_beads.py --gate    # non-zero exit on un-allowlisted MISSING
```

Intentional deferrals go in `scripts/reconcile_allowlist.txt` with a reason.
Turn `--gate` on in CI once the current MISSING backlog is cut or allowlisted.
