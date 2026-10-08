# Preview publishing policy

Owner ask, 2026-10-08: publish to the rainbow preview page (`https://jammers-preview.dilger.dev/`) regularly, so the
owner always has something current to play. Previews never freeze (R85), so publishing never blocks development.

This is a proposed policy until the owner ratifies it.

## When to publish

Publish a preview from the newest green commit when **any** of these is true:

1. **A playable step landed.** A bead closed that changes what a person sees or does on the host or a controller:
   joining, driving, cameras, HUD, lobby or results screens, track generation, damage, sound. Epics count when their
   last child closes. Internal-only beads (types, protocol internals, CI, docs, tooling) do not trigger a publish.
2. **A fix to something already visible.** A bug bead closed that the owner would have hit while playing.
3. **It has been 2 working days** since the last publish and anything visible has changed since. This is the ceiling;
   don't wait for it when 1 or 2 applies.
4. **The owner is about to play.** Before a couch session, a gate (G-DESIGN, Q02) or a hardware check (P1-R), publish
   first, then tell the owner the preview id.

Never publish from a red or unfinished commit. Never skip a publish because the build is "not impressive yet": a
rough but current build beats a polished stale one.

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

The end state is that a green push to `v0.2-revamp` that touches the web or server bundle publishes by itself, with a
smoke check, and that the index lists the commit and the CI run. Until D04 lands, publishing is a manual step by
whichever session closes a qualifying bead.
