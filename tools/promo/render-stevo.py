#!/usr/bin/env python3
"""Edit the race-led Stevo trailer (P1-PROMO3): staged real-host captures, free local Stevo narration, burned-in
subtitles and a WebVTT track, 1920x1080 at 60 fps, H.264/AAC with faststart.

  uv run --with 'fonttools[woff]' python tools/promo/render-stevo.py --grow /tmp/jj-promo3-grow \
      --loop /tmp/jj-promo3-loop --tracks /tmp/jj-promo3-tracks --roster /tmp/jj-promo3-roster60 --voice /tmp/jj-promo3-stevo-v2

The grow shot's narration lands where the capture's tile count arrives at each stop (capture.json `plan`), so the
voice and the grid agree. Every other scene lasts its line plus a beat. The editor refuses a voice batch that is not
Stevo or has a failing row.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
VOICE = 'stevo-australian-announcer-v1'
FPS = 60
W, H = 1920, 1080
INK, PAPER, GOLD = '&H003A2015', '&H00DAF4FF', '&H0041B8F5'  # ASS is &HAABBGGRR


def run(args):
    subprocess.run([str(a) for a in args], check=True)


def seconds(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(p)]))


def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def ass_time(t):
    cs = round(t * 100)
    return f'{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}'


def vtt_time(t):
    ms = round(t * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}.{ms % 1000:03}'


def ass_text(s):
    return s.replace('\\', '\\\\').replace('{', '(').replace('}', ')')


def clip(src, dest, dur, start=0.0, still=False):
    """One segment, normalised: 1920x1080, 60 fps, yuv420p, silent."""
    inp = ['-loop', '1', '-framerate', str(FPS), '-i', src] if still else ['-ss', f'{start:.3f}', '-i', src]
    vf = (f'scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x15203A,'
          f'fps={FPS},setsar=1')
    run(['ffmpeg', '-y', '-loglevel', 'error', *inp, '-t', f'{dur:.3f}', '-vf', vf, '-an', '-c:v', 'libx264',
         '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', dest])
    got = seconds(dest)
    assert got >= dur - 0.05, f'{src}: segment needs {dur:.2f}s, source gives {got:.2f}s'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--grow', type=Path, required=True)
    ap.add_argument('--loop', type=Path, required=True)
    ap.add_argument('--tracks', type=Path, required=True)
    ap.add_argument('--roster', type=Path, required=True)
    ap.add_argument('--voice', type=Path, required=True, help='Directory holding promo3-manifest.json and its takes')
    ap.add_argument('--controllers', type=Path, default=Path('/tmp/jj-promo-crowd-reviewed-f3c175d9'))
    ap.add_argument('--keyboard', type=Path, default=Path('/tmp/jj-promo3-keyboard/controllers-menu.jpg'), help='capture-keyboard.mjs: the host Controllers panel with a keyboard player seated')
    ap.add_argument('--engine', type=Path, default=Path('/tmp/jj-promo-engine.wav'))
    ap.add_argument('--out', type=Path, default=ROOT / 'art/ui/poc/promo')
    ap.add_argument('--name', default='bring-everyone-stevo')
    args = ap.parse_args()

    board = json.loads((ROOT / 'tools/promo/stevo-storyboard.json').read_text())
    scenes = {s['id']: s for s in board['scenes']}
    manifest = json.loads((args.voice / 'promo3-manifest.json').read_text())
    assert manifest['canonical_voice_id'] == VOICE, 'Owner default voice is Stevo; refusing another voice'
    assert manifest['summary']['fail'] == 0, 'Refusing a voice batch with failing rows'
    takes = {r['id']: r for r in manifest['rows']}
    for sid, s in scenes.items():
        assert takes[sid]['text'] == s['text'], f'{sid}: take does not match the storyboard'
        assert digest(args.voice / takes[sid]['file']) == takes[sid]['sha256']
    say = {sid: takes[sid]['seconds'] for sid in scenes}

    grow = json.loads((args.grow / 'capture.json').read_text())
    roster = {v['vehicle']['id']: v for v in json.loads((args.roster / 'roster.json').read_text())}
    tracks = json.loads((args.tracks / 'capture.json').read_text())

    cues = []      # (start, scene id): narration and its subtitle
    titles = []    # (start, end, title, label)
    segments = []  # files, in order
    t = 0.0
    with tempfile.TemporaryDirectory(prefix='jj-promo3-edit-') as td:
        tmp = Path(td)
        fonts = tmp / 'fonts'
        fonts.mkdir()
        for name in ['barlow-condensed-900-italic', 'barlow-semi-condensed-700', 'barlow-semi-condensed-600']:
            font = TTFont(ROOT / f'art/ui/fonts/{name}.woff2')
            font.flavor = None
            font.save(fonts / f'{name}.ttf')

        def seg(name, src, dur, **k):
            dest = tmp / f'{len(segments):02}-{name}.mp4'
            clip(src, dest, dur, **k)
            segments.append(dest)
            return seconds(dest)

        # 1. The grid grows from one screen to 64; each line starts as the count lands on its stop.
        stops = grow['plan']['stopsAtFrame']
        gdur = grow['plan']['frames'] / FPS
        seg('grow', args.grow / 'grow.mp4', gdur)
        ids = ['grow1', 'grow4', 'grow16', 'grow64']
        for k, sid in enumerate(ids):
            a = 0.35 if k == 0 else stops[k] / FPS + 0.1
            b = (stops[k + 1] / FPS) if k + 1 < len(ids) else gdur
            assert a + say[sid] <= b + 0.6, f'{sid}: the line ({say[sid]:.2f}s) outlasts its stop'
            cues.append((a, sid))
            titles.append((a, b, scenes[sid]['title'], scenes[sid]['label']))
        t = gdur

        def scene(sid, build, minimum=0.0, lead=0.25, tail=0.75):
            nonlocal t
            dur = max(minimum, lead + say[sid] + tail)
            build(dur)
            cues.append((t + lead, sid))
            titles.append((t + lead, t + dur - 0.1, scenes[sid]['title'], scenes[sid]['label']))
            t += dur

        # 2. The whole field from above.
        scene('race', lambda d: seg('pack', args.grow / 'pack.mp4', d, start=1.0))  # past the 64 -> 4 reflow

        # 3. Four generated biomes, an equal share each.
        def tracks_build(d):
            shots = tracks['shots']
            for s in shots:
                seg(s['id'], args.tracks / f'{s["id"]}.mp4', d / len(shots), start=0.2)
        scene('tracks', tracks_build, minimum=6.4)

        # 4. A car carried round the generated loop (the capture asserts it went inverted on camera).
        loop_clip = args.loop / 'loop.mp4'
        scene('loop', lambda d: seg('loop', loop_clip, d, start=max(0.0, seconds(loop_clip) - d)), minimum=6.0, lead=0.6)

        # 5-6. Every selectable vehicle, named while it drives.
        def vehicles(ids_):
            def build(d):
                start = t
                for k, vid in enumerate(ids_):
                    seg(vid, args.roster / f'{vid}.mp4', d / len(ids_), start=0.15)
                    titles.append((start + k * d / len(ids_), start + (k + 1) * d / len(ids_) - 0.05, None, roster[vid]['vehicle']['name'].upper()))
            return build
        scene('cars', vehicles(['cruz-missile', 'au-hawk', 'tradie-ute', 'lion-president']), minimum=6.4)
        scene('bikes', vehicles(['pig-catcher', 'postie-bike', 'hawk-dash']), minimum=5.4)

        # 7. The actual controller pages.
        def controllers(d):
            for name, f in [('phone', args.controllers / 'controller-phone.jpg'), ('pad', args.controllers / 'controller-pad-phone.jpg'), ('keyboard', args.keyboard)]:
                seg(name, f, d / 3, still=True)
        scene('controllers', controllers, minimum=6.0)

        # 8. End card over the full 64-car grid.
        end_still = tmp / 'end.jpg'
        run(['ffmpeg', '-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', args.grow / 'grow.mp4', '-frames:v', '1',
             '-vf', 'eq=brightness=-0.32:saturation=0.7,gblur=sigma=6', end_still])
        scene('end', lambda d: seg('end', end_still, d, still=True), lead=0.4, tail=1.8)
        total = t

        listing = tmp / 'list.txt'
        listing.write_text(''.join(f"file '{s}'\n" for s in segments))
        picture = tmp / 'picture.mp4'
        run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listing, '-c', 'copy', picture])

        # Titles (top left), vehicle names, and subtitles (bottom centre, clear of the host footer).
        sub_end = {}
        for k, (a, sid) in enumerate(sorted(cues)):
            sub_end[sid] = a + say[sid] + 0.25
        ass = [
            '[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', 'WrapStyle: 0', '',
            '[V4+ Styles]',
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
            f'Style: Title,Barlow Condensed,84,{PAPER},{PAPER},{INK},{INK},900,1,0,0,100,100,0,0,3,16,0,7,70,70,104,1',
            f'Style: Label,Barlow Semi Condensed,36,{GOLD},{GOLD},{INK},{INK},700,0,0,0,100,100,1,0,3,10,0,7,70,70,218,1',
            f'Style: Name,Barlow Condensed,78,{GOLD},{GOLD},{INK},{INK},900,1,0,0,100,100,0,0,1,6,3,1,70,70,200,1',
            f'Style: Sub,Barlow Semi Condensed,52,{PAPER},{PAPER},&H00000000,&H9A3A2015,700,0,0,0,100,100,0,0,3,14,0,2,160,160,96,1',
            f'Style: End,Barlow Condensed,170,{PAPER},{PAPER},{INK},{INK},900,1,0,0,100,100,0,0,1,8,6,5,60,60,0,1',
            f'Style: EndLabel,Barlow Semi Condensed,64,{GOLD},{GOLD},{INK},{INK},700,0,0,0,100,100,2,0,1,5,0,8,60,60,660,1',
            '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ]
        fade = r'{\fad(180,180)}'
        for a, b, title, label in titles:
            if title == 'JOYSTICK JAMMERS':
                ass.append(f'Dialogue: 1,{ass_time(a)},{ass_time(total)},End,,0,0,0,,{{\\fad(400,0)}}{ass_text(title)}')
                ass.append(f'Dialogue: 1,{ass_time(a + 0.4)},{ass_time(total)},EndLabel,,0,0,0,,{{\\fad(400,0)}}{ass_text(label)}')
            elif title is None:
                ass.append(f'Dialogue: 1,{ass_time(a)},{ass_time(b)},Name,,0,0,0,,{fade}{ass_text(label)}')
            else:
                ass.append(f'Dialogue: 1,{ass_time(a)},{ass_time(b)},Title,,0,0,0,,{fade}{ass_text(title)}')
                ass.append(f'Dialogue: 1,{ass_time(a)},{ass_time(b)},Label,,0,0,0,,{fade}{ass_text(label)}')
        for a, sid in cues:
            ass.append(f'Dialogue: 2,{ass_time(a)},{ass_time(sub_end[sid])},Sub,,0,0,0,,{ass_text(scenes[sid]["text"])}')
        (tmp / 'promo.ass').write_text('\n'.join(ass) + '\n')

        # Voice at its cues; race music under it, ducked by the voice; the engine lap bed low.
        voice_inputs, delays = [], []
        for k, (a, sid) in enumerate(cues):
            voice_inputs += ['-i', args.voice / takes[sid]['file']]
            delays.append(f'[{k + 3}:a]aresample=48000,adelay={round(a * 1000)}:all=1[v{k}]')
        n = len(cues)
        fc = ';'.join(delays) + ';' + ''.join(f'[v{k}]' for k in range(n)) + \
            f'amix=inputs={n}:normalize=0:duration=longest,apad=whole_dur={total:.3f},asplit=2[voice][key];' \
            f'[1:a]aresample=48000,volume=-15dB,afade=t=in:d=0.6,afade=t=out:st={total - 2.5:.3f}:d=2.5[music];' \
            f'[2:a]aresample=48000,aloop=loop=-1:size=2e9,volume=-24dB,afade=t=out:st={total - 2:.3f}:d=2[engine];' \
            '[music][engine]amix=inputs=2:normalize=0[bed];' \
            '[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];' \
            '[voice][ducked]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout];' \
            f"[0:v]ass={tmp / 'promo.ass'}:fontsdir={fonts}[vout]"
        args.out.mkdir(parents=True, exist_ok=True)
        draft = tmp / 'promo.mp4'
        run(['ffmpeg', '-y', '-loglevel', 'error', '-i', picture, '-stream_loop', '-1', '-i', ROOT / 'assets/audio/music/race-2.ogg',
             '-i', args.engine, *voice_inputs, '-filter_complex', fc, '-map', '[vout]', '-map', '[aout]', '-t', f'{total:.3f}',
             '-r', str(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '11M', '-bufsize', '22M', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
             '-g', str(FPS * 2), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', draft])
        short = digest(draft)[:8]
        final = args.out / f'{args.name}-{short}.mp4'
        final.write_bytes(draft.read_bytes())
        poster = args.out / f'{args.name}-{short}.jpg'
        run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{(stops[3] / FPS) + 1.2:.2f}', '-i', final, '-frames:v', '1', '-q:v', '3', poster])

    vtt = ['WEBVTT', '']
    for a, sid in sorted(cues):
        vtt += [f'{vtt_time(a)} --> {vtt_time(sub_end[sid])}', scenes[sid]['text'], '']
    (args.out / f'{args.name}-{short}.vtt').write_text('\n'.join(vtt))
    receipt = {
        'mp4': final.name, 'sha256': digest(final), 'bytes': final.stat().st_size, 'seconds': seconds(final),
        'fps': FPS, 'size': [W, H], 'voice': {k: manifest[k] for k in ['canonical_voice_id', 'pack_sha256', 'engine', 'api_cost_usd']},
        'cues': [{'start': round(a, 3), 'end': round(sub_end[s], 3), 'id': s, 'text': scenes[s]['text']} for a, s in sorted(cues)],
        'titles': [{'start': round(a, 3), 'end': round(b, 3), 'title': ti, 'label': la} for a, b, ti, la in titles],
        'sources': {'grow': grow, 'loop': json.loads((args.loop / 'capture.json').read_text()), 'tracks': tracks, 'roster': sorted(roster), 'controllers': str(args.controllers), 'keyboard': digest(args.keyboard)},
        'music': 'assets/audio/music/race-2.ogg', 'engine': digest(args.engine),
    }
    (args.out / f'{args.name}-{short}.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(final, f'{receipt["seconds"]:.2f}s', receipt['bytes'])


if __name__ == '__main__':
    main()
