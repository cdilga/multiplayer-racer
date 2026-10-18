#!/bin/bash
# ask.sh (br-bwju.12): asks a small vision model, with no hint, what real car each render looks like.
#   tools/vehicles/recognition/ask.sh <render dir> <out.tsv> [model=claude-haiku-5-5]
# One `claude -p` call per image (6 in parallel), the exact prompt below, only the Read tool allowed. Each image is copied to a
# neutral name (render.png in a fresh temp dir), so neither the file name nor the folder gives the answer away.
# Output: <image file name>\t<the model's answer, one line>
dir=$1; out=$2; model=${3:-claude-haiku-5-5}
PROMPT='Look at the image file %s . It is a render of a low-poly game car. What real-world car (make, model and generation) does it look like? Answer in one short line.'
one() {
  f=$1; model=$2; t=$(mktemp -d "${TMPDIR:-/tmp}/recog-XXXXXX"); cp "$f" "$t/render.png"
  p=$(printf "$PROMPT" "$t/render.png")
  a=$(printf %s "$p" | claude -p --model "$model" --effort low --allowedTools Read 2>&1 | tr '\n' ' ' | sed 's/\t/ /g; s/^Permission allow rule.*mean\. //')
  printf '%s\t%s\n' "$(basename "$f")" "$a"
}
export -f one; export PROMPT
ls "$dir"/*.png | xargs -P 6 -I{} bash -c 'one "$@"' _ {} "$model" | sort > "$out"
cat "$out"
