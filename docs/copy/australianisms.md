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
- No Indigenous cultural terms used as jokes, and no Indigenous-derived slang as a punchline.
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
| mate | Address implying equality and goodwill (can also be ironic). | Friendly aside in a callout. | yes | Never aimed at one person by name or gender; keep it warm, not sarcastic. | ANDC "mate", `australian-words-m` | welcome, door-off, wreck |
| no worries | No bother; all is well. First recorded in the 1960s. | Reassuring a newcomer or a loser. | yes | None. | ANDC "no worries", `australian-words-n` | welcome, time-up, late-joiner |
| fair go | A reasonable chance, a fair deal; Australia sees itself as "the land of the fair go". | Everyone gets a turn; late joiners. | yes | A cherished value, so use it sincerely. ANDC notes it is also an exclamation of disbelief, so keep the plain meaning obvious. | ANDC "fair go", `australian-words-f` | late-joiner |
| fair dinkum | Genuine, true, honest. "Dinkum" is from British dialect; Australian use from the 1890s. | Hyping something real: a close finish, a thriller. | yes | None. | ANDC "dinkum", `australian-words-d`; Macquarie "Fair dinkum true blue Aussie, mate", `https://www.macquariedictionary.com.au/fair-dinkum-true-blue-aussie-mate/` | photo-finish, lead-change |
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
| too right | Exclamation of agreement: yes, absolutely. Originally Australian; earliest quotation 1918. | Agreeing with the question just asked. | yes | None. | Green's "too right!, excl.", `https://greensdictofslang.com/entry/hyxv4dq` | next-round |
| good on ya / good on you / good on yer | Well done. Green's labels it Australian and Irish, now equally common in the UK and Ireland. | Congratulating the winner. | yes | None. | Green's "good, adj.1" (phrase "good on you"), `https://greensdictofslang.com/entry/63gk4oy` | winner |
| you beauty / you little beauty | Appreciative cheer: excellent! | A cheer for the winner or a pass. | yes | Aimed at what happened, not at a person's looks. | Green's "beauty!, excl.", `https://greensdictofslang.com/entry/avneojy` | winner, lead-change |
| pearler | Something outstanding. Green's Australian citation is from 1901. | Praising a jump. | yes | None. | Green's "purler, n." (spelt pearler), `https://greensdictofslang.com/entry/cmx6sea` | big-air |
| cactus | Ruined, useless, finished. Linked to the prickly pear plague. Earliest quotation 1967. | A wrecked car. | yes | Cars only. It may sound dated to younger listeners, so keep plain words beside it. | Green's "cactus, adj.", `https://greensdictofslang.com/entry/zxgtmyi` | wreck |
| come a gutser / came a gutser / comes a gutser | To take a heavy fall or fail; "gutser" is a heavy fall or collision. Australian military slang in 1918. | A tumble or a wreck. | yes | None. | Green's "gutser, n.2", `https://greensdictofslang.com/entry/p35f2ia` | wreck |
| rock up / rocks up / rocked up / rocking up | To arrive, usually without notice. Earliest quotation 1974. | A late joiner. | yes | None. Green's also records it in South African and Scots English. | Green's "rock, v.3" (sense "rock up"), `https://greensdictofslang.com/entry/zlfamhy` | late-joiner |
| starve the lizards | Exclamation of surprise. First recorded in the 1920s. | Big air. | yes | Dated; Macquarie says it has fallen out of use, which is part of the joke. | Macquarie "Starve the lizards!", `https://macquariedictionary.com.au/blog/article/789` | big-air |
| ~~stone the crows~~ | **Dropped by the owner 2026-10-04** (not a phrase they've heard in Australian slang; the cue `big-air` variant 2 and its clip are removed). | none | n/a | Dated (Macquarie says it is dying out). Some listeners hear "stone" as violent, so drop it if the owner prefers; the announcer says the clean form only. | Macquarie "Starve the lizards!", `https://macquariedictionary.com.au/blog/article/789` | big-air |
| hooroo | A farewell; in use since at least 1916 and from "hooray". | Closing a round. | yes | None. | Macquarie "Ever leave a party without saying hooroo?", `https://www.macquariedictionary.com.au/ever-leave-a-party-without-saying-hooroo/` | next-round |

### Verified, held for later (not in a Playtest-1 line)

Same columns. Cleared for A06 (derby and items) or Full awards so the next pass doesn't repeat the research.

| Term | Meaning | Where it fits | Family-friendly | Sensitivity note | Source | Used in |
|---|---|---|---|---|---|---|
| chuck a U-ey / chuck a U-ie / chucked a U-ey / chucked a U-ie | Make a U-turn. Originally Australian. | Full: an award for most reversing. | yes | None. | Green's "U-ie, n.", `https://greensdictofslang.com/entry/tsvbh2y` | none yet |
| stoush | A fight or brawl (noun and verb). Late 19th century, from Scots dialect. | A06: a big hit in derby. | yes | Violent word. Only about cars bashing, never people. | ANDC "stoush", `australian-words-s` | none yet |

## Considered and left out

| Term | Why it is out |
|---|---|
| walkabout ("gone walkabout") | An Aboriginal cultural practice used as a joke. The audition sheet used it for a wheel; the real sheet does not. Not in the ANDC list either. |
| hard yakka | ANDC traces "yakka" to *yaga*, 'work', in the Yagara language of the Brisbane region. Indigenous-derived slang as a punchline is out by the rule above. |
| cooee, galah, bunyip, yowie, yidaki, dreamtime | Indigenous-origin words or cultural terms. ANDC records "galah" as a bird name from Aboriginal languages that also means 'a fool'; it is both Indigenous-derived and an insult. |
| boomerang (as a joke) | An Aboriginal tool. The item may keep its game name in A06's rows; no punchlines about it. Owner to decide if the item keeps the name. |
| hoon | ANDC: a lout, especially one who drives dangerously, so it points at real reckless driving. Left out of a game about cars. Owner decision if wanted. |
| bogan, bludger, drongo, wowser | Put-downs for a kind of person (ANDC: bogan "uncultured", though now sometimes affectionate; bludger "an idler"; drongo "a fool"). Nothing punching down, so master plan §10.10's "Bogan of the Day" is not recommended. |
| legend ("you legend", "legends") | Ubiquitous, but I could not verify it in a dictionary or published glossary, so it is out. The audition line "legends" is not carried over. |
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
