"""The preview index at https://jammers-preview.dilger.dev/ (P1-D05), rendered from the git record (scripts/record.py).

Newest first, pinned builds on top (`pin/<id>` tags; a pin's label such as "Playtest 1" shows on its card). Per preview:
  Build        id, branch, short commit, time (shown in the viewer's local time)
  What it is   the commit's one-line title and a "What changed" disclosure (commits since the previous preview)
  Status       "Smoke passed: <steps>", or "Not playable" with the reason; never a claim for a step that didn't run
  Keep         pinned / latest / one of the 3 newest / expires in Xh (counted down in the browser from the 24 h age limit),
               and a Pin or Unpin link to the Retention workflow's run form on Gitea (owner sign-in; scripts/preview-pin.sh
               does the same from a shell)
  Open         Host and Join (on the preview's own base path; a build that failed its smoke gets small "Try … anyway" links
               under a "probably not playable" warning instead) and its CI run as evidence
Retired previews sit below, greyed, with the reason they were retired. Styled from edge/tokens.json (a copy of the
game's UI token file: swap it for the accepted set and re-render, no template change).
"""

import html
import json
import pathlib
from datetime import datetime, timezone

import retention

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "edge" / "tokens.json"
FONT_BASE = "/"  # the edge serves the design mirror (fonts/…) at the site root
PIN_FORM = "https://git.dilger.dev/cdilga/multiplayer-racer/actions?workflow=deploy-retention.yml"


def tokens() -> dict:
    return json.loads(TOKENS.read_text())


def style(t: dict) -> str:
    pal = t["palette"]
    vars_ = "".join(f"--{k}:{v['hex']};" for k, v in pal.items())
    faces = ""
    for role in ("display", "body"):
        f = t["fonts"][role]
        for file in f["files"]:
            faces += (f"@font-face{{font-family:'{f['family']}';font-weight:{file['weight']};font-style:{file['style']};"
                      f"font-display:swap;src:url('{FONT_BASE}{file['file']}') format('woff2');}}")
    fallback = ", ".join(t["fonts"]["fallback"])
    ink_w = t["ink"]["outlinePx"]["desk"]
    shadow_y = t["ink"]["stickerShadow"]["y"]
    return faces + f"""
  :root {{ {vars_} --display:'{t['fonts']['display']['family']}', {fallback}; --body:'{t['fonts']['body']['family']}', {fallback}; --line:{ink_w}px; --lift:{shadow_y}px; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--paper-shade); color:var(--ink); font:500 17px/1.45 var(--body); padding:16px; }}
  main {{ max-width:960px; margin:0 auto; }}
  h1 {{ margin:10px 0 4px; font:900 clamp(34px,7vw,56px)/1 var(--display); text-transform:uppercase; letter-spacing:.5px; }}
  h1 span {{ color:var(--red-earth); }}
  h2 {{ font:800 22px/1.2 var(--display); text-transform:uppercase; margin:28px 0 4px; color:var(--ink-soft); }}
  .tag {{ display:inline-block; background:var(--saffron); border:var(--line) solid var(--ink); border-radius:8px; padding:1px 10px; font:800 15px/1.5 var(--display); text-transform:uppercase; transform:rotate(-1.2deg); }}
  .card {{ border:var(--line) solid var(--ink); border-radius:14px; background:var(--paper); padding:14px 16px; margin:16px 0; box-shadow:0 var(--lift) 0 rgba(21,32,58,.85); display:grid; gap:10px 20px; grid-template-columns:minmax(0,1.1fr) minmax(0,1.5fr) minmax(0,1fr); }}
  .card.pinned {{ border-color:var(--red-earth); }}
  .card.retired {{ opacity:.7; background:var(--paper-shade); box-shadow:none; }}
  .card h3 {{ margin:0 0 2px; font:800 13px/1.2 var(--display); text-transform:uppercase; letter-spacing:.8px; color:var(--ink-soft); }}
  .wide {{ grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:10px; align-items:center; }}
  .id {{ font:800 22px/1.1 var(--display); }}
  code {{ font-size:.9em; }}
  .ok {{ color:var(--success); font-weight:700; }} .bad {{ color:var(--danger); font-weight:700; }}
  .why {{ background:var(--danger-tint); border-radius:8px; padding:6px 10px; margin:4px 0 0; }}
  .good {{ background:var(--success-tint); border-radius:8px; padding:6px 10px; margin:4px 0 0; }}
  .muted {{ color:var(--ink-soft); }}
  details {{ margin-top:6px; }} summary {{ cursor:pointer; font-weight:700; color:var(--cobalt-deep); min-height:32px; }}
  ul.changed {{ margin:6px 0 0; padding-left:20px; }}
  a.btn {{ display:inline-flex; align-items:center; min-height:48px; padding:0 18px; border:var(--line) solid var(--ink); border-radius:10px; background:var(--saffron); color:var(--ink); font:800 18px/1 var(--display); text-transform:uppercase; text-decoration:none; }}
  a.btn.alt {{ background:var(--paper); }}
  a.ev {{ color:var(--cobalt-deep); font-weight:700; }}
  a:focus-visible, summary:focus-visible {{ outline:3px solid var(--cobalt); outline-offset:2px; }}
  @media (max-width:720px) {{ .card {{ grid-template-columns:1fr; }} body {{ padding:12px; }} }}
"""


def parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts) if ts else None


def time_tag(ts: str | None) -> str:
    if not ts:
        return ""
    return f'<time data-local datetime="{html.escape(ts)}">{html.escape(ts.replace("T", " ").replace("+00:00", " UTC"))}</time>'


def keep_html(p: dict, pinned_by: list[str], is_latest: bool, keep: set[str], newest: set[str], now: datetime) -> str:
    if p.get("retired"):
        return f'<span class="muted">Retired {time_tag(p["retired"])}</span>'
    out = []
    if pinned_by:
        out.append("<b>\U0001F4CC Pinned</b>: kept until unpinned")
    if is_latest:
        out.append("<b>Latest</b>: kept while it is the newest")
    if not out:
        published = parse(p.get("publishedAt"))
        if p["id"] in newest:
            out.append(f"<b>{retention.NEWEST_KEPT} newest</b>: kept until {retention.NEWEST_KEPT} newer builds are up and it is 24 h old")
        elif p["id"] in keep and published:
            left = retention.MAX_AGE - (now - published)
            hours = max(0, left.total_seconds()) / 3600
            iso = (published + retention.MAX_AGE).isoformat(timespec="seconds")
            out.append(f'Expires <span data-expires="{iso}">in {hours:.0f} h</span>')
        else:
            out.append("Retires at the next publish")
    pid = html.escape(p["id"])
    if pinned_by:
        out.append(f'<a class="ev" href="{PIN_FORM}" title="Run workflow with unpin = {pid}">Unpin</a> <span class="muted">(unpin = <code>{pid}</code>)</span>')
    else:
        out.append(f'<a class="ev" href="{PIN_FORM}" title="Run workflow with pin = {pid}">\U0001F4CC Pin</a> <span class="muted">(pin = <code>{pid}</code>)</span>')
    return "<br>".join(out)


def status_html(p: dict) -> str:
    if p.get("retired"):
        return f'<span class="bad">Retired</span><div class="why">{html.escape(p.get("retiredReason", "Retired by the retention policy."))}</div>'
    if p.get("status") == "playable":
        steps = ", ".join(p.get("smoke", []))
        when = f" {time_tag(p['smokedAt'])}" if p.get("smokedAt") else ""
        return f'<span class="ok">Smoke passed</span><div class="good">Ran: {html.escape(steps)}.{when}</div>'
    return f'<span class="bad">Not playable</span><div class="why">{html.escape(p.get("reason") or "No reason recorded.")}</div>'


def changed_html(p: dict) -> str:
    items = p.get("changed") or []
    if not items:
        return '<details><summary>What changed</summary><p class="muted">No change list recorded (first preview, or the compare failed).</p></details>'
    lis = "".join(f"<li>{html.escape(title_text(c))}</li>" for c in items)
    return f'<details><summary>What changed ({len(items)} commit{"s" if len(items) != 1 else ""})</summary><ul class="changed">{lis}</ul></details>'


def open_html(p: dict) -> str:
    base = f"/p/{html.escape(p['id'])}/"
    links = []
    if p.get("status") == "playable" and not p.get("retired"):
        links.append(f'<a class="btn" href="{base}host">Host</a><a class="btn alt" href="{base}">Join</a>')
    elif not p.get("retired"):
        # Still deployed: open it anyway, but it failed its smoke, so the links say so and stay small.
        links.append(f'<span class="bad">Failed its smoke, probably not playable:</span>'
                     f'<a class="ev" href="{base}host">Try Host anyway</a><a class="ev" href="{base}">Try Join anyway</a>')
    if p.get("ciRun"):
        # Gitea reports run URLs on its LAN address; the page is public, so link the public host.
        ci = p["ciRun"].replace("http://192.168.11.12:3001/", "https://git.dilger.dev/")
        links.append(f'<a class="ev" href="{html.escape(ci)}">CI run (evidence)</a>')
    return "".join(links) or '<span class="muted">No links</span>'


def title_text(t: str) -> str:
    """Titles recorded before the publisher cut at a word (exactly 200 characters, cut mid-word) end at a word here."""
    if len(t) >= 200 and not t.endswith("…"):
        return t[:200].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return t


def card(p: dict, pinned_by: list[str], is_latest: bool, keep: set[str], newest: set[str], now: datetime) -> str:
    tags = "".join(f'<span class="tag">{html.escape(label)}</span> ' for label in pinned_by + (["Latest"] if is_latest else []))
    cls = "card" + (" pinned" if pinned_by else "") + (" retired" if p.get("retired") else "")
    branch = html.escape(p.get("branch", ""))
    sha = html.escape(p.get("sha", "")[:12])
    return (f'<article class="{cls}" id="{html.escape(p["id"])}">'
            f'<div class="wide">{tags}<span class="id">{html.escape(p["id"])}</span></div>'
            f'<div><h3>Build</h3>{branch + " " if branch else ""}<code>{sha}</code><br>{time_tag(p.get("publishedAt"))}</div>'
            f'<div><h3>What it is</h3>{html.escape(title_text(p.get("title", ""))) or "<span class=muted>No title</span>"}{changed_html(p)}</div>'
            f'<div><h3>Status</h3>{status_html(p)}</div>'
            f'<div><h3>Keep</h3>{keep_html(p, pinned_by, is_latest, keep, newest, now)}</div>'
            f'<div class="wide"><h3 style="margin:0">Open</h3>{open_html(p)}</div></article>')


SCRIPT = """
(() => {
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  document.querySelectorAll('time[data-local]').forEach((t) => { const d = new Date(t.dateTime); if (!isNaN(d)) t.textContent = fmt.format(d); });
  const tick = () => document.querySelectorAll('[data-expires]').forEach((e) => {
    const ms = new Date(e.dataset.expires) - Date.now();
    e.textContent = ms <= 0 ? 'at the next publish' : ms < 5400e3 ? 'in ' + Math.max(1, Math.round(ms / 60e3)) + ' min' : 'in ' + Math.round(ms / 3600e3) + ' h';
  });
  tick(); setInterval(tick, 60e3);
})();
"""


def render(reg: dict, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    previews = reg.get("previews", [])
    pins = set(reg.get("pins", []))
    labels: dict[str, list[str]] = {}
    for label, pid in reg.get("labels", {}).items():
        if label != "Latest":
            labels.setdefault(pid, []).append(label)
    latest = reg.get("labels", {}).get("Latest")
    keep = retention.keep_set(reg, now) if previews else set()
    newest = {p["id"] for p in retention.newest_unpinned(reg)[:retention.NEWEST_KEPT]}

    def pinned_by(p):
        return labels.get(p["id"], []) or (["Pinned"] if p["id"] in pins else [])

    live = [p for p in previews if not p.get("retired")]
    gone = [p for p in previews if p.get("retired")]
    top = [p for p in live if p["id"] in pins or p["id"] in labels]
    rest = [p for p in live if p not in top]
    body = "".join(card(p, pinned_by(p), p["id"] == latest, keep, newest, now) for p in top + rest)
    if not body:
        body = '<article class="card"><div class="wide"><strong>No previews yet.</strong> Every 0.2 build that passes CI lands here.</div></article>'
    if gone:
        body += "<h2>Retired</h2>" + "".join(card(p, [], False, keep, newest, now) for p in gone)
    return f"""<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jammers previews</title><style>{style(tokens())}</style></head>
<body><main><div class="tag">Rainbow previews</div><h1>Joystick <span>Jammers</span> 0.2</h1>
<p>Every 0.2 build that passes CI lands here, newest first, pinned builds on top. Open <b>Host</b> on the TV or laptop, then scan its QR with your phones. A build that fails its smoke test is listed as not playable, with the reason. The {retention.NEWEST_KEPT} newest builds always stay up, and so does anything under 24 hours old; pinned builds stay until unpinned.</p>
{body}
<p><small class="muted">The game you can play today is 0.1 at <a href="https://jammers.dilger.dev">jammers.dilger.dev</a>. The design POC is at <a href="/poc/">/poc/</a>.</small></p>
</main><script>{SCRIPT}</script></body></html>
"""


if __name__ == "__main__":
    import record
    reg = record.load()
    (ROOT / "edge" / "index.html").write_text(render(reg))
    print("edge/index.html rendered")
