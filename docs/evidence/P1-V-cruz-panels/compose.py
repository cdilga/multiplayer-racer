from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
p=Path(__file__).parent
out=Image.new('RGB',(2100,5*420),'#eeeeee');d=ImageDraw.Draw(out)
for row,view in enumerate(['body','side','front','underside']):
 for col,stage in enumerate(['before-fixed','after-fixed']):
  im=ImageOps.contain(Image.open(p/stage/f'{view}.png'),(1030,380))
  out.paste(im,(col*1050+(1050-im.width)//2,row*420+35))
  d.text((col*1050+8,row*420+8),f'{stage}: {view}; identical world camera and size',fill='black')
for col,view in enumerate(['hero','side','front']):
 im=ImageOps.contain(Image.open(f'art/vehicles/cruz-missile/refs/masks/lod1_{view}.crop.png'),(690,360))
 out.paste(im,(col*700+(700-im.width)//2,4*420+35));d.text((col*700+8,4*420+8),f'REFERENCE {view}: aspect preserved, uncalibrated',fill='black')
out.save(p/'visual-comparison.png')
files=list((p/'final').glob('*.png'))
out=Image.new('RGB',(1800,((len(files)+1)//2)*650),'#eeeeee');d=ImageDraw.Draw(out)
for i,f in enumerate(files):
 im=ImageOps.contain(Image.open(f),(890,610));x=i%2*900;y=i//2*650
 out.paste(im,(x+(900-im.width)//2,y+30));d.text((x+8,y+8),f.name,fill='black')
out.save(p/'loader-contact.png')
