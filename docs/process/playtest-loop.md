# The playtest loop

Plan §13.4 and §13b.6. A playtest finding becomes reproducible work: a clip or a scenario, a probe that fails with numbers
before the fix, and the same probe passing after it.

## 1. Playtest, and save a clip

On any host (previews included) press **Ctrl/Cmd+Shift+B**, or use the diagnostics **Save bug clip** button (the fault screen
has the same button). The host downloads `jj-clip-<build>-w<world>-t<tick>.jjclip`. It holds the build id, the map's bytes
and hash, the session seed, the track seed (session seed + preparation id, so it names the exact track), the roster and the
applied-input journal of the current world (the free-drive session, or the round) with the moment marked. Saving reads
what main already holds, so it never pauses the host, and it works after a worker fault.

When a clip isn't possible (a phone-only problem, a host that was down), say so in the bead and give the preview id, the time
and what was seen.

A development host can also keep the whole session (`*.jjsession`, F12): every round's journal, seeds, roster changes,
connection paths, input-age percentiles and frame pacing, in IndexedDB, never uploaded.

## 2. The round record

The coordinator writes `docs/playtests/round-<date>.md`:

```markdown
# Playtest round <date>, preview <preview-id>, build <commit>

Players: <who, devices, network>   Clips: <files under docs/evidence/<BEAD>/>

## What was understood
<one paragraph: what the owner played and what they said>

## Findings
1. <what was seen> (clip: <file>, tick <t>) -> bead <ID>
2. ...

## Investigated
<what was probed, with the numbers>

## Changed
<beads closed, and the build that carries them>
```

Every finding is numbered and becomes a bead.

## 3. The bug bead

```markdown
Title: <what was seen, in a line>
Clip: docs/evidence/<ID>/<name>.jjclip   (or: preview <id>, <time>, <what was seen>)
Preview id / build: <preview-id> / <commit>
Seen: <what happened, in the owner's words>
Expected: <what should have happened>
Probe first: <the scenario or journey that reproduces it with numbers, and the number now>
Acceptance: the probe fails before the fix with <numbers>, passes after, and joins the affordance bank or the journeys.
```

**Probe first.** Reproduce before fixing: replay the clip and read the numbers, then write the probe.

```bash
jj sim --replay docs/evidence/<ID>/<name>.jjclip --trace          # target/jj-runs/replay-<name>/trace.jsonl
jj sim --replay docs/evidence/<ID>/<name>.jjclip --json           # end hash, checkpoints, state at the mark
```

- `jj sim --replay` refuses a clip from another build: check that build out (`git checkout <build>`) and rebuild `jj`.
  `--any-build` replays anyway; expect hashes to differ.
- Each checkpoint hash the host took is verified; a divergence prints the first tick where the replay stopped matching.
- The trace is `jj sim --trace`'s format, so the clip against its fix is one command:
  `jj sim --compare <clip trace> <fixed trace>`.
- Clips are `*.jjclip` and `*.jjsession` files, LFS-tracked (`.gitattributes`).

## 4. Fix, and keep the probe

The worker writes the probe, fixes, and shows the same probe passing. The probe stays: an affordance-bank scenario
(`scenarios/affordances/`) or a Playwright journey.

## 5. Accept a baseline

When the owner accepts a build's feel in a playtest, save the affordance bank's traces as the accepted baseline:

```bash
id=<preview-id>
mkdir -p scenarios/accepted/$id
for f in scenarios/affordances/*.json; do
  jj sim --trace --out target/jj-runs/accepted-$id/$(basename $f .json) $f
  cp target/jj-runs/accepted-$id/$(basename $f .json)/trace.jsonl scenarios/accepted/$id/$(basename $f .json).trace.jsonl
done
git add scenarios/accepted/$id && git commit -m "accepted baseline <preview-id>"
```

Later changes compare against it (`jj sim <fixture> --compare scenarios/accepted/$id/<name>.trace.jsonl`); a regression against
an accepted baseline fails unless the owner accepts the new feel.
