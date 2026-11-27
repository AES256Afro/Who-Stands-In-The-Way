#!/usr/bin/env python3
"""Draws the site-wide link-preview image public/og.png (1200x630). Run: .venv/bin/python scripts/make_og.py"""
import pathlib
from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "og.png"
W, H = 1200, 630
img = Image.new("RGB", (W, H), "#111214")
d = ImageDraw.Draw(img)


def font(size, bold=True):
    for path in ["/System/Library/Fonts/Supplemental/Georgia Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Georgia.ttf",
                 "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial.ttf"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


colors = ["#0e8f7e", "#b98b00", "#8a63d2", "#6b6f78", "#d8483f"]
for i, c in enumerate(colors):
    d.rectangle([i * W / 5, 0, (i + 1) * W / 5, 14], fill=c)
d.text((64, 70), "Who Stands", font=font(40), fill="#f1f0ec")
d.text((64 + d.textlength("Who Stands ", font=font(40)), 70), "In The Way", font=font(40), fill="#d8483f")
d.text((64, 170), "Who supports Medicare for All,", font=font(64), fill="#f1f0ec")
d.text((64, 250), "and who stands in the way?", font=font(64), fill="#f1f0ec")
d.text((64, 370), "Every member of the Congress sworn in January 2027:", font=font(30, False), fill="#b9bbc1")
d.text((64, 412), "where they stand, who funds them, and how to call them.", font=font(30, False), fill="#b9bbc1")
# a row of dots echoing the seat charts
import random
random.seed(4)
for i in range(46):
    c = random.choices(colors, weights=[27, 12, 15, 23, 23])[0]
    x = 64 + i * 23.5
    d.ellipse([x, 520, x + 17, 537], fill=c)
OUT.parent.mkdir(exist_ok=True)
img.save(OUT, optimize=True)
print(OUT, OUT.stat().st_size)
