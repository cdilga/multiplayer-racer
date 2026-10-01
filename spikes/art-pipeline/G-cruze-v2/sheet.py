"""Contact sheet: concept + six review renders.  python3 sheet.py <render_dir> <out.jpg>"""
import sys
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
names = ["hero", "hero_left", "hero_rear", "side", "front", "rear"]
ims = [Image.open("../../../art/style/refs/hero_cruz_missile_v2a.png").convert("RGB")]
ims += [Image.open(f"{d}/v2_{n}.png").convert("RGB") for n in names]
thumb = Image.open(f"{d}/v2_thumb40.png").convert("RGB")
W = 560
ims = [i.resize((W, int(i.height * W / i.width))) for i in ims]
H = max(i.height for i in ims)
s = Image.new("RGB", (W * 4, H * 2), "white")
for k, i in enumerate(ims):
    s.paste(i, ((k % 4) * W, (k // 4) * H))
s.paste(thumb.resize((240, 160), Image.NEAREST), (3 * W + 20, H + 20))
s.paste(thumb, (3 * W + 280, H + 20))
s.save(out, quality=85)
