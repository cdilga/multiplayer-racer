Before asking for validation, do a fresh self-review of your bead.

Checklist:

1. Reread the bead with `br show <bead-id>` and compare the implementation against every acceptance
   criterion.
2. Review your diff with `git diff -- <paths>` and look for accidental scope creep, missing imports,
   stale comments, debug logging, dead code, fragile timing, and unhandled edge cases.
3. Re-run the exact tests that matter for the bead. If a command fails, fix the cause or document a
   real blocker; do not bury the failure.
4. For visual changes, inspect the generated artifact yourself. A file existing is not proof; verify
   that it shows the expected state and is not blank, cropped incorrectly, overlapped, or stale.
5. For numeric evidence, identify the exact assertion/value that proves the behavior. Exit code 0
   alone is not enough for behavior-sensitive work.
6. If the bead touches joins, results, maps, race/derby flow, or room lifecycle, self-check the
   product invariants: late joins admitted without unfair wins/result mutation, race finish-grace
   instead of waiting for last place, derby anti-stalemate/tiebreak, and known/random map validation.
7. Check Agent Mail again in case another agent has reported a conflict. Use MCP tools or the `am`
   CLI. If you cannot access Agent Mail either way, say so in the NTM pane and do not ask for
   closure until the coordinator has a reliable coordination trail.

Evidence package template:

```markdown
Ready for fresh validation on `<bead-id>`.

Scope changed:
- ...

Evidence:
- Command: `...`
  Result: ...
- Visual artifact: `path/to/artifact`
  Proves: ...
- Numeric/diagnostic artifact: `path/to/file` or exact output summary
  Proves: ...

Edge cases covered:
- ...

Not tested:
- ... because ...

Files touched:
- ...
```

Post this package to the Agent Mail thread whose `thread_id` is the bead id. The CLI fallback is
`am mail send --project /Users/cdilga/Documents/dev/multiplayer-racer --from <YourAgentMailName>
--to StormyBeaver --subject "[<bead-id>] ready for validation" --body "<evidence package>"
--thread-id <bead-id>`. After posting it, leave the bead in `in_progress` and ask the coordinator
for a fresh validator. Do not close it until a separate agent posts PASS.
