"""Applies the edge (edge/Caddyfile, edge/index.html) to the TrueNAS app jammers-preview-edge through the middleware.

The app's compose is replaced wholesale (app.update replaces each top-level key it's given), so this always sends the
complete compose: Caddy on :30290, the POC mirror read-only, the preview index folder read-only, and the shared
jammers-previews network (owned by the jammers-net app) so /p/<id>/ reaches container jjp-<id>.

The index page is a file in INDEX_DIR on TrueNAS, not part of the compose: the middleware's messages stop at 64 kB, and
the index grows with every live preview (25 previews overflowed it on 2026-10-17, so the edge stopped updating).
`write_index` puts it there; the publisher does it through the runner's Docker socket (`publish.write_index`).
  python3 edge/apply.py            # through `ssh truenas midclt` (an admin on the Mac)
"""
import json, pathlib, subprocess

HERE = pathlib.Path(__file__).resolve().parent
# The preview index on TrueNAS, served at / by the edge (bind-mounted read-only at /srv/index).
INDEX_DIR = "/mnt/vessel/apps/jammers-preview-index"


def compose() -> dict:
    return {
        "configs": {
            "caddyfile": {"content": (HERE / "Caddyfile").read_text()},
        },
        "services": {"edge": {
            "image": "caddy:2.11.4-alpine",
            "restart": "unless-stopped",
            "ports": ["30290:80"],
            "configs": [
                {"source": "caddyfile", "target": "/etc/caddy/Caddyfile", "mode": 292},
            ],
            "volumes": [
                {"type": "bind", "source": "/mnt/vessel/apps/jammers-preview-poc", "target": "/srv/ui", "read_only": True},
                {"type": "bind", "source": INDEX_DIR, "target": "/srv/index", "read_only": True},
            ],
            "networks": ["previews"],
        }},
        "networks": {"previews": {"external": True, "name": "jammers-previews"}},
    }


if __name__ == "__main__":
    index = (HERE / "index.html").read_bytes()
    w = subprocess.run(["ssh", "truenas", f"sudo -n sh -c 'mkdir -p {INDEX_DIR} && cat > {INDEX_DIR}/index.html.tmp && mv {INDEX_DIR}/index.html.tmp {INDEX_DIR}/index.html'"],
                       input=index, capture_output=True)
    print("index", w.returncode, (w.stdout + w.stderr)[-300:].decode(errors="replace"))
    payload = json.dumps({"custom_compose_config": compose()})
    q = "'" + payload.replace("'", "'\\''") + "'"
    r = subprocess.run(["ssh", "truenas", f"sudo -n midclt call -j app.update jammers-preview-edge {q}"], capture_output=True, text=True)
    print(r.returncode, (r.stdout + r.stderr)[-300:])
