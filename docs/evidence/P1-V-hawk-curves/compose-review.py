"""Labelled reference | before | after | diff sheets for the owner's POC review.
Run after tools/vehicles/fit/capture.mjs has written before-lodN/ and reference-lodN/ here.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw

root = Path(__file__).parent
refs = Path('art/vehicles/hawk-dash/refs/masks')

def trim(im):
    bg = im.getpixel((2, 2)); px = im.load(); w, h = im.size
    xs = [x for x in range(w) for y in range(0, h, 4) if sum(abs(a-b) for a,b in zip(px[x,y][:3],bg[:3])) > 30]
    ys = [y for y in range(h) for x in range(0, w, 4) if sum(abs(a-b) for a,b in zip(px[x,y][:3],bg[:3])) > 30]
    return im.crop((max(0,min(xs)-6),max(0,min(ys)-6),min(w,max(xs)+6),min(h,max(ys)+6))) if xs else im

def fit(im, w, h):
    im = im.copy(); im.thumbnail((w,h), Image.Resampling.LANCZOS)
    return im

for lod in range(3):
    old, new = root/f'before-lod{lod}', root/f'reference-lod{lod}'
    before, after = [json.loads((p/'score.json').read_text()) for p in (old,new)]
    sheet = 'lowest' if lod == 2 else 'lod1'
    canvas = Image.new('RGB',(2000,1420),(245,245,247)); d = ImageDraw.Draw(canvas)
    d.text((16,12),f'Hawk Dash LOD{lod} - wheel budget into body curves - 25 October 2026',fill='black')
    for col,label in enumerate(['REFERENCE','BEFORE (24 Oct)','AFTER (25 Oct)','AFTER silhouette diff']): d.text((col*500+16,38),label,fill='black')
    for row,view in enumerate(['side','front','rear','top']):
        y = 65 + row*255
        paths = [refs/f'{sheet}_{view}.crop.png',old/f'shade_{view}.png',new/f'shade_{view}.png',new/f'diff_{view}.png']
        for col,path in enumerate(paths):
            im = Image.open(path).convert('RGB')
            if col in (1,2): im = trim(im)
            im = fit(im,480,220); canvas.paste(im,(col*500+(500-im.width)//2,y+20))
        d.text((16,y),f'{view} - silhouette IoU {before["views"][view]["iou"]:.4f} -> {after["views"][view]["iou"]:.4f}',fill='black')
    y = 1090
    for col,path in enumerate([refs/f'{sheet}_hero.crop.png',old/'hero.png',new/'hero.png']):
        im = fit(trim(Image.open(path).convert('RGB')),650,280);canvas.paste(im,(col*665+(665-im.width)//2,y))
    d.text((16,1390),f'Weighted silhouette: {before["score"]:.4f} -> {after["score"]:.4f}. Red: reference only. Green: model only. Flat shading; identical fit viewer and paint.',fill='black')
    canvas.save(new/'sheet.png')
