# CI runners

The Gitea Actions runners at `http://192.168.11.12:3001` are instance-wide and shared by every project (owner ruling
2026-10-03). Labels are generic; only hardware facts (a GPU) pin work to a machine (R93). The Mac is not a CI machine.

| Runner | Host | Labels | Slots | Job container limits | Persistent `/cargo-cache` |
|---|---|---|---|---|---|
| triton-rust | triton (container `physical-soccer-rust-triton`) | rust, rust-triton | 1 | 12 CPU, 16 GB | docker volume `ps-rust-cache` (boot NVMe) |
| **triton-ci** (2026-10-07) | triton (container `triton-ci-runner`) | rust, rust-triton, ubuntu-latest | 4 | 4 CPU, 12 GB, shm 2 GB | bind `/mnt/unit/ci-cache` (ZFS `tank`) |
| triton-general | triton | ubuntu-latest | 1 | | none |
| triton-gpu | triton (GTX 1080, driver 470) | gpu-triton | 1 | 4 CPU, 6 GB | none |
| truenas-rust | TrueNAS app `ps-rust-runner` | rust, rust-truenas | 1 | | `ix-ps-rust-runner_cargo_cache_zfs` |
| **truenas-ci** (2026-10-07) | TrueNAS container `truenas-ci-runner` | rust, rust-truenas, ubuntu-latest | 3 | 4 CPU, 8 GB, shm 2 GB | docker volume `ci-cache` |
| truenas-shared, truenas-general-2 | TrueNAS | ubuntu-latest | 1 each | | none |
| jammers-docker-truenas | TrueNAS | jammers-docker, jammers-deploy | 1 | host Docker socket | |
| **eris-gpu** (2026-10-07) | eris, host executor, user systemd unit | gpu, gpu-eris | 2 | none (runs as `cdilga`) | eris's own `~/.cargo`, `~/.cache/jj-ci` |

## The CI job image (`jj-ci:<hash>`)

`scripts/ci/ci-image.Dockerfile` adds what every job used to install per job: node (`.nvmrc`), Playwright's Chromium
headless shell **and its system libraries** (the `--with-deps` apt step took 10 minutes a job on TrueNAS), coturn,
git-lfs, zstd, wasm-bindgen and cargo-nextest. The tag is the Dockerfile's hash, and the image is **built locally on each
Docker runner host**, never pulled (the runners run with `force_pull: false`, so a present image is used as is):

```bash
scripts/ci/ci-image.sh --tag                # the tag ci.yml must name
scripts/ci/ci-image.sh triton               # build on triton (chris is in the docker group)
scripts/ci/ci-image.sh truenas sudo         # build on TrueNAS (needs sudo for Docker)
```

When the Dockerfile changes: build on both hosts first, then push the workflow with the new tag (every
`image: jj-ci:…` line in `.gitea/workflows/ci.yml`). A host without the image fails its job at container creation.

## How the new runners were registered (2026-10-07)

Registration tokens come from `POST /api/v1/admin/actions/runners/registration-token` (`tea api --login gitea-lan`);
they were piped over ssh into files and never printed or committed.

**triton-ci** (`~/.config/triton-ci-runner/config.yaml`, data in `~/.local/share/triton-ci-runner/data`):

```yaml
runner:
  file: /data/.runner
  capacity: 4
  timeout: 1h
  labels:
    - "rust:docker://catthehacker/ubuntu:act-22.04@sha256:3cdab37904fc1798c460f1fadd47fd2c4d24fa2f292d1b57fc12eff072b415ec"
    - "rust-triton:docker://catthehacker/ubuntu:act-22.04@sha256:3cdab379…"
    - "ubuntu-latest:docker://catthehacker/ubuntu:act-22.04@sha256:3cdab379…"
cache: { enabled: false }
container:
  options: "--volume=/mnt/unit/ci-cache:/cargo-cache --memory=12g --cpus=4 --pids-limit=4096 --shm-size=2g"
  valid_volumes: ["/mnt/unit/ci-cache"]
  docker_host: "-"
  force_pull: false
```

```bash
docker run -d --name triton-ci-runner --restart unless-stopped \
  -e GITEA_INSTANCE_URL=http://192.168.11.12:3001 -e GITEA_RUNNER_NAME=triton-ci \
  -e GITEA_RUNNER_REGISTRATION_TOKEN_FILE=/data/registration-token -e CONFIG_FILE=/config.yaml \
  -v /var/run/docker.sock:/var/run/docker.sock -v $HOME/.local/share/triton-ci-runner/data:/data \
  -v $HOME/.config/triton-ci-runner/config.yaml:/config.yaml:ro gitea/act_runner:0.2.13
```

The cache lives on `tank` because triton's boot NVMe (where Docker's own volumes live) was 96 % full. `tank` finished
its resilver on 2026-10-06 with one old data error; it only holds caches here, so losing it costs a cold build.

**truenas-ci**: the same config with `capacity: 3`, `rust-truenas`, `--volume=ci-cache:/cargo-cache --memory=8g` and
`valid_volumes: ["ci-cache"]`, in the docker volume `truenas-ci-runner-data` (config at `/data/config.yaml`):

```bash
sudo docker run -d --name truenas-ci-runner --restart unless-stopped \
  -e GITEA_INSTANCE_URL=http://192.168.11.12:3001 -e GITEA_RUNNER_NAME=truenas-ci \
  -e GITEA_RUNNER_REGISTRATION_TOKEN_FILE=/data/registration-token -e CONFIG_FILE=/data/config.yaml \
  -v /var/run/docker.sock:/var/run/docker.sock -v truenas-ci-runner-data:/data gitea/act_runner:0.2.13
```

TrueNAS has 24 cores but only ~34 GB of its 125 GB free (Frigate, Home Assistant and the other apps), so it gets 3
slots of 8 GB. This is a plain Docker container, not a TrueNAS app: after a TrueNAS reboot check it came back
(`sudo docker ps | grep truenas-ci`), and see the deploy-topology note about the docker group.

**eris-gpu**: a host executor, because eris's login isn't in the docker group (and sudo isn't reliable there), and
because the host is where headless Chromium reaches the NVIDIA Vulkan driver (`JJ_CHROMIUM_GPU=1`).

```bash
curl -sSfL -o ~/.local/bin/act_runner https://dl.gitea.com/act_runner/0.2.13/act_runner-0.2.13-linux-amd64
cd ~/.local/share/eris-gpu-runner     # config.yaml: capacity 2, labels gpu:host, gpu-eris:host,
                                       # host.workdir_parent ~/.cache/act-runner, envs.PATH with mise shims + ~/.cargo/bin
act_runner register --no-interactive --config config.yaml --instance http://192.168.11.12:3001 \
  --name eris-gpu --labels gpu:host,gpu-eris:host --token "$(cat token-file)"
systemctl --user enable --now eris-gpu-runner.service   # ExecStart=act_runner daemon --config …; Restart=always
loginctl enable-linger cdilga                            # keeps the user unit up without a login session
```

eris is a desktop that is sometimes off, so only `.gitea/workflows/gpu.yml` uses `gpu`, and no CI lane waits on it.

### Undo

- triton: `docker rm -f triton-ci-runner`; `rm -rf ~/.config/triton-ci-runner ~/.local/share/triton-ci-runner`;
  optionally `sudo rm -rf /mnt/unit/ci-cache`.
- TrueNAS: `sudo docker rm -f truenas-ci-runner && sudo docker volume rm truenas-ci-runner-data ci-cache`.
- eris: `systemctl --user disable --now eris-gpu-runner`; remove `~/.config/systemd/user/eris-gpu-runner.service`,
  `~/.local/share/eris-gpu-runner`, `~/.local/bin/act_runner`, `~/.cache/act-runner`, `~/.cache/jj-ci`;
  `loginctl disable-linger cdilga` if nothing else needs it.
- Then delete the runner entries: `tea api --login gitea-lan -X DELETE /admin/actions/runners/<id>`.
- `docker image rm jj-ci:<tag>` on triton and TrueNAS.

## Not done, and why

- **triton's GTX 1080 as a second `gpu` runner:** inside a container with `--gpus all` the 470 driver's Vulkan ICD
  fails `vkCreateInstance` (the loader falls back to llvmpipe), so ANGLE-on-Vulkan wouldn't be a real GPU there. A
  newer driver, or Chromium on EGL, would be needed.
- **devbox:** an LXD container on triton's nearly full boot NVMe; the triton-ci runner already uses triton's CPUs.
- **RCH in CI:** RCH dispatches from the Mac's daemon; job containers have no `rch`. CI's Rust stays on the runners'
  warm `/cargo-cache` target dirs instead.
