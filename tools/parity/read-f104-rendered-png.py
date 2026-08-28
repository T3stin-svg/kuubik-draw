#!/usr/bin/env python3
"""Independent Poppler-rendered pixel summary for the F-104 A3 fixture."""

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
        counts = {"red": 0, "redAlphaOnWhite": 0, "blue": 0, "black": 0, "nonWhite": 0, "leftRed": 0, "rightBlue": 0}
        for index, (red, green, blue) in enumerate(rgb.get_flattened_data()):
            x = index % rgb.width
            if (red, green, blue) != (255, 255, 255):
                counts["nonWhite"] += 1
            if red > 230 and green < 40 and blue < 40:
                counts["red"] += 1
                if x < rgb.width / 2:
                    counts["leftRed"] += 1
            if red > 245 and 80 <= green <= 125 and 80 <= blue <= 125:
                counts["redAlphaOnWhite"] += 1
            if red < 40 and green <= 140 and blue > 180:
                counts["blue"] += 1
                if x > rgb.width / 2:
                    counts["rightBlue"] += 1
            if red < 40 and green < 40 and blue < 40:
                counts["black"] += 1
        return {
            "label": label, "width": rgb.width, "height": rgb.height, "mode": rgb.mode,
            "sha256": hashlib.sha256(data).hexdigest(), "counts": counts, "extrema": rgb.getextrema(),
        }


def main() -> int:
    entries: dict[str, object] = {}
    for argument in sys.argv[1:]:
        label, separator, path = argument.partition("=")
        if not separator or not label or label in entries:
            raise ValueError(f"Invalid or duplicate label: {label!r}")
        entries[label] = summarize(label, path)
    if not entries:
        raise ValueError("At least one rendered PNG is required.")
    print(json.dumps({"schemaVersion": 1, "images": entries}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
