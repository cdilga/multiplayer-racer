# P1-A06c receipt (br-ennm), helper run 2026-10-05

Machine: Mac (Darwin), tree v0.2-revamp. Cargo through RCH.

| Command | Result |
|---|---|
| `python3 tools/audio/check_cues.py` | OK: 69 rows (was 60), 17 moments (new `off-course`), glossary 36 terms (was 28) |
| `rch exec -- cargo test -p jj-procgen` | 10 sign tests pass (15 signs: 12 + servo, arvo-servo, the-institution) |
| `node --test web/host/tests/signs.test.mjs` | 8 pass; legend cap heights at 192x108: arvo-servo 16 px, servo 22.9, the-institution 12.5 (min 6) |
| `node --test web/landing/tests/` | 34 pass |
| `node art/ui/poc/phone/check.mjs` | all checks pass (37 states x 2 engines x 3 devices x 2 orientations; includes new `race&stick=offcourse`). Side effect: it rewrites `docs/evidence/P1-U03/**`; those changes are not part of this bead and should be discarded (`git checkout -- docs/evidence/P1-U03; git clean -fd docs/evidence/P1-U03`) |
| `node art/ui/lib/live-check.mjs --local --viewports 412x915,915x412 --out docs/evidence/P1-A06c/captures <3 phone paths>` | 6 captures ok |
| landing at 412x915 and 915x412 (Playwright Chromium against the built landing, no horizontal overflow) | 2 captures |

New cue rows (all `family_friendly=yes`, `slang_terms` filled): welcome-4, photo-finish-4, time-up-4, winner-4, next-round-4,
off-course-1..4. `check_cues.py` changes: new moment `off-course` (event `car.out_of_bounds`, A03 must map it); `walkabout` no longer in the
Indigenous-term rule (R114 supersedes the hold-back); glossary source may be `Owner-supplied` (no dictionary page yet).

## Clips: NOT regenerated

eris check: `nvidia-smi` showed 3504 MiB of 8192 MiB held by desktop apps (Brave 1.8 GB, others), no jammers job running. Launching
`tools/audio/render_voice.py --only welcome,photo-finish,time-up,winner,next-round,off-course` from this helper was refused by the
permission classifier, so no job started and nothing was changed on eris. The 9 new rows have no `assets/audio/voice/*.ogg` yet. To finish:
run that command (about 9 rows x 8 takes) from the owner's session; commit only `assets/audio/voice/*.ogg`, `manifest.json` and the
refreshed `docs/evidence/P1-A01/` index.
