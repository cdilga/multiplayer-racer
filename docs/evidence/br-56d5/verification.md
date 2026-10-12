# P1-F02 — br-56d5

CI3436 at 3cf749b5 completed its build (job7728) successfully, while browser jobs7729–7735 exited before testing. Their fetch logs report `the build job failed; nothing to test`. The fetch script selected a historical commit status from cancelled run3432 instead of its own run's job.

The fetch now queries `/actions/runs/$GITHUB_RUN_ID/jobs` and only treats the current completed build's failing conclusion as terminal. A pending or successful build continues waiting for store publication; no run ID or unavailable API also continues waiting within the existing deadline. Cache/archive/native checks remain intact.

Five regression cases exercise the actual fetch shell with isolated fake store/API/archive commands: pending build against an old failed status, successful build awaiting publication, and current failure/cancellation/timeout. All passed on Mac arm64 with Node26; shell syntax passed. See `regression.txt`. These tests do not claim an archive integration run. Green CI remains required before close.
