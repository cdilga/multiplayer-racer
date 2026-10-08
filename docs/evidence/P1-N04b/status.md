# P1-N04b status (2026-10-08, BrownCreek): the live Cloudflare run waits for the broker

The two `ev:hardware` items:
- **The one controlled live run** (a controller with `iceTransportPolicy: "relay"` and coturn unreachable fires the
  fallback and connects through Cloudflare, once restricted to the TLS-443 entry; the issued tag shows in the guard's
  per-tag listing) needs a deployed TURN broker: `JJ_ROLE=turn-broker` is the only process allowed to hold
  `CF_TURN_KEY_ID`/`CF_TURN_KEY_API_TOKEN`, and `docs/infra/turn-and-previews.md` ("Deploying the broker") lists what
  isn't deployed: the TrueNAS app `jammers-turn-broker` on `jammers-previews` with no public route, a new
  `JJ_BROKER_KEY`, and the deploy repo's `JJ_BROKER_SECRET` injection. Doing the run without that deployment would mean
  copying the Cloudflare key to another machine, which this run must not do (R92: issued credentials can't be revoked).
- **The guard dry-run against a synthetic breach**: done 2026-10-07, `guard-dry-run.txt` (alerts and would delete
  `jammers-fallback`).

Next step: deploy the broker as written (owner or the deploy repo through `midclt app.create`), publish a preview with
`JJ_BROKER_URL`/`JJ_BROKER_SECRET`, then run the controller once from eris with `?ice=relay`, coturn blocked, and
`--only-url turns:…:443`, and list the tag with `tools/turn-guard/guard.py`. One issuance, then the receipt here.
