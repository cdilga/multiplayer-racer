#!/usr/bin/env python3
"""60 fps, no lag: the trailer's video stream is constant 60 fps with the frame count its duration implies, and no
frame repeats its predecessor outside the editorial stills (the controller pages and the end card), so every moving
shot advances on every frame. Writes a JSON receipt next to the MP4.

  python3 tools/promo/check-cadence.py art/ui/poc/promo/bring-everyone-stevo-<hash>.mp4
"""
import json
import re
import subprocess
import sys
from pathlib import Path

mp4 = Path(sys.argv[1])
receipt = json.loads(mp4.with_suffix('.json').read_text())
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
                                            'stream=r_frame_rate,avg_frame_rate,nb_read_frames,width,height:format=duration', '-of', 'json', str(mp4)]))
stream, duration = probe['streams'][0], float(probe['format']['duration'])
frames = int(stream['nb_read_frames'])
# Stills: the controller pages and the end card are held images by design.
stills = [(t['start'], t['end']) for t in receipt['titles'] if t['title'] in ("BRING WHATEVER YOU'VE GOT.", 'JOYSTICK JAMMERS')]
stills = [(a - 0.4, b + 2.5) for a, b in stills]
# A frame mpdecimate would drop is (near) identical to the one before it: a repeated frame.
log = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(mp4), '-vf', 'mpdecimate=hi=64*2:lo=64*1:frac=0.05,showinfo', '-an', '-f', 'null', '-'],
                     capture_output=True, text=True).stderr
kept = [float(m) for m in re.findall(r'pts_time:([0-9.]+)', log)]
step = 1 / 60
gaps = []
for a, b in zip(kept, kept[1:]):
    if b - a > step * 1.5 and not any(lo <= a <= hi for lo, hi in stills):
        gaps.append({'from': round(a, 3), 'to': round(b, 3), 'repeated': round((b - a) / step) - 1})
result = {
    'mp4': mp4.name, 'r_frame_rate': stream['r_frame_rate'], 'avg_frame_rate': stream['avg_frame_rate'],
    'size': [stream['width'], stream['height']], 'duration': duration, 'frames': frames,
    'expected_frames': round(duration * 60), 'stills_excluded': stills,
    'repeated_frames_in_motion': sum(g['repeated'] for g in gaps), 'gaps': gaps,
}
result['pass'] = (stream['r_frame_rate'] == '60/1' and stream['avg_frame_rate'] == '60/1'
                  and abs(frames - result['expected_frames']) <= 2 and not gaps)
mp4.with_name(mp4.stem + '-cadence.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['r_frame_rate', 'frames', 'expected_frames', 'repeated_frames_in_motion', 'pass']}))
sys.exit(0 if result['pass'] else 1)
