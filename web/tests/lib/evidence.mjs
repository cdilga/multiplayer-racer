// Test artifacts go to a unique OS scratch directory unless the caller explicitly selects a receipt destination.
// JJ_EVIDENCE_DIR selects a directory; JJ_EVIDENCE selects a file; JJ_CAPTURE_DIR selects a capture directory.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let scratch;

/** Keep each suite's existing override convention; never default to the committed evidence tree. */
export function evidencePath(relative = '', variable = 'JJ_EVIDENCE_DIR') {
  if (process.env[variable]) return process.env[variable];
  scratch ??= mkdtempSync(join(tmpdir(), 'jj-test-evidence-'));
  return join(scratch, relative);
}
