# Australianisms for the Playtest-1 announcer (P1-A00, R53)

The research slice behind the announcer's lines in `tools/audio/cues-playtest1.tsv`. It covers only what the
announcer says in Playtest 1. Award titles, car blurbs, chaos warnings and the name generator stay V2-112 (Full);
the master plan §10.10 examples are triaged at the bottom.

**Voice.** The announcer is the cheeky, warm one; the UI is plain (`art/ui/GUIDE.md` §11). They share one
vocabulary: *room* (the party on this TV), *round* (one race), *number*, *car*, *host*, *controller*; never lobby,
session, match, level, heat, vehicle, kart, ride, seat, slot, remote, client or device. Australian spelling.
A visitor who has never heard Australian English must still follow every line, so a slang term sits beside plain
words that carry the meaning.

**Rules every line follows** (the loader `tools/audio/check_cues.py` enforces them):

- Family friendly: no swearing (including "bloody"), nothing about alcohol or violence against people.
- Nothing punching down: no insults for a kind of person, no class or ability jokes.
- Indigenous-derived Australian slang (walkabout, hard yakka, galah, cooee and the like) is welcome, by owner ruling R114 (2026-10-06). It is part of how Australians talk, so use it the way the owner does.
- No player names (R69), and in Playtest 1 no car numbers or colours (Q-A5; a spliced number catalogue stays Full).
- No brand names.

**How the terms were checked.** On 2026-10-03 each entry below was looked up on the cited page. Sources, in the
order I trusted them:

- **ANDC**: the Australian National Dictionary Centre (ANU), *Meanings and origins of Australian words and
  idioms*, one page per initial letter at `https://history.cass.anu.edu.au/centres/andc/australian-words-<letter>`.
- **Macquarie**: the Macquarie Dictionary's own articles, `https://www.macquariedictionary.com.au/`.
- **Green's**: *Green's Dictionary of Slang*, `https://greensdictofslang.com/entry/<id>`, which records region
  labels and the earliest dated quotation.

Meanings are paraphrased, not copied. Where a term has only a Green's entry, that is stated. The ANDC pages are
selections, so a term missing there is not necessarily wrong; it was simply sourced elsewhere or left out.

## Terms

The loader reads this table: the **Term** cell lists the canonical form first, then the other forms the announcer
may say, separated by ` / `. A cue-sheet row must list the canonical term in its `slang_terms` column for every
term it uses, and every term in this table that appears in a line must be listed. `Family-friendly` must be `yes`
for a term to ship.

| Term | Meaning | Where it fits | Family-friendly | Sensitivity note | Source | Used in |
|---|---|---|---|---|---|---|
| g'day | Familiar greeting, any hour; short for "good day". | Opening a line to the room. | yes | Worldwide cliche from 1980s tourism ads; use once or twice, not every line. | ANDC "g'day", `australian-words-g` | welcome, late-joiner |
| mate | Address implying equality and goodwill (can also be ironic). | Friendly aside in a callout. | yes | Never aimed at one person by name or gender; keep it warm, not sarcastic. | ANDC "mate", `australian-words-m` | door-off, off-course, welcome |
| no worries | No bother; all is well. First recorded in the 1960s. | Reassuring a newcomer or a loser. | yes | None. | ANDC "no worries", `australian-words-n` | late-joiner, time-up, welcome, wreck |
| fair go | A reasonable chance, a fair deal; Australia sees itself as "the land of the fair go". | Everyone gets a turn; late joiners. | yes | A cherished value, so use it sincerely. ANDC notes it is also an exclamation of disbelief, so keep the plain meaning obvious. | ANDC "fair go", `australian-words-f` | late-joiner |
| fair dinkum | Genuine, true, honest. "Dinkum" is from British dialect; Australian use from the 1890s. | Hyping something real: a close finish, a thriller. | yes | None. | ANDC "dinkum", `australian-words-d`; Macquarie "Fair dinkum true blue Aussie, mate", `https://www.macquariedictionary.com.au/fair-dinkum-true-blue-aussie-mate/` | all-ready, bodywork-off, lead-change, photo-finish |
| she'll be right | It will be fine. Australian English often uses "she" where standard English uses "it". | Cosmetic car damage; consoling a loser. | yes | The phrase can brush off real problems, so never use it for a connection or join fault; damage only. | ANDC "apples: she's apples", `australian-words-a` (the entry explains this "she") | door-off, next-round |
| she'll be apples / she's apples | Everything is fine. Began as rhyming slang (apple and spice, nice); first recorded in the 1920s. | Same as "she'll be right"; vary the two. | yes | Same as "she'll be right". | ANDC "apples: she's apples", `australian-words-a` | bodywork-off |
| bonzer | Surpassingly good, splendid. Early 20th century. | Praising a drive or a win. | yes | Dated; it reads as affectionate and old-fashioned, which suits the tone. | ANDC "bonzer", `australian-words-b`; Green's "bonzer, adj.", `https://greensdictofslang.com/entry/2ztbvba` (Aus/NZ) | winner, wheel-off |
| give it a burl | Have a try; a variant of "give it a whirl". | Inviting people to start. | yes | None. | ANDC "burl: give it a burl", `australian-words-b` | welcome, all-ready |
| cark it / carked it / carks it / carking it | To die, break down or fail. First recorded in the 1970s. | A wrecked car. | yes | The "die" sense means the car only. Never use it about a person, and avoid it if a future mode makes hits look like harm to people. | ANDC "cark", `australian-words-c` | wreck |
| shoot through like a Bondi tram / shot through like a Bondi tram | To leave in a hurry. First recorded in 1943; the Bondi trams stopped in 1960. | A wheel or part leaving the car fast. | yes | "Shoot through" can also mean abandoning someone; here it is only a part leaving. Bondi is a real suburb, not a brand. | ANDC "Bondi tram", `australian-words-b`; Macquarie "Will shoot through like the Bondi tram make a comeback?", `https://www.macquariedictionary.com.au/will-shoot-through-like-the-bondi-tram-make-a-comeback/` | wheel-off |
| bingle / bingles | A minor collision (older senses: a thump, a skirmish). First recorded in the 1940s. | A crash between cars. | yes | A real-road crash word, so it stays on cartoon cars and never in safety or real-road copy. | ANDC "bingle", `australian-words-b` | wreck |
| flat out like a lizard drinking | Extremely busy, at top speed. A pun on lying flat and going flat out. First recorded in the 1930s. | The last lap. | yes | Animal reference only; no cruelty. | ANDC "flat out like a lizard drinking", `australian-words-f` | final-lap |
| strewth / 'strewth / struth | Mild exclamation of surprise, short for "God's truth". Earliest quotation 1883. | Surprise: close finish, big air. | yes | A minced oath. It is very mild and common in family media; drop it if the owner prefers no religious roots. | Green's "'strewth!, excl.", `https://greensdictofslang.com/entry/qmsiify` (no ANDC entry found) | photo-finish, big-air |
| crikey | Exclamation of surprise; a softened form of "Christ!". | Surprise at damage. | yes | A minced oath. Strongly tied to Steve Irwin in family media; mild. | Green's "crikey!, excl.", `https://greensdictofslang.com/entry/ghmqtca`; Macquarie "Crikey! Aussie slang overseas", `https://www.macquariedictionary.com.au/crikey-aussie-slang-overseas/` | door-off |
| ripper | Something excellent ("a ripper of a race"). Green's labels it British and Australian; it is strongly Australian today. | Praising a race, a pass. | yes | Not the "murderer" sense; keep it to "a ripper of a ...". | Green's "ripper, n.1", `https://greensdictofslang.com/entry/o4wu2yy` | all-ready, photo-finish, lead-change |
| too right | Exclamation of agreement: yes, absolutely. Originally Australian; earliest quotation 1918. | Agreeing with the question just asked. | yes | None. | Green's "too right!, excl.", `https://greensdictofslang.com/entry/hyxv4dq` | next-round, winner |
| good on ya / good on you / good on yer | Well done. Green's labels it Australian and Irish, now equally common in the UK and Ireland. | Congratulating the winner. | yes | None. | Green's "good, adj.1" (phrase "good on you"), `https://greensdictofslang.com/entry/63gk4oy` | winner |
| you beauty / you little beauty | Appreciative cheer: excellent! | A cheer for the winner or a pass. | yes | Aimed at what happened, not at a person's looks. | Green's "beauty!, excl.", `https://greensdictofslang.com/entry/avneojy` | winner, lead-change |
| pearler | Something outstanding. Green's Australian citation is from 1901. | Praising a jump. | yes | None. | Green's "purler, n." (spelt pearler), `https://greensdictofslang.com/entry/cmx6sea` | big-air |
| cactus | Ruined, useless, finished. Linked to the prickly pear plague. Earliest quotation 1967. | A wrecked car. | yes | Cars only. It may sound dated to younger listeners, so keep plain words beside it. | Green's "cactus, adj.", `https://greensdictofslang.com/entry/zxgtmyi` | wreck |
| come a gutser / came a gutser / comes a gutser | To take a heavy fall or fail; "gutser" is a heavy fall or collision. Australian military slang in 1918. | A tumble or a wreck. | yes | None. | Green's "gutser, n.2", `https://greensdictofslang.com/entry/p35f2ia` | wreck |
| rock up / rocks up / rocked up / rocking up | To arrive, usually without notice. Earliest quotation 1974. | A late joiner. | yes | None. Green's also records it in South African and Scots English. | Green's "rock, v.3" (sense "rock up"), `https://greensdictofslang.com/entry/zlfamhy` | late-joiner |
| starve the lizards | Exclamation of surprise. First recorded in the 1920s. | Big air. | yes | Dated; Macquarie says it has fallen out of use, which is part of the joke. | Macquarie "Starve the lizards!", `https://macquariedictionary.com.au/blog/article/789` | big-air |
| hooroo | A farewell; in use since at least 1916 and from "hooray". | Closing a round. | yes | None. | Macquarie "Ever leave a party without saying hooroo?", `https://www.macquariedictionary.com.au/ever-leave-a-party-without-saying-hooroo/` | next-round |
| walkabout / gone walkabout / going walkabout | Wandering off, gone missing; here a car that has strayed off the track. | A car that has left the track or is missing/respawning. Never for a person. | yes | Owner ruling R114 supersedes the earlier hold-back (see the left-out table). Plain words (the car, the track) sit beside it. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | off-course |
| out past whoop whoop | Very far away, in the middle of nowhere. | The out-of-bounds message, with the plain instruction beside it. | yes | The plain instruction (back onto the track) must always carry the meaning. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | off-course |
| cheers | Thanks (also a toast). | Thank-yous and sign-offs. | yes | Plain and safe. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | time-up, winner, next-round |
| sheila / sheilas | Slang for women. | Banter and flavour lines where the owner wants it. | yes | Owner-supplied; used per the owner's direction (R114). | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | welcome, winner |
| blokes | Men, fellas. | Group address and banter. | yes | Owner-supplied. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | welcome, winner, next-round |
| yeah nah / nah yeah / nah | Casual no; "yeah nah" a polite no, "nah yeah" a yes. | Playful reactions where the literal meaning doesn't matter. | yes | Confusing to non-Australians: only in lines that stay correct if read literally either way, and never in a warning, choice or confirmation. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | time-up |
| arvo / arvos / arvo's / arvy | Afternoon. | Time-of-day banter, "this arvo's racing"; scenery and signs. | yes | Plain and safe. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | welcome |
| servo / servos | A petrol or fuel station. | Scenery and signs, pit/repair spots, the Aussie roadside. | yes | Plain and safe. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | none yet |
| the institution | A pub. | Signs, scenery, banter. | yes | Owner-supplied. Not in a cue line (the loader refuses the word pub and alcohol words in speech); lives on a sign, with MEALS beside it. | Owner-supplied (R114, 2026-10-04); dictionary citation still to come | none yet |
| legend / legends / you legend | A great person; a warm form of address to a group. | Greeting or cheering the room. | yes | None. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | all-ready, countdown, final-lap, late-joiner, next-round, time-up, welcome |
| righto | Right then; okay. | Starting a line or a round. | yes | None. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | time-up, welcome |
| reckon / reckons | Think, suppose. | Hedging a call: "I reckon...". | yes | None. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | first-finisher, lead-change, wheel-off |
| dead set | Absolutely, truly. | Emphasis: "dead set, who needs doors". | yes | None. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | door-off |
| snag / snags | A sausage. | Banter between rounds; the sausage sizzle. | yes | Food only. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | next-round |
| barbie | A barbecue. | Banter between rounds. | yes | None. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | next-round |
| hard yakka | Hard work. From *yaga*, 'work', in the Yagara language; ANDC. | Effort, the last lap, a long round. | yes | None; plain words beside it. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | final-lap, wheel-off |
| galah / galahs | A noisy cockatoo; affectionately, a silly person. From Yuwaalaraay *gilaa*; ANDC. | Cheerful ribbing of the room or a daft move, never a kind of person. | yes | Affectionate use only. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | first-finisher, wreck |
| cooee | A call to attract attention across distance. From Dharug *gu-weei*; ANDC. | Calling to the room; the Identify flash is already called Cooee. | yes | None. | Owner-supplied (R114, 2026-10-06); the owner's Big Aussie Accent reading, dictionary citation still to come | late-joiner |

Dropped by the owner 2026-10-04: ~~stone the crows~~ (not a phrase they've heard in Australian slang). The `big-air` line and its clip were removed and the remaining `big-air` variants renumbered 1-4. Earlier notes: Dated (Macquarie says it is dying out). Some listeners hear "stone" as violent, so drop it if the owner prefers; the announcer says the clean form only. Source: Macquarie "Starve the lizards!", `https://macquariedictionary.com.au/blog/article/789`

### Verified, held for later (not in a Playtest-1 line)

Same columns. Cleared for A06 (derby and items) or Full awards so the next pass doesn't repeat the research.

| Term | Meaning | Where it fits | Family-friendly | Sensitivity note | Source | Used in |
|---|---|---|---|---|---|---|
| chuck a U-ey / chuck a U-ie / chucked a U-ey / chucked a U-ie | Make a U-turn. Originally Australian. | Full: an award for most reversing. | yes | None. | Green's "U-ie, n.", `https://greensdictofslang.com/entry/tsvbh2y` | none yet |
| stoush | A fight or brawl (noun and verb). Late 19th century, from Scots dialect. | A06: a big hit in derby. | yes | Violent word. Only about cars bashing, never people. | ANDC "stoush", `australian-words-s` | none yet |

## Considered and left out

| Term | Why it is out |
|---|---|
| walkabout ("gone walkabout") | Back in the Terms table: owner ruling R114 (2026-10-04) supersedes this hold-back, and the owner-supplied table says to use it freely for cars wandering off. Used only for a car off the track, never for a person. |
| hard yakka, cooee, galah, bunyip, yowie, boomerang | Back in: owner ruling R114 (2026-10-06) lifts the hold-back on Indigenous-derived Australian slang. hard yakka, galah and cooee are now in the Terms table. |
| hoon | ANDC: a lout, especially one who drives dangerously, so it points at real reckless driving. Left out of a game about cars. Owner decision if wanted. |
| bogan, bludger, drongo, wowser | Put-downs for a kind of person (ANDC: bogan "uncultured", though now sometimes affectionate; bludger "an idler"; drongo "a fool"). Nothing punching down, so master plan §10.10's "Bogan of the Day" is not recommended. |
| legend ("you legend", "legends") | Back in: owner-supplied (R114, 2026-10-06) and now in the Terms table. |
| Maccas, Esky and other brand names | "Maccas Run" (master plan) names a brand. ANDC notes Esky began as a proprietary brand. No brand names in lines. |
| "Couldn't organise a piss-up in a brewery" | Swearing and alcohol. The master plan already asks for a family-friendly variant; none is verified. |
| Dropped a clanger, Servo Pie | Not verified as Australian in any source I read, so they stay out until someone can cite them. |
| bloody (in any phrase) | Mild in Australia but not family friendly for a visitor audience. The loader refuses it. |

## Master plan §10.10 examples, triaged

| Example | Status |
|---|---|
| Latest to Rock Up | "rock up" verified (Green's); the award title stays V2-112. The late-joiner callouts use the phrase. |
| Flat Out Like a Lizard Drinking | Verified (ANDC); used for the final lap. |
| Carked It (most wrecks) | "cark it" verified (ANDC); used on wrecks. Award stays V2-112. |
| She'll Be Right (most repaired damage) | Verified (ANDC); used on door-off and next-round. |
| Chucked a U-ey (most reversing) | Verified (Green's); held for Full. |
| Fair Dinkum Finish | "fair dinkum" verified (ANDC, Macquarie); used on the photo finish. |
| Dropped a Clanger, Servo Pie | Not verified, left out. |
| Bogan of the Day, Maccas Run, the piss-up line | Left out, reasons above. |

## Owner-supplied terms (2026-10-04)

The owner's own list. They are approved to use; the dictionary citations (ANDC/Macquarie/Green's) the table above carries are
still to be added by a copy pass, and until then they count as **owner-supplied, not dictionary-verified**. The voice rules at
the top still apply: a slang term sits beside plain words that carry the meaning, and Australian spelling.

| Term | Meaning | Where it fits | Notes |
|---|---|---|---|
| fair dinkum | Genuine, true, the real thing. | Photo finish, big wins, "fair dinkum finish". | Already in the table above (verified). |
| nah / yeah nah / nah yeah | Casual no; "yeah nah" is a polite no, "nah yeah" a yes. | Playful reactions and banter where the literal meaning doesn't matter (e.g. a near miss: "Yeah nah, not today!"). | **Confusing to non-Australian players** (the two-way meaning): never use in anything that carries information, a warning, a choice or a confirmation; only where the line still reads correctly if taken literally either way. |
| scallop | A potato cake (battered, fried potato slice) in some states, a sea creature in others. | Flavour text on pickups or scenery only. | Regional and ambiguous: pair it with a plain word or art that settles which, or leave it out. |
| cruiser | A Toyota Landcruiser. | Car names, blurbs and commentary on big 4WDs. | Owner-supplied. |
| going walkabout | Wandering off, gone missing; a car that has strayed. | A car that has left the track, a missing/respawning car. | Owner-supplied: use it freely for cars wandering off. Supersedes the older walkabout row below. |
| out past whoop whoop | Very far away in the middle of nowhere. | **The out-of-bounds message** when we need one ("You're out past whoop whoop!") with the plain instruction beside it. | Plain words must carry the instruction (return to the track). |
| sheila / sheilas | Slang for women. | Banter and flavour lines where the owner wants it. | Owner-supplied. Use per the owner's direction; no pre-emptive disclaimers. |
| blokes | Men, fellas. | Group address and banter ("good on ya, blokes"). | Owner-supplied. |
| sanga | Sandwich, specifically sausage in bread (the game's sausage-on-bread item, R-items). | The sanga item, its pickup and callouts. | Already the item's name. |
| cheers | Thanks (also a toast). | Thank-yous in UI copy, sign-offs ("Cheers!"), the round-complete thanks. | Plain and safe. |
| the institution | A pub. | Signs, scenery, banter. | Owner-supplied. |
| servo | A petrol station / fuel station. | Scenery and signs, pit/repair spots, the Aussie roadside. | Plain and safe. |
| arvo / arvy | Afternoon. | Time-of-day banter, "this arvo's racing". | Plain and safe. |

**Names.** Diminutive nicknames ("Davo", "Stevo", "Gazza", "Shazza", "Bazza", "Macca", "Robbo") belong in the autogenerated
names someone gets if they don't pick one (P1-C03's curated prefill list, and the later name generator).

## Where it's used (P1-A06c, br-ennm)

Every term from the owner-supplied list that ships, with its exact line. Cue ids are `moment-variant` in
`tools/audio/cues-playtest1.tsv`; each is also a clip `assets/audio/voice/<id>.ogg`. Terms the doc fits to places we have no copy for
yet (scallop, cruiser, sanga) are not used. TV and host lines to follow are in `docs/evidence/P1-A06c/tv-copy-todo.md`.

| Term | Line | Where |
|---|---|---|
| out past whoop whoop | "Out past whoop whoop! Drive back onto the track." | cue `off-course-1` |
| out past whoop whoop | "You're out past whoop whoop! Steer back to the track." | cue `off-course-4` |
| out past whoop whoop | "Out past whoop whoop" / "Drive back onto the track." | phone banner, `art/ui/poc/phone/phone.js:201` (state `#race&stick=offcourse`) |
| walkabout | "That car's gone walkabout! Back onto the track, mate." | cue `off-course-2` |
| walkabout | "Gone walkabout! Bring that car back onto the track." | cue `off-course-3` |
| cheers | "Yeah nah, not this time. The round's over, cheers for racing." | cue `time-up-4` |
| cheers | "Cheers for racing, sheilas and blokes! What a round that was." | cue `winner-4` |
| cheers | "Cheers for that one, blokes. Next round's loading, so hang tight." | cue `next-round-4` |
| cheers | "Cheers for playing! You finished 3rd." | phone state card `game-ended`, `art/ui/poc/phone/phone.js:426` |
| fair dinkum | "A fair dinkum finish! Nobody gave an inch." | cue `photo-finish-4` |
| sheila / sheilas | "Welcome, blokes and sheilas! Grab a controller, this arvo's racing is on." | cue `welcome-4` |
| sheila / sheilas | "Cheers for racing, sheilas and blokes! What a round that was." | cue `winner-4` |
| blokes | the `welcome-4`, `winner-4` and `next-round-4` lines above | cues |
| blokes, sheilas, arvo | "Everyone races on one shared screen, steering from their own phone. Perfect for an arvo with the blokes and sheilas." | landing pitch, `web/landing/index.html:15` |
| arvo | "...this arvo's racing is on." | cue `welcome-4` |
| arvo, servo | `SERVO` / `OPEN ARVOS` / `1 KM` | sign `signs/arvo-servo` (`assets/kit/signs/data/arvo-servo.json`) |
| servo | `SERVO` / `3 KM` | sign `signs/servo` |
| the institution | `THE INSTITUTION` / `MEALS` / `4 KM` | sign `signs/the-institution`; tourist family (brown, white legend), because the grammar has no business-sign family and no new shape or colour family is allowed |
| yeah nah | "Yeah nah, not this time. The round's over, cheers for racing." | cue `time-up-4`; read literally it is still true (this time did not go that way) |
| fair dinkum, sheila, mate, etc. | unchanged earlier cues | see the "Used in" column of the Terms table |

`the institution` is on a sign only: the cue loader refuses the word "pub" and alcohol words in speech, so no announcer line says it.
