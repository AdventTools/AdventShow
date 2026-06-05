#!/usr/bin/env python3
"""
Generează imaginea de fundal pentru fereastra .dmg a AdventShow: titlu, indicație
„trage în Applications" și o săgeată mare de la iconița .app (stânga) spre
shortcut-ul /Applications (dreapta). Iconițele în sine sunt desenate de Finder pe
pozițiile din `dmg.contents` (electron-builder.json5) — fundalul pictează doar
textele și săgeata.

Rulare:  python3 scripts/create_dmg_background.py   (necesită Pillow)
Output:  build/dmg-background.png  (540x380, referit din electron-builder.json5)
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write("Pillow (PIL) e necesar: pip3 install Pillow\n")
    sys.exit(1)


WIDTH = 540
HEIGHT = 380

# Centrul vertical al rândului de iconițe (Finder desenează 128x128 centrate aici).
ICON_Y = 230
APP_ICON_X = 140
APPS_ICON_X = 400

# Culori.
BG_TOP = (245, 247, 250)
BG_BOTTOM = (224, 230, 240)
TEXT_PRIMARY = (24, 32, 48)
TEXT_SECONDARY = (90, 100, 120)
ARROW_COLOR = (99, 102, 241)  # accentul AdventShow (indigo)


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def _vertical_gradient(img: Image.Image, top: tuple, bottom: tuple) -> None:
    w, h = img.size
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        for x in range(w):
            px[x, y] = (r, g, b)


def _draw_arrow(draw: ImageDraw.ImageDraw, x1: int, x2: int, y: int) -> None:
    shaft_height = 14
    head_size = 36
    shaft_end = x2 - head_size
    draw.rectangle([x1, y - shaft_height // 2, shaft_end, y + shaft_height // 2], fill=ARROW_COLOR)
    draw.polygon(
        [(shaft_end, y - head_size // 2), (shaft_end, y + head_size // 2), (x2, y)],
        fill=ARROW_COLOR,
    )


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(script_dir, "..", "build", "dmg-background.png")

    img = Image.new("RGB", (WIDTH, HEIGHT), BG_TOP)
    _vertical_gradient(img, BG_TOP, BG_BOTTOM)
    draw = ImageDraw.Draw(img)

    title_font = _load_font(28, bold=True)
    subtitle_font = _load_font(16, bold=False)

    title = "Instalează AdventShow"
    subtitle = "Trage aplicația în dosarul Applications pentru instalare."

    bbox = draw.textbbox((0, 0), title, font=title_font)
    draw.text(((WIDTH - (bbox[2] - bbox[0])) / 2, 50), title, font=title_font, fill=TEXT_PRIMARY)

    bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    draw.text(((WIDTH - (bbox[2] - bbox[0])) / 2, 95), subtitle, font=subtitle_font, fill=TEXT_SECONDARY)

    _draw_arrow(draw, x1=APP_ICON_X + 80, x2=APPS_ICON_X - 80, y=ICON_Y)

    img.save(os.path.abspath(out_path), "PNG", optimize=True)
    print(f"OK: {os.path.abspath(out_path)} ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
