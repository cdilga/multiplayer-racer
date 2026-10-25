# Preview publishing policy

Owner ask, 2026-10-08: publish to the rainbow preview page (`https://jammers-preview.dilger.dev/`) regularly, so the
owner always has something current to play. Previews never freeze (R85), so publishing never blocks development.

Owner rulings from 2026-10-17 and R140 (2026-10-25) supersede the original green-only proposal below.

## When to publish

Every CI run whose image built gets a preview, red or green. The smoke check marks whether it is playable;
green CI is a quality signal, never a publication gate. The scheduled `deploy-previews.yml` workflow handles
normal publication. At a bead boundary the solo session or claimed CI repair agent checks that the newest built
image has its preview and smoke record. A dedicated deploy session is optional.

Publish promptly when **any** of these is true:

1. **A playable step landed.** A bead closed that changes what a person sees or does on the host or a controller:
   joining, driving, cameras, HUD, lobby or results screens, track generation, damage, sound. Do not wait for bead
   closure or a green batch when the image is already built.
2. **A fix to something already visible.** A bug bead closed that the owner would have hit while playing.
3. **It has been a day** since the last playable preview and anything visible has changed since. This is the ceiling;
   don't wait for it when 1 or 2 applies.
4. **The owner is about to play.** Before a couch session, a gate (G-DESIGN, Q02) or a hardware check (P1-R), publish
   first, then tell the owner the preview id.

Publish built, committed images; identify red lanes and smoke failures honestly. A day without a new playable
preview is P0 for the repair owner (or the solo session). Do not wait for a feature to feel impressive.

If a built run is missing its preview, dispatch `deploy-previews.yml` with input `mode: --from-run <run-id>`.
Its `infra/previews/scripts/publish.py` publishes that immutable image and records smoke results. Inspect once;
keep working instead of polling or redispatching the same run. Preview records are pushed as tags, not commits.

## What to say when publishing

One line to the owner: the preview id, the commit, what is new since the previous preview, and what is known broken.
When reporting status at any time, state how old the newest preview is (in days and in commits or CI runs behind HEAD).

## Retention

A preview is retired once it is more than 2 days old **and** at least 3 newer previews exist. This keeps the
containers and disk from piling up. Exempt: a preview named in an open gate or bug report, and any pinned playtest
preview (R85), until that gate closes.

## Reminder at close

`scripts/beads/close.sh` prints a publish reminder after closing a bead labelled `visual`, which is the proxy for
"qualifying" in rule 1 above. A non-visual bead that changes behaviour (for example driving or track generation) should
still publish; the reminder is a nudge, not the whole rule.

## Automation target (P1-D04)

The scheduled/on-demand `deploy-previews.yml` workflow publishes built images independently of CI verdict,
with a smoke check and an index linking the commit and source CI run. Code lives in `infra/previews/`.
