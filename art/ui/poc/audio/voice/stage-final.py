#!/usr/bin/env python3
"""Stage the current announcer lines (assets/audio/voice) for the "Listen and compare" page.
Copies the .ogg files into ./clips/final/ (gitignored) and writes ./final.json, which page.js appends as a group."""
import json, shutil, pathlib
here = pathlib.Path(__file__).resolve().parent
src = here.parents[4] / 'assets/audio/voice'
m = json.loads((src / 'manifest.json').read_text())
out = here / 'clips/final'; out.mkdir(parents=True, exist_ok=True)
moments = {}
for r in m['rows']:
    shutil.copy2(src / r['file'], out / r['file'])
    t = next((t for t in r['takes'] if t.get('picked')), {})
    moments.setdefault(r['moment'], []).append({
        'label': f"{r['delivery']} #{r['variant']}" + ('' if r['pass'] else ' (fails screens)'),
        'text': r['text'], 'src': f"clips/final/{r['file']}",
        'speaker_sim': t.get('speaker_sim'), 'wer': t.get('wer'), 'median_hz': t.get('median_hz'),
        'lufs': r['export']['lufs'], 'seconds': r['seconds'], 'heard': t.get('heard')})
blocks = [{'letter': str(i + 1), 'title': k, 'sub': f"{len(v)} lines", 'clips': v} for i, (k, v) in enumerate(moments.items())]
s = m['summary']
(here / 'final.json').write_text(json.dumps({'id': 'final', 'short': 'Current lines', 'title': 'Current announcer lines',
    'blurb': f"The {s['rows']} lines now in assets/audio/voice, generated {m['generated_utc']}. {s['pass']} pass every screen; {s['fail']} still fail the word-accuracy screen, so a line may open with a stray word. The WER and 'Whisper heard' under each clip say which.",
    'blocks': blocks}))
print(len(m['rows']), 'lines staged')
