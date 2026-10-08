"""Deploys the Cloudflare TURN credential broker (P1-N04b) as the TrueNAS app `jammers-turn-broker` (R117: from Gitea
Actions only, .gitea/workflows/deploy-turn-broker.yml). Design and limits: docs/infra/turn-and-previews.md.

The app runs the same `jj-server` image as the previews, by digest, with JJ_ROLE=turn-broker, on the internal
`jammers-previews` network only (no port, no edge route, no tunnel): previews reach it as
http://jammers-turn-broker:8080. It alone holds the Cloudflare TURN key; previews get only their per-id HMAC
(infra/previews/scripts/publish.py `backend_secret`).

  python3 infra/turn-broker/deploy.py [--digest sha256:…] [--cloudflare off] [--plan]
    --digest      image digest (default: the newest playable preview's, from the git record)
    --cloudflare  off: deploy without the Cloudflare variables (the broker answers 503 relay-unavailable; the kill
                  switch short of removing the app)
    --plan        print the compose with secrets redacted; touch nothing
Secrets (env, from the workflow): TRUENAS_APPS_WRITE_KEY, JJ_BROKER_KEY, CF_TURN_KEY_ID, CF_TURN_KEY_API_TOKEN,
GITEA_TOKEN (to read the record when --digest is absent).
"""

import asyncio
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "previews" / "scripts"))

APP = "jammers-turn-broker"
IMAGE = "127.0.0.1:3001/cdilga/jj-server"
NETWORK = "jammers-previews"


def arg(name: str, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else default


def compose(digest: str, env: dict) -> dict:
    return {
        "services": {"broker": {
            "image": f"{IMAGE}@{digest}",
            "container_name": APP,
            "restart": "unless-stopped",
            "environment": env,
            "networks": ["previews"],
            "read_only": True,
            "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"],
            "mem_limit": "128m",
            "pids_limit": 128,
        }},
        "networks": {"previews": {"external": True, "name": NETWORK}},
    }


def broker_env(cloudflare: bool, secrets: dict) -> dict:
    env = {"JJ_ROLE": "turn-broker", "JJ_BIND": "0.0.0.0:8080", "JJ_BROKER_KEY": secrets["JJ_BROKER_KEY"]}
    if cloudflare:
        env["CF_TURN_KEY_ID"] = secrets["CF_TURN_KEY_ID"]
        env["CF_TURN_KEY_API_TOKEN"] = secrets["CF_TURN_KEY_API_TOKEN"]
    return env


def newest_playable_digest() -> str:
    import record
    for p in record.load()["previews"]:
        if p.get("status") == "playable" and not p.get("retired") and p.get("digest"):
            print(f"broker: image of preview {p['id']} ({p['sha'][:12]})")
            return p["digest"]
    raise SystemExit("broker: no playable preview to take the image from; pass --digest")


async def main():
    cloudflare = arg("--cloudflare", "on") != "off"
    digest = arg("--digest") or newest_playable_digest()
    names = ["JJ_BROKER_KEY"] + (["CF_TURN_KEY_ID", "CF_TURN_KEY_API_TOKEN"] if cloudflare else [])
    if "--plan" in sys.argv:
        print(json.dumps(compose(digest, broker_env(cloudflare, {k: "<redacted>" for k in names})), indent=1))
        return
    missing = [k for k in names + ["TRUENAS_APPS_WRITE_KEY"] if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"broker: secret(s) missing: {', '.join(missing)}")
    from truenas import TrueNAS
    c = compose(digest, broker_env(cloudflare, {k: os.environ[k] for k in names}))
    async with TrueNAS(os.environ["TRUENAS_APPS_WRITE_KEY"]) as nas:
        if APP in await nas.apps(APP):
            await nas.job("app.update", [APP, {"custom_compose_config": c}])
            print(f"broker: {APP} updated to {digest} (cloudflare {'on' if cloudflare else 'off'})")
        else:
            await nas.job("app.create", [{"app_name": APP, "custom_app": True, "custom_compose_config": c}])
            print(f"broker: {APP} created at {digest} (cloudflare {'on' if cloudflare else 'off'})")
        for _ in range(60):
            state = (await nas.apps(APP)).get(APP)
            if state == "RUNNING":
                print("broker: RUNNING")
                return
            await asyncio.sleep(2)
        raise SystemExit(f"broker: {APP} is {state}, not RUNNING")


if __name__ == "__main__":
    asyncio.run(main())
