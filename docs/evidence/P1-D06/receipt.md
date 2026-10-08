# P1-D06 receipt (2026-10-07, BrownCreek)

Deploy repo: jammers-deploy `scripts/retention.py`, `tests/test_retention.py`, `edge/Caddyfile` (at 364753f).

## AC1: a scripted sequence of publishes, pins and time skips ends with exactly the expected set

`deploy-unit-tests.txt` (`python3 -m unittest discover -s tests -p 'test_*.py' -v` in jammers-deploy, 20 tests OK):
`test_publishes_pins_and_time_skips` publishes five, pins one, skips 5 h and 40 h and unpins, asserting the kept set at
each step (pinned + Latest + at most three unpinned younger than 24 h).

## AC2: the reconciler is idempotent and preserves evidence before removal

- `test_idempotent_after_retiring`: a second run retires nothing.
- Live: publish run 1734 ran the reconciler on publish and retired `v02-f4d0e2ef` (four previews: Latest, two young
  playable, and the oldest). Its TrueNAS app is gone (`docker ps -a | grep -c jjp-v02-f4d0e2ef` = 0) while its register
  row stays, marked `"retired": "2026-10-07T16:43:31…"` with its sha, digest, CI run, smoke result and reason
  (jammers-deploy commit 555958c "register: retired v02-f4d0e2ef"). Evidence lives in the register and the game repo,
  never in the container.

## AC3: expired links show the explanation page; API calls under an expired base path get 410 preview-expired

`retired-preview-410.txt` (16:45 UTC, after the retirement above):

    /p/v02-f4d0e2ef/api/v1/rooms/ABCD   {"reason":"preview-expired"}  [410]
    /p/v02-f4d0e2ef/host                This test build has expired. The live previews are at https://jammers-preview.dilger.dev/  [410]
    /p/v02-f4d0e2ef/version             This test build has expired. …  [410]

Found on the way: the hourly retention workflow shared the `publish` concurrency group, so the 5-minute poll replaced
every waiting run and it never ran (1606, 1631, 1666). It has its own group now (jammers-deploy 2e5d64a); reconciling on
every publish (as above) was and is the main path.

## 2026-10-08 (BrownCreek): pin and unpin on the tag record (R117)

Retention workflow run 2138 (`pin=v02-39f5aa80`, `label=Pin test`): `pin/v02-39f5aa80 (Pin test): created`,
`retired: []`; the next publish poll re-applied the index, and the live page listed `class="card pinned"
id="v02-39f5aa80"` with the `Pin test` tag first, above the newer `v02-552e7bda-2`. Run 2184 (`unpin=v02-39f5aa80`)
removed the tag. Neither tag started a CI run (made with the workflow's token). Unit tests: `infra/previews/tests`
(25, in the checks job).
