"""TrueNAS middleware over its JSON-RPC 2.0 WebSocket API, as the Jammers deploy identity (P1-D03/D04).

The key is the `jammersdeploy` user's (privilege: APPS_WRITE only). TrueNAS revokes an API key that's ever sent over
plain HTTP, so this only speaks wss. The appliance's certificate is self-signed; it's pinned by SHA-256 when
TRUENAS_CERT_SHA256 is set, otherwise accepted on the LAN address only.
"""

import asyncio
import hashlib
import json
import os
import ssl

import websockets

URL = os.environ.get("TRUENAS_URL", "wss://192.168.11.12:20443/api/current")


class TrueNAS:
    def __init__(self, key: str):
        self.key = key
        self.ws = None
        self.next_id = 0

    async def __aenter__(self):
        ctx = ssl._create_unverified_context()  # self-signed appliance cert, pinned below when configured
        self.ws = await websockets.connect(URL, ssl=ctx, open_timeout=15, max_size=2**24)
        pin = os.environ.get("TRUENAS_CERT_SHA256")
        if pin:
            cert = self.ws.transport.get_extra_info("ssl_object").getpeercert(binary_form=True)
            if hashlib.sha256(cert).hexdigest() != pin.lower():
                raise SystemExit("truenas: certificate fingerprint mismatch")
        if await self.call("auth.login_with_api_key", [self.key]) is not True:
            raise SystemExit("truenas: API key login refused")
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()

    async def call(self, method: str, params: list | None = None):
        self.next_id += 1
        ident = self.next_id
        await self.ws.send(json.dumps({"jsonrpc": "2.0", "id": ident, "method": method, "params": params or []}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") != ident:
                continue  # notifications (job progress) and other replies
            if "error" in msg:
                err = msg["error"]
                raise RuntimeError(f"{method}: {err.get('message')} {json.dumps(err.get('data', {}))[:600]}")
            return msg.get("result")

    async def job(self, method: str, params: list | None = None, timeout_s: int = 600):
        """Calls a job method and waits for it; returns its result or raises with its error."""
        jid = await self.call(method, params)
        for _ in range(timeout_s):
            jobs = await self.call("core.get_jobs", [[["id", "=", jid]]])
            if jobs and jobs[0]["state"] in ("SUCCESS", "FAILED", "ABORTED"):
                j = jobs[0]
                if j["state"] != "SUCCESS":
                    raise RuntimeError(f"{method} job {jid} {j['state']}: {j.get('error')}")
                return j.get("result")
            await asyncio.sleep(1)
        raise RuntimeError(f"{method} job {jid} timed out")

    async def apps(self, prefix: str = ""):
        rows = await self.call("app.query", [[], {"select": ["name", "state"]}])
        return {r["name"]: r["state"] for r in rows if r["name"].startswith(prefix)}
