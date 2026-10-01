"""Top-view comparison: stock reference plan view vs the model.  python3 sheet_top.py <render_dir> <out.jpg>"""
import sys
from PIL import Image

d, out = sys.argv[1], sys.argv[2]
ims = [Image.open("../refs/top.png").convert("RGB"), Image.open(f"{d}/v2_top.png").convert("RGB")]
W = 700
ims = [i.resize((W, int(i.height * W / i.width))) for i in ims]
s = Image.new("RGB", (W * 2, max(i.height for i in ims)), "white")
for k, i in enumerate(ims):
    s.paste(i, (k * W, 0))
s.save(out, quality=85)
