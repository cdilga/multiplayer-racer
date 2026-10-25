from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
FONT=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22)
def row(file,width):
 im=Image.open(file).convert('RGB');im.resize((width,max(1,round(im.height*width/im.width))))
 return im.resize((width,max(1,round(im.height*width/im.width))),Image.Resampling.LANCZOS)
for car in ['postie-bike','pig-catcher']:
 dst=ROOT/'docs/evidence/P1-V-roster-visual'/car
 files=['current-loader/ladder.png','final/damage-strip.png','final/damage-strip-overview.png','final/paints-strip.png','current-loader/colliders.png','final/grid-1.png','final/grid-4.png','final/grid-24.png']
 rows=[(f,row(dst/f,2048)) for f in files[:5]];out=Image.new('RGB',(2048,sum(im.height+38 for _,im in rows)+570),'#fafafa');d=ImageDraw.Draw(out);y=0
 for name,im in rows:d.text((9,y+6),car+' — '+name,fill='#111',font=FONT);out.paste(im,(0,y+38));y+=38+im.height
 for col,name in enumerate(files[5:]):
  im=row(dst/name,682);d.text((col*682+6,y+5),name,fill='#111',font=FONT);out.paste(im,(col*682,y+38))
 out.save(dst/'final-contact.png')
 cols=[]
 for lod in range(3):
  folder=dst/f'current-lod{lod}';a=Image.open(folder/'sheet.png').convert('RGB');b=row(folder/'hero_rear.png',a.width);col=Image.new('RGB',(a.width,a.height+b.height+35),'#fafafa');col.paste(a,(0,0));ImageDraw.Draw(col).text((6,a.height+6),f'LOD{lod}: rear hero (same frozen camera)',fill='#111',font=FONT);col.paste(b,(0,a.height+35));cols.append(col)
 out=Image.new('RGB',(sum(c.width for c in cols),max(c.height for c in cols)),'#fafafa');x=0
 for c in cols:out.paste(c,(x,0));x+=c.width
 out.save(dst/'comparison-contact.png')
