from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

p = Path(__file__).parent
photo = Image.open('art/vehicles/tradie-ute/refs/owner-2026-10-21/20261021_204514.jpg').convert('RGB')
prev = Image.open(p / 'previous-lod0-rear.png').convert('RGB')
cur = Image.open(p / 'current-lod0-rear.png').convert('RGB')

def panel(dst, im, xy, wh, label):
    x,y = xy; w,h = wh
    thumb = ImageOps.contain(im, (w,h-45))
    dst.paste(thumb, (x+(w-thumb.width)//2, y+45+(h-45-thumb.height)//2))
    ImageDraw.Draw(dst).text((x+15,y+15), label, fill='white')

out = Image.new('RGB', (3600,950), '#262a30')
for i,(im,label) in enumerate([(photo,'OWNER PHOTO: uncalibrated night perspective'),(prev,'PREVIOUS: az140 elev14 dist11 fov26'),(cur,'CURRENT: same camera, image size and crop as previous')]):
    panel(out,im,(1200*i,0),(1200,950),label)
out.save(p / 'reference-previous-current.png')

for view in ['underside','front','rear']:
    out = Image.new('RGB',(2400,2250),'#262a30')
    for lod in range(3):
        for i,label in enumerate(['previous','current']):
            panel(out,Image.open(p/f'{label}-lod{lod}-{view}.png'),(i*1200,lod*750),(1200,750),f'{label.upper()} LOD{lod}: {view}; fixed identical comparison camera')
    out.save(p/f'{view}-comparison.png')

out = Image.new('RGB',(2100,1250),'#262a30')
for i,(im,box,label) in enumerate([(photo,(55,160,250,415),'PHOTO: cab roll / inward glass'),(prev,(335,190,650,415),'PREVIOUS: convex cab retained'),(cur,(335,190,650,415),'CURRENT: convex flank / glass retained')]):
    panel(out,im.crop(box),(700*i,0),(700,780),label)
for i,(im,box,label) in enumerate([(photo,(495,403,580,475),'PHOTO: amber/red/white toward centre'),(prev,(825,400,900,452),'PREVIOUS: white incorrectly outside'),(cur,(825,400,900,452),'CURRENT: amber correctly outside')]):
    panel(out,im.crop(box),(700*i,800),(700,450),label)
out.save(p/'regional-comparison.png')

names = ['ladder','damage-strip','damage-strip-overview','paints-strip','grid-1','grid-4','grid-24','colliders']
out = Image.new('RGB',(3000,1950),'#262a30')
for i,name in enumerate(names):
    panel(out,Image.open(p/f'final/{name}.png'),((i%3)*1000,(i//3)*650),(1000,650),f'FINAL {name}')
out.save(p/'final-contact.png')
out = Image.new('RGB',(3000,1000),'#262a30')
for i,name in enumerate(['front-comparison','rear-comparison','underside-comparison']):
    panel(out,Image.open(p/f'{name}.png'),(i*1000,0),(1000,1000),f'{name}: all 3 LODs, previous/current')
out.save(p/'comparison-contact.png')
