"""Write the POC's plain join QR (no room code, no logo) as an SVG path: qr-roo7.svg.

Usage: python3 art/ui/poc/shared/make-qr.py   (needs the `qrcode` package)
Follows the QR rule in art/ui/tokens.json: error correction M, a 4-module quiet zone, black on white,
nothing in the middle. The mocks place the room code beside it in the display face.
"""
import pathlib

import qrcode

URL = "https://jammers.dilger.dev/j/ROO7"
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
qr.add_data(URL)
qr.make(fit=True)
m = qr.get_matrix()  # includes the border
n = len(m)
path = "".join(f"M{x} {y}h1v1h-1z" for y, row in enumerate(m) for x, on in enumerate(row) if on)
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
    f'<title>Join QR: {URL}</title><rect width="{n}" height="{n}" fill="#FFFFFF"/>'
    f'<path fill="#000000" d="{path}"/></svg>\n'
)
out = pathlib.Path(__file__).with_name("qr-roo7.svg")
out.write_text(svg)
print(f"{out.name}: version {qr.version}, {n} modules incl. quiet zone, {URL}")
