# Joystick Jammers — Gap Design: Accounts, Identity & Monetization

> **Status:** v1 design — fills the **GAP** left by `feedback-design-pass.md` §11.6 (Theme I, To-Do
> items **1** "pay once for offline, $6/mo for online" and **3** "account system?"). The parent plan
> only *sketches* this strand ("anonymous device token → optional account", `FB-account` / `FB-monetize`
> beads) and explicitly defers the real design to a human product call (§14 #6, #7). This document is
> that design.
>
> **Method (same Jeff Emanuel workflow as the parent):** front-load reasoning, ground every claim in
> current state or an explicit assumption, give *options* with trade-offs and a recommendation per
> item, make each item testable, and **flag every decision that is a business/human call** rather than
> an engineering one. Money, tax, and chargeback liability are heavy on human calls — they are marked
> **⚖︎ DECISION** inline and gathered in §8.
>
> **Scope guard.** This is a *separate product track that runs AFTER gameplay polish* (parent §13 Wave
> 4, after the items everyone actually feels). §7 says exactly what minimal identity work the gameplay
> needs *now* (almost nothing beyond the token that already exists in the game-modes plan) and what is
> deferred. Do **not** let this block the camera/physics/onboarding work.
>
> **Owner decision locked 2026-06-29:** no paid work yet. Do not implement paid accounts,
> subscriptions, payment flows, offline-storefront SKUs, hosted-online gates, or cosmetic store work in
> the current phase. Allowed now: anonymous durable device token, local preferences/reconnect, and clean
> seams so a future account can own multiple device tokens.
>
> **How to read:** §1 grounds the problem in current state. §2 is the identity ladder. §3 is the
> entitlement/SKU model. §4 is payment integration. §5 is chargeback risk (the owner's named fear).
> §6 is the bead breakdown that refines `FB-account`/`FB-monetize`. §7 is sequencing. §8 is the
> human/business decisions. §9 is the honest list of what is unverified.

---

## 1. Problem (grounded in current state)

**What exists today.**
- **No identity beyond a per-room socket.** Players are ephemeral: a monotonic `player_id` per room,
  a `reconnect_id` in `sessionStorage` (game-modes §4.4). The game-modes plan adds a **durable
  per-device token** `jammers_player_token` in `localStorage`, server-keyed and **scoped by
  `{token, room_code}`**, treated as opaque (game-modes §4.4, §6.5). That token is the *only* identity
  primitive the codebase will have, and it is **anonymous, per-device, and non-portable** (clear
  browser storage → new player; second device → second identity).
- **No accounts, no login, no email capture, no user DB.** Rooms are in-memory and die on host
  disconnect / server restart (parent §2, game-modes §6.6). There is **nothing persistent server-side
  about a person.**
- **No payment of any kind.** No Stripe, no storefront, no entitlement check, no paywalled feature.
  Everything the game does is free and anonymous.
- **The owner's literal asks** (To-Do items 1 & 3, verbatim flavor): *"account / pay-once-offline /
  $6-mo-online"* and *"account system?"*, plus the standing fear captured in §11.6: **"pay for one
  month, chargeback, kill me."** `IDEAS_NEEDING_REFINEMENT.md` adds the long-horizon wishlist
  (subscription + cosmetics, email accounts + progression, Steam release $5 EA / $15 full, offline
  download, UGC, leaderboards).

**Why this is a gap and not just "add Stripe".** Three things are tangled and must be pulled apart:
1. **Identity** (who is this person, across devices/sessions) — a *prerequisite* for anything paid,
   because an entitlement has to attach to a stable subject, and an anonymous device token is too
   weak to carry money (clear storage and you lose what you paid for).
2. **Entitlement** (what has this subject paid for, and what does that unlock) — the SKU model. The
   owner's "offline = one-time, online = subscription" split is a real architectural fork: those are
   **two different products with two different delivery channels and two different risk profiles.**
3. **Payment + risk** (how money moves, who is the merchant of record, who eats a chargeback). The
   chargeback fear is the load-bearing constraint and it should *shape the SKU model*, not be bolted
   on after.

**Design principles for this strand** (extending the parent's §3, money-specific):
- **P-i. Anonymous-first, account-on-demand.** A no-install party game lives or dies on
  walk-up-and-play (parent §3.1). Never gate *play* behind login. An account is offered **only** at
  the moment it buys the player something (cross-device cosmetics, an entitlement, a purchase
  receipt) — never as an upfront wall.
- **P-ii. The token is the trunk; accounts are a graft.** The durable device token already designed
  in game-modes §4.4 is the root identity. An account *links* tokens; it does not replace them.
  Deleting the account concept entirely must still leave a working game.
- **P-iii. Minimize what we store, and what we are liable for.** Less PII = less breach surface,
  less GDPR/CCPA weight, less to leak. Prefer **OAuth (no password to store)** and **a payment
  processor that is the merchant of record (no card data, ideally no tax liability)**.
- **P-iv. De-risk before you scale.** The chargeback fear is rational at *zero* operating buffer.
  The mitigation is structural: pick channels where **someone else owns the chargeback** (Steam /
  itch / a merchant-of-record), keep direct card exposure tiny, and **don't take recurring money at
  all until the gameplay earns organic demand.**
- **P-v. This track is reversible and deferrable.** Everything here is gated behind a feature flag
  and ships *after* the game is good. If monetization never happens, the only residue is the device
  token (which the gameplay needs anyway) and a clean seam where accounts *could* attach.

---

## 2. Identity ladder

The design is a **three-rung ladder**. Each rung is optional and additive; you only climb when there
is a concrete reason to. Rung 0 already exists (game-modes plan); rungs 1–2 are this gap's `FB-account`.

### 2.1 The ladder

| Rung | Identity | Created when | Carries | Lives where |
|---|---|---|---|---|
| **0. Anonymous device token** *(exists, game-modes §4.4)* | `jammers_player_token` (opaque UUID) | First visit, automatically, no friction | Seat reconnect, per-device cosmetic prefs, the device's *local* entitlement cache | `localStorage` (client) + server per-player state keyed by token, scoped `{token, room_code}` |
| **1. Linked account (optional)** | A stable `account_id` + a verified contact (email or OAuth subject) | Player chooses "Save my stuff / sign in" — offered at purchase, at a cosmetic unlock, or in settings | Cross-device identity: a set of linked device tokens, cosmetic ownership, **entitlements** (the thing they paid for), display name | Server DB (the first persistent user table the project has) |
| **2. Entitlement record** | A row tying an `account_id` (or, for offline, a license key) to a SKU + its source + status | A successful purchase (Stripe / Steam / itch) fires a verified event | What is unlocked, until when (subs), proof of purchase, refund/chargeback status | Server DB; the source-of-truth is always the **payment processor's API**, the DB is a cache |

**The link operation (rung 0 → 1).** When a player signs in, the client presents its current
`jammers_player_token`. The server attaches that token to the resolved `account_id` (creating the
account on first sign-in). One account → many tokens (phone + laptop + the friend's TV they played on
once). On a new device, signing in pulls the account's cosmetics/entitlements down and registers that
device's token under the account. **No merge UI nightmare**: tokens are additive; we never have to
reconcile two *accounts* because a player only ever has one (keyed by the OAuth subject / verified
email). Edge case — a player who bought something anonymously then later makes an account: the
purchase receipt (Stripe `client_reference_id` = the device token, §4.2) lets us *claim* the prior
entitlement into the new account. ⚖︎ DECISION minor: how long do we honor an unclaimed anonymous
entitlement (recommend: indefinitely, it's keyed by an opaque token the buyer still holds).

### 2.2 What's stored, where, and the privacy posture

**Rung 0 (token) — unchanged from game-modes plan.** Opaque random ID, no PII. `localStorage`
(XSS-readable, hence treated as opaque and scoped server-side, game-modes §6.5). No consent banner
needed — it is a functional identifier for reconnect, the kind that is generally exempt from
cookie-consent because it is strictly necessary for the service the user requested. (⚖︎ verify per
jurisdiction if we ever serve the EU at scale, §9.)

**Rung 1 (account) — minimize PII.** Options for the verified contact, in increasing storage burden:
- **Option ID-A — OAuth only (Google / Apple / Discord / GitHub).** We store the **provider subject
  id** (an opaque per-provider user id) + a display name + email *if the provider returns it and the
  user consents*. **We never store a password.** Apple's "Hide My Email" relay is honored. This is
  the **lowest-liability** path — the provider does the auth, the breach surface is "a list of opaque
  ids", and password-reset / credential-stuffing risk is entirely outside our system. Recommended.
- **Option ID-B — email + magic link (passwordless).** We store an email + issue a signed login link;
  no password. Slightly more PII (real emails) and we own the email-deliverability problem, but no
  third-party dependency and works for players who refuse OAuth. Reasonable secondary.
- **Option ID-C — email + password.** **Rejected for v1.** Storing password hashes, building reset
  flows, and carrying credential-stuffing risk is exactly the liability P-iii says to avoid, for a
  party game that doesn't need it.

**What we deliberately do NOT store:** card numbers (Stripe/Steam hold those — we never see a PAN),
real names, addresses (unless a tax/MoR flow forces a billing country — see §4), gameplay telemetry
tied to a person (the `IDEAS` "analytics" strand is a *separate, later, consent-gated* decision, out
of scope here).

**Privacy/compliance baseline** (do this once, cheaply, when rung 1 ships):
- A short **privacy policy** + **terms** page (what we store, why, how to delete). Required by Stripe
  and by the OAuth providers anyway.
- **Account deletion / data export** endpoint (GDPR/CCPA "right to erasure / access"). For this data
  model it is trivial — delete the account row, its token links, its entitlement rows; the payment
  processor retains its own financial records (legally required, and not ours to delete). Build it
  from day one; retrofitting deletion is painful.
- **Data residency / processor list:** Stripe + the OAuth providers + the host are the only
  sub-processors. Keep the list short and documented.

**Recommendation (identity):** **Rung 0 always-on (already planned). Rung 1 = OAuth-first (ID-A),
email magic-link (ID-B) as a fallback, no passwords (reject ID-C). Rung 2 entitlement records keyed
to the account, claimable from an anonymous token.** Build deletion/export with rung 1, not later.

---

## 3. Entitlement model (the SKUs)

The owner's ask — **"pay once for offline, $6/month for online"** — is two distinct products. Name
them precisely and define exactly what each gates, plus the free tier that must remain generous (P-i,
parent §3.1: never block a join on payment).

### 3.1 The three tiers

| SKU | Price (placeholder ⚖︎) | Channel | Merchant of record | What it gates |
|---|---|---|---|---|
| **Free (Local)** | $0 | The hosted web app, no account | n/a | **The whole game, locally.** Walk-up, scan a QR, host on one screen, everyone in the room plays. All modes, all cars (default/recolor cosmetics), no caps. This is the product as it exists today and it **stays free forever** — it is the funnel. |
| **Hosted Online (subscription)** | **$6 / month** (owner's number) | Hosted web app | **Us, via Stripe** (or a MoR — §4.3) | The **convenience of *our* always-on hosted Remote service**: persistent public rooms / deep-link invites over the internet to people not in the room (game-modes Remote mode), our compute hosting the relay, cross-device account + cosmetic sync, maybe larger-scale public matchmaking later. You are paying for *us to run servers for you*, not for game content. |
| **Offline / Self-host (one-time)** | **one-time** (owner: "pay once"; `IDEAS`: $5 EA / $15 full) | **Steam / itch.io** (or direct download) | **The storefront** (Steam/itch) — *not us* | A **downloadable build you run yourself**: host the game on your own LAN/machine forever, no subscription, no dependency on our servers being up. This is the "buy it and own it" SKU. |

**The crucial framing — what is actually being sold.** Online is a **service** (we burn compute and
ops keeping rooms alive on the public internet; recurring cost → recurring price). Offline is a
**good** (a binary you own; one-time cost → one-time price). This is *why* the owner's instinct is
right: subscription for the thing with ongoing cost to us, one-time for the thing with zero ongoing
cost to us. The free Local tier exists because the core experience (one screen, same room) costs us
**nothing** — players bring their own host device — so charging for it would only kill the funnel.

### 3.2 What each SKU literally unlocks (concrete gates)

**Free (Local) — never gated:**
- Host a game on a local big screen; players join over LAN / same network via QR (the current flow).
- Every game mode (race, derby), every track/arena, every default & recolored car, no player cap
  (parent §3.6).
- Anonymous device-token identity, local reconnect, the bug reporter.
- *Optional* rung-1 account for cross-device cosmetic sync (account is free; cosmetics may or may not
  be — see "cosmetics" below).

**Hosted Online subscription gates only the *hosted service*, never content:**
- **Internet Remote hosting on our infrastructure** (game-modes Remote mode): we run the relay so a
  host with friends across the country can play. *Self-hosting the same Remote mode on your own box
  is the offline SKU — same code, different operator.*
- Persistent public room codes / vanity invites, longer host-loss grace, room TTL bumps.
- Account + cosmetic + entitlement **cloud sync** across devices.
- ⚖︎ DECISION: do subscribers get exclusive cosmetics, or is online purely the *service*? Recommend
  **service-only** at v1 (simpler, less "pay-to-win/cosmetic-FOMO" pressure), revisit later.

**Offline / Self-host one-time unlocks the binary:**
- A bundled host+server build (the Flask + dist bundle the repo already produces) the buyer runs on
  their own machine. They get LAN Remote and Local forever, version-locked to what they bought, with
  optional update entitlement (Steam handles this naturally).
- ⚖︎ DECISION: `IDEAS` floats $5 early-access / $15 full. Pricing is a pure business call (§8).

**Cosmetics (the `IDEAS` "subscription + cosmetics" strand) — explicitly deferred.** Cosmetic
ownership *lives in the entitlement model* (rung 2) so the plumbing is ready, but **whether cosmetics
are sold, subscription-bundled, or all-free is a v2 product call**, not a v1 build. The car-identity
work (parent §5.4 `FB-carid`: curated palette, roof numbers) already gives visual variety for free;
do not let a cosmetic store block the game.

### 3.3 Free-tier defensibility (why this won't cannibalize)

The honest tension: if Local is free and forever, *and* the offline build is a one-time purchase that
also does Local + LAN Remote, what does the subscription sell? **Answer: someone else's servers and
the public internet.** Local-free covers "friends in my living room". Offline-buy covers "I want to
own it / run my own server / play on my LAN without the internet". Subscription covers "I don't want
to run a server; host my cross-country game for me on infrastructure that's always up." These are
genuinely different jobs-to-be-done; the free tier is the *funnel*, not a competitor to the paid
tiers. ⚖︎ This segmentation is a hypothesis to validate with real users (§8 #3).

**Recommendation (SKU):** **Free Local (forever) + one-time Offline/Self-host via a storefront +
optional $6/mo Hosted-Online-as-a-service.** Online sells *service*, not content. Offline sells a
*binary*. Cosmetics deferred to v2 but plumbed via the entitlement record. **The subscription should
be the *last* thing built (§5, §7) — possibly not in v1 at all.**

---

## 4. Payment integration

Two channels, deliberately, because they have different merchant-of-record (MoR) and thus different
chargeback liability (§5).

### 4.1 Channel A — Offline/Self-host purchase: sell through a storefront, not direct

**Recommendation: Steam and/or itch.io, with direct-download as a distant third.**

| Option | MoR (who eats chargebacks + does tax) | Reach | Cut | Effort |
|---|---|---|---|---|
| **Pay-A1 — Steam** | **Steam** | Huge built-in audience, wishlists, updates, key reselling | 30% | Steamworks integration, store page, review process; build packaging |
| **Pay-A2 — itch.io** | **itch** (and itch lets *you* be MoR if you opt in — don't) | Indie/dev audience, dead-simple, "pay what you want" possible | ~10% default (configurable) | Very low; upload a build, done |
| **Pay-A3 — direct download + Stripe Checkout one-time** | **Us** | Whatever traffic we drive | Stripe ~2.9%+30¢ | We build the download gating, license keys, **and we eat chargebacks + global tax** |

**Why a storefront wins for offline (this is the chargeback insight applied):** when Steam or itch is
the merchant of record, **they** handle the card transaction, **they** absorb and adjudicate
chargebacks, and **they** deal with worldwide VAT/sales-tax. The owner's "chargeback kills me" fear is
*structurally removed* from this channel by not being the merchant. The 10–30% cut is the price of
that risk transfer and it is worth it for a solo operator. **Direct Stripe one-time (Pay-A3) reintroduces
exactly the liability we're trying to avoid** — only do it if a storefront is impossible.

**Verification (server-side) for Channel A.** Steam: validate ownership via the Steamworks API / the
build only runs when launched through Steam. itch: distribute via the itch app / download keys. For a
self-hosted build the "entitlement check" is mostly *the storefront gating the download* — once they
own the binary, it runs offline with no phone-home required (and shouldn't require one — P-v, and it's
an *offline* product by definition). Optional: a signed license file for direct-download buyers.

### 4.2 Channel B — Hosted Online subscription: Stripe Billing (if we sell it at all)

**Recommendation: Stripe Checkout + Billing (Customer Portal), with server-side webhook
verification.** Stripe is the default for a browser subscription: hosted Checkout means **we never
touch card data** (PCI scope minimized to SAQ-A), and the **Customer Portal** gives self-serve cancel
/ update-card / invoice history for free (which directly cuts "I couldn't cancel so I charged it back"
disputes — §5).

**Flow (concrete):**
1. Subscriber clicks "Go Online" → server creates a Stripe **Checkout Session** in subscription mode,
   sets `client_reference_id = jammers_player_token` (or `account_id`) so the purchase is tied to our
   subject, and `customer_email` if known. Redirect to Stripe-hosted Checkout.
2. Stripe handles card entry, **SCA / 3D Secure**, and the charge.
3. **Source of truth = webhooks, never the redirect.** The server listens for
   `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
   `invoice.paid`, `invoice.payment_failed`, and **`charge.dispute.created`** (the chargeback signal,
   §5). Each webhook is **signature-verified** (Stripe-Signature header) before we mutate state.
4. On `invoice.paid` → write/refresh the rung-2 entitlement row `{account_id, sku=online, status=active,
   current_period_end}`. On `subscription.deleted` or dunning-final-fail → mark `status=lapsed`.
5. **Server-side entitlement check on every privileged action** (creating a *hosted-internet* Remote
   room, syncing cosmetics): the relay endpoint looks up the account's entitlement row and confirms
   `status=active && period_end > now`. **Never trust the client's local entitlement cache** — the
   client cache (rung 0) is for *UX hints only* (show/hide the "Go Online" button); the gate is
   server-side, exactly mirroring game-modes §6.5's "don't trust client-supplied identity".
6. **Customer Portal** link in settings for cancel/update-card → fewer disputes, less support load.

**The MoR question for Channel B — ⚖︎ DECISION #2 (the biggest one besides "subs at all").** Raw
Stripe makes **us** the merchant of record: we own chargeback adjudication *and* the global sales-tax
/ VAT compliance mess (which for digital goods sold to the EU/UK is genuinely onerous for a solo
operator). The alternative:
- **Pay-B-MoR — sell the subscription through a Merchant-of-Record (Paddle / Lemon Squeezy /
  FastSpring).** They are the seller of record: **they** remit VAT/sales-tax worldwide, **they** take
  on a large share of chargeback/fraud handling, in exchange for a higher cut (~5% + fees vs Stripe's
  ~2.9%+30¢). For an operator whose explicit fear is chargebacks *and* who has a day job (no time for
  tax filings in 40 jurisdictions), **a MoR is very possibly the right answer for the subscription**,
  trading margin for the elimination of two existential admin risks. Strongly worth choosing over raw
  Stripe unless the owner specifically wants Stripe's control/lower fees and is willing to own tax.

### 4.3 Recommendation (payment)

- **Offline SKU → a storefront (itch first for speed/simplicity, Steam for reach).** MoR = storefront.
  This channel carries **near-zero chargeback risk to us** and should be **first** to ship if we
  monetize at all.
- **Online SKU → either Stripe Billing (we own tax + disputes) or a MoR like Paddle/Lemon Squeezy (they
  own tax + most disputes for ~2% more).** Given the owner's stated fear and time constraints, **lean
  MoR for the subscription** unless they consciously choose to own tax/disputes for the lower fee.
- **Verification is always server-side via verified webhooks; the client cache is a UX hint, never a
  gate.**

---

## 5. Chargeback risk (the owner's named fear: "pay one month, chargeback, kill me")

This deserves its own section because it is the owner's explicit blocker and it should *shape the
strategy*, not be a footnote.

### 5.1 What a chargeback actually costs a tiny operator (be concrete and honest)

When a customer disputes a $6 charge with their bank:
- You lose the **$6** (refunded to them) **and** pay a **dispute/chargeback fee** (Stripe's is on the
  order of **~$15 USD**; ⚖︎ verify current — fees and "fee returned if you win?" policy change, §9).
  So one disputed $6 sub is roughly a **−$21 swing**, i.e. you'd need ~3–4 *honest* months of that
  same sub just to recover one chargeback. The unit economics of a cheap sub are genuinely fragile
  against disputes.
- You can *contest* it (submit evidence via the Stripe dashboard) but for a $6 digital good the
  evidence is thin and **the fee is often not worth your time even when you win.**

**But here is the honest reframing the owner needs.** At *small scale*, the **dollar** damage from
chargebacks is trivial — a handful of $21 swings is lunch money, not "kill me". **The thing that can
actually kill you is your *dispute ratio*, not the dollars.** Card networks (Visa/Mastercard) run
fraud/dispute monitoring programs with thresholds (e.g. Visa's program historically triggers around a
**~0.9% dispute-to-transaction ratio with a floor of ~100 disputes/month** — ⚖︎ verify current
numbers, §9). Blow past them and you get fines, then your payment processor can **freeze or terminate
your account**, and you can land on the **MATCH list** (a card-industry blacklist that makes it hard
to get *any* processor for years). **That** is the existential outcome — losing your ability to take
payment at all — not the per-dispute $21. With tiny transaction *counts*, even a few disputes can blow
the *ratio* (3 disputes on 200 charges = 1.5% > 0.9%), which is precisely why a tiny operator should
either not take cards directly or keep volume/exposure controlled while building reputation.

### 5.2 Concrete mitigations (in priority order)

1. **Don't be the merchant of record for the risky channel.** Sell offline via Steam/itch (§4.1) and,
   ideally, the subscription via a MoR (§4.2 Pay-B-MoR). **The single most effective chargeback
   mitigation is making someone else the seller of record** — they carry the ratio, the fines, the
   MATCH-list risk. This alone resolves most of the owner's fear.
2. **3D Secure / SCA on every subscription charge.** When a transaction is authenticated via 3DS, the
   **fraud-related chargeback liability shifts to the card issuer**, not you. Stripe can request/force
   3DS (and SCA is mandatory for EU cards anyway). This neutralizes the *fraudulent-card* class of
   chargeback specifically. Turn it on.
3. **Stripe Radar (fraud scoring).** Built into Stripe; blocks high-risk charges pre-authorization.
   Radar's baseline rules are free; the ML tier costs a few cents per transaction — cheap insurance.
   Tune rules to block obvious fraud (mismatched country, known-bad cards, velocity).
4. **Make cancellation trivially easy (kills the biggest *legitimate* dispute class).** Most disputes
   on cheap subs aren't fraud — they're **"I forgot I subscribed / I couldn't find the cancel button"**.
   The Stripe **Customer Portal** (one-click self-serve cancel), a **clear billing descriptor**
   ("JOYSTICKJAMMERS.COM" not a cryptic LLC name), a **renewal-reminder email**, and an **easy refund
   policy** ("email us, we refund, no fight") convert would-be chargebacks into cheap refunds (a
   refund costs you the $6 but **no dispute fee and no ratio hit**). Refunding generously is *strictly
   cheaper* than being disputed.
5. **Dunning, not surprise re-charges.** Stripe Billing's **dunning** (retry failed payments with
   email nudges, then lapse gracefully) avoids the "my card was charged after it failed and I didn't
   expect it" dispute. **Proration** on plan changes avoids "I was overcharged" disputes.
6. **Low initial exposure / manual review while small.** Keep prices low (a $6 sub is a small dispute
   target), and while volume is tiny, **manually eyeball signups/disputes** — at low N you can
   literally read every dispute and refund-or-fight by hand. Set a Stripe Radar alert.
7. **No free-trial-to-paid auto-conversion trap (if a trial exists at all).** Auto-converting "free
   trials" are a top dispute generator. If we trial, make the conversion **explicit and reminded**, or
   skip trials entirely.

### 5.3 Should we even take subscriptions at v1? (the strategic answer)

**Recommendation: No — not in the first monetization step.** Sequence the risk:
- **v1 monetization = the Offline/Self-host one-time SKU via a storefront only.** Storefront is MoR →
  the owner's chargeback fear is *structurally absent* from this channel. It validates "will people
  pay for this at all?" with **zero direct dispute exposure** and zero tax burden on us.
- **Free Hosted Online while small.** Run the hosted Remote service **free** (or invite-only/"pay what
  you want" via itch) until there is **demonstrated organic demand** and the gameplay is genuinely
  polished. This defers the chargeback risk *and* the tax/MoR decision until they're justified by real
  numbers, and it's a great growth lever (free online play = more players = more funnel).
- **Add the $6/mo subscription only later, once** (a) gameplay polish is done, (b) there's real
  hosted-online demand straining free capacity, and (c) we've chosen a MoR-or-Stripe path (§4.2) with
  3DS + Radar + Portal in place. **The subscription is the *last* bead, and it's gated on a deliberate
  go decision (⚖︎ §8 #1), not auto-built.**

This directly answers parent §14 #6 ("is hosted online a paid subscription at all in v1?"):
**recommended NO — offline/self-host is the v1 paid SKU; online stays free-while-small; subscription
deferred behind an explicit go decision.**

---

## 6. Bead breakdown (refines parent `FB-account` / `FB-monetize`)

Replaces the two stub beads in parent §13 with a properly decomposed, dependency-ordered set. All are
**Theme I**, all sit in **parent Wave 4 (after gameplay polish)**, all flag-gated. Cross-plan deps use
the game-modes epic `br-modes-remote-play-design-48a` (`.3` = durable token).

| Bead | Title | Depends on | Test layer |
|---|---|---|---|
| **FB-acct-schema** | Persistent user store: `account`, `device_token_link`, `entitlement` tables; account-deletion + data-export endpoint (§2.2); privacy-policy/terms pages | game-modes `.3` (durable token) | unit (link/unlink/delete), schema migration test |
| **FB-acct-oauth** | Rung-1 account: OAuth sign-in (Google/Apple/Discord), no passwords; magic-link email fallback; **link current device token → account; claim anonymous entitlement** (§2.1) | FB-acct-schema | E2E (sign in on 2 devices → same account/cosmetics), unit (token→account link) |
| **FB-ent-model** | Entitlement check service: server-side `hasEntitlement(account, sku)`; client cache is **UX-hint only**, gate is server-side (§3.2, §4.2 step 5) | FB-acct-schema | unit (gate denies without active entitlement), E2E (privileged Remote action blocked when lapsed) |
| **FB-buy-offline** | Offline/Self-host SKU via **storefront** (itch first, Steam later): packaged host+server build, store page, download/ownership gating (§4.1) — **MoR = storefront, no direct card exposure** | FB-ent-model | build-package smoke; manual storefront QA (no automatable card flow) |
| **FB-sub-online** | $6/mo Hosted-Online subscription: **Stripe Checkout+Billing or a MoR (Paddle/Lemon Squeezy)**; signature-verified webhooks → entitlement; Customer Portal; **3DS + Radar + dunning + proration** (§4.2, §5.2). **Gated behind explicit go decision (§8 #1) — build last, maybe not v1** | FB-ent-model, FB-acct-oauth | webhook-signature unit test, sandbox Checkout E2E, dispute-webhook handler test |
| **FB-online-gate** | Wire the entitlement gate into the **hosted-internet Remote** path: only active-subscription accounts create public hosted rooms; free Local + self-host unaffected (§3.2) | FB-sub-online, game-modes `.2` (Remote mode) | E2E (free user → Local OK, hosted-online blocked; subscriber → both OK) |

**Notes carried from the parent that stay true:**
- `FB-bugtrk` (parent §11.6, the bug-tracker `POST /report` endpoint) is a *sibling* Theme-I bead but
  is **independent of accounts/payment** — it ships earlier, unchanged. Not re-specified here.
- Cosmetic *store* beads are intentionally **not created** (deferred to v2, §3.2); the `entitlement`
  table is shaped to hold cosmetic SKUs when that day comes.

---

## 7. Sequencing (this is a separate track AFTER gameplay polish)

**Headline: do almost none of this now.** The parent plan is right to put `FB-account`/`FB-monetize`
in **Wave 4**, after the camera/physics/onboarding/audio/asset work that players actually *feel*.
Monetizing an unpolished game is premature; the funnel (free Local) needs to be *good* before paying
for *more* of it makes sense.

**What the gameplay actually needs NOW (and it's tiny):**
- **Only the durable device token** (game-modes `.3` `jammers_player_token`, already planned). That is
  the entire identity prerequisite for shipping the whole game, Local *and* free Remote. It carries
  seat-reconnect and per-device cosmetic prefs. **No accounts, no DB, no payment, no login** is needed
  for the game to be complete and fun.
- When building the token (game-modes `.3`), **leave a clean seam**: treat the token as opaque and
  server-scoped (already specified, §6.5), and key any per-player state by it in a way that an
  `account_id` could later own a *set* of tokens. That seam costs nothing now and saves a migration
  later. **That is the only "monetization-aware" thing to do during gameplay work.**

**What is explicitly deferred (this whole document):**
- Rung-1 accounts, the user DB, OAuth — deferred until there's a cross-device or purchase reason.
- All payment — deferred to Wave 4, and *within* Wave 4, **offline-storefront first, subscription
  last (or never-in-v1)** per §5.3.
- Cosmetic store — v2.

**Recommended order when the track does start (Wave 4):**
1. **FB-acct-schema → FB-acct-oauth → FB-ent-model** (identity + entitlement plumbing; useful even
   before any sale, e.g. free cross-device cosmetic sync).
2. **FB-buy-offline** (storefront one-time SKU — **lowest risk, validates willingness-to-pay**).
3. *Gate decision* (§8 #1): is hosted-online a paid sub in v1? If **no** → stop here, run online free.
4. If **yes** → **FB-sub-online → FB-online-gate** with full chargeback hardening (§5.2).

**Single biggest risk in this track:** building the subscription before the game has organic demand —
you take on chargeback + tax liability to monetize a service no one is yet straining to use. Mitigation
is the sequencing above: storefront-offline first, free-online-while-small, subscription gated on a
deliberate go decision.

---

## 8. Deferred business decisions

The current owner call is **no paid work yet**. The questions below stay in the document as future
business calls, but they should not produce implementation beads in the current gameplay-polish pass
except for the anonymous durable token seam described in §7.

1. **Subscription in v1 at all?** (Parent §14 #6.) **Resolved for now: no.** Hosted online stays
   free-while-small; any $6/mo subscription is deferred behind a later explicit "go" once gameplay is
   polished and demand is real.
2. **⚖︎ Merchant of record for the subscription (if/when built):** raw **Stripe** (lower fee ~2.9%+30¢,
   but *we* own global VAT/sales-tax + chargeback adjudication + MATCH-list risk) vs a **MoR like
   Paddle / Lemon Squeezy** (~2% more, but *they* own tax remittance + most dispute/fraud liability).
   *Recommendation: lean **MoR** given the owner's chargeback fear and time constraints — trade margin
   for the elimination of two existential admin risks.*
3. **⚖︎ SKU pricing & free-tier line:** confirm $6/mo online; set the offline one-time price (`IDEAS`
   floats $5 EA / $15 full); confirm Local stays free forever. Validate the segmentation hypothesis
   (§3.3) that the three jobs-to-be-done don't cannibalize — ideally with a few real users.
4. **⚖︎ Identity scope / when to add accounts** (Parent §14 #7, game-modes §9 #4): *Recommendation:
   anonymous device token only until a purchase or cross-device need forces rung 1; then **OAuth-first,
   no passwords**.*
5. **⚖︎ Offline storefront choice:** itch (fast, ~10%, indie reach) vs Steam (30%, huge reach, more
   effort) vs both. *Recommendation: itch first for speed/simplicity, Steam later for reach. Avoid
   direct-Stripe-download (reintroduces the chargeback/tax liability the storefront removes).*
6. **⚖︎ Do online subscribers get exclusive cosmetics, or is online purely the *service*?**
   *Recommendation: service-only in v1; revisit cosmetics in v2.*
7. **⚖︎ Refund policy:** a generous no-questions refund policy is *cheaper than chargebacks* (§5.2 #4)
   — confirm we'll offer it. *Recommendation: yes, explicitly.*

---

## 9. Honest list of what is unverified (settle before building money flows)

Per the parent's discipline of separating verified facts from first-principles judgment:
- **Exact Stripe dispute fee, and whether it's returned on a win** — stated ~$15 USD; **verify current
  Stripe pricing** for the operating region before modeling unit economics.
- **Card-network dispute-ratio thresholds / monitoring-program numbers** (the ~0.9% / ~100-disputes
  figures) and current **MATCH-list** mechanics — directionally true and the *qualitative* argument
  (ratio, not dollars, is the killer) is robust, but **verify exact current thresholds** before relying
  on any specific number.
- **MoR fee schedules** (Paddle / Lemon Squeezy / FastSpring) and **storefront cuts** (Steam 30%, itch
  configurable) — verify current rates.
- **Tax/VAT obligations** for digital goods sold from the owner's actual tax jurisdiction to the EU/UK
  — this is exactly the complexity a MoR removes; **get a real answer before taking direct card money.**
- **3D Secure liability-shift specifics** by region/card type — the *mechanism* (authenticated → issuer
  liability for fraud) is real; verify coverage for the cards we'll actually see.
- **Cookie-consent exemption for the functional device token** in the EU — likely exempt as
  strictly-necessary, but verify if we ever serve the EU at scale.

These are all **business/legal verifications**, not engineering blockers, and they only bite at the
moment we take direct money — which §7 defers anyway. None of them block gameplay polish.
