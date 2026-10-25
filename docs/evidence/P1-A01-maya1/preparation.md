# Canonical Maya1 preparation — br-8h3u.13, 25 October 2026

Owner superseded the older FrankenTTS premise with **Aussie Maya1 v1**, project ID `aussie-maya1-v1`, for all Jammers announcements and both games' promos. Exact prompt/settings are pinned in `tools/audio/maya1-voice.json`; recipe SHA256 `6d43cc70a833a04325ef5d976543b2ea8c8e0f7a1b7ea7838b4d87af795777b2` matches Soccer's live recipe. Maya1 is prompt-defined; no provider voice ID or seed and no owner recording conditions it.

All **70 gameplay and 11 final promo** raw fal.ai takes are generated and cached privately on eris, keyed by exact text and recipe. No automatic paid retakes or duplicate submissions. Durations: gameplay214.5295625s, promo56.149625s. Combined with Soccer72.533752s, duration-based spend estimate is approximately **$0.68643 of the owner's $2 total authorization**; local proof takes excluded. Not an account billing receipt.

Local original-weight Maya1 runs on eris, native FP16, no quantization. Maya revision `b1b9b38ca9decbfcfd6c98ea93dd502bfd0f9572`; SNAC revision `d73ad176a12188fcf4f360ba3bf2c2fbbe8f58ec`, SNAC1.2.1. Fully resident proof produced2.39s in5.667s. Shared GPU pressure caused CPU offload and a5.55s welcome needed70.072s, so the owner-approved fal.ai fallback generated the batch. Local inference has separately recorded backend provenance, not a claim of identical provider output.

The standalone shared private library `/Users/cdilga/Documents/dev/Voices` stores canonical recipe/examples/API and eris renderers, plus separately preserved Combined reference/pack/examples. Private checksum inventory refreshed after the GPU-lock cleanup fix. No packs, model weights, raw recordings or credentials enter Git.

Commands: `python3 tools/audio/render_voice.py --dry-run` selects canonical Maya1 by default; legacy Qwen requires `--legacy-qwen`. `python3 tools/audio/maya1.py --cached-only --review-only` audits existing raw takes without a key, provider calls or game-asset installation. Promo adds `--job tools/promo/voice-job.json --batch maya1-promo`. Request IDs survive failures and resume existing paid jobs.

Initial technical status: all81 raw files hash-verified against their eris cache; duration envelope, raw loudness and raw true-peak screens pass on the Mac. ASR/export checks remain in progress. Shared GPU timing CI took priority; independent FrankenWhisper large-v3 audit began on the Mac. Raw ASR transcripts are retained; only the inaudible US/UK spelling neighborhood/neighbourhood is additionally folded when scoring Maya lines.

Validation: five offline Maya tests (recipe integrity, cache invalidation, exact request, pending resumption, no-submit cache audit and orthographic scoring), existing25 renderer and36 cue-guard checks; Python compile, bash syntax and default dry-run. No human listening approval claimed.

**Not complete and not installed/published.** The owner's vehicle-review hold (Agent Mail3900, reiterated3916) permits current audio to finish/cache but defers final Jammers media/new footage until revised vehicles are reviewed. Existing game/index media remains unchanged. Receipt/export hashes will be added after technical completion; bead stays in progress.
