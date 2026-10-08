# P1-F06 status (2026-10-08, BrownCreek): receipts from the machines; not closed

The transcripts beside this file were taken on 2026-10-07 23:40-23:42 UTC from the Mac (rch, ssh) at game commit
2055da7.

| AC | State | Receipt |
|---|---|---|
| 1. `rch workers` lists devbox and eris; a workspace check runs on each; two concurrent builds land on different workers | **partly**: both listed; builds run on eris ("Selected worker: eris"), but devbox has 0 slots (disk critical, 2.5 % free), so every build, concurrent ones included, lands on eris | `rch-workers.txt` |
| 2. devbox's build storage on triton's pool, with room (`df`) | **pending**: devbox's rootfs is still on triton's boot NVMe (`/dev/nvme0n1p2 458G 423G 12G 98%`); `tank` finished resilvering on 2026-10-06 ("0 errors") but still reports DEGRADED with an old data error, and has 3.2 T free | `devbox-storage.txt` |
| 3. `scripts/remote/eris.sh npx playwright --version` works | met: `Version 1.62.1` | `eris-sync-and-runs.txt` |
| 4. `ru status` shows the clone in sync; eris.sh syncs first and refuses on unpushed commits | met: `cdilga/multiplayer-racer current v0.2-revamp 0/0`; eris.sh's refusal was seen live this session: `eris.sh: refusing: eris is at c27fca271c52, the Mac at 682f721cb816; the Mac has unpushed commits (1 ahead of origin): push first.` | `eris-sync-and-runs.txt` |
| 5. Two simultaneous runs share the clone, separate output dirs, nothing edited by hand | met: runs `f06-a` and `f06-b` at once each wrote their own `~/Work/runs/<id>/out.txt` (the second saw `RU_SYNC=skipped (runs in progress)`); the clone has 0 tracked changes | `eris-sync-and-runs.txt` |
| 6. Pruning removes idle run dirs; reclaim-target.sh keeps the Mac's target/ under 15 GiB | met (dry runs): `target/: 7.98 GiB (budget 15 GiB)`; prune-caches reports eris's caches and the `.pruned` area | `pruning.txt` |
| 7. The RCH worker comes back after a restart of its service, no manual steps | **partly** (2026-10-08 06:33 UTC): `launchctl kickstart -k` of the Mac's RCH daemon came back by itself (new PID, `Workers : 2/2 healthy`, eris 6 slots), but the next two builds fell back to the Mac (`active_project_exclusion`: eris was already building this project for another agent; devbox disk-critical), so no post-restart remote build is shown yet | `rch-restart.txt` |
| 8. With eris off, the same commands fall back to devbox through RCH or per-crate local runs on the Mac | **partly**: the Mac's per-crate fallback works (rch logged 90 local fallbacks in 24 h), but devbox can't take builds until AC2. 2026-10-08: cleaning devbox's regenerable build output freed 21.7 GiB (9.8 → 33 GiB free), past `min_free_gb = 30`, but the daemon still rates it WARNING (7.3 %) and gives it 0 slots; with eris drained, `rch diagnose` selects no worker (`devbox-storage.txt`, second entry) | `rch-workers.txt` |

Also pending:
- **`ru` for jammers-deploy on eris:** ru on eris syncs from GitHub; jammers-deploy lives only on Gitea, so `ru add`
  can't follow it as configured. Nothing on eris needs it today (the deploy smoke runs on the deploy runner).

**The devbox storage move, for the owner (root on triton):** give the devbox LXD container a disk on `tank` (for
example `lxc config device add devbox rchdata disk source=/mnt/unit/devbox-build path=/data`) and point rch-wkr's work
dirs and `~/.cache` there, then `rch workers capabilities --refresh`. Check `zpool status tank` first: it finished
resilvering but still shows DEGRADED with an old data error.
