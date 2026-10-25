from PIL import Image,ImageDraw,ImageFont,ImageChops
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
FONT=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',19)
def fit(im,box):
 im=im.copy();im.thumbnail(box,Image.Resampling.LANCZOS);return im
for car in ['postie-bike','pig-catcher']:
 dst=ROOT/'docs/evidence/P1-V-roster-visual'/car
 cfg=json.loads((ROOT/'art/vehicles'/car/'refs/sheets.json').read_text())
 ref=Image.open(ROOT/'art/vehicles'/car/'refs/lod-plus-1.png').convert('RGB')
 board=Image.new('RGB',(2100,1610),'#f4f4f4');d=ImageDraw.Draw(board)
 for i,t in enumerate(['REFERENCE (aspect preserved; generated, uncalibrated)','PREVIOUS (frozen diagnostic cameras)','CURRENT (same cameras and common crop)']):d.text((i*700+10,12),t,fill='#111111',font=FONT)
 for row,view in enumerate(['side','front','hero']):
  top=48+row*510;d.text((8,top),view.upper(),fill='#111111',font=FONT)
  r=ref.crop(tuple(cfg['views'][view]))
  old=Image.open(dst/'baseline-lod0'/('hero.png' if view=='hero' else f'shade_{view}.png')).convert('RGB')
  new=Image.open(dst/'current-lod0'/('hero.png' if view=='hero' else f'shade_{view}.png')).convert('RGB')
  # OLD and NEW use the exact same crop and uniform transform, preserving all proportions.
  if view=='hero': crop=(340,100,860,440)
  else: crop=(0,0,old.width,old.height)
  for col,im in enumerate([r,old.crop(crop),new.crop(crop)]):
   im=fit(im,(680,465));board.paste(im,(col*700+(700-im.width)//2,top+30+(465-im.height)//2))
 board.save(dst/'visual-comparison.png')
 # A direct close view: no rescaling/reframing between old and new.
 out=Image.new('RGB',(1560,550),'#f4f4f4');dr=ImageDraw.Draw(out)
 for col,folder in enumerate(['baseline-lod0','current-lod0']):
  im=Image.open(dst/folder/'hero.png').crop((430,145,785,380)).resize((780,516),Image.Resampling.NEAREST)
  out.paste(im,(780*col,34));dr.text((780*col+8,7),folder+' — tank, engine, rider, attachment',fill='#111111',font=FONT)
 out.save(dst/'regional-comparison.png')
