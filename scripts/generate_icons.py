import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "static" / "icons"


def ensure_icons():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        image = Image.new("RGBA", (size, size), "#4f46e5")
        draw = ImageDraw.Draw(image)
        text = "FS"
        font_size = int(size * 0.45)
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except OSError:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        draw.text(
            ((size - text_width) / 2, (size - text_height) / 2),
            text,
            fill="white",
            font=font,
        )

        image.save(OUTPUT_DIR / f"icon-{size}x{size}.png")
        print(f"Generated icon-{size}x{size}.png")


if __name__ == "__main__":
    ensure_icons()

