#!/usr/bin/env python3
"""Independent rendered-pixel summary for the synthetic F-103 plot fixture."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image


COLORS = {
    "black": (0, 0, 0),
    "red": (255, 0, 0),
    "green": (0, 255, 0),
    "trueColorBlue": (10, 100, 220),
    "transparentRedOnWhite": (255, 102, 102),
    "transparentBlackOnWhite": (102, 102, 102),
    "grayscaleRed": (76, 76, 76),
    "grayscaleGreen": (149, 149, 149),
    "white": (255, 255, 255),
}


def summarize(label: str, path_text: str) -> dict[str, object]:
    path = Path(path_text).resolve(strict=True)
    data = path.read_bytes()
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        pixels = list(rgb.get_flattened_data())
        counts = {name: pixels.count(color) for name, color in COLORS.items()}
        counts["transparentRedOnWhiteRange"] = sum(1 for r, g, b in pixels if r >= 250 and 90 <= g <= 115 and 90 <= b <= 115)
        counts["transparentBlackOnWhiteRange"] = sum(1 for r, g, b in pixels if 90 <= r <= 115 and r == g == b)
        counts["trueColorBlueRange"] = sum(1 for r, g, b in pixels if r < 200 and g < 220 and b > 200 and b > g + 20)
        extrema = rgb.getextrema()
        return {
            "label": label,
            "width": rgb.width,
            "height": rgb.height,
            "mode": rgb.mode,
            "sha256": hashlib.sha256(data).hexdigest(),
            "counts": counts,
            "extrema": extrema,
        }


def main() -> int:
    entries: dict[str, object] = {}
    for argument in sys.argv[1:]:
        if "=" not in argument:
            raise ValueError("Expected label=path arguments.")
        label, path = argument.split("=", 1)
        if not label or label in entries:
            raise ValueError(f"Invalid or duplicate label: {label!r}")
        entries[label] = summarize(label, path)
    if not entries:
        raise ValueError("At least one rendered PNG is required.")
    print(json.dumps({"schemaVersion": 1, "images": entries}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
