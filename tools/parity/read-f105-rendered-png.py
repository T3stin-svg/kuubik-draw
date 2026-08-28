#!/usr/bin/env python3
"""Summarize Poppler-rendered F-105 pages without trusting the PDF writer."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image


def summarize(label: str, path_text: str) -> dict[str, object]:
    path = Path(path_text).resolve(strict=True)
    data = path.read_bytes()
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        counts = {"red": 0, "blue": 0, "black": 0, "nonWhite": 0}
        for red, green, blue in rgb.get_flattened_data():
            if (red, green, blue) != (255, 255, 255):
                counts["nonWhite"] += 1
            if red > 180 and green < 100 and blue < 100:
                counts["red"] += 1
            if blue > 150 and blue > red + 60 and blue > green + 40:
                counts["blue"] += 1
            if red < 50 and green < 50 and blue < 50:
                counts["black"] += 1
        return {
            "label": label,
            "width": rgb.width,
            "height": rgb.height,
            "sha256": hashlib.sha256(data).hexdigest(),
            "counts": counts,
            "extrema": rgb.getextrema(),
        }


def main(arguments: list[str]) -> None:
    images: dict[str, object] = {}
    for argument in arguments:
        label, separator, path = argument.partition("=")
        if not separator or not label or label in images:
            raise SystemExit(f"Invalid or duplicate labelled path: {argument}")
        images[label] = summarize(label, path)
    if not images:
        raise SystemExit("At least one image is required.")
    print(json.dumps({"schemaVersion": 1, "images": images}))


if __name__ == "__main__":
    main(sys.argv[1:])
