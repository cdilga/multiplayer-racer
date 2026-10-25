from PIL import Image,ImageDraw
from pathlib import Path
import json
D=Path(__file__).parent
before=Image.open(D/'before/ladder.png').convert('RGB');after=Image.open(D/'final/ladder.png').convert('RGB')
out=Image.new('RGB',(1536,740),'#edf0f2');draw=ImageDraw.Draw(out)
for row,(im,label) in enumerate([(before,'BEFORE'),(after,'REVISED')]):
    for i,(a,b,view) in enumerate([(440,880,'Front 3/4'),(880,1320,'Side'),(1320,1760,'Rear 3/4')]):
        crop=im.crop((a,0,b,460));crop.thumbnail((510,330));out.paste(crop,(i*512,row*370+35));draw.text((i*512+12,row*370+12),f'{label} — {view}',fill='#202428')
out.save(D/'comparison.png')
b=json.loads((D/'before-shape-check.json').read_text())['lods'][0];a=json.loads((D/'shape-check.json').read_text())['lods'][0]
out=Image.new('RGB',(1100,530),'#f6f7f8');d=ImageDraw.Draw(out)
d.text((20,15),'Current geometry section checks; qualitative source-informed bands, not calibrated photo reconstruction',fill='#202428')
d.text((20,40),'Blue: previous. Green: revised. Half-width at rear cab z=-0.65m.',fill='#202428')
ys=[.65,.80,1.20,1.30]
for q,color in [(b,'#336fc2'),(a,'#21854e')]:
    for sign in [-1,1]:
        pts=[(275+sign*w*235,450-(y-.55)*430) for w,y in zip(q['widthHalfMetres'],ys)]
        d.line(pts,fill=color,width=4)
        for x,y in pts:d.ellipse((x-3,y-3,x+3,y+3),fill=color)
for y in ys:
    yy=450-(y-.55)*430;d.line((40,yy,500,yy),fill='#d7dce0');d.text((16,yy-15),f'y={y:.2f}',fill='#444c54')
d.text((580,75),'Nose plan: centre / middle / corner at x=0 / .45 / .73m',fill='#202428')
for q,color in [(b,'#336fc2'),(a,'#21854e')]:
    pts=[(650+x*460,155+(2.32-z)*1300) for x,z in zip([0,.45,.73],q['noseZMetres'])]
    d.line(pts,fill=color,width=4)
    for x,y in pts:d.ellipse((x-3,y-3,x+3,y+3),fill=color)
d.text((580,380),'Previous: flat end cap and straight flank.',fill='#336fc2');d.text((580,408),'Revised: intermediate nose facets and returning shoulder.',fill='#21854e')
d.text((20,495),'Owner photographs govern cab/tray cues; newer owner source supports front interpretation. See refs/shape-reference.json.',fill='#444c54')
out.save(D/'local-shape.png')
