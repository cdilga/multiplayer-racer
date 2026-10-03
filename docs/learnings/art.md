# Art pipeline learnings (append-only)

## 2026-10-03 · `codex exec` image generation is unavailable on the ChatGPT account (P1-U01)

- `gpt-6.1-sol` (the configured default), `gpt-6-astra` (which made `art/style/refs/*`), `gpt-6` and
  `gpt-6.1` are refused with "not supported when using Codex with a ChatGPT account". `gpt-6-luna`,
  `gpt-5.6-terra` and `gpt-5.6-luna` run, but their exec sessions have no built-in `image_gen` tool. The
  imagegen skill's CLI fallback needs `OPENAI_API_KEY` (billed), so it needs the owner's approval.
- The models the account offers are cached in `~/.codex/*model*`. `codex exec -i <file>` takes several
  values, so end the image list with `--` before the prompt.
- (Superseded the same day: the frames now come from Muse Image, see the entry below.)

## 2026-10-03 · Style frames moved to Muse Image (P1-U01.2)

- The owner supplied a Meta Model API key (`MUSE_API_KEY` in the repo's git-ignored `.env`) with a $2.50 cap
  (250 images at a flat $0.01). `art/ui/frames/generate.mjs` calls `POST https://api.meta.ai/v1/images/edits`
  (`muse-image-1.0`, multipart, repeated `image` fields for references, `size=1536x1024` comes back 1920x1280)
  and keeps `ledger.jsonl`, which refuses a call past the cap. `generate.sh` (codex exec) is retired.
- Without a style lock the first frame came out as a glossy generic 3D render in an American wild-west town,
  with a title bar over the grid. Leading with "paint this in exactly the art style of the first attached
  image (H4)… not a glossy 3D render; not the American south-west" fixed both; the model then copies H4's
  windmill, bunting and sign almost verbatim.
- It invents chrome from H4's layout (bottom bars, QR codes, "Hide debris", counters, "32/32 joined" that reads
  as a player cap). Say "nothing else: no bottom bar, no QR code, no buttons, no counters" and check every pick
  for caps and invented features before using it.
