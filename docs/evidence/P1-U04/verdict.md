# P1-U04 (br-p1-u04-cr8): G-DESIGN verdict receipt

**Record:** `docs/playtests/poc-2026-10-07.md` (committed in c1846c9).
**Accepted set:** `art/ui/accepted/2026-10-07/` (`GUIDE.md`, `tokens.json`, `poc/`, `frames/`; frozen from commit
`532617856b88`, per its `README.md`).
**Gallery:** `https://jammers-preview.dilger.dev/poc/`.

## The owner's verdict, quoted from the record

> **Verdict: accepted** by the owner on 2026-10-07, in the solo session (BrownCreek), for the POC as published at
> `https://jammers-preview.dilger.dev/poc/` after rounds 3–5 (br-dim, br-awxz, br-xqho, br-u02 beads closed with their
> visual self-reviews). The voice pick stands as recorded on 2026-10-06 (clones of the owner's own recordings; FrankenTTS
> 0.6B fallback approved).

> **POC7-01** The POC is the accepted design set for Playtest 1; frozen in `art/ui/accepted/2026-10-07/`. No §3a
> decision changed in this round.

> **POC7-02** Still to do, not blocking the verdict (owner): publish the newly re-rendered announcer lines to `/poc/` in
> the "Listen and compare" section, and fix its Listen and compare button (br-5hg4 / P1-A01, the voice session).

> U04 closes once br-5hg4 closes

br-5hg4 closed on 2026-10-07 (receipt `docs/evidence/P1-A01b/receipt.md`, "live /poc/audio/voice/ verified").

## Acceptance, item by item

| AC | Covered by |
|---|---|
| 1. Every `gate:g-design` bead closed with its self-review; owner reviewed the republished gallery after them | `br list --label gate:g-design --all` on 2026-10-07: all 24 closed (br-dim.1–3, .5–.12; br-awxz, .1–.3; br-xqho, .1–.4; br-u02-qr-list-space-jdc; br-u02-grid-visual-phone-d4g; br-5hg4; br-ftts-rider-83r5). The record states the verdict is for the gallery "after rounds 3–5". |
| 2. [ev:owner] Round record shows acceptance, with any §3a changes | The record: "Verdict: accepted"; POC7-01 "No §3a decision changed in this round." |
| 3. [ev:owner] Accepted set committed under `art/ui/accepted/<date>/`; gallery live at `/poc/` | `art/ui/accepted/2026-10-07/` (c1846c9). Link check of the live gallery on 2026-10-07: every linked page opens (`live-check.log`, below). |
| 4. Visual self-review committed | `docs/evidence/P1-U04/self-review.md`, with the screenshots it names. |
| 5. [ev:owner] Audio reviewed: engine synth and announcer voice | Voice: the record ("The voice pick stands as recorded on 2026-10-06 … FrankenTTS 0.6B fallback approved") and `docs/playtests/owner-checklists.md` §1 ("Announcer voice: approved 2026-10-06"). Engine synth: reviewed by the owner in round 1 (`docs/playtests/poc-2026-10-03.md`, POC1-02, start/stop sounds, R103) and part of the POC "as published" that was accepted. |

## Gaps in the paper trail (stated, not filled in)

- The AC names `docs/playtests/poc-2026-10-06.md` as where the voice pick is recorded; that file does not exist. The
  2026-10-06 approval is recorded in `docs/playtests/owner-checklists.md` §1 and restated in the 2026-10-07 record.
- The engine synth box in `docs/playtests/owner-checklists.md` §1 is still unticked; the 2026-10-07 record does not name
  the synth separately.

## Gallery link check (required test)

`ERIS_MIN=c909059 scripts/remote/eris.sh --run u04-gallery 'node art/ui/lib/live-check.mjs --viewports
412x915,915x412,1366x768,1920x1080 --fullscreen /poc/ /poc/guide.html /poc/tv/ /poc/phone/ /poc/world/ /poc/motion/
/poc/motion/side.html /poc/audio/engine/ /poc/audio/voice/ /sheets/brand.html /sheets/components.html /sheets/cvd.html
/sheets/fonts.html'` (eris, Playwright Chromium, against the live preview). All 13 linked pages load at all 4 viewports,
before and after a resize; no 4xx/5xx responses (the index's one "request failed" is its `has()` probe of
`/poc/audio/engine/index.html`, which answers 200 on its own and whose "Play the engine" button renders). Exit 1 from layout findings, judged in `self-review.md`. Full output:
`docs/evidence/P1-U04/live-check.log`.
