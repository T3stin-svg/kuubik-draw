#!/usr/bin/env python3
"""Independent Poppler-rendered pixel summary for F-106 outputs."""

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
        black = non_white = 0
        bounds = [rgb.width, rgb.height, -1, -1]
        for index, (red, green, blue) in enumerate(rgb.get_flattened_data()):
            if (red, green, blue) != (255, 255, 255):
                non_white += 1
                x = index % rgb.width
                y = index // rgb.width
                bounds = [min(bounds[0], x), min(bounds[1], y), max(bounds[2], x), max(bounds[3], y)]
            if red < 50 and green < 50 and blue < 50:
                black += 1
        return {
            "label": label, "width": rgb.width, "height": rgb.height, "mode": rgb.mode,
            "sha256": hashlib.sha256(data).hexdigest(), "counts": {"black": black, "nonWhite": non_white},
            "paintedBounds": bounds, "extrema": rgb.getextrema(),
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
