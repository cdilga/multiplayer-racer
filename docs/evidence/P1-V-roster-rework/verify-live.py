"""Check public POC bytes against the committed review candidate, without trusting a deploy status."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import datetime, hashlib, json, subprocess

root = Path(__file__).parent
base = 'https://jammers-preview.dilger.dev/'
cars = ['au-hawk', 'cruz-missile', 'lion-president', 'pig-catcher', 'postie-bike', 'tradie-ute']
paths = ['poc/vehicles/review.js', 'poc/vehicles/viewer.js', 'poc/shared/paint-key.js']
for car in cars:
    prefix = f'poc/vehicles/{car}/'
    r = json.loads((Path('art/ui') / prefix / 'review.json').read_text())
    paths.append(prefix + 'review.json')
    paths += [prefix + r['turntable'][k] for k in ['assetJson', 'atlas', 'emissive']]
    paths += [prefix + lod['glb'] for lod in r['turntable']['lods']]
    paths += [prefix + r['reference']['sheet']]
    paths += [prefix + c['sheet'] for c in r['reference']['compare']]
    if r['reference'].get('measured'):
        paths += [prefix + r['reference']['measured'][k] for k in ['oracle', 'report']]
    paths.append(prefix + r['gate']['report'])

# Verify every generated per-car payload too, including damage, paints and grids.
for car in cars:
    paths += [str(p.relative_to('art/ui')) for p in (Path('art/ui/poc/vehicles') / car).rglob('*') if p.is_file()]

def check(path):
    body = subprocess.check_output(['curl', '-fsS', '--max-time', '30', base + path])
    sha = hashlib.sha256(body).hexdigest()
    expected = hashlib.sha256((Path('art/ui') / path).read_bytes()).hexdigest()
    return dict(path=path, bytes=len(body), sha256=sha, expected=expected, match=sha == expected)

with ThreadPoolExecutor(max_workers=5) as pool:
    files = list(pool.map(check, dict.fromkeys(paths)))
commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', 'art/vehicles/postie-bike/model.js'], text=True).strip()
result = dict(utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), commit=commit, base=base, files=files)
(root / 'deployment.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'{sum(x["match"] for x in files)}/{len(files)} public files match the reviewed candidate')
raise SystemExit(0 if all(x['match'] for x in files) else 1)
