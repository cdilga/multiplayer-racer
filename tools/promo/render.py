#!/usr/bin/env python3
"""Edit actual host captures + approved audio exports into the landing trailer.

uv run --with 'fonttools[woff]' python tools/promo/render.py --captures /tmp/jj-promo3
Narration must pass the existing voice pipeline before rendering. No audio is synthesised here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]

def run(args):
    subprocess.run(args, check=True)

def seconds(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)]))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def stamp(t):
    ms=round(t*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--captures',type=Path,required=True)
    ap.add_argument('--engine',type=Path,default=Path('/tmp/jj-promo-engine.wav'))
    args=ap.parse_args()
    out=ROOT/'assets/promo'; out.mkdir(exist_ok=True)
    manifest=json.loads((ROOT/'assets/audio/voice/promo-manifest.json').read_text())
    assert manifest['summary']['fail']==0, 'Narration has failing screens'
    rows=manifest['rows']
    # Short cuts, player benefit first. Development is a single brief build/break/rebuild beat.
    shots=['rivals','town','dirt','jump','rocks','rivals','town']
    titles=['ONE SCREEN. ZERO PEACE.','A PERFECTLY SENSIBLE IDEA.','BUILT. BROKEN. REBUILT.','DEEPLY UNREASONABLE ROADS.','TAKE THE RISKY LINE.','YOUR PHONE IS THE CONTROLLER.','JOYSTICK JAMMERS']
    labels=['BRING YOUR FRIENDS','THEN THE CARS GOT INVOLVED','FROM REFERENCE SHEETS TO RIVALRY','GRAVITY HAS ENTERED THE CHAT','THERE IS ALWAYS ANOTHER CORNER','OPEN A BROWSER. SCAN IN. RACE.','BRING YOUR FRIENDS. LEAVE YOUR DIGNITY.']
    timeline=[]; t=0
    with tempfile.TemporaryDirectory(prefix='jj-promo-edit-') as td:
        tmp=Path(td)
        # FFmpeg's FreeType build silently falls back for WOFF2: expand the project's fonts to TTF first.
        fonts={}
        for name in ['barlow-condensed-900-italic','barlow-semi-condensed-700','barlow-semi-condensed-600']:
            font=TTFont(ROOT/f'art/ui/fonts/{name}.woff2'); font.flavor=None
            fonts[name]=tmp/f'{name}.ttf'; font.save(fonts[name])
        for i,(row,shot,title,label) in enumerate(zip(rows,shots,titles,labels)):
            voice=ROOT/'assets/audio/voice'/row['file']
            assert digest(voice)==row['sha256'], f'Voice checksum mismatch: {voice}'
            dur=seconds(voice)+(.85 if i<6 else 2.0)
            # Export frame-aligned cuts so audio and subtitle timestamps agree with the final mux.
            dur=round(dur*30)/30
            titlefile=tmp/f'title-{i}.txt'; titlefile.write_text(title)
            labelfile=tmp/f'label-{i}.txt'; labelfile.write_text(label)
            vf=(f'scale=1280:720,setsar=1,drawbox=x=0:y=0:w=iw:h=130:color=0x15203A@0.88:t=fill,'
                f'drawtext=fontfile={fonts["barlow-condensed-900-italic"]}:textfile={titlefile}:fontsize=58:fontcolor=0xFFF4DA:x=36:y=18,'
                f'drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:textfile={labelfile}:fontsize=22:fontcolor=0xF5B841:x=38:y=86,'
                'drawbox=x=0:y=680:w=iw:h=40:color=0x15203A@0.9:t=fill,'
                f'drawtext=fontfile={fonts["barlow-semi-condensed-600"]}:text=WORK IN PROGRESS   /   REAL GAMEPLAY   /   JAMMERS.DILGER.DEV:fontsize=18:fontcolor=0xFFF4DA:x=36:y=691')
            dest=tmp/f'{i}.mp4'
            run(['ffmpeg','-y','-loglevel','error','-stream_loop','-1','-i',str(args.captures/f'{shot}.mp4'),'-i',str(voice),'-t',str(dur),'-vf',vf,'-af','adelay=200|200,apad','-r','30','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-ac','2',str(dest)])
            timeline.append({'start':round(t,3),'seconds':dur,'shot':shot,'voice':row['file'],'text':row['text'],'title':title,'label':label})
            t+=dur
        concat=tmp/'concat.txt';concat.write_text(''.join(f"file '{tmp}/{i}.mp4'\n" for i in range(7)))
        joined=tmp/'joined.mp4'
        run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(concat),'-c','copy',str(joined)])
        # Dialogue drives the ducking. Existing race score and engine/SFX evidence form the beds.
        graph=(f'[0:a]asplit=2[voice][key];'
               f'[1:a]volume=0.24,afade=t=out:st={t-2}:d=2[music];'
               '[music][key]sidechaincompress=threshold=0.025:ratio=10:attack=10:release=300[ducked];'
               f'[2:a]volume=0.14,afade=t=out:st={t-2}:d=2[engine];'
               '[voice][ducked][engine]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[mix]')
        run(['ffmpeg','-y','-loglevel','error','-i',str(joined),'-stream_loop','-1','-i',str(ROOT/'assets/audio/music/race-2.ogg'),'-stream_loop','-1','-i',str(args.engine),'-filter_complex',graph,'-map','0:v','-map','[mix]','-t',str(t),'-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out/'bring-your-friends.mp4')])
        # A gameplay poster with a legible invitation, taken from the finished trailer.
        run(['ffmpeg','-y','-loglevel','error','-ss','1.5','-i',str(out/'bring-your-friends.mp4'),'-frames:v','1','-update','1','-q:v','2',str(out/'bring-your-friends.jpg')])
    cues=['WEBVTT','']
    for line in timeline:
        start=line['start']+.2; end=line['start']+line['seconds']-.3
        words=line['text'].split(); mid=len(words)//2
        cues.extend([f'{stamp(start)} --> {stamp(end)}',' '.join(words[:mid]),' '.join(words[mid:]),''])
    (out/'bring-your-friends.vtt').write_text('\n'.join(cues))
    evidence=ROOT/'docs/evidence/P1-PROMO'
    (evidence/'timeline.json').write_text(json.dumps({'seconds':round(t,3),'fps':30,'size':[1280,720],'timeline':timeline,'video_sha256':digest(out/'bring-your-friends.mp4'),'music':'assets/audio/music/race-2.ogg','music_sha256':digest(ROOT/'assets/audio/music/race-2.ogg'),'engine_sha256':digest(args.engine),'audio_note':'Editorial mix of approved exports, not live synchronised gameplay audio. Voice + ducked instrumental score + engine/SFX bed; final loudnorm -16 LUFS/-1.5 dBTP.'},indent=2)+'\n')
    print(f'Rendered {t:.2f}s trailer')

if __name__=='__main__':main()
