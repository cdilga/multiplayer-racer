# Art pipeline learnings (append-only)

## 2026-10-03 · `codex exec` image generation is unavailable on the ChatGPT account (P1-U01)

- `gpt-6.1-sol` (the configured default), `gpt-6-astra` (which made `art/style/refs/*`), `gpt-6` and
  `gpt-6.1` are refused with "not supported when using Codex with a ChatGPT account". `gpt-6-luna`,
  `gpt-5.6-terra` and `gpt-5.6-luna` run, but their exec sessions have no built-in `image_gen` tool. The
  imagegen skill's CLI fallback needs `OPENAI_API_KEY` (billed), so it needs the owner's approval.
- The models the account offers are cached in `~/.codex/*model*`. `codex exec -i <file>` takes several
  values, so end the image list with `--` before the prompt.
- `art/ui/frames/generate.sh <name>` is ready to rerun once a model with `image_gen` is back
  (`CODEX_MODEL=<model>` overrides the default).
