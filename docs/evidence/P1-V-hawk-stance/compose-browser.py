"""Contact sheets for the actual local/deployed review-page captures."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).parent
for folder in ['local-page','local-interactions','live-page','live-interactions']:
    q=root/folder
    for group in ['page'] if folder.endswith('page') else ['chromium','webkit']:
        files=sorted(q.glob('*.png')) if group=='page' else sorted(q.glob(group+'-*.png'))
        if not files: continue
        width=500; height=450; cols=5 if group=='page' else 3
        for mode in ['top','full'] if group=='page' else ['stage']:
            out=Image.new('RGB',(cols*width,height*((len(files)+cols-1)//cols)),(240,240,240));d=ImageDraw.Draw(out)
            for i,f in enumerate(files):
                im=Image.open(f).convert('RGB')
                if mode=='top': im=im.crop((0,0,im.width,min(im.height,1400)))
                im.thumbnail((width-12,height-35))
                x=(i%cols)*width;y=(i//cols)*height
                out.paste(im,(x+(width-im.width)//2,y+30));d.text((x+5,y+3),f.stem[-55:],fill='black')
            out.save(q/f'{group}-{mode}-matrix.jpg')
