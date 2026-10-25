#!/usr/bin/env python3
"""Free local Stevo promo narration: retained private takes, transcript QC, Opus exports.

Run with --private-dir /outside/git; --publish installs only a complete passing batch.
The shared voice library owns enrollment/settings. This driver never calls an API.
"""
import argparse
import array
import hashlib
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VOICE = 'stevo-australian-announcer-v1'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)


def measure(path):
    proc = command(['ffmpeg', '-hide_banner', '-i', path, '-af',
                    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
                    '-f', 'null', '-'], capture_output=True, text=True)
    return json.JSONDecoder().raw_decode(proc.stderr[proc.stderr.rfind('{'):])[0]


def norm(text):
    # Case/punctuation, number orthography and vehicle-name orthography only.
    # These do not substitute missing or changed words. No prompt biases ASR.
    text = text.lower().replace('64', 'sixty four').replace('sixty-four', 'sixty four').replace('16', 'sixteen')
    text = re.sub(r'\b4\b', 'four', re.sub(r'\b1\b', 'one', text))
    text = re.sub(r'\bcruise\b', 'cruz', text)
    text = re.sub(r'\bau\b', 'a u', text)
    text = re.sub(r'\bposty\b', 'postie', text)
    text = re.sub(r"['’]", '', text)
    return re.findall(r'[a-z]+', text)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--private-dir', type=Path, required=True)
    ap.add_argument('--library', type=Path, default=Path.home()/'Documents/dev/Voices')
    ap.add_argument('--model', type=Path, default=Path.home()/'.cache/franken_whisper_models/ggml-large-v3.bin')
    ap.add_argument('--storyboard', type=Path, default=ROOT/'tools/promo/stevo-storyboard.json')
    ap.add_argument('--selections', type=Path, help='Private JSON mapping scene IDs to integer take seeds')
    ap.add_argument('--publish', action='store_true')
    args = ap.parse_args()
    private = args.private_dir.expanduser().resolve()
    if private.is_relative_to(ROOT):
        ap.error('Use a private directory outside the project working tree.')
    private.mkdir(parents=True, exist_ok=True)
    scenes = json.loads(args.storyboard.read_text())['scenes']
    registry = json.loads((args.library/'voices.json').read_text())
    selected = next(v for v in registry['voices'] if v['voice_id'] == VOICE)
    recipe = json.loads((args.library/selected['recipe']).read_text())
    assert recipe['conditioning_mode'] == 'quality'
    picks = json.loads(args.selections.read_text()) if args.selections else {}
    rows = []
    for scene in scenes:
        seed = picks.get(scene['id'], 251025)
        raw = private/f'{scene["id"]}-{seed}.wav'
        metadata = raw.with_suffix('.wav.json')
        if not metadata.exists():
            command(['python3', args.library/'render-frankentts.py', '--voice', VOICE,
                     '--text', scene['text'], '--seed', seed, '--timeout', 900, '--out', raw])
        take = json.loads(metadata.read_text())
        assert take['voice_id'] == VOICE and take['text'] == scene['text']
        assert take['output_sha256'] == sha(raw)
        assert take['conditioning_mode'] == 'quality' and take['pack_sha256'] == recipe['pack_sha256']
        reportpath = raw.with_suffix('.asr.json')
        if not reportpath.exists():
            print('Transcribing', scene['id'], flush=True)
            with reportpath.open('w') as out, raw.with_suffix('.asr.stderr').open('w') as err:
                command(['fw', 'transcribe', '--input', raw, '--backend', 'whisper-cpp',
                         '--model', args.model, '--language', 'en', '--no-diarize',
                         '--no-persist', '--json'], stdout=out, stderr=err)
        report = json.loads(reportpath.read_text())
        result = report['result']
        transcript = result['transcript']
        raw_loudness = measure(raw)
        with wave.open(str(raw)) as wav:
            assert wav.getsampwidth() == 2
            data = array.array('h', wav.readframes(wav.getnframes()))
            if sys.byteorder != 'little':
                data.byteswap()
            peak = max(abs(x) for x in data)/32768
        opus = private/f'promo3-{scene["id"]}.ogg'
        # Gain to the target, then a peak limiter: linear loudnorm cannot add gain to a short, peaky line without
        # passing the true-peak ceiling. All speech and its natural pauses are kept. The limiter takes a little level
        # off, so the gain is corrected from the decoded measurement (at most three passes).
        gain = -16 - float(raw_loudness['input_i'])
        for _ in range(3):
            filt = f'aresample=192000,volume={gain:.2f}dB,alimiter=limit=0.75:level=false:attack=1:release=60,aresample=48000'
            command(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', filt,
                     '-ar', '48000', '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', opus])
            decoded = measure(opus)
            if abs(float(decoded['input_i']) + 16) <= 0.5:
                break
            gain += -16 - float(decoded['input_i'])
        duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                         'format=duration', '-of', 'csv=p=0', str(opus)], text=True))
        words = len(scene['text'].split())
        screens = {
            'wording': norm(transcript) == norm(scene['text']),
            'duration': .4+.15*words <= duration <= 2+.6*words,
            'raw_unclipped': peak < .999,
            'raw_audible': float(raw_loudness['input_i']) >= -45,
            'decoded_loudness': abs(float(decoded['input_i'])+16) <= 1,
            'decoded_true_peak': float(decoded['input_tp']) <= -1,
        }
        row = {'id': scene['id'], 'text': scene['text'], 'file': opus.name,
               'sha256': sha(opus), 'seconds': duration, 'seed': seed,
               'raw_sha256': sha(raw), 'raw_peak_amplitude': peak,
               'raw_lufs': float(raw_loudness['input_i']),
               'decoded_lufs': float(decoded['input_i']),
               'decoded_true_peak_dbtp': float(decoded['input_tp']),
               'transcript': transcript, 'asr_run_id': report.get('run_id'),
               'asr_segments': result.get('segments', []),
               'screens': screens, 'pass': all(screens.values())}
        rows.append(row)
        print(scene['id'], round(duration, 3), 'PASS' if row['pass'] else 'FLAG', transcript, flush=True)
    manifest = {'schema_version': 1, 'canonical_voice_id': VOICE,
                'conditioning_mode': 'quality', 'training': recipe['training'],
                'pack_sha256': recipe['pack_sha256'], 'engine': recipe['engine'],
                'profile': 'strict', 'math_mode': 'strict', 'api_cost_usd': 0,
                'storyboard_sha256': sha(args.storyboard),
                'asr': {'engine': subprocess.check_output(['fw', '--version'], text=True).splitlines()[0],
                        'model': args.model.name, 'model_sha256': sha(args.model),
                        'prompt': None, 'normalization': 'Case/punctuation, digits 1/4/16/64 as words, Cruise/Cruz, AU/A U, Posty/Postie.'},
                'human_listening': 'Not performed; transcript and signal screens are automated checks, not accent approval.',
                'rows': rows, 'summary': {'pass': sum(row['pass'] for row in rows),
                                         'fail': sum(not row['pass'] for row in rows)}}
    (private/'promo3-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    if args.publish:
        if manifest['summary']['fail']:
            sys.exit('Refusing to install flagged batch; retained private QC for targeted retakes.')
        # Trailer narration, not game audio: outside assets/audio/voice, which the host bundles whole.
        public = ROOT/'assets/promo/voice'
        public.mkdir(parents=True, exist_ok=True)
        for row in rows:
            (public/row['file']).write_bytes((private/row['file']).read_bytes())
        (public/'promo3-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        evidence = ROOT/'docs/evidence/P1-PROMO3'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence/'voice-qc.json').write_text(json.dumps(manifest, indent=2)+'\n')


if __name__ == '__main__':
    main()
