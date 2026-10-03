# Kit-piece registry (`jj.map.v1` dressing and props)

One JSON file per piece under `<family>/`. `jj-map` validates every map's `kitPiece` against it, `jj-sim` reads each
piece's collider proxy for `collides` dressing and props, and the renderer builds the piece in code by its `id`. The
registry is data, so the sim never waits for the render track (plan §8.1).

| Field | Meaning |
|---|---|
| `id` | `<family>/<name>`, the file's path without `.json` |
| `version` | bumps when the piece's parameters or collider change |
| `params` | integer parameters: `{min, max, default}` each; a map may set any of them, and nothing else |
| `collider` | **required** proxy, origin on the ground at the piece's centre, y up: `{"box": {x, y, z}}` (full sizes) or `{"cylinder": {radius, height}}`; each size is millimetres or `{"param": name, "scale": k}` (the param × k, e.g. cm → mm with 10) |
| `lod` | `simplifyBeyondMm`, optional `cullBeyondMm`: per-view render detail, never a count of pieces |

`generic/` (P1-M01): barrier, post, box building, cone, bin, for the greybox. Biome and sign tasks add their own families.
