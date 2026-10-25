#!/usr/bin/env python3
"""Validate the promotional cue sheet with A00's row guards and build the eris worker job."""
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/audio'))
from check_cues import check_sheet
from render_voice import build_job

sheet=ROOT/'tools/promo/narration.tsv'
# Trailer narration is a fixed passage, not randomised in-game callouts: row guards apply,
# while the game's required-moment coverage and repeat-variant floors do not.
result=check_sheet(sheet,rows_only=True)
if result.problems:
    for problem in result.problems: print(problem,file=sys.stderr)
    sys.exit(1)
job=build_job(result,sheet)
for i,row in enumerate(job['rows'],1):
    row['id']=f'promo-{i:02}'
    row['moment_id']=row['id']
    row['trigger_event']='trailer.narration'
(ROOT/'tools/promo/voice-job.json').write_text(json.dumps(job,indent=2)+'\n')
print(f'Validated {len(job["rows"])} promotional narration rows.')
