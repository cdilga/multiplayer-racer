# Browser test artifacts

Ordinary runs of `node --test web/tests/ web/host/tests/` write receipts and captures to unique
`jj-test-evidence-*` directories under the OS temporary directory. They do not update `docs/evidence/`.
These directories are retained so failed runs can be inspected; separate suites have separate roots.

To recapture evidence, explicitly select the destination using the variable documented at the top of
the test file:

- `JJ_EVIDENCE_DIR`: the suite's receipt directory. Audio and crash suites use it as a root and append
  their bead directories, preserving their existing convention.
- `JJ_EVIDENCE`: the complete filename for worker and preparation receipts.
- `JJ_CAPTURE_DIR`: the suite's capture directory. Suites whose captures are optional still skip
  them unless this is set.

For example, `JJ_EVIDENCE_DIR=docs/evidence/P1-R02 node --test web/host/tests/vehicles.test.mjs`
explicitly updates the vehicle renderer's receipt and images. Review these artifacts before committing
them. Standalone capture and performance scripts retain their documented `--out` or environment options.
