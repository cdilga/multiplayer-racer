# game-model-prep (skill)

Generic, cross-agent skill for preparing game vehicle/character models to be **good to play and
balanced**. Engine-generic: it reads a project **adapter** + **`rubric.json`**; it contains no
game-specific paths or rules. See `SKILL.md` for the pipeline (Stages A–H).

## Cross-agent install

The canonical copy lives here (`.claude/skills/game-model-prep/`) and Claude reads it in-place.
Codex and Copilot read from per-user dirs, so symlink it there once per machine:

```bash
bash .claude/skills/game-model-prep/install.sh
# → ~/.codex/skills/game-model-prep  and  ~/.copilot/skills/game-model-prep
```

(`AGENTS.md` also points to this skill for discoverability.)

## Using it in a project

1. Implement the **adapter contract** (see `SKILL.md` → "The adapter contract"): `loadModel`,
   `normalize`, `spawn`, `simStep`/`measure`, `render`.
2. Copy `assets/rubric.template.json` → your project's `rubric.json` and fill thresholds,
   archetypes, and budgets.
3. Run a model through Stages A–H; results accumulate in a `model-prep.json`
   (`assets/model-prep.schema.json`).
4. Your project's own validation/acceptance skill is Stage H (the gate).

## What's here

| Path | Purpose |
|---|---|
| `SKILL.md` | The pipeline + decision tree + adapter contract. |
| `references/` | Validated knowledge: Rapier tunables, wheel rigging, destructibility, balance, visual QA. |
| `scripts/inspect-wheel-pivots.mjs` | GLB wheel-pivot inspector (perpendicular-to-spin-axis metric; CI-gateable). |
| `scripts/validate-and-budgets.md` | glTF-Validator + glTF-Transform runbook. |
| `assets/model-prep.schema.json` | Per-model prep-manifest schema. |
| `assets/rubric.template.json` | Project-fills thresholds/archetypes/budgets. |
| `install.sh` | Symlink into Codex + Copilot skill dirs. |
