"""Verify deployed review bytes against this checkout; curl uses the public POC URL."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import datetime, hashlib, json, subprocess

root=Path(__file__).parent
base='https://jammers-preview.dilger.dev/'
paths=['poc/vehicles/hawk-dash/review.json','poc/vehicles/viewer.js','poc/shared/paint-key.js','poc/vehicles/hawk-dash/media/model/hawk-dash.atlas.png']
paths += [f'poc/vehicles/hawk-dash/media/model/hawk-dash.lod{i}.glb' for i in range(3)]
paths += [f'poc/vehicles/hawk-dash/media/reference-lod{i}/sheet.png' for i in range(3)]
def check(path):
    body=subprocess.check_output(['curl','-fsS',base+path])
    sha=hashlib.sha256(body).hexdigest()
    expected=hashlib.sha256((Path('art/ui')/path).read_bytes()).hexdigest()
    return dict(path=path,bytes=len(body),sha256=sha,expected=expected,match=sha==expected)
with ThreadPoolExecutor(max_workers=5) as pool: files=list(pool.map(check,paths))
result=dict(utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),commit='8430ec49',base=base,files=files)
(root/'deployment.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'{sum(x["match"] for x in files)}/{len(files)} deployed files match')
raise SystemExit(0 if all(x['match'] for x in files) else 1)
