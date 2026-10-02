#!/usr/bin/env python3
"""Cloudflare Realtime TURN spend guard: make sure credential abuse can never cost money.

Cloudflare bills TURN egress at $0.05/GB after a 1,000 GB/month free allowance and offers no hard
spending cap (budget alerts are email-only and a day late). This guard runs once per account
(not per preview), polls TURN egress from the GraphQL analytics API and, well before the free
allowance is used up, **deletes every Jammers TURN key**, which stops credential issuance and
invalidates outstanding credentials. It never re-enables anything: creating a new key is a manual
owner action. Details: docs/infra/turn-and-previews.md ("never get billed").

Environment:
  CF_ACCOUNT_ID, CF_TURN_GUARD_TOKEN   scoped token: Calls Write + Account Analytics Read
  HA_WEBHOOK_URL                       local-only Home Assistant webhook that pushes to the owner
  FREE_GB=1000  NOTIFY_FRACTION=0.25  KILL_FRACTION=0.5  PER_IDENTIFIER_GB_PER_HOUR=2
  INTERVAL_SECONDS=300  KEY_PREFIX=jammers-  STATE_DIR=/state  DRY_RUN=0
Usage: guard.py            run forever
       guard.py --once     one check, print the status JSON, exit (for tests)
"""
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
ENV = os.environ
ACC = ENV["CF_ACCOUNT_ID"]
TOKEN = ENV["CF_TURN_GUARD_TOKEN"]
HOOK = ENV.get("HA_WEBHOOK_URL", "")
FREE_BYTES = float(ENV.get("FREE_GB", "1000")) * 1e9
NOTIFY_AT = float(ENV.get("NOTIFY_FRACTION", "0.25")) * FREE_BYTES
KILL_AT = float(ENV.get("KILL_FRACTION", "0.5")) * FREE_BYTES
PER_ID_HOURLY = float(ENV.get("PER_IDENTIFIER_GB_PER_HOUR", "2")) * 1e9
INTERVAL = int(ENV.get("INTERVAL_SECONDS", "300"))
PREFIX = ENV.get("KEY_PREFIX", "jammers-")
DRY_RUN = ENV.get("DRY_RUN", "0") == "1"
STATE = pathlib.Path(ENV.get("STATE_DIR", "/state")) / "guard.json"
BLIND_AFTER = 3  # consecutive failed checks (15 min at the default interval)


def request(method, url, body=None, auth=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def notify(title, message):
    print(f"NOTIFY {title}: {message}", flush=True)
    if HOOK:
        try:
            request("POST", HOOK, {"title": title, "message": message}, auth=False)
        except Exception as exc:  # alerting must never crash the guard
            print(f"notify failed: {exc!r}", flush=True)


def gql(query, variables):
    out = request("POST", f"{API}/graphql", {"query": query, "variables": variables})
    if out.get("errors"):
        raise RuntimeError(f"graphql errors: {out['errors']}")
    return out["data"]["viewer"]["accounts"][0]


SUM_Q = """query($acc:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$acc}){
  callsTurnUsageAdaptiveGroups(filter:{datetimeMinute_geq:$s,datetimeMinute_lt:$e},limit:1){sum{egressBytes}}}}}"""
TOP_Q = """query($acc:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$acc}){
  callsTurnUsageAdaptiveGroups(filter:{datetimeMinute_geq:$s,datetimeMinute_lt:$e},limit:5,
    orderBy:[sum_egressBytes_DESC]){dimensions{customIdentifier}sum{egressBytes}}}}}"""


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def egress(start, end):
    rows = gql(SUM_Q, {"acc": ACC, "s": iso(start), "e": iso(end)})["callsTurnUsageAdaptiveGroups"]
    return float(rows[0]["sum"]["egressBytes"]) if rows else 0.0


def rolling_31_days(now, state):
    """Sum egress over 31 days in daily windows; days older than 2 days are cached."""
    cache = state.setdefault("day_cache", {})
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    total = 0.0
    for back in range(31, -1, -1):
        day = today - dt.timedelta(days=back)
        key = day.strftime("%Y-%m-%d")
        if back >= 2 and key in cache:
            total += cache[key]
            continue
        end = min(day + dt.timedelta(days=1), now)
        value = egress(day, end)
        if back >= 2:
            cache[key] = value
        total += value
    for key in list(cache):  # forget days that fell out of the window
        if key < (today - dt.timedelta(days=32)).strftime("%Y-%m-%d"):
            del cache[key]
    return total


def top_identifiers(now):
    rows = gql(TOP_Q, {"acc": ACC, "s": iso(now - dt.timedelta(hours=1)), "e": iso(now)})["callsTurnUsageAdaptiveGroups"]
    return [((r["dimensions"] or {}).get("customIdentifier") or "(none)", float(r["sum"]["egressBytes"])) for r in rows]


def jammers_keys():
    out = request("GET", f"{API}/accounts/{ACC}/calls/turn_keys")
    return [k for k in out.get("result") or [] if (k.get("name") or "").startswith(PREFIX)]


def kill(state, reason):
    keys = jammers_keys()
    deleted = []
    for k in keys:
        if DRY_RUN:
            deleted.append(f"(dry-run) {k['name']}")
            continue
        request("DELETE", f"{API}/accounts/{ACC}/calls/turn_keys/{k['uid']}")
        deleted.append(k["name"])
    state["killed"] = {"at": iso(dt.datetime.now(dt.timezone.utc)), "reason": reason, "keys": deleted}
    notify("Jammers TURN guard: Cloudflare TURN DISABLED",
           f"{reason}. Deleted TURN keys: {', '.join(deleted) or 'none'}. Self-hosted TURN still works. "
           "Re-enable only by creating a new key by hand.")


def check(state):
    now = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
    keys = jammers_keys()
    total = rolling_31_days(now, state)
    top = top_identifiers(now)
    status = {"at": iso(now), "keys": [k["name"] for k in keys], "egress_31d_gb": round(total / 1e9, 3),
              "notify_at_gb": NOTIFY_AT / 1e9, "kill_at_gb": KILL_AT / 1e9,
              "top_1h": [(i, round(b / 1e9, 4)) for i, b in top], "dry_run": DRY_RUN}
    if keys and total >= KILL_AT:
        kill(state, f"31-day TURN egress {total / 1e9:.1f} GB reached the kill threshold ({KILL_AT / 1e9:.0f} GB)")
    elif keys and top and top[0][1] >= PER_ID_HOURLY:
        kill(state, f"credential tag {top[0][0]} used {top[0][1] / 1e9:.2f} GB in the last hour")
    elif total >= NOTIFY_AT and not state.get("notified_level"):
        state["notified_level"] = iso(now)
        notify("Jammers TURN guard: usage warning",
               f"Cloudflare TURN egress is {total / 1e9:.1f} GB over 31 days (alert at {NOTIFY_AT / 1e9:.0f} GB, "
               f"automatic shut-off at {KILL_AT / 1e9:.0f} GB of the {FREE_BYTES / 1e9:.0f} GB free allowance).")
    elif total < NOTIFY_AT * 0.8:
        state.pop("notified_level", None)
    return status


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(STATE)


def main():
    once = "--once" in sys.argv
    state = load_state()
    failures = 0
    while True:
        try:
            status = check(state)
            failures = 0
            state.pop("blind_notified", None)
            print(json.dumps(status), flush=True)
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, KeyError, ValueError) as exc:
            failures += 1
            print(f"check failed ({failures}): {exc!r}", flush=True)
            if failures >= BLIND_AFTER and not state.get("blind_notified"):
                state["blind_notified"] = True
                notify("Jammers TURN guard: BLIND",
                       f"The spend guard has failed {failures} checks in a row ({exc!r}). It cannot see TURN usage; "
                       "check the jammers-turn-guard app on TrueNAS.")
        save_state(state)
        if once:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
