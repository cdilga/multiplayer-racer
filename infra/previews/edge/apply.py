"""Applies the edge (edge/Caddyfile, edge/index.html) to the TrueNAS app jammers-preview-edge through the middleware.

The app's compose is replaced wholesale (app.update replaces each top-level key it's given), so this always sends the
complete compose: Caddy on :30290, the POC mirror read-only, and the shared jammers-previews network (owned by the
jammers-net app) so /p/<id>/ reaches container jjp-<id>.
  python3 edge/apply.py            # through `ssh truenas midclt` (an admin on the Mac)
"""
import json, pathlib, subprocess

HERE = pathlib.Path(__file__).resolve().parent


def compose() -> dict:
    return {
        "configs": {
            "caddyfile": {"content": (HERE / "Caddyfile").read_text()},
            "index_html": {"content": (HERE / "index.html").read_text()},
        },
        "services": {"edge": {
            "image": "caddy:2.11.4-alpine",
            "restart": "unless-stopped",
            "ports": ["30290:80"],
            "configs": [
                {"source": "caddyfile", "target": "/etc/caddy/Caddyfile", "mode": 292},
                {"source": "index_html", "target": "/srv/index/index.html", "mode": 292},
            ],
            "volumes": [{"type": "bind", "source": "/mnt/vessel/apps/jammers-preview-poc", "target": "/srv/ui", "read_only": True}],
            "networks": ["previews"],
        }},
        "networks": {"previews": {"external": True, "name": "jammers-previews"}},
    }


if __name__ == "__main__":
    payload = json.dumps({"custom_compose_config": compose()})
    q = "'" + payload.replace("'", "'\\''") + "'"
    r = subprocess.run(["ssh", "truenas", f"sudo -n midclt call -j app.update jammers-preview-edge {q}"], capture_output=True, text=True)
    print(r.returncode, (r.stdout + r.stderr)[-300:])
